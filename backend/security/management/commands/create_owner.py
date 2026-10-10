from datetime import timedelta
from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone

from security.models import EnrollmentPermission, SecurityState
from security.services import audit


class Command(BaseCommand):
    help = "Crea un propietario autorizado y habilita su primera inscripción TOTP durante 24 horas."

    def add_arguments(self, parser):
        parser.add_argument("--email", help="Correo del propietario; la contraseña siempre se solicita de forma oculta.")

    def handle(self, *args, **options):
        email = (options.get("email") or input("Correo del propietario: ")).strip().lower()
        try:
            validate_email(email)
        except ValidationError as exc:
            raise CommandError("Escribe un correo válido.") from exc
        if len(email) > 150:
            raise CommandError("El correo no puede superar 150 caracteres.")
        user_model = get_user_model()
        if user_model.objects.filter(username__iexact=email).exists():
            raise CommandError("Ese usuario ya existe. Para recuperar MFA usa authorize_enrollment --email.")
        user = user_model(username=email, email=email, is_active=True, is_staff=True, is_superuser=True)
        password = getpass("Contraseña (mínimo 12 caracteres): ")
        confirmation = getpass("Repite la contraseña: ")
        if password != confirmation:
            raise CommandError("Las contraseñas no coinciden.")
        try:
            validate_password(password, user=user)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages)) from exc
        with transaction.atomic():
            user.set_password(password)
            user.save()
            SecurityState.objects.create(user=user)
            EnrollmentPermission.objects.create(user=user, expires_at=timezone.now() + timedelta(hours=24))
            audit("owner_created", user=user)
        self.stdout.write(self.style.SUCCESS("Propietario creado. Abre /admin/, ingresa correo y contraseña y configura tu aplicación de autenticación. La inscripción vence en 24 horas."))
