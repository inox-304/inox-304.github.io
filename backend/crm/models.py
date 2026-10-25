"""Commercial records are distinct from anonymous marketing click totals."""
import re
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


def normalize_phone(value):
    value = (value or "").strip()
    if not value:
        return ""
    if not re.fullmatch(r"\+?[\d\s().-]+", value):
        raise ValidationError("Usa un teléfono con código de país; no incluyas letras.")
    digits = re.sub(r"\D", "", value)
    if re.fullmatch(r"9\d{8}", digits):
        digits = "51" + digits
    if not re.fullmatch(r"[1-9]\d{7,14}", digits):
        raise ValidationError("Ingresa un teléfono válido de 8 a 15 dígitos, incluido el país.")
    return "+" + digits


class Opportunity(models.Model):
    class Source(models.TextChoices):
        WEBSITE = "website", "Web INOX 304"
        GOOGLE = "google", "Google"
        FACEBOOK = "facebook", "Facebook"
        INSTAGRAM = "instagram", "Instagram"
        TIKTOK = "tiktok", "TikTok"
        WHATSAPP = "whatsapp", "WhatsApp"
        STORE = "store", "Tienda"
        REFERRAL = "referral", "Recomendación"
        OTHER = "other", "Otro"
        UNKNOWN = "unknown", "Sin identificar"

    class Stage(models.TextChoices):
        NEW = "new", "Nuevo"
        EVALUATING = "evaluating", "En evaluación"
        QUOTED = "quoted", "Cotizado"
        FOLLOWUP = "followup", "En seguimiento"
        WON = "won", "Venta confirmada"
        DELIVERED = "delivered", "Entregado"
        LOST = "lost", "No concretado"

    class Currency(models.TextChoices):
        PEN = "PEN", "Soles (PEN)"
        USD = "USD", "Dólares (USD)"

    class LossReason(models.TextChoices):
        PRICE = "price", "Precio"
        TIMING = "timing", "No es el momento"
        NO_RESPONSE = "no_response", "Sin respuesta"
        COMPETITION = "competition", "Eligió otra opción"
        CANCELLED = "cancelled", "Proyecto cancelado"
        OTHER = "other", "Otro motivo"

    name = models.CharField("nombre del cliente", max_length=120)
    phone = models.CharField("WhatsApp o teléfono", max_length=40, blank=True)
    email = models.EmailField("correo", blank=True)
    company = models.CharField("negocio o empresa", max_length=150, blank=True)
    city = models.CharField("ciudad", max_length=100, blank=True)
    interest = models.TextField("qué necesita", max_length=2000, blank=True)
    product_code = models.CharField("código del producto", max_length=64, blank=True)
    configuration = models.TextField("configuración solicitada", max_length=4000, blank=True)
    source = models.CharField("cómo nos conoció", max_length=16, choices=Source.choices, default=Source.UNKNOWN)
    campaign = models.CharField("campaña", max_length=120, blank=True)
    medium = models.CharField("medio", max_length=80, blank=True)
    stage = models.CharField("estado", max_length=16, choices=Stage.choices, default=Stage.NEW)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name="responsable", on_delete=models.SET_NULL, null=True, blank=True, related_name="crm_opportunities")
    next_followup = models.DateTimeField("próximo seguimiento", null=True, blank=True)
    quote_amount = models.DecimalField("importe cotizado", max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0"))])
    currency = models.CharField("moneda", max_length=3, choices=Currency.choices, default=Currency.PEN)
    loss_reason = models.CharField("motivo de cierre", max_length=16, choices=LossReason.choices, blank=True)
    loss_detail = models.TextField("detalle del cierre", max_length=1000, blank=True)
    submission_id = models.UUIDField(null=True, blank=True, unique=True, editable=False)
    submission_fingerprint = models.CharField(max_length=64, blank=True, editable=False)
    created_at = models.DateTimeField("creado", auto_now_add=True)
    updated_at = models.DateTimeField("actualizado", auto_now=True)
    first_contact_at = models.DateTimeField(null=True, blank=True, editable=False)
    quoted_at = models.DateTimeField(null=True, blank=True, editable=False)
    won_at = models.DateTimeField(null=True, blank=True, editable=False)
    delivered_at = models.DateTimeField(null=True, blank=True, editable=False)
    version = models.PositiveIntegerField(default=1, editable=False)

    class Meta:
        ordering = ("-updated_at", "-pk")
        verbose_name = "oportunidad"
        verbose_name_plural = "oportunidades"
        default_permissions = ("view", "add", "change")
        indexes = [models.Index(fields=["stage", "next_followup"], name="crm_stage_followup"), models.Index(fields=["created_at", "source"], name="crm_created_source")]
        constraints = [models.CheckConstraint(condition=models.Q(quote_amount__isnull=True) | models.Q(quote_amount__gte=0), name="crm_amount_nonnegative")]

    @property
    def code(self):
        return f"CRM-{self.pk:06d}" if self.pk else "Por guardar"

    @property
    def is_closed(self):
        return self.stage in {self.Stage.WON, self.Stage.DELIVERED, self.Stage.LOST}

    @property
    def is_overdue(self):
        return bool(not self.is_closed and self.next_followup and self.next_followup < timezone.now())

    @property
    def whatsapp_url(self):
        if self.phone and re.fullmatch(r"\+[1-9]\d{7,14}", self.phone):
            return "https://wa.me/" + self.phone[1:]
        return ""

    def clean(self):
        super().clean()
        self.name = (self.name or "").strip()
        self.email = (self.email or "").strip().lower()
        errors = {}
        if not self.name:
            errors["name"] = "Escribe el nombre del cliente."
        try:
            self.phone = normalize_phone(self.phone)
        except ValidationError as error:
            errors["phone"] = error.messages
        if not self.phone and not self.email:
            errors["phone"] = "Añade un teléfono o un correo para poder contactar al cliente."
        if self.stage == self.Stage.LOST and not self.loss_reason:
            errors["loss_reason"] = "Indica por qué no se concretó la oportunidad."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} · {self.name}"


class Activity(models.Model):
    class Kind(models.TextChoices):
        CREATED = "created", "Registro"
        UPDATED = "updated", "Actualización"
        NOTE = "note", "Nota"
        CONTACT = "contact", "Contacto realizado"
        STAGE = "stage", "Cambio de estado"

    opportunity = models.ForeignKey(Opportunity, on_delete=models.PROTECT, related_name="activities")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="crm_activities")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    body = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-pk")
        default_permissions = ()
        verbose_name = "actividad comercial"
        verbose_name_plural = "historial comercial"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("El historial se conserva sin modificaciones. Añade una nueva nota.")
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("El historial comercial no se elimina.")


class WebMetric(models.Model):
    class Event(models.TextChoices):
        CLICK_WHATSAPP = "click_whatsapp", "Clic en WhatsApp"
        CONTACT_SUBMIT = "contact_submit", "Solicitud recibida"

    date = models.DateField()
    source = models.CharField(max_length=16, choices=Opportunity.Source.choices)
    event = models.CharField(max_length=20, choices=Event.choices)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        default_permissions = ()
        constraints = [models.UniqueConstraint(fields=["date", "source", "event"], name="crm_daily_source_event")]
