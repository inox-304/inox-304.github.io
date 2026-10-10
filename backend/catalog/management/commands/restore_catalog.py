from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from catalog.backups import create_backup, inspect_backup, restore_backup


class Command(BaseCommand):
    help = "Valida una copia firmada y restaura el catálogo. Requiere --confirm RESTAURAR y crea antes una copia de seguridad."

    def add_arguments(self, parser):
        parser.add_argument("source")
        parser.add_argument("--confirm", default="")
        parser.add_argument("--check", action="store_true", help="Solo verifica firma, integridad y estructura; no modifica datos.")

    def handle(self, *args, **options):
        try:
            objects, _ = inspect_backup(options["source"])
            if options["check"]:
                self.stdout.write(self.style.SUCCESS(f"Copia válida: {len(objects)} registros comerciales."))
                return
            if options["confirm"] != "RESTAURAR":
                raise CommandError("La restauración reemplaza los datos comerciales. Ejecute primero --check y confirme con --confirm RESTAURAR.")
            destination = Path(settings.DATA_DIR) / "backups" / f"antes-restauracion-{datetime.now(timezone.utc):%Y%m%d-%H%M%S-%f}.zip"
            create_backup(destination)
            count = restore_backup(options["source"])
        except (OSError, ValidationError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"Restaurados {count} registros. Copia previa: {destination}"))
