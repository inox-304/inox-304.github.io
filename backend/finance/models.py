"""Private cash movements. Amounts are historical facts, never live price lookups."""
import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

CURRENCIES = (("PEN", "Soles (PEN)"), ("USD", "Dólares (USD)"))
CODE_VALIDATOR = RegexValidator(r"^[A-Z0-9][A-Z0-9_-]*$", "Usa letras mayúsculas, números, guion o guion bajo.")
CENT = Decimal("0.01")


class ValidatedModel(models.Model):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class Company(ValidatedModel):
    code = models.CharField("código", max_length=20, unique=True, validators=[CODE_VALIDATOR])
    name = models.CharField("nombre de empresa", max_length=160)
    default_currency = models.CharField("moneda habitual", max_length=3, choices=CURRENCIES, default="PEN")
    active = models.BooleanField("activa", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("name",)
        default_permissions = ()
        verbose_name = "empresa"
        verbose_name_plural = "empresas"

    def clean(self):
        self.name = (self.name or "").strip()
        self.code = (self.code or "").strip().upper()
        if not self.name:
            raise ValidationError({"name": "Escribe el nombre de la empresa."})

    def __str__(self):
        return self.name


class CompanyAccess(ValidatedModel):
    class Role(models.TextChoices):
        VIEW = "view", "Consultar"
        RECORD = "record", "Registrar borradores"
        REVIEW = "review", "Revisar y confirmar"

    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="accesses")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="finance_accesses")
    role = models.CharField("permiso", max_length=10, choices=Role.choices, default=Role.VIEW)

    class Meta:
        default_permissions = ()
        constraints = [models.UniqueConstraint(fields=["company", "user"], name="finance_company_user")]

    def clean(self):
        if self.user_id and not (self.user.is_active and self.user.is_staff):
            raise ValidationError({"user": "Elige una cuenta activa del panel."})


class Account(ValidatedModel):
    class Method(models.TextChoices):
        YAPE = "yape", "Yapes"
        CASH = "cash", "Efectivo"
        TRANSFER = "transfer", "Transacciones"

    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="accounts")
    code = models.CharField("código", max_length=30, validators=[CODE_VALIDATOR])
    name = models.CharField("cuenta o caja", max_length=160)
    method = models.CharField("medio", max_length=10, choices=Method.choices)
    currency = models.CharField("moneda", max_length=3, choices=CURRENCIES, default="PEN")
    active = models.BooleanField("activa", default=True)

    class Meta:
        default_permissions = ()
        ordering = ("company__name", "name")
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="finance_account_code")]

    def clean(self):
        self.code = (self.code or "").strip().upper()
        self.name = (self.name or "").strip()
        if not self.name:
            raise ValidationError({"name": "Escribe el nombre de la cuenta."})
        if self.pk:
            old = type(self).objects.get(pk=self.pk)
            if (old.company_id, old.currency, old.method) != (self.company_id, self.currency, self.method) and (self.movements.exists() or self.incoming_transfers.exists()):
                raise ValidationError("Una cuenta con movimientos conserva su empresa, moneda y medio. Crea otra cuenta.")

    def __str__(self):
        return f"{self.name} · {self.currency}"


class Category(ValidatedModel):
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="categories")
    name = models.CharField("categoría", max_length=100)
    direction = models.CharField("tipo", max_length=10, choices=(("income", "Ingreso"), ("expense", "Egreso")))
    active = models.BooleanField("activa", default=True)

    class Meta:
        default_permissions = ()
        ordering = ("name",)
        constraints = [models.UniqueConstraint(fields=["company", "name", "direction"], name="finance_category_name")]

    def __str__(self):
        return self.name

    def clean(self):
        self.name = (self.name or "").strip()
        if not self.name:
            raise ValidationError({"name": "Escribe el nombre de la categoría."})
        if self.pk:
            old = type(self).objects.get(pk=self.pk)
            if (old.company_id, old.direction) != (self.company_id, self.direction) and self.movements.exists():
                raise ValidationError("Una categoría utilizada conserva su empresa y tipo. Crea otra categoría.")


class Item(ValidatedModel):
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="finance_items")
    code = models.CharField("código del ítem", max_length=40, validators=[CODE_VALIDATOR])
    name = models.CharField("nombre", max_length=180)
    unit = models.CharField("unidad", max_length=30, default="unidad")
    current_unit_price = models.DecimalField("precio sugerido actual", max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0"))])
    current_unit_cost = models.DecimalField("costo sugerido actual", max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0"))])
    currency = models.CharField("moneda", max_length=3, choices=CURRENCIES, default="PEN")
    active = models.BooleanField("activo", default=True)

    class Meta:
        default_permissions = ()
        ordering = ("code",)
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="finance_item_code")]

    def clean(self):
        self.code = (self.code or "").strip().upper()
        for field in ("current_unit_price", "current_unit_cost"):
            value = getattr(self, field)
            if value is not None and (not isinstance(value, Decimal) or not value.is_finite()):
                raise ValidationError({field: "Escribe un importe válido."})
        if self.pk:
            old = type(self).objects.get(pk=self.pk)
            if (old.company_id, old.currency) != (self.company_id, self.currency) and self.movementline_set.exists():
                raise ValidationError("Un ítem utilizado conserva su empresa y moneda. Crea otro código para la nueva combinación.")

    def __str__(self):
        return f"{self.code} · {self.name}"


class ImmutableQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError("Usa las operaciones auditadas de Finanzas para modificar registros.")

    def delete(self):
        raise ValidationError("Estos registros financieros se conservan; no se eliminan.")

    def bulk_update(self, objs, fields, batch_size=None):
        raise ValidationError("Los registros financieros se guardan de forma individual y auditada.")

    def bulk_create(self, objs, **kwargs):
        raise ValidationError("Los registros financieros se guardan de forma individual y auditada.")


class Movement(ValidatedModel):
    class Kind(models.TextChoices):
        INCOME = "income", "Ingreso"
        EXPENSE = "expense", "Egreso"
        TRANSFER = "transfer", "Traslado entre cuentas"

    class Status(models.TextChoices):
        DRAFT = "draft", "Por revisar"
        POSTED = "posted", "Confirmado"
        VOID = "void", "Anulado"

    class Source(models.TextChoices):
        MANUAL = "manual", "Panel"
        WHATSAPP = "whatsapp", "WhatsApp"
        IMPORT = "import", "Importación histórica"

    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="movements")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="movements")
    destination_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="incoming_transfers", null=True, blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="movements", null=True, blank=True)
    kind = models.CharField("tipo", max_length=10, choices=Kind.choices)
    occurred_on = models.DateField("fecha de la operación", default=timezone.localdate)
    description = models.CharField("detalle", max_length=500)
    reference = models.CharField("referencia de pago", max_length=120, blank=True)
    amount = models.DecimalField("importe", max_digits=14, decimal_places=2, validators=[MinValueValidator(CENT)])
    currency = models.CharField("moneda", max_length=3, choices=CURRENCIES, default="PEN")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, editable=False)
    version = models.PositiveIntegerField(default=1, editable=False)
    idempotency_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    submission_fingerprint = models.CharField(max_length=64, editable=False)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    source_reference = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="finance_created")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="finance_updated")
    posted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="finance_posted", null=True, blank=True)
    voided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="finance_voided", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    posted_at = models.DateTimeField(null=True, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=1000, blank=True)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ("-occurred_on", "-pk")
        default_permissions = ()
        indexes = [models.Index(fields=["company", "occurred_on", "status"], name="finance_company_date"), models.Index(fields=["account", "reference"], name="finance_payment_ref")]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="finance_positive_amount")]

    @property
    def code(self):
        return f"FIN-{self.pk:07d}" if self.pk else "Por guardar"

    def __str__(self):
        return f"{self.code} · {self.description}"

    def clean(self):
        errors = {}
        self.description = (self.description or "").strip()
        self.reference = (self.reference or "").strip()
        if not self.description:
            errors["description"] = "Describe qué se cobró o pagó."
        if isinstance(self.occurred_on, date) and (self.occurred_on.year < 1900 or self.occurred_on > timezone.localdate()):
            errors["occurred_on"] = "Usa una fecha real entre 1900 y hoy. Este registro es de operaciones realizadas, no de pagos previstos."
        if not isinstance(self.amount, Decimal) or not self.amount.is_finite() or self.amount <= 0:
            errors["amount"] = "El importe debe ser mayor que cero."
        if self.account_id and (self.account.company_id != self.company_id or self.account.currency != self.currency):
            errors["account"] = "La cuenta debe pertenecer a esta empresa y moneda."
        if self.kind == self.Kind.TRANSFER:
            if not self.destination_account_id:
                errors["destination_account"] = "Elige la cuenta de destino."
            elif self.destination_account_id == self.account_id or self.destination_account.company_id != self.company_id or self.destination_account.currency != self.currency:
                errors["destination_account"] = "El destino debe ser otra cuenta de la misma empresa y moneda."
            if self.category_id:
                errors["category"] = "Un traslado no es un ingreso ni un gasto."
        elif self.destination_account_id:
            errors["destination_account"] = "Solo los traslados tienen cuenta de destino."
        if self.category_id and (self.category.company_id != self.company_id or self.category.direction != self.kind):
            errors["category"] = "La categoría no corresponde a esta empresa y tipo de operación."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self._state.adding:
            if self.status != self.Status.DRAFT:
                raise ValidationError("Los movimientos nuevos empiezan como borrador.")
        else:
            old = type(self).objects.get(pk=self.pk)
            if old.status != self.Status.DRAFT:
                permitted = {"status", "version", "updated_by_id", "updated_at", "voided_by_id", "voided_at", "void_reason"}
                changed = {f.attname for f in self._meta.concrete_fields if getattr(old, f.attname) != getattr(self, f.attname)}
                if not (getattr(self, "_finance_transition", False) and old.status == self.Status.POSTED and self.status == self.Status.VOID and not changed - permitted):
                    raise ValidationError("Un movimiento confirmado conserva sus importes y datos históricos. Usa Anular con motivo.")
            elif self.status != self.Status.DRAFT and not getattr(self, "_finance_transition", False):
                raise ValidationError("Confirma el movimiento desde la operación de revisión.")
            if old.company_id != self.company_id:
                raise ValidationError("La empresa de un movimiento guardado no se cambia. Crea un borrador nuevo.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Los movimientos no se eliminan. Conserva su trazabilidad.")


class LineQuerySet(ImmutableQuerySet):
    def delete(self):
        if self.exclude(movement__status=Movement.Status.DRAFT).exists():
            raise ValidationError("No se modifican detalles de un movimiento confirmado.")
        return models.QuerySet.delete(self)


class MovementLine(ValidatedModel):
    movement = models.ForeignKey(Movement, on_delete=models.PROTECT, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT, null=True, blank=True)
    item_code = models.CharField("código guardado", max_length=40, blank=True)
    item_name = models.CharField("concepto guardado", max_length=180)
    unit = models.CharField("unidad guardada", max_length=30, default="unidad")
    quantity = models.DecimalField("cantidad", max_digits=12, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    unit_price = models.DecimalField("precio unitario guardado", max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    unit_cost = models.DecimalField("costo unitario guardado", max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0"))])
    objects = LineQuerySet.as_manager()

    class Meta:
        ordering = ("pk",)
        default_permissions = ()

    @property
    def total(self):
        return (self.quantity * self.unit_price).quantize(CENT, rounding=ROUND_HALF_UP)

    @property
    def cost_total(self):
        return None if self.unit_cost is None else (self.quantity * self.unit_cost).quantize(CENT, rounding=ROUND_HALF_UP)

    def clean(self):
        if self.movement_id and self.movement.status != Movement.Status.DRAFT:
            raise ValidationError("Los detalles confirmados no se modifican.")
        if self.item_id and (self.item.company_id != self.movement.company_id or self.item.currency != self.movement.currency):
            raise ValidationError({"item": "El ítem debe pertenecer a la empresa y moneda del movimiento."})

    def save(self, *args, **kwargs):
        if self.pk:
            old = type(self).objects.select_related("movement").get(pk=self.pk)
            if old.movement.status != Movement.Status.DRAFT or old.movement_id != self.movement_id:
                raise ValidationError("No se trasladan ni reescriben detalles históricos.")
        # Refresh status; a stale Python parent object must not authorize a write.
        if self.movement_id and Movement.objects.get(pk=self.movement_id).status != Movement.Status.DRAFT:
            raise ValidationError("Los detalles confirmados no se modifican.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if Movement.objects.get(pk=self.movement_id).status != Movement.Status.DRAFT:
            raise ValidationError("Los detalles confirmados no se eliminan.")
        return super().delete(*args, **kwargs)


def attachment_path(instance, filename):
    extension = Path(filename).suffix.lower()
    return f"finance/documents/{uuid.uuid4().hex}{extension}"


class Attachment(ValidatedModel):
    movement = models.ForeignKey(Movement, on_delete=models.PROTECT, related_name="attachments")
    file = models.FileField(upload_to=attachment_path, max_length=220)
    name = models.CharField(max_length=180)
    content_type = models.CharField(max_length=60)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ("created_at",)
        default_permissions = ()
        constraints = [models.UniqueConstraint(fields=["movement", "sha256"], name="finance_attachment_duplicate")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("El comprobante original se conserva sin reemplazarlo.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Los comprobantes originales se conservan.")


class Audit(ValidatedModel):
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="audit_entries")
    movement = models.ForeignKey(Movement, on_delete=models.PROTECT, related_name="audit_entries", null=True, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=40)
    body = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "-pk")
        default_permissions = ()

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("La auditoría no se modifica.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("La auditoría no se elimina.")


class ClosedPeriod(ValidatedModel):
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="periods")
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    is_closed = models.BooleanField(default=True)
    closed_at = models.DateTimeField(default=timezone.now)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        ordering = ("-year", "-month")
        default_permissions = ()
        constraints = [models.UniqueConstraint(fields=["company", "year", "month"], name="finance_company_period"), models.CheckConstraint(condition=models.Q(month__gte=1, month__lte=12, year__gte=1900, year__lte=2200), name="finance_valid_period")]

    def clean(self):
        if not 1 <= self.month <= 12 or not 1900 <= self.year <= 2200:
            raise ValidationError("Elige un año y mes válidos.")
