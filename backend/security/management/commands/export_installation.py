from django.core.management.base import BaseCommand, CommandError
from security.installation_transfer import TransferError, export_installation


class Command(BaseCommand):
    help = "Exporta una instalación privada completa. Detén las escrituras durante el traslado; contiene secretos MFA."

    def add_arguments(self, parser):
        parser.add_argument("destination", help="Paquete ZIP nuevo dentro de una carpeta privada.")

    def handle(self, *args, **options):
        try:
            export_installation(options["destination"])
        except (TransferError, OSError) as error:
            raise CommandError(str(error)) from error
        except Exception:
            raise CommandError("No se pudo exportar la instalación. No se conserva ningún paquete parcial; revisa el estado del origen.") from None
        self.stdout.write(self.style.SUCCESS("Paquete privado completo creado. Contiene cuentas y secretos MFA: protégelo y no lo publiques. Conserva por separado la clave Django y las credenciales de servicios. Mantén detenidas las escrituras hasta el cambio de servidor."))
