from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.views.decorators.debug import sensitive_variables

from .management.commands.setup_access import mail_configuration_ready


ROLE_CHOICES = (
    ("catalog_inventory", "Catálogo e inventario"),
    ("catalog", "Solo catálogo"),
    ("inventory", "Solo inventario"),
)


class OwnerConfirmationForm(forms.Form):
    owner_password = forms.CharField(
        label="Tu contraseña de propietario", max_length=1024, strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )


class AccountCreateForm(OwnerConfirmationForm):
    email = forms.EmailField(label="Correo de la cuenta", max_length=150,
                            widget=forms.EmailInput(attrs={"autocomplete": "off"}))
    name = forms.CharField(label="Nombre para reconocer la cuenta", max_length=150, required=False,
                           help_text="Por ejemplo: Gerencia o responsable de taller.")
    role = forms.ChoiceField(label="Acceso autorizado", choices=ROLE_CHOICES)
    mfa_method = forms.ChoiceField(label="Primera verificación", choices=(
        ("email", "Código por correo"), ("totp", "Aplicación autenticadora")),
        help_text="La persona deberá confirmar su propio segundo factor dentro de las próximas 24 horas.")
    new_password = forms.CharField(label="Contraseña de la nueva cuenta", max_length=1024, strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text="Al menos 12 caracteres. Entrega esta contraseña por un medio privado.")
    confirm_password = forms.CharField(label="Repite la contraseña de la nueva cuenta", max_length=1024,
        strip=False, widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}))
    field_order = ["email", "name", "role", "mfa_method", "new_password", "confirm_password", "owner_password"]

    def clean_email(self):
        value = self.cleaned_data["email"].strip().lower()
        if get_user_model().objects.filter(Q(username__iexact=value) | Q(email__iexact=value)).exists():
            raise ValidationError("Ya existe una cuenta con ese correo. Revisa su acceso en la lista; no se modificó su contraseña.")
        return value

    @sensitive_variables()
    def clean(self):
        data = super().clean()
        if data.get("new_password"):
            candidate = get_user_model()(username=data.get("email", ""), email=data.get("email", ""),
                                         first_name=data.get("name", ""))
            try:
                validate_password(data["new_password"], candidate)
            except ValidationError as exc:
                self.add_error("new_password", exc)
            if data.get("new_password") != data.get("confirm_password"):
                self.add_error("confirm_password", "Las contraseñas de la nueva cuenta deben coincidir.")
        if data.get("mfa_method") == "email" and not mail_configuration_ready():
            self.add_error("mfa_method", "El servidor debe tener el envío de correo configurado antes de habilitar esta opción.")
        return data


class AccountAccessForm(OwnerConfirmationForm):
    role = forms.ChoiceField(label="Acceso autorizado", choices=ROLE_CHOICES)
    field_order = ["role", "owner_password"]
