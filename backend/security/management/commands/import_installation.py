from django.core.management.base import BaseCommand, CommandError
from security.installation_transfer import TransferError, import_installation


class Command(BaseCommand):
    help = "Comprueba o restaura una instalación completa únicamente sobre una base y archivos vacíos."

    def add_arguments(self, parser):
        parser.add_argument("source", help="Paquete privado de la instalación de origen.")
        choice = parser.add_mutually_exclusive_group(required=True)
        choice.add_argument("--check", action="store_true", help="Verifica paquete y destino sin restaurar datos.")
        choice.add_argument("--confirm", choices=["RESTORE_EMPTY_INSTALLATION"], help="Restaura solo sobre una instalación vacía.")

    def handle(self, *args, **options):
        try:
            import_installation(options["source"], check_only=options["check"])
        except (TransferError, OSError) as error:
            raise CommandError(str(error)) from error
        except Exception:
            raise CommandError("No se pudo restaurar la instalación. Los registros y archivos importados se revirtieron; revisa el esquema y el destino privado.") from None
        message = "Paquete y destino verificados; no se restauró ningún dato." if options["check"] else "Instalación restaurada y verificada: cuentas, segundo factor, permisos, sesiones, historial y archivos conservados. No se crearon cuentas nuevas ni se restablecieron accesos."
        self.stdout.write(self.style.SUCCESS(message))
