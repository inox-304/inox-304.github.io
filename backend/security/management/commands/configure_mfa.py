from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import EmailDevice, EnrollmentPermission, RecoveryDevice, SecurityState
from security.services import audit, revoke_sessions


class Command(BaseCommand):
    help = "Cambia el segundo factor, revoca sesiones y códigos y habilita la activación durante 24 horas."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--method", choices=["totp", "email"], required=True)

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        method = options["method"]
        with transaction.atomic():
            user = get_user_model().objects.filter(username=email, is_active=True, is_staff=True).first()
            if user is None:
                raise CommandError("No existe una cuenta activa autorizada con ese correo.")
            if method == "email":
                try:
                    validate_email(user.email)
                except ValidationError as exc:
                    raise CommandError("La cuenta requiere un correo autorizado válido.") from exc
            revoke_sessions(user)
            state = SecurityState.objects.select_for_update().get(user=user)
            state.mfa_method = method
            state.save(update_fields=["mfa_method"])
            TOTPDevice.objects.filter(user=user).delete()
            RecoveryDevice.objects.filter(user=user).delete()
            EmailDevice.objects.filter(user=user).delete()
            EnrollmentPermission.objects.update_or_create(user=user, defaults={"created_at": timezone.now(), "expires_at": timezone.now() + timedelta(hours=24), "used_at": None})
            audit("mfa_method_configured_by_cli", user=user, detail=method)
        self.stdout.write(self.style.SUCCESS("Método actualizado. Las sesiones y códigos anteriores están revocados. La próxima verificación requiere la contraseña y el nuevo segundo factor; la activación vence en 24 horas."))
