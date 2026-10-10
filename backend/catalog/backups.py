"""Authenticated commercial backups. Authentication accounts and secrets never enter an archive."""
import hashlib
import hmac
import json
import os
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.core import serializers
from django.core.exceptions import ValidationError
from django.core.management.color import no_style
from django.db import connection, transaction

from .audit import audit_context
from .models import AuditLog, BusinessSettings, Contact, MediaAsset, Product, ProductImage, ProductVariant

BACKUP_MODELS = (Contact, MediaAsset, Product, ProductVariant, ProductImage, BusinessSettings)
MAX_ARCHIVE_SIZE = 512 * 1024 * 1024
MAX_DATABASE_SIZE = 32 * 1024 * 1024


def signing_key():
    key = os.getenv("CATALOG_BACKUP_KEY") or settings.SECRET_KEY
    if len(key) < 32:
        raise ValidationError("CATALOG_BACKUP_KEY debe tener al menos 32 caracteres aleatorios.")
    return key.encode("utf-8")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def safe_media_name(name):
    if not re.fullmatch(r"catalog/[0-9a-f-]{36}\.(webp|pdf|glb)", name):
        raise ValidationError("La copia contiene una ruta de archivo no permitida.")
    return name


@transaction.atomic
def create_backup(destination):
    destination = Path(destination).resolve()
    public_roots = (Path(settings.BASE_DIR).parent / "public", Path(settings.FRONTEND_DIST))
    if any(destination.is_relative_to(root.resolve()) for root in public_roots):
        raise ValidationError("Guarde la copia fuera de las carpetas públicas de la web.")
    if destination.exists():
        raise ValidationError("El archivo de destino ya existe; elija otro nombre.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if connection.vendor == "postgresql":
        # Keep one consistent commercial snapshot while rows and media references are read.
        tables = ", ".join(connection.ops.quote_name(model._meta.db_table) for model in BACKUP_MODELS)
        with connection.cursor() as cursor:
            cursor.execute(f"LOCK TABLE {tables} IN SHARE MODE")
    records = [obj for model in BACKUP_MODELS for obj in model.objects.all()]
    database = serializers.serialize("json", records, ensure_ascii=False).encode("utf-8")
    media_root = Path(settings.MEDIA_ROOT).resolve()
    contents = {"catalog.json": database}
    for asset in MediaAsset.objects.all():
        name = safe_media_name(asset.file.name)
        path = (media_root / name).resolve()
        if not path.is_relative_to(media_root) or not path.is_file():
            raise ValidationError(f"Falta el archivo privado {asset.pk}; la copia no se creó.")
        contents[f"media/{name}"] = path.read_bytes()
    if sum(map(len, contents.values())) > MAX_ARCHIVE_SIZE:
        raise ValidationError("El respaldo supera 512 MB; solicite una copia operativa de base de datos y archivos.")
    manifest = {"format": "inox-catalog-v1", "created_at": datetime.now(timezone.utc).isoformat(), "files": {name: {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)} for name, data in contents.items()}}
    manifest["signature"] = hmac.new(signing_key(), canonical(manifest), hashlib.sha256).hexdigest()
    try:
        with destination.open("xb") as output:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("manifest.json", canonical(manifest))
                for name, data in contents.items():
                    archive.writestr(name, data)
        if os.name != "nt":
            destination.chmod(0o600)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return destination


def inspect_backup(source):
    source = Path(source)
    if source.stat().st_size > MAX_ARCHIVE_SIZE:
        raise ValidationError("La copia supera el límite de tamaño.")
    try:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or len(names) > 10000 or sum(info.file_size for info in infos) > MAX_ARCHIVE_SIZE:
                raise ValidationError("La copia contiene duplicados o excede los límites.")
            if "manifest.json" not in names or archive.getinfo("manifest.json").file_size > 2 * 1024 * 1024:
                raise ValidationError("La copia no contiene un manifiesto válido.")
            manifest = json.loads(archive.read("manifest.json"))
            signature = manifest.pop("signature", "")
            expected = hmac.new(signing_key(), canonical(manifest), hashlib.sha256).hexdigest()
            if not isinstance(signature, str) or not hmac.compare_digest(signature, expected) or manifest.get("format") != "inox-catalog-v1":
                raise ValidationError("Firma inválida. Use la misma CATALOG_BACKUP_KEY de la instalación de origen.")
            if not isinstance(manifest.get("files"), dict) or set(names) != {"manifest.json", *manifest["files"]} or "catalog.json" not in manifest["files"]:
                raise ValidationError("El contenido de la copia no coincide con su manifiesto.")
            contents = {}
            for name, metadata in manifest["files"].items():
                if name != "catalog.json":
                    if not name.startswith("media/"):
                        raise ValidationError("Ruta de archivo no permitida.")
                    safe_media_name(name.removeprefix("media/"))
                if name == "catalog.json" and archive.getinfo(name).file_size > MAX_DATABASE_SIZE:
                    raise ValidationError("Los datos comerciales superan el límite permitido.")
                data = archive.read(name)
                if len(data) != metadata.get("size") or hashlib.sha256(data).hexdigest() != metadata.get("sha256"):
                    raise ValidationError("La copia está dañada: no coinciden sus sumas de verificación.")
                contents[name] = data
    except (zipfile.BadZipFile, KeyError, TypeError, AttributeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError("La copia no tiene un formato válido.") from exc
    try:
        records = json.loads(contents.pop("catalog.json"))
        if not isinstance(records, list):
            raise ValueError
        allowed = {model._meta.label_lower for model in BACKUP_MODELS}
        if any(not isinstance(row, dict) or row.get("model") not in allowed for row in records):
            raise ValueError
        identities = [(row["model"], str(row["pk"])) for row in records]
        if len(set(identities)) != len(identities):
            raise ValueError
        objects = list(serializers.deserialize("json", json.dumps(records)))
    except Exception as exc:
        raise ValidationError("Los registros de la copia no son válidos.") from exc
    asset_files = {f"media/{safe_media_name(str(item.object.file))}" for item in objects if isinstance(item.object, MediaAsset)}
    if asset_files != set(contents):
        raise ValidationError("Los archivos no corresponden a los registros de la copia.")
    return objects, contents


def restore_backup(source):
    objects, contents = inspect_backup(source)
    media_root = Path(settings.MEDIA_ROOT).resolve()
    media_root.mkdir(parents=True, exist_ok=True)
    replaced, added = [], []
    with tempfile.TemporaryDirectory(prefix=".catalog-restore-", dir=media_root) as staging:
        staging = Path(staging)
        try:
            with transaction.atomic(), audit_context(operation="restore"):
                for model in reversed(BACKUP_MODELS):
                    model.objects.all().delete()
                for item in objects:
                    item.save()
                for item in objects:
                    item.object.full_clean()
                with connection.cursor() as cursor:
                    for sql in connection.ops.sequence_reset_sql(no_style(), BACKUP_MODELS):
                        cursor.execute(sql)
                for index, (name, data) in enumerate(contents.items()):
                    relative = safe_media_name(name.removeprefix("media/"))
                    target = (media_root / relative).resolve()
                    if not target.is_relative_to(media_root):
                        raise ValidationError("Ruta de archivo no permitida.")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    staged = staging / f"new-{index}"
                    staged.write_bytes(data)
                    if target.exists():
                        old = staging / f"old-{index}"
                        target.replace(old)
                        replaced.append((target, old))
                    else:
                        added.append(target)
                    staged.replace(target)
                AuditLog.objects.create(entity="catalog.backup", object_id="catalog", label="Restauración de copia comercial", operation="restore", after={"records": len(objects), "files": len(contents)})
        except Exception:
            for target in added:
                target.unlink(missing_ok=True)
            for target, old in reversed(replaced):
                target.unlink(missing_ok=True)
                old.replace(target)
            raise
    return len(objects)
