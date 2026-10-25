"""Small, atomic operations for the CRM; every change leaves an activity."""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import Activity, Opportunity


EDITABLE_FIELDS = {
    "name", "phone", "email", "company", "city", "interest", "product_code",
    "configuration", "source", "campaign", "medium", "stage", "assignee",
    "next_followup", "quote_amount", "currency", "loss_reason", "loss_detail",
}
CONFLICT_MESSAGE = "Otra persona actualizó esta oportunidad. Recarga la ficha antes de guardar para conservar ambos cambios."


def _version_check(opportunity, expected_version):
    try:
        parsed = int(expected_version)
    except (TypeError, ValueError, OverflowError):
        raise ValidationError("Falta la versión de la ficha. Recárgala antes de guardar.", code="version_required")
    if isinstance(expected_version, bool) or parsed != opportunity.version:
        raise ValidationError(CONFLICT_MESSAGE, code="conflict")


def _validate_assignee(assignee):
    if assignee is not None and not (
        assignee.is_active and assignee.is_staff
        and assignee.has_perm("crm.view_opportunity") and assignee.has_perm("crm.change_opportunity")
    ):
        raise ValidationError({"assignee": "Elige una cuenta activa con acceso al CRM."})


def _payload(data, *, creating=False):
    values = dict(data)
    # These are transport fields, never directly assigned to the database model.
    values.pop("version", None)
    reason = str(values.pop("reopen_reason", "") or "").strip()
    if len(reason) > 1000:
        raise ValidationError({"reopen_reason": "Usa como máximo 1000 caracteres."})
    permitted = EDITABLE_FIELDS | ({"submission_id", "submission_fingerprint"} if creating else set())
    if set(values) - permitted:
        raise ValidationError("La solicitud contiene campos que no se pueden modificar.")
    if "assignee" in values:
        _validate_assignee(values["assignee"])
    return values, reason


def _milestones(opportunity, now):
    if opportunity.stage == Opportunity.Stage.QUOTED and opportunity.quoted_at is None:
        opportunity.quoted_at = now
    if opportunity.stage in {Opportunity.Stage.WON, Opportunity.Stage.DELIVERED} and opportunity.won_at is None:
        opportunity.won_at = now
    if opportunity.stage == Opportunity.Stage.DELIVERED and opportunity.delivered_at is None:
        opportunity.delivered_at = now
    if opportunity.is_closed:
        opportunity.next_followup = None


def _activity(opportunity, kind, body, actor):
    return Activity.objects.create(opportunity=opportunity, actor=actor, kind=kind, body=body)


@transaction.atomic
def create_opportunity(data, actor=None):
    values, _ = _payload(data, creating=True)
    opportunity = Opportunity(**values)
    _milestones(opportunity, timezone.now())
    opportunity.save()
    origin = "Solicitud recibida desde la web" if actor is None else "Oportunidad registrada"
    _activity(opportunity, Activity.Kind.CREATED, f"{origin}. Estado: {opportunity.get_stage_display()}.", actor)
    return opportunity


@transaction.atomic
def update_opportunity(opportunity_id, data, actor, expected_version):
    opportunity = Opportunity.objects.select_for_update().get(pk=opportunity_id)
    _version_check(opportunity, expected_version)
    values, reopen_reason = _payload(data)
    previous_stage = opportunity.stage
    next_stage = values.get("stage", previous_stage)
    reopening = (
        opportunity.is_closed and next_stage != previous_stage
        and not (previous_stage == Opportunity.Stage.WON and next_stage == Opportunity.Stage.DELIVERED)
    )
    if reopening and not reopen_reason:
        raise ValidationError({"reopen_reason": "Explica por qué cambias una oportunidad cerrada; el historial se conservará."})
    previous_loss = opportunity.get_loss_reason_display() if opportunity.loss_reason else ""
    changes = []
    for field, value in values.items():
        old = getattr(opportunity, field)
        if old != value:
            changes.append(str(Opportunity._meta.get_field(field).verbose_name))
            setattr(opportunity, field, value)
    if not changes:
        return opportunity
    if reopening and opportunity.stage != Opportunity.Stage.LOST:
        opportunity.loss_reason = ""
        opportunity.loss_detail = ""
    _milestones(opportunity, timezone.now())
    opportunity.version += 1
    opportunity.save()
    labels = dict(Opportunity.Stage.choices)
    if previous_stage != opportunity.stage:
        body = f"Estado: {labels[previous_stage]} → {opportunity.get_stage_display()}."
        if opportunity.stage == Opportunity.Stage.LOST:
            body += f" Motivo: {opportunity.get_loss_reason_display()}."
            if opportunity.loss_detail:
                body += f" {opportunity.loss_detail}"
        if reopening:
            body += f" Cambio de cierre autorizado: {reopen_reason}."
            if previous_loss:
                body += f" Motivo anterior: {previous_loss}."
        other_changes = [field for field in changes if field != "estado"]
        if other_changes:
            body += " Otros datos actualizados: " + ", ".join(other_changes) + "."
        _activity(opportunity, Activity.Kind.STAGE, body, actor)
    else:
        _activity(opportunity, Activity.Kind.UPDATED, "Datos actualizados: " + ", ".join(changes) + ".", actor)
    return opportunity


def _note_text(body, *, required=True):
    text = str(body or "").strip()
    if required and not text:
        raise ValidationError("Escribe una nota antes de guardarla.")
    if len(text) > 4000:
        raise ValidationError("La nota debe tener como máximo 4000 caracteres.")
    return text


@transaction.atomic
def add_note(opportunity_id, body, actor, expected_version=None):
    opportunity = Opportunity.objects.select_for_update().get(pk=opportunity_id)
    if expected_version is not None:
        _version_check(opportunity, expected_version)
    text = _note_text(body)
    opportunity.version += 1
    opportunity.save()
    _activity(opportunity, Activity.Kind.NOTE, text, actor)
    return opportunity


@transaction.atomic
def mark_contacted(opportunity_id, actor, expected_version, body=""):
    opportunity = Opportunity.objects.select_for_update().get(pk=opportunity_id)
    _version_check(opportunity, expected_version)
    text = _note_text(body, required=False)
    if opportunity.first_contact_at is None:
        opportunity.first_contact_at = timezone.now()
    opportunity.version += 1
    opportunity.save()
    _activity(opportunity, Activity.Kind.CONTACT, text or "Se registró un contacto realizado con el cliente.", actor)
    return opportunity
