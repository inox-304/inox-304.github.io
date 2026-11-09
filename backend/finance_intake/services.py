"""Signed receipts can only be linked by the owner to explicitly reviewed drafts."""
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from finance.permissions import is_owner

from .configuration import connection_status
from .models import IntakeAudit, IntakeMessage


def require_inbox_owner(actor):
    if not is_owner(actor):
        raise PermissionDenied


@transaction.atomic
def link_receipt(pk, movement, *, actor):
    from finance.models import Movement

    require_inbox_owner(actor)
    receipt = IntakeMessage.objects.select_for_update().get(pk=pk)
    movement = Movement.objects.select_for_update().select_related("account", "company").get(pk=movement.pk)
    if receipt.status not in (IntakeMessage.Status.PENDING, IntakeMessage.Status.NEEDS_REVIEW):
        raise ValidationError("Este mensaje ya fue revisado; no se puede reutilizar.")
    if movement.status != "draft":
        raise ValidationError("Vincula el mensaje a un borrador antes de confirmarlo.")
    if not movement.company.active:
        raise ValidationError("La empresa del movimiento está inactiva.")
    if movement.account.method != receipt.method:
        raise ValidationError("El medio de la cuenta no coincide con el grupo de origen. Revisa el movimiento.")
    if IntakeMessage.objects.filter(movement=movement).exists():
        raise ValidationError("Este borrador ya tiene un mensaje de origen. No lo registres dos veces.")
    receipt.status = IntakeMessage.Status.LINKED
    receipt.movement = movement
    receipt.reviewed_by = actor
    receipt.reviewed_at = timezone.now()
    receipt.note = "Empresa y cuenta elegidas manualmente; mensaje vinculado a borrador."
    receipt.save(update_fields=["status", "movement", "reviewed_by", "reviewed_at", "note"])
    IntakeAudit.objects.create(receipt=receipt, actor=actor, action="linked", detail=f"Vinculado al movimiento {movement.pk}.")
    return receipt


@transaction.atomic
def ignore_receipt(pk, reason, *, actor):
    require_inbox_owner(actor)
    reason = str(reason or "").strip()
    if not 8 <= len(reason) <= 2000:
        raise ValidationError("Explica el motivo para descartar el mensaje (entre 8 y 2000 caracteres).")
    receipt = IntakeMessage.objects.select_for_update().get(pk=pk)
    if receipt.status not in (IntakeMessage.Status.PENDING, IntakeMessage.Status.NEEDS_REVIEW):
        raise ValidationError("Este mensaje ya fue revisado.")
    receipt.status = IntakeMessage.Status.IGNORED
    receipt.note = reason
    receipt.reviewed_by = actor
    receipt.reviewed_at = timezone.now()
    receipt.save(update_fields=["status", "note", "reviewed_by", "reviewed_at"])
    IntakeAudit.objects.create(receipt=receipt, actor=actor, action="ignored", detail=reason)
    return receipt
