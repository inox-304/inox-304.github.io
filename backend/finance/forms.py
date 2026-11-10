"""Company-scoped forms. Financial writes go through audited services."""
import uuid
from decimal import Decimal

from django import forms
from django.contrib.auth import get_user_model
from django.forms import formset_factory
from django.utils import timezone

from .models import Account, Category, Company, CompanyAccess, CURRENCIES, Item, Movement


class CompanyForm(forms.ModelForm):
    class Meta:
        model = Company
        fields = ("code", "name", "default_currency", "active")
        help_texts = {"code": "Identificador estable. Ejemplo: INOX304. El nombre visible se puede cambiar.", "default_currency": "Se propone PEN. Confirma la moneda antes de registrar operaciones."}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["code"].disabled = True


class AccountForm(forms.ModelForm):
    class Meta:
        model = Account
        fields = ("code", "name", "method", "currency", "active")
        help_texts = {"name": "Identifica la cuenta real: caja de tienda, Yape del negocio o banco. No incluyas claves.", "method": "Clasifica cómo se mueve el dinero; no identifica a la empresa.", "currency": "Cada cuenta usa una sola moneda. No se convierten importes automáticamente."}


class CategoryForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = ("name", "direction", "active")


class ItemForm(forms.ModelForm):
    class Meta:
        model = Item
        fields = ("code", "name", "unit", "currency", "current_unit_price", "current_unit_cost", "active")
        help_texts = {"current_unit_price": "Solo sugiere el precio para nuevos registros. No cambia movimientos anteriores.", "current_unit_cost": "Costo conocido actual. Vacío significa no confirmado; no equivale a cero."}


class MemberForm(forms.Form):
    user = forms.ModelChoiceField(label="Cuenta del panel", queryset=get_user_model().objects.none())
    role = forms.ChoiceField(label="Acceso a esta empresa", choices=CompanyAccess.Role.choices)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["user"].queryset = get_user_model().objects.filter(is_active=True, is_staff=True).order_by("email", "username")
        self.fields["user"].label_from_instance = lambda user: user.email or user.username


class MovementForm(forms.Form):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput, required=False)
    idempotency_key = forms.UUIDField(widget=forms.HiddenInput)
    kind = forms.ChoiceField(label="¿Qué ocurrió?", choices=Movement.Kind.choices)
    occurred_on = forms.DateField(label="Fecha de la operación", widget=forms.DateInput(format="%Y-%m-%d", attrs={"type": "date"}), initial=timezone.localdate)
    account = forms.ModelChoiceField(label="Cuenta de origen / cobro", queryset=Account.objects.none())
    destination_account = forms.ModelChoiceField(label="Cuenta de destino", queryset=Account.objects.none(), required=False, help_text="Solo para mover dinero entre dos cuentas de la misma empresa y moneda.")
    category = forms.ModelChoiceField(label="Categoría", queryset=Category.objects.none(), required=False, help_text="Clasificación de ingreso o egreso. Déjala vacía para traslados.")
    amount = forms.DecimalField(label="Importe total", max_digits=14, decimal_places=2, min_value=Decimal("0.01"), widget=forms.NumberInput(attrs={"step": "0.01", "min": "0.01"}))
    currency = forms.ChoiceField(label="Moneda", choices=CURRENCIES)
    description = forms.CharField(label="Detalle de la operación", max_length=500, widget=forms.Textarea(attrs={"rows": 3, "placeholder": "Qué se cobró o pagó, a quién y por qué"}))
    reference = forms.CharField(label="Referencia de pago / número de operación", max_length=120, required=False, help_text="Ayuda a detectar el mismo pago registrado dos veces. Una factura adjunta no crea otro cobro.")

    def __init__(self, *args, company, instance=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.company, self.instance = company, instance
        self.fields["account"].queryset = Account.objects.filter(company=company, active=True)
        self.fields["destination_account"].queryset = Account.objects.filter(company=company, active=True)
        self.fields["category"].queryset = Category.objects.filter(company=company, active=True)
        self.fields["category"].label_from_instance = lambda category: f"{category.name} · {category.get_direction_display()}"
        self.initial.setdefault("idempotency_key", uuid.uuid4())
        self.initial.setdefault("currency", company.default_currency)
        if instance:
            self.initial.update({key: getattr(instance, key) for key in ("kind", "occurred_on", "amount", "currency", "description", "reference", "version", "idempotency_key")})
            for key in ("account", "category", "destination_account"):
                self.initial[key] = getattr(instance, key + "_id")
            self.fields["version"].required = True


class ReceiptReviewForm(MovementForm):
    """OCR is advisory; every submitted amount remains an explicitly reviewed draft."""
    document = forms.FileField(
        label="Foto del comprobante",
        widget=forms.ClearableFileInput(attrs={"accept": "image/jpeg,image/png", "data-receipt-file": ""}),
        help_text="JPG o PNG, hasta 10 MB. El original se guarda de forma privada al crear el borrador.",
    )
    reviewed = forms.BooleanField(
        label="Revisé la empresa, la fecha, la cuenta y el importe, y confirmé que hubo un cobro o pago real.",
        error_messages={"required": "Revisa los datos y confirma que el dinero se cobró o pagó antes de guardar el borrador."},
    )

    def __init__(self, *args, company, **kwargs):
        super().__init__(*args, company=company, **kwargs)
        self.fields["kind"].choices = [("", "Selecciona ingreso, egreso o traslado"), *Movement.Kind.choices]
        self.fields["currency"].choices = [("", "Confirma la moneda"), *CURRENCIES]
        self.initial.pop("currency", None)
        self.fields["occurred_on"].initial = None
        self.initial.pop("occurred_on", None)
        self.fields["occurred_on"].help_text = "Confirma la fecha del movimiento de dinero; puede diferir de la fecha de la factura."
        self.fields["amount"].help_text = "Revisa cuánto se pagó o cobró realmente. El total de una factura puede incluir importes pendientes."

    def clean_document(self):
        document = self.cleaned_data["document"]
        # Validation of the actual image bytes is repeated by the write service.
        from pathlib import Path
        if Path(document.name).suffix.lower() not in (".jpg", ".jpeg", ".png") or not 0 < document.size <= 10 * 1024 * 1024:
            raise forms.ValidationError("Selecciona una foto JPG o PNG de hasta 10 MB.")
        return document


class LineForm(forms.Form):
    item = forms.ModelChoiceField(label="Ítem guardado (opcional)", queryset=Item.objects.none(), required=False)
    item_code = forms.CharField(label="Código del ítem", max_length=40, required=False)
    item_name = forms.CharField(label="Concepto", max_length=180, required=False)
    unit = forms.CharField(label="Unidad", max_length=30, required=False)
    quantity = forms.DecimalField(label="Cantidad", max_digits=12, decimal_places=3, min_value=Decimal("0.001"), required=False)
    unit_price = forms.DecimalField(label="Precio / importe unitario", max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, help_text="En registros de fechas anteriores, escribe siempre el precio real de ese momento.")
    unit_cost = forms.DecimalField(label="Costo unitario conocido", max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, help_text="Vacío en registros históricos significa costo desconocido; no se toma el costo actual.")

    def __init__(self, *args, company, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["item"].queryset = Item.objects.filter(company=company, active=True)

    def clean(self):
        data = super().clean()
        if not self.has_changed() and not self.initial:
            return data
        if data.get("DELETE"):
            return data
        if not data.get("item") and not data.get("item_name"):
            self.add_error("item_name", "Elige un ítem o escribe el concepto.")
        if data.get("quantity") is None:
            self.add_error("quantity", "Indica la cantidad.")
        if not data.get("item") and data.get("unit_price") is None:
            self.add_error("unit_price", "Indica el importe unitario histórico.")
        return data


LineFormSet = formset_factory(LineForm, extra=2, max_num=20, validate_max=True, absolute_max=20, can_delete=True)


class AttachmentForm(forms.Form):
    document = forms.FileField(label="Comprobante", help_text="PDF, JPG o PNG, máximo 10 MB. Se conserva el original en almacenamiento privado.")


class PeriodForm(forms.Form):
    year = forms.IntegerField(label="Año", min_value=1900, max_value=2200)
    month = forms.IntegerField(label="Mes", min_value=1, max_value=12)
    reason = forms.CharField(label="Motivo de reapertura", max_length=1000, required=False, widget=forms.Textarea(attrs={"rows": 2}))
