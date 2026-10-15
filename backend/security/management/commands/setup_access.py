"""Private interactive setup, never a public enrollment route."""
from datetime import timedelta
from getpass import GetPassWarning, getpass
import warnings

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import EmailDevice, EnrollmentPermission, RecoveryDevice, SecurityState
from security.services import audit, revoke_sessions


def mail_configuration_ready():
    """Inspect configuration only; SMTP reachability/delivery are not tested."""
    return bool(settings.SECURITY_EMAIL_ENABLED
                and settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend"
                and settings.EMAIL_HOST and settings.DEFAULT_FROM_EMAIL
                and (settings.EMAIL_USE_TLS or settings.EMAIL_USE_SSL)
                and bool(settings.EMAIL_HOST_USER) == bool(settings.EMAIL_HOST_PASSWORD))


def has_confirmed_device(user):
    return any(model.objects.filter(user=user, confirmed=True).exists()
               for model in (EmailDevice, TOTPDevice, RecoveryDevice))


class Command(BaseCommand):
    help = "Guía local para elegir cuenta, conservar o cambiar contraseña y completar la primera activación."

    def add_arguments(self, parser):
        parser.add_argument("--email", help="Selecciona una cuenta existente sin mostrar el menú.")
        parser.add_argument("--status", action="store_true", help="Solo diagnostica, sin preguntas, cambios ni envío de mensajes.")

    def show_status(self, user):
        state = SecurityState.objects.filter(user=user).first()
        permission = EnrollmentPermission.objects.filter(user=user).first()
        active = bool(permission and not permission.used_at and permission.expires_at > timezone.now())
        self.stdout.write(f"Cuenta: {user.email or user.username}")
        self.stdout.write(f"Autorizada: {'sí' if user.is_active and user.is_staff else 'no'}")
        self.stdout.write(f"Contraseña configurada: {'sí' if user.has_usable_password() else 'no'}")
        self.stdout.write(f"Segundo paso: {'correo' if state and state.mfa_method == 'email' else 'aplicación autenticadora' if state else 'sin configurar'}")
        self.stdout.write(f"Dispositivo verificado: {'sí' if has_confirmed_device(user) else 'no'}")
        self.stdout.write(f"Primera activación vigente: {'sí' if active else 'no'}")

    def handle(self, *args, **options):
        ready = mail_configuration_ready()
        self.stdout.write("CONFIGURACIÓN LOCAL DE ACCESO · INOX 304")
        self.stdout.write("Correo: configurado; entrega aún no comprobada." if ready else
                          "Correo: falta configuración. Abre CONFIGURAR-CORREO.cmd antes de entrar con código por correo.")
        self.stdout.write("Esta herramienta no envía códigos ni publica el panel en Internet.")
        users = get_user_model().objects.filter(is_staff=True).order_by("email", "pk")
        email = (options.get("email") or "").strip().lower()
        if options["status"]:
            if email:
                users = users.filter(username__iexact=email)
            for user in users:
                self.show_status(user)
            if not users.exists():
                self.stdout.write("No hay una cuenta administrativa coincidente en esta instalación.")
            return
        try:
            if not email:
                choices = list(users)
                for index, user in enumerate(choices, start=1):
                    self.stdout.write(f"{index}. {user.email or user.username}{' (inactiva)' if not user.is_active else ''}")
                self.stdout.write("N. Crear otro propietario\n0. Salir")
                choice = input("Elige el número de tu cuenta: ").strip().lower()
                if choice in ("", "0"):
                    self.stdout.write("Sin cambios.")
                    return
                if choice == "n":
                    self.create_owner(ready)
                    return
                if not choice.isdigit() or not 1 <= int(choice) <= len(choices):
                    raise CommandError("Elige un número de la lista.")
                email = choices[int(choice) - 1].username
            user = get_user_model().objects.filter(username__iexact=email, is_active=True, is_staff=True).first()
            if user is None:
                raise CommandError("No existe una cuenta administrativa activa con ese correo. No se cambiaron permisos.")
            self.show_status(user)
            self.change_password(user)
            self.prepare_enrollment(user, ready)
            self.stdout.write("Cuando completes los pasos pendientes, abre INICIAR-PANEL.cmd y entra en http://127.0.0.1:8000/admin/.")
            self.stdout.write("Usa el correo elegido y tu contraseña; después confirma el segundo paso.")
        except (EOFError, KeyboardInterrupt) as exc:
            raise CommandError("Configuración interrumpida. Solo se conservan los cambios que ya confirmaste.") from exc
        except GetPassWarning as exc:
            raise CommandError("Esta ventana no permite ocultar la contraseña. Abre CONFIGURAR-ACCESO.cmd directamente en tu PC; no se guardó una nueva contraseña.") from exc

    def create_owner(self, mail_ready):
        choice = input("Segundo paso: 1 correo, 2 aplicación autenticadora [1]: ").strip()
        if choice not in ("", "1", "2"):
            raise CommandError("Elige 1 o 2.")
        method = "totp" if choice == "2" else "email"
        if method == "email" and not mail_ready:
            self.stdout.write("Primero ejecuta CONFIGURAR-CORREO.cmd y vuelve aquí. Todavía no se creó ninguna cuenta.")
            return
        with warnings.catch_warnings():
            warnings.simplefilter("error", GetPassWarning)
            call_command("create_owner", mfa=method, stdout=self.stdout)
        self.stdout.write("Abre INICIAR-PANEL.cmd y entra en http://127.0.0.1:8000/admin/ antes de 24 horas.")

    def change_password(self, user):
        answer = input("¿Quieres establecer una contraseña nueva? [s/N]: ").strip().lower()
        if answer not in ("s", "sí", "si"):
            self.stdout.write("Se conserva tu contraseña actual; no se puede mostrar ni recuperar su texto.")
            return
        with warnings.catch_warnings():
            warnings.simplefilter("error", GetPassWarning)
            password = getpass("Nueva contraseña (mínimo 12 caracteres; no se muestra): ")
            confirmation = getpass("Repite la nueva contraseña: ")
        if password != confirmation:
            raise CommandError("Las contraseñas no coinciden. Se conserva la anterior.")
        try:
            validate_password(password, user=user)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages)) from exc
        with transaction.atomic():
            SecurityState.objects.select_for_update().filter(user=user).first()
            locked_user = get_user_model().objects.select_for_update().get(pk=user.pk)
            if not locked_user.is_active or not locked_user.is_staff:
                raise CommandError("La cuenta dejó de estar autorizada. No se cambió su contraseña.")
            locked_user.set_password(password)
            locked_user.save(update_fields=["password"])
            revoke_sessions(locked_user)
            audit("password_changed_by_access_setup", user=locked_user)
        self.stdout.write("Contraseña actualizada y sesiones anteriores revocadas. El segundo paso sigue siendo obligatorio.")

    def prepare_enrollment(self, user, mail_ready):
        state = SecurityState.objects.filter(user=user).first()
        if state is None:
            raise CommandError("Esta cuenta no tiene un método de verificación configurado. Requiere revisión del operador.")
        if has_confirmed_device(user):
            current = (EmailDevice.objects.filter(user=user, confirmed=True, email=user.email).exclude(email="").exists()
                       if state.mfa_method == "email" else TOTPDevice.objects.filter(user=user, confirmed=True).exists())
            if not current:
                raise CommandError("Existen dispositivos protegidos, pero no coinciden con el método o correo actual. Un operador debe revisarlos; no se borró nada.")
            self.stdout.write("Tu segundo paso ya está activado. Se conservan todos los dispositivos y códigos de recuperación.")
            return
        if state.mfa_method == "email" and not mail_ready:
            self.stdout.write("La activación por correo sigue pendiente. Configura CONFIGURAR-CORREO.cmd y vuelve a CONFIGURAR-ACCESO.cmd.")
            return
        permission = EnrollmentPermission.objects.filter(user=user).first()
        if permission and permission.used_at:
            raise CommandError("Esta cuenta ya completó una activación anterior. La recuperación requiere revisión del operador; no se restableció MFA.")
        if permission and permission.expires_at > timezone.now():
            self.stdout.write("La primera activación todavía está vigente. Completa el segundo paso antes de que venza.")
            return
        answer = input("¿Habilitar tu primera verificación durante 24 horas? [s/N]: ").strip().lower()
        if answer not in ("s", "sí", "si"):
            self.stdout.write("La primera activación sigue pendiente; no podrás entrar hasta habilitarla.")
            return
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().get(user=user)
            user = get_user_model().objects.select_for_update().get(pk=user.pk)
            if not user.is_active or not user.is_staff or has_confirmed_device(user):
                raise CommandError("El estado de la cuenta cambió. Revisa su configuración; no se restableció MFA.")
            permission = EnrollmentPermission.objects.select_for_update().filter(user=user).first()
            if permission and permission.used_at:
                raise CommandError("La cuenta ya completó una activación; no se restableció MFA.")
            now = timezone.now()
            EnrollmentPermission.objects.update_or_create(user=user, defaults={"created_at": now, "expires_at": now + timedelta(hours=24), "used_at": None})
            audit("initial_enrollment_renewed_by_access_setup", user=user)
        self.stdout.write("Primera activación habilitada durante 24 horas. No se cambió el método ni se borraron dispositivos.")
