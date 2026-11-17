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


def link_receipt(pk, movement, *, actor):
    from django.core.files.base import ContentFile
    from finance import services as finance_services
    from finance.models import Attachment, Company, Movement
    from .processing import ProcessingFailure, _original_bytes, _remove_created_file

    require_inbox_owner(actor)
    created_attachment = None
    try:
        with transaction.atomic():
            reference = Movement.objects.only("company_id").get(pk=movement.pk)
            # Match financial edits: company first, movement second, receipt last.
            company = Company.objects.select_for_update().get(pk=reference.company_id)
            movement = Movement.objects.select_for_update().get(pk=movement.pk)
            receipt = IntakeMessage.objects.select_for_update().get(pk=pk)
            if receipt.status not in (IntakeMessage.Status.PENDING, IntakeMessage.Status.NEEDS_REVIEW):
                raise ValidationError("Este mensaje ya fue revisado; no se puede reutilizar.")
            if movement.status != "draft":
                raise ValidationError("Vincula el mensaje a un borrador antes de confirmarlo.")
            if not company.active:
                raise ValidationError("La empresa del movimiento está inactiva.")
            if movement.account.method != receipt.method:
                raise ValidationError("El medio de la cuenta no coincide con el grupo de origen. Revisa el movimiento.")
            if IntakeMessage.objects.filter(movement=movement).exists():
                raise ValidationError("Este borrador ya tiene un mensaje de origen. No lo registres dos veces.")
            if receipt.original_file:
                duplicates = Attachment.objects.filter(movement__company=company, sha256=receipt.original_sha256).exclude(movement=movement).exclude(movement__status="void")
                if duplicates.exists():
                    raise ValidationError("Esta foto ya está en otro movimiento de la empresa. Revisa el posible duplicado.")
                try:
                    raw = _original_bytes(receipt)
                except ProcessingFailure as error:
                    raise ValidationError("No se pudo verificar el original privado; el mensaje no se vinculó.") from error
                existed = movement.attachments.filter(sha256=receipt.original_sha256).exists()
                attachment = finance_services.attach_document(movement.pk, ContentFile(raw, name=receipt.original_name), actor)
                if not existed:
                    created_attachment = attachment
            receipt.status = IntakeMessage.Status.LINKED
            receipt.movement = movement
            receipt.proposed_company = company
            receipt.reviewed_by = actor
            receipt.reviewed_at = timezone.now()
            receipt.processing_state = IntakeMessage.ProcessingState.CANCELLED
            receipt.processing_lease_token = None
            receipt.processing_lease_until = None
            receipt.processing_available_at = None
            receipt.processing_version += 1
            receipt.note = "Empresa y cuenta elegidas manualmente; mensaje vinculado a borrador."
            receipt.save(update_fields=["status", "movement", "proposed_company", "reviewed_by", "reviewed_at", "note", "processing_state",
                                       "processing_lease_token", "processing_lease_until", "processing_available_at", "processing_version"])
            IntakeAudit.objects.create(receipt=receipt, actor=actor, action="linked", detail=f"Vinculado al movimiento {movement.pk}.")
            return receipt
    except Exception:
        if created_attachment:
            _remove_created_file(created_attachment.file)
        raise


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
    receipt.processing_state = IntakeMessage.ProcessingState.CANCELLED
    receipt.processing_lease_token = None
    receipt.processing_lease_until = None
    receipt.processing_available_at = None
    receipt.processing_version += 1
    receipt.save(update_fields=["status", "note", "reviewed_by", "reviewed_at", "processing_state",
                               "processing_lease_token", "processing_lease_until", "processing_available_at", "processing_version"])
    IntakeAudit.objects.create(receipt=receipt, actor=actor, action="ignored", detail=reason)
    return receipt
