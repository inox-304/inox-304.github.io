from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import EmailDevice, EnrollmentPermission, RecoveryDevice
from security.services import audit, revoke_sessions


class Command(BaseCommand):
    help = "Restablece MFA desde el servidor, revoca sesiones y habilita una nueva inscripción durante 24 horas."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        with transaction.atomic():
            user = get_user_model().objects.filter(username=email, is_active=True, is_staff=True).first()
            if user is None:
                raise CommandError("No existe un usuario activo autorizado con ese correo.")
            revoke_sessions(user)
            TOTPDevice.objects.filter(user=user).delete()
            RecoveryDevice.objects.filter(user=user).delete()
            EmailDevice.objects.filter(user=user).delete()
            EnrollmentPermission.objects.update_or_create(user=user, defaults={"created_at": timezone.now(), "expires_at": timezone.now() + timedelta(hours=24), "used_at": None})
            audit("enrollment_reset_by_cli", user=user)
        self.stdout.write(self.style.SUCCESS("Sesiones y códigos anteriores revocados. La cuenta puede confirmar su segundo factor durante 24 horas al ingresar con su contraseña."))
