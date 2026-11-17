"""Durable inbox. Receipt is evidence of reception, never evidence of a payment."""
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


def original_image_path(instance, filename):
    extension = ".png" if str(filename).lower().endswith(".png") else ".jpg"
    return f"finance/whatsapp/{uuid.uuid4().hex}{extension}"


class IntakeMessage(models.Model):
    class ProcessingState(models.TextChoices):
        MANUAL = "manual", "Recepción manual"
        QUEUED = "queued", "Foto en cola"
        PROCESSING = "processing", "Leyendo foto"
        RETRY = "retry", "Reintento pendiente"
        REVIEW = "review", "Completar y revisar"
        DRAFTED = "drafted", "Borrador automático por revisar"
        CANCELLED = "cancelled", "Procesamiento detenido"

    class Method(models.TextChoices):
        YAPE = "yape", "Yapes"
        CASH = "cash", "Efectivo"
        TRANSFER = "transfer", "Transacciones"

    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente de revisión"
        NEEDS_REVIEW = "needs_review", "Requiere revisión"
        LINKED = "linked", "Vinculado a un movimiento"
        IGNORED = "ignored", "Descartado con motivo"

    provider_message_id = models.CharField(max_length=512, unique=True, editable=False)
    fingerprint = models.CharField(max_length=64, editable=False)
    group_id = models.CharField(max_length=512, editable=False)
    method = models.CharField(max_length=16, choices=Method.choices, editable=False)
    sender_id = models.CharField(max_length=256, editable=False)
    sender_id_kind = models.CharField(max_length=8, editable=False)
    message_type = models.CharField(max_length=32, editable=False)
    text = models.TextField(max_length=16000, blank=True, editable=False)
    media = models.JSONField(default=dict, blank=True, editable=False)
    provider_timestamp = models.DateTimeField(null=True, editable=False)
    received_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    movement = models.OneToOneField("finance.Movement", null=True, blank=True, on_delete=models.PROTECT,
                                   related_name="whatsapp_receipt")
    note = models.TextField(max_length=2000, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name="reviewed_finance_receipts")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Historical rows stay manual. Only a newly accepted webhook explicitly
    # queues a photo; installing this migration never reprocesses the inbox.
    receiver_phone_number_id = models.CharField(max_length=64, blank=True, editable=False)
    processing_state = models.CharField(max_length=16, choices=ProcessingState.choices,
                                        default=ProcessingState.MANUAL, editable=False)
    processing_attempts = models.PositiveSmallIntegerField(default=0, editable=False)
    processing_version = models.PositiveIntegerField(default=1, editable=False)
    draft_generation = models.PositiveSmallIntegerField(default=0, editable=False)
    processing_available_at = models.DateTimeField(null=True, blank=True, editable=False)
    processing_lease_token = models.UUIDField(null=True, blank=True, editable=False)
    processing_lease_until = models.DateTimeField(null=True, blank=True, editable=False)
    processing_error_code = models.CharField(max_length=48, blank=True, editable=False)
    processed_at = models.DateTimeField(null=True, blank=True, editable=False)
    original_file = models.FileField(upload_to=original_image_path, max_length=220, blank=True, editable=False)
    original_name = models.CharField(max_length=180, blank=True, editable=False)
    original_content_type = models.CharField(max_length=64, blank=True, editable=False)
    original_size = models.PositiveIntegerField(default=0, editable=False)
    original_sha256 = models.CharField(max_length=64, blank=True, editable=False, db_index=True)
    ocr_text = models.TextField(max_length=60000, blank=True, editable=False)
    ocr_fields = models.JSONField(default=dict, blank=True, editable=False)
    ocr_warnings = models.JSONField(default=list, blank=True, editable=False)
    proposed_company = models.ForeignKey("finance.Company", null=True, blank=True,
                                         on_delete=models.PROTECT, related_name="proposed_receipts", editable=False)

    class Meta:
        ordering = ("-received_at", "-pk")
        default_permissions = ()
        indexes = [models.Index(fields=["status", "received_at"], name="finance_inbox_pending"),
                   models.Index(fields=["processing_state", "processing_available_at"], name="finance_inbox_jobs")]
        verbose_name = "mensaje recibido"
        verbose_name_plural = "mensajes recibidos"

    @property
    def code(self):
        return f"WA-{self.pk:06d}" if self.pk else "Por recibir"

    def delete(self, *args, **kwargs):
        raise ValidationError("Conserva el mensaje original; descártalo indicando un motivo.")


class IntakeAudit(models.Model):
    receipt = models.ForeignKey(IntakeMessage, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=16)
    detail = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-pk")
        default_permissions = ()

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("El historial de recepción no se modifica.")
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("El historial de recepción no se elimina.")
