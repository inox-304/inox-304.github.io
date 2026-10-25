from django import forms
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models import Q

from .models import Opportunity, normalize_phone


def eligible_assignees():
    accounts = get_user_model().objects.filter(is_active=True, is_staff=True)
    for permission in ("view_opportunity", "change_opportunity"):
        accounts = accounts.filter(
            Q(is_superuser=True)
            | Q(user_permissions__content_type__app_label="crm", user_permissions__codename=permission)
            | Q(groups__permissions__content_type__app_label="crm", groups__permissions__codename=permission)
        )
    return accounts.distinct().order_by("email", "username")


class AssigneeChoiceField(forms.ModelChoiceField):
    def label_from_instance(self, obj):
        return obj.get_full_name() or obj.email or obj.get_username()


class OpportunityForm(forms.ModelForm):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput, required=False)
    reopen_reason = forms.CharField(
        label="Motivo para cambiar el cierre", max_length=1000, required=False,
        help_text="Sólo se necesita si cambias una oportunidad ya cerrada. El historial y las ventas confirmadas se conservan.",
        widget=forms.Textarea(attrs={"rows": 2}),
    )
    assignee = AssigneeChoiceField(label="Responsable", queryset=get_user_model().objects.none(), required=False, empty_label="Sin asignar")

    class Meta:
        model = Opportunity
        fields = [
            "name", "phone", "email", "company", "city", "interest", "product_code",
            "configuration", "source", "campaign", "medium", "stage", "assignee",
            "next_followup", "quote_amount", "currency", "loss_reason", "loss_detail",
        ]
        widgets = {
            "interest": forms.Textarea(attrs={"rows": 3, "placeholder": "Qué equipo busca, para cuándo lo necesita y detalles importantes"}),
            "configuration": forms.Textarea(attrs={"rows": 3}),
            "loss_detail": forms.Textarea(attrs={"rows": 2}),
            "next_followup": forms.DateTimeInput(format="%Y-%m-%dT%H:%M", attrs={"type": "datetime-local"}),
            "phone": forms.TextInput(attrs={"type": "tel", "autocomplete": "tel", "placeholder": "+51 999 999 999"}),
            "name": forms.TextInput(attrs={"autocomplete": "name"}),
            "email": forms.EmailInput(attrs={"autocomplete": "email"}),
            "quote_amount": forms.NumberInput(attrs={"min": "0", "step": "0.01"}),
        }
        help_texts = {
            "phone": "Un celular peruano de 9 dígitos se completa con +51. También puedes registrar sólo un correo.",
            "next_followup": "Cuándo volverás a contactar al cliente. La agenda usa la hora local del panel.",
            "quote_amount": "Importe cotizado, no cobrado. Soles y dólares se informan por separado.",
            "source": "Canal por el que llegó el cliente; no cambia por volver a escribirle por WhatsApp.",
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self._previous_stage = self.instance.stage if self.instance.pk else None
        self.fields["assignee"].queryset = eligible_assignees()
        self.fields["next_followup"].input_formats = ["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"]
        if self.instance.pk:
            self.fields["version"].required = True
            self.initial["version"] = self.instance.version
        else:
            self.initial.setdefault("version", 1)
            if user and user.pk and self.fields["assignee"].queryset.filter(pk=user.pk).exists():
                self.initial.setdefault("assignee", user.pk)

    def clean_phone(self):
        return normalize_phone(self.cleaned_data.get("phone", ""))

    def clean_email(self):
        return (self.cleaned_data.get("email") or "").strip().lower()

    def clean(self):
        cleaned = super().clean()
        closed = {Opportunity.Stage.WON, Opportunity.Stage.DELIVERED, Opportunity.Stage.LOST}
        target = cleaned.get("stage")
        if self._previous_stage in closed and target and target != self._previous_stage:
            if not (self._previous_stage == Opportunity.Stage.WON and target == Opportunity.Stage.DELIVERED) and not cleaned.get("reopen_reason"):
                self.add_error("reopen_reason", "Indica el motivo para cambiar una oportunidad cerrada.")
        return cleaned

    def save(self, *args, **kwargs):
        raise ValidationError("Guarda esta ficha con los servicios del CRM para conservar el historial y comprobar su versión.")
