import signal
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from model_imports.runner import process_job
from model_imports.services import claim_job


class Command(BaseCommand):
    help = "Procesa la cola privada SketchUp con un único conversor acotado."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Procesa como máximo un trabajo y termina.")

    def handle(self, *args, **options):
        def stop(signum, frame):
            # BaseException unwinds convert_process's finally and kills its child.
            raise KeyboardInterrupt
        previous = signal.signal(signal.SIGTERM, stop)
        wait = 5
        try:
            while True:
                close_old_connections()
                job = claim_job()
                if job:
                    process_job(job)
                    wait = 5
                if options["once"]:
                    return
                if not job:
                    time.sleep(wait)
                    wait = min(wait + 5, 30)
        except KeyboardInterrupt:
            pass  # The fenced lease recovers interrupted work after expiry.
        finally:
            signal.signal(signal.SIGTERM, previous)
            close_old_connections()
