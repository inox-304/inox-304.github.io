from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from catalog.backups import create_backup


class Command(BaseCommand):
    help = "Crea una copia ZIP autenticada de los datos comerciales y archivos privados, sin usuarios ni secretos."

    def add_arguments(self, parser):
        parser.add_argument("destination", help="Archivo ZIP nuevo, fuera de las carpetas públicas.")

    def handle(self, *args, **options):
        try:
            path = create_backup(options["destination"])
        except (OSError, ValidationError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"Copia comercial creada: {path}"))
