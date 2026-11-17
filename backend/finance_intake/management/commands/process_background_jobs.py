"""One serial worker for bounded model conversion and receipt OCR."""
import os
import signal
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections


class Command(BaseCommand):
    help = "Procesa fotos financieras y modelos en serie, sin confirmar movimientos."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        from finance_intake.processing import process_next
        from model_imports.runner import process_job
        from model_imports.services import claim_job

        imports = os.environ.get("MODEL_IMPORT_WORKER", "1" if os.environ.get("DJANGO_ENV") == "production" else "0") == "1"
        photos = settings.FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED

        def stop(_signum, _frame):
            raise KeyboardInterrupt

        previous = signal.signal(signal.SIGTERM, stop)
        wait = 5
        try:
            while True:
                close_old_connections()
                worked = process_next() if photos else False
                # Neither queue can starve the other. Heavy children never overlap.
                job = claim_job() if imports else None
                if job:
                    process_job(job)
                    worked = True
                if options["once"]:
                    return
                if worked:
                    wait = 5
                else:
                    time.sleep(wait)
                    wait = min(wait + 5, 30)
        except KeyboardInterrupt:
            pass  # Fenced leases make interrupted work retryable.
        finally:
            signal.signal(signal.SIGTERM, previous)
            close_old_connections()
