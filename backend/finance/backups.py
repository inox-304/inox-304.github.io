"""Portable owner export. Financial records and originals, never login secrets."""
import hashlib
import json
import tempfile
import zipfile

from django.core import serializers
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connection, transaction
from django.utils import timezone

from catalog.storage import open_private_file, safe_storage_name
from .models import Account, Attachment, Audit, Category, ClosedPeriod, Company, CompanyAccess, Item, Movement, MovementLine
from .permissions import is_owner

MAX_RECORDS = 100000
MAX_BYTES = 256 * 1024 * 1024


class BoundedJSONWriter:
    def __init__(self, target, budget):
        self.target, self.budget = target, budget
        self.size = 0
        self.digest = hashlib.sha256()

    def write(self, value):
        data = value.encode("utf-8")
        self.size += len(data)
        self.budget[0] += len(data)
        if self.budget[0] > MAX_BYTES:
            raise ValidationError("El respaldo supera 256 MB; solicita una copia operativa.")
        self.digest.update(data)
        return self.target.write(data)


def build_backup(actor):
    if not is_owner(actor):
        raise PermissionDenied
    from finance_intake.models import IntakeMessage, IntakeAudit
    output = tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024, mode="w+b")
    manifest = {"format": "inox-finance-export-v1", "created_at": timezone.now().isoformat(),
                "files": {}, "record_counts": {}}
    budget = [0]
    try:
        with transaction.atomic():
            if connection.vendor == "postgresql":
                # Use one consistent database snapshot across all tables.
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                models = (Company, CompanyAccess, Account, Category, Item, Movement, MovementLine,
                          Attachment, Audit, ClosedPeriod, IntakeMessage, IntakeAudit)
                count = 0
                for model in models:
                    queryset = model.objects.order_by("pk")
                    size = queryset.count()
                    count += size
                    if count > MAX_RECORDS:
                        raise ValidationError("El respaldo supera el límite del panel. Solicita un respaldo operativo de la base de datos y los archivos.")
                    name = "data/" + model._meta.label_lower + ".json"
                    with archive.open(name, "w") as target:
                        writer = BoundedJSONWriter(target, budget)
                        serializers.serialize("json", queryset.iterator(chunk_size=200), ensure_ascii=False, stream=writer)
                    manifest["files"][name] = {"size": writer.size, "sha256": writer.digest.hexdigest()}
                    manifest["record_counts"][model._meta.label] = size
                for attachment in Attachment.objects.order_by("pk").iterator():
                    storage_name = safe_storage_name(attachment.file.name)
                    if not storage_name.startswith("finance/"):
                        raise ValidationError("Un comprobante tiene una ruta inesperada. Revisa el almacenamiento antes de exportar.")
                    name = f"documents/{attachment.pk}/" + storage_name.rsplit("/", 1)[-1]
                    digest, size = hashlib.sha256(), 0
                    with open_private_file(attachment.file.storage, storage_name) as source, archive.open(name, "w") as target:
                        while chunk := source.read(1024 * 1024):
                            size += len(chunk)
                            budget[0] += len(chunk)
                            if budget[0] > MAX_BYTES:
                                raise ValidationError("El respaldo supera 256 MB; solicita una copia operativa.")
                            digest.update(chunk)
                            target.write(chunk)
                    if size != attachment.size or digest.hexdigest() != attachment.sha256:
                        raise ValidationError("Un comprobante no coincide con su huella guardada. El respaldo no se entregó incompleto.")
                    manifest["files"][name] = {"size": size, "sha256": digest.hexdigest(), "storage_name": storage_name}
                instructions = (
                    "RESPALDO FINANCIERO PRIVADO - INOX 304\n"
                    "Contiene registros, permisos financieros, historial, mensajes recibidos y comprobantes originales.\n"
                    "No contiene contraseñas, sesiones, llaves de acceso ni secretos de las API.\n"
                    "Conservar en un lugar privado: el ZIP no está cifrado.\n"
                    "Los SHA-256 del manifiesto verifican integridad; no son una firma de autoría.\n"
                    "Es una exportación para recuperación asistida; no hay restauración automática desde el panel.\n"
                    "Antes de una restauración, verificar hashes, referencias de usuarios y probar en una base aislada.\n"
                ).encode("utf-8")
                archive.writestr("LEEME.txt", instructions)
                manifest["files"]["LEEME.txt"] = {"size": len(instructions), "sha256": hashlib.sha256(instructions).hexdigest()}
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
        output.seek(0)
        return output
    except Exception:
        output.close()
        raise
