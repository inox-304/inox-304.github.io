"""Durable inbox. Receipt is evidence of reception, never evidence of a payment."""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class IntakeMessage(models.Model):
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

    class Meta:
        ordering = ("-received_at", "-pk")
        default_permissions = ()
        indexes = [models.Index(fields=["status", "received_at"], name="finance_inbox_pending")]
        verbose_name = "mensaje recibido"
        verbose_name_plural = "mensajes recibidos"

    @property
    def code(self):
        return f"WA-{self.pk:06d}" if self.pk else "Por recibir"

    def delete(self, *args, **kwargs):
        raise ValidationError("Conserva el mensaje original; descártalo indicando un motivo.")


class IntakeAudit(models.Model):
    receipt = models.ForeignKey(IntakeMessage, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
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
