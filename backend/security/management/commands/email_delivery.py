"""Explicit delivery controls; never changes authentication or sends a code."""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from security.models import EmailDevice, SecurityState
from security.services import audit


class Command(BaseCommand):
    help = "Consulta, pausa por un rebote confirmado o reanuda el correo de una cuenta existente. No envía mensajes ni restablece MFA."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--action", choices=("status", "pause", "resume"), default="status")
        parser.add_argument("--confirm-reviewed", action="store_true",
                            help="Confirma revisión de la causa y acceso de recuperación antes de cambiar la entrega.")

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username__iexact=options["email"].strip(),
                                              is_active=True, is_staff=True).first()
        if user is None:
            raise CommandError("No existe una cuenta administrativa activa con ese correo.")
        action = options["action"]
        if action != "status" and not options["confirm_reviewed"]:
            raise CommandError("Revisa la causa y el acceso de recuperación; confirma con --confirm-reviewed. No hubo cambios.")
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().filter(user=user).first()
            device = EmailDevice.objects.select_for_update().filter(user=user).first()
            if state is None or state.mfa_method != "email" or device is None or device.email != user.email:
                raise CommandError("La cuenta no tiene un dispositivo de correo compatible. No hubo cambios.")
            if action == "status":
                self.stdout.write("Envío pausado." if device.delivery_paused_at else "Envío habilitado; esto no confirma entrega en el buzón.")
                return
            paused = action == "pause"
            if paused == (device.delivery_paused_at is not None):
                self.stdout.write("La entrega ya tiene ese estado. No hubo cambios.")
                return
            device.delivery_paused_at = timezone.now() if paused else None
            device.delivery_smtp_code = None
            device.save(update_fields=["delivery_paused_at", "delivery_smtp_code"])
            audit("email_delivery_paused_by_cli" if paused else "email_delivery_resumed_by_cli", user=user)
        self.stdout.write(self.style.SUCCESS("Entrega actualizada. No se enviaron correos ni se cambiaron contraseñas, MFA, sesiones o cuotas."))
