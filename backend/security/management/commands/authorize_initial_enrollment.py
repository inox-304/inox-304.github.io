"""Explicit first activation; never a reset or account-creation operation."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from security.management.commands.setup_access import has_confirmed_device, mail_configuration_ready
from security.models import EmailDevice, EnrollmentPermission, SecurityState
from security.services import audit


class Command(BaseCommand):
    help = "Autoriza la primera verificación durante 24 horas sin cambiar contraseña, sesiones ni dispositivos."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Correo de la cuenta administrativa existente.")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        user = get_user_model().objects.filter(username__iexact=email, is_active=True, is_staff=True).first()
        if user is None:
            raise CommandError("No existe una cuenta administrativa activa con ese correo.")
        with transaction.atomic():
            # Match the lock order of email verification and the interactive access tool.
            state = SecurityState.objects.select_for_update().filter(user=user).first()
            user = get_user_model().objects.select_for_update().get(pk=user.pk)
            if not user.is_active or not user.is_staff:
                raise CommandError("La cuenta dejó de estar autorizada. No se cambió su acceso.")
            if state is None or state.mfa_method not in ("email", "totp"):
                raise CommandError("La cuenta no tiene un método de verificación válido. Requiere revisión del operador.")
            if not user.has_usable_password():
                raise CommandError("La cuenta no tiene una contraseña utilizable. No se habilitó la primera verificación.")
            if has_confirmed_device(user):
                raise CommandError("La cuenta tiene un dispositivo confirmado. Se conserva su acceso; este comando no restablece MFA.")
            permission = EnrollmentPermission.objects.select_for_update().filter(user=user).first()
            if permission and permission.used_at is not None:
                raise CommandError("La cuenta ya completó una activación anterior. Requiere recuperación del operador; no se restableció MFA.")
            if state.mfa_method == "email":
                try:
                    validate_email(user.email)
                except ValidationError as exc:
                    raise CommandError("La cuenta no tiene un correo válido. No se habilitó la primera verificación.") from exc
                device = EmailDevice.objects.filter(user=user).first()
                if device and device.email and device.email != user.email:
                    raise CommandError("El dispositivo pendiente corresponde a otro correo. Requiere revisión del operador; no se borró nada.")
                if not mail_configuration_ready():
                    raise CommandError("Configura el servicio de correo antes de habilitar sus 24 horas de primera verificación.")
            now = timezone.now()
            if permission and permission.expires_at > now:
                self.stdout.write("La primera verificación ya está vigente. Se conserva su vencimiento; no hubo cambios.")
                return
            EnrollmentPermission.objects.update_or_create(
                user=user,
                defaults={"created_at": now, "expires_at": now + timedelta(hours=24), "used_at": None},
            )
            audit("initial_enrollment_authorized_by_cli", user=user)
        self.stdout.write(self.style.SUCCESS(
            "Primera verificación habilitada durante 24 horas. Ingresa con tu contraseña y confirma tu segundo factor. "
            "Se conservaron la contraseña, el método, las sesiones y los dispositivos. No se enviaron códigos."
        ))
