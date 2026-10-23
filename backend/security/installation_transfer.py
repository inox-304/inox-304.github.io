"""Private, authenticated installation handoff. Never a catalog-only backup.

Archives contain password hashes and MFA secrets. Runtime secret files are kept
outside the archive; the destination must already have the same Django key.
Stop application writers for the complete export, transfer and cutover window.
"""
import datetime
import hashlib
import hmac
import io
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

from django.apps import apps
from django.conf import settings
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core import serializers
from django.core.files.storage import FileSystemStorage, default_storage
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.db.models import Max
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone

from catalog.storage import open_private_file, save_new_file, storage_names


FORMAT = "inox-private-installation-v1"
MAX_TOTAL = 2 * 1024 ** 3
MAX_ENTRY = 128 * 1024 ** 2
MAX_DATABASE = 32 * 1024 ** 2
MAX_ARCHIVE = 1024 ** 3
MAX_FILES = 10000
MAX_RECORDS = 100000
INVENTORY_FILES = {"inventory/snapshot.json", "inventory/sync-status.json"}


class TransferError(Exception):
    pass


class TransferJSONEncoder(DjangoJSONEncoder):
    """Keep database timestamps exact, including sub-millisecond precision.

    Django's web JSON encoder truncates microseconds, and a timestamp ending in
    .000123 becomes .000 on export then loses that suffix on its next export.
    A transfer needs both lossless values and a stable digest after restoration.
    """

    def default(self, value):
        if isinstance(value, datetime.datetime):
            encoded = value.isoformat(timespec="microseconds")
            return encoded.removesuffix("+00:00") + "Z" if encoded.endswith("+00:00") else encoded
        if isinstance(value, datetime.time):
            if timezone.is_aware(value):
                raise ValueError("El traslado no admite horas con zona horaria.")
            return value.isoformat(timespec="microseconds")
        return super().default(value)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), cls=TransferJSONEncoder).encode("utf-8")


def key_fingerprint():
    if len(settings.SECRET_KEY) < 32:
        raise TransferError("La clave Django debe conservarse y tener al menos 32 caracteres.")
    return hashlib.sha256(settings.SECRET_KEY.encode()).hexdigest()


def signature(manifest):
    return hmac.new(settings.SECRET_KEY.encode(), canonical(manifest), hashlib.sha256).hexdigest()


def model_sets():
    ordinary = sorted((model for model in apps.get_models() if model._meta.managed and not model._meta.proxy), key=lambda model: model._meta.label_lower)
    relations = sorted((model for model in apps.get_models(include_auto_created=True)
                        if model._meta.auto_created and model._meta.managed), key=lambda model: model._meta.label_lower)
    return ordinary, relations


def schema():
    ordinary, relations = model_sets()
    models = ordinary + relations
    expected = {model._meta.db_table for model in models} | {MigrationRecorder.Migration._meta.db_table}
    with connection.cursor() as cursor:
        actual = set(connection.introspection.table_names(cursor))
    if actual != expected:
        raise TransferError("La instalación contiene tablas faltantes o no representadas por sus modelos; no se puede trasladar de forma completa.")
    description = [{"model": model._meta.label_lower, "table": model._meta.db_table,
                    "fields": [field.deconstruct()[0:3] for field in model._meta.local_fields],
                    "relations": [(field.name, field.remote_field.through._meta.label_lower) for field in model._meta.local_many_to_many]}
                   for model in models]
    migrations = sorted([list(row) for row in MigrationRecorder.Migration.objects.values_list("app", "name")])
    return {"models": [model._meta.label_lower for model in models], "tables": sorted(actual),
            "schema_sha256": hashlib.sha256(canonical(description)).hexdigest(), "migrations": migrations}


def lock_tables():
    if connection.vendor not in {"sqlite", "postgresql"}:
        raise TransferError("Este traslado solo admite SQLite y PostgreSQL.")
    if connection.vendor == "postgresql":
        ordinary, relations = model_sets()
        names = sorted({model._meta.db_table for model in ordinary + relations} | {"django_migrations"})
        with connection.cursor() as cursor:
            cursor.execute("LOCK TABLE " + ", ".join(connection.ops.quote_name(name) for name in names) + " IN SHARE ROW EXCLUSIVE MODE")
    elif connection.settings_dict.get("OPTIONS", {}).get("transaction_mode") != "IMMEDIATE":
        raise TransferError("SQLite debe usar transaction_mode=IMMEDIATE para una instantánea consistente.")


def safe_name(name):
    path = PurePosixPath(name)
    if not name or "\\" in name or ":" in name or path.is_absolute() or path.as_posix() != name or any(part in {"", ".", ".."} for part in name.split("/")):
        raise TransferError("El archivo contiene una ruta no permitida.")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{number}" for number in range(1, 10)), *(f"LPT{number}" for number in range(1, 10))}
    if any(part.rstrip(" .") != part or part.split(".")[0].upper() in reserved or any(ord(char) < 32 for char in part) for part in path.parts):
        raise TransferError("El archivo contiene una ruta no portable.")
    if name in {"database.json", "relations.json"} or name in INVENTORY_FILES:
        return name
    if len(path.parts) > 1 and path.parts[0] == "media":
        return name
    raise TransferError("El archivo incluye contenido ajeno a la instalación permitida.")


def data_roots():
    data = Path(settings.DATA_DIR).resolve()
    media = Path(settings.MEDIA_ROOT).resolve()
    if isinstance(default_storage, FileSystemStorage):
        if media != data / "media" or Path(default_storage.location).resolve() != media:
            raise TransferError("El traslado requiere almacenamiento local en DATA_DIR/media.")
    return data, media


class StoredSource:
    def __init__(self, name):
        self.name = name

    def open(self, mode):
        if mode != "rb":
            raise ValueError("Los medios de traslado solo se abren para lectura.")
        return open_private_file(default_storage, self.name)


def state_payload():
    ordinary, relations = model_sets()
    counts = {model._meta.label_lower: model.objects.count() for model in ordinary + relations}
    if sum(counts.values()) > MAX_RECORDS:
        raise TransferError("La instalación supera el límite de registros del traslado portable.")
    records = []
    for model in ordinary:
        rows = json.loads(serializers.serialize("json", model.objects.order_by("pk"), ensure_ascii=False, cls=TransferJSONEncoder))
        automatic = [field.name for field in model._meta.local_many_to_many if field.remote_field.through._meta.auto_created]
        for row in rows:
            for name in automatic:
                row["fields"].pop(name, None)
        records.extend(rows)
    joins = [{"model": model._meta.label_lower, "rows": list(model.objects.order_by("pk").values())} for model in relations]
    return {"database.json": canonical(records), "relations.json": canonical(joins)}, counts


def sequence_models():
    ordinary, relations = model_sets()
    return {model._meta.label_lower: model for model in ordinary + relations
            if model._meta.pk.get_internal_type() in {"AutoField", "BigAutoField", "SmallAutoField"}}


def sequence_highwaters():
    result = {}
    with connection.cursor() as cursor:
        for name, model in sequence_models().items():
            highest = model.objects.aggregate(value=Max("pk"))["value"] or 0
            if connection.vendor == "sqlite":
                cursor.execute("SELECT seq FROM sqlite_sequence WHERE name=%s", [model._meta.db_table])
                row = cursor.fetchone()
                counter = row[0] if row else 0
            else:
                sequences = connection.introspection.get_sequences(cursor, model._meta.db_table)
                sequences = [item for item in sequences if item["column"] == model._meta.pk.column]
                if len(sequences) != 1:
                    raise TransferError("No se pudo identificar la secuencia de una tabla.")
                cursor.execute("SELECT last_value, is_called FROM " + connection.ops.quote_name(sequences[0]["name"]))
                value, called = cursor.fetchone()
                counter = value if called else value - 1
            result[name] = max(0, highest, counter)
    return result


def restore_sequences(highwaters):
    with connection.cursor() as cursor:
        for name, model in sequence_models().items():
            value = highwaters[name]
            highest = model.objects.aggregate(value=Max("pk"))["value"] or 0
            if value < highest:
                raise TransferError("La secuencia del paquete no conserva todas las identidades.")
            if connection.vendor == "sqlite":
                cursor.execute("UPDATE sqlite_sequence SET seq=%s WHERE name=%s", [value, model._meta.db_table])
                if not cursor.rowcount:
                    cursor.execute("INSERT INTO sqlite_sequence(name, seq) VALUES (%s, %s)", [model._meta.db_table, value])
            else:
                cursor.execute("SELECT setval(pg_get_serial_sequence(%s, %s), %s, %s)",
                               [model._meta.db_table, model._meta.pk.column, max(1, value), value > 0])


def source_files():
    data, media = data_roots()
    result = []
    if (data / "inventory").is_symlink():
        raise TransferError("No se permiten enlaces simbólicos en el inventario.")
    for name in storage_names(default_storage, max_files=MAX_FILES):
        result.append((safe_name("media/" + name), StoredSource(name)))
    inventory_files = INVENTORY_FILES if getattr(settings, "INOX_INVENTORY_PERSISTENCE", "file") == "file" else set()
    for name in sorted(inventory_files):
        path = data / name
        if path.is_symlink() or (path.exists() and not path.resolve().is_relative_to(data)):
            raise TransferError("La copia de inventario contiene una ruta no permitida.")
        if path.is_file():
            result.append((name, path))
    from catalog.models import MediaAsset
    known = {name for name, _ in result}
    if any(safe_name("media/" + str(name)) not in known for name in MediaAsset.objects.values_list("file", flat=True)):
        raise TransferError("Faltan archivos referenciados por el catálogo. El traslado se detuvo.")
    return result


def export_installation(destination):
    destination = Path(destination).resolve()
    data, _ = data_roots()
    project = Path(settings.BASE_DIR).parent.resolve()
    public = [project / "public", Path(settings.FRONTEND_DIST).resolve(), Path(settings.STATIC_ROOT).resolve(), data / "media", data / "inventory"]
    if any(destination.is_relative_to(root) for root in public) or (destination.is_relative_to(project) and not destination.is_relative_to(data)):
        raise TransferError("Guarda el paquete en DATA_DIR/backups o en otra carpeta privada fuera del proyecto y de la web.")
    if destination.exists():
        raise TransferError("El archivo de destino ya existe; no se sobrescribió.")
    key_fingerprint()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    created = False
    try:
        with transaction.atomic():
            lock_tables()
            structure = schema()
            payloads, counts = state_payload()
            files = source_files()
            if len(payloads) + len(files) + 1 > MAX_FILES:
                raise TransferError("La instalación supera el límite de archivos.")
            manifest = {"format": FORMAT, "created_at": timezone.now().isoformat(), "django_key_sha256": key_fingerprint(),
                        "inventory_persistence": getattr(settings, "INOX_INVENTORY_PERSISTENCE", "file"),
                        **structure, "counts": counts, "sequences": sequence_highwaters(), "files": {}}
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created = True
            total = 0
            with os.fdopen(descriptor, "wb") as output, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for name, value in payloads.items():
                    if len(value) > MAX_DATABASE:
                        raise TransferError("Los registros superan el tamaño permitido.")
                    total += len(value)
                    archive.writestr(name, value)
                    manifest["files"][name] = {"size": len(value), "sha256": hashlib.sha256(value).hexdigest()}
                for name, path in files:
                    digest, size = hashlib.sha256(), 0
                    with path.open("rb") as source, archive.open(name, "w") as target:
                        while chunk := source.read(1024 * 1024):
                            size += len(chunk)
                            total += len(chunk)
                            if size > MAX_ENTRY or total > MAX_TOTAL:
                                raise TransferError("Los archivos superan el tamaño permitido para el traslado portable.")
                            digest.update(chunk)
                            target.write(chunk)
                    manifest["files"][name] = {"size": size, "sha256": digest.hexdigest()}
                manifest["signature"] = signature(manifest)
                archive.writestr("manifest.json", canonical(manifest))
        if destination.stat().st_size > MAX_ARCHIVE:
            raise TransferError("El paquete supera el límite de tamaño permitido.")
    except Exception:
        if created:
            destination.unlink(missing_ok=True)
        raise
    return destination


def inspect_archive(source):
    source = Path(source)
    if source.stat().st_size > MAX_ARCHIVE:
        raise TransferError("El paquete supera el límite de tamaño permitido.")
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)) or len(names) > MAX_FILES or sum(entry.file_size for entry in entries) > MAX_TOTAL:
                raise TransferError("El paquete contiene duplicados o supera los límites de tamaño.")
            if "manifest.json" not in names or archive.getinfo("manifest.json").file_size > 4 * 1024 * 1024:
                raise TransferError("El paquete no contiene un manifiesto válido.")
            manifest = json.loads(archive.read("manifest.json"))
            signed = manifest.pop("signature", "")
            if manifest.get("django_key_sha256") != key_fingerprint():
                raise TransferError("La clave Django efectiva no coincide. Conserva la clave privada del origen antes de importar.")
            if manifest.get("format") != FORMAT or not isinstance(signed, str) or not hmac.compare_digest(signed, signature(manifest)):
                raise TransferError("La firma del paquete no es válida.")
            if not isinstance(manifest.get("files"), dict) or set(names) != {"manifest.json", *manifest["files"]}:
                raise TransferError("El contenido no coincide con el manifiesto.")
            for name, metadata in manifest["files"].items():
                safe_name(name)
                entry = archive.getinfo(name)
                if entry.is_dir() or entry.file_size > MAX_ENTRY or entry.file_size != metadata.get("size") or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise TransferError("El paquete contiene un archivo no permitido.")
                if name in {"database.json", "relations.json"} and entry.file_size > MAX_DATABASE:
                    raise TransferError("Los registros superan el tamaño permitido.")
                digest = hashlib.sha256()
                with archive.open(name) as handle:
                    while chunk := handle.read(1024 * 1024):
                        digest.update(chunk)
                if not hmac.compare_digest(digest.hexdigest(), str(metadata.get("sha256", ""))):
                    raise TransferError("El paquete está dañado: no coincide la suma de verificación.")
            if not {"database.json", "relations.json"}.issubset(manifest["files"]):
                raise TransferError("Faltan los registros completos de la instalación.")
            current = schema()
            if any(manifest.get(key) != value for key, value in current.items()):
                raise TransferError("Las migraciones, tablas o modelos no coinciden. Usa el mismo código y esquema antes de importar.")
            database = json.loads(archive.read("database.json"))
            relations = json.loads(archive.read("relations.json"))
            validate_records(database, relations, manifest)
            source_inventory_mode(manifest, database)
            return manifest, database, relations
    except TransferError:
        raise
    except (OSError, ValueError, KeyError, TypeError, AttributeError, zipfile.BadZipFile, RuntimeError) as error:
        raise TransferError("El paquete privado no es válido o no se pudo leer.") from error


def validate_records(database, relations, manifest):
    ordinary, automatic = model_sets()
    allowed = {model._meta.label_lower: model for model in ordinary}
    joins = {model._meta.label_lower: model for model in automatic}
    if not isinstance(database, list) or not isinstance(relations, list) or len(database) > MAX_RECORDS:
        raise TransferError("Los registros del paquete no son válidos.")
    highwaters = manifest.get("sequences")
    if not isinstance(highwaters, dict) or set(highwaters) != set(sequence_models()) or any(type(value) is not int or not 0 <= value < 2 ** 63 for value in highwaters.values()):
        raise TransferError("Las secuencias del paquete no son válidas.")
    identities, counts = set(), {name: 0 for name in (*allowed, *joins)}
    for record in database:
        model = allowed.get(record.get("model"))
        identity = (record.get("model"), str(record.get("pk")))
        if model is None or record.get("pk") is None or identity in identities or not isinstance(record.get("fields"), dict):
            raise TransferError("El paquete contiene modelos, identidades o registros no permitidos.")
        automatic_names = {field.name for field in model._meta.local_many_to_many if field.remote_field.through._meta.auto_created}
        if automatic_names.intersection(record["fields"]):
            raise TransferError("Las relaciones deben conservar sus identidades propias.")
        identities.add(identity)
        counts[model._meta.label_lower] += 1
    if {item.get("model") for item in relations} != set(joins) or len(relations) != len(joins):
        raise TransferError("El paquete no conserva todas las relaciones de permisos.")
    for item in relations:
        model, seen = joins[item["model"]], set()
        expected = {field.attname for field in model._meta.local_fields}
        for row in item["rows"]:
            if set(row) != expected or row[model._meta.pk.attname] in seen:
                raise TransferError("Las relaciones del paquete no son válidas.")
            seen.add(row[model._meta.pk.attname])
        counts[item["model"]] = len(item["rows"])
    if counts != manifest.get("counts") or sum(counts.values()) > MAX_RECORDS:
        raise TransferError("Los conteos del paquete no coinciden.")
    from catalog.models import MediaAsset
    for row in database:
        if row["model"] == MediaAsset._meta.label_lower and safe_name("media/" + row["fields"]["file"]) not in manifest["files"]:
            raise TransferError("Faltan medios referenciados por los registros.")


def empty_destination():
    ordinary, automatic = model_sets()
    for model in ordinary + automatic:
        if model not in {ContentType, Permission} and model.objects.exists():
            raise TransferError("El destino contiene cuentas o datos. La importación solo admite una instalación vacía.")
    types = {(model._meta.app_label, model._meta.model_name): model for model in ordinary}
    for content_type in ContentType.objects.all():
        if (content_type.app_label, content_type.model) not in types:
            raise TransferError("El destino contiene tipos de contenido ajenos al esquema vacío.")
    for permission in Permission.objects.select_related("content_type"):
        model = types[(permission.content_type.app_label, permission.content_type.model)]
        standard = {f"{action}_{model._meta.model_name}" for action in model._meta.default_permissions}
        custom = {codename for codename, _ in model._meta.permissions}
        if permission.codename not in standard | custom:
            raise TransferError("El destino contiene permisos personalizados; no se sobrescribió.")
    data, media = data_roots()
    if storage_names(default_storage, max_files=MAX_FILES):
        raise TransferError("Los directorios de medios e inventario del destino deben estar vacíos.")
    for root in ((media, data / "inventory") if isinstance(default_storage, FileSystemStorage) else (data / "inventory",)):
        if root.is_symlink() or (root.exists() and (not root.is_dir() or any(root.iterdir()))):
            raise TransferError("Los directorios de medios e inventario del destino deben estar vacíos.")


def install_local_file(name, incoming, expected, installed, created_dirs):
    data, _ = data_roots()
    destination = data / safe_name(name)
    if not destination.resolve().is_relative_to(data):
        raise TransferError("La ruta de destino no es privada.")
    missing = []
    parent = destination.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700)
        created_dirs.append(directory)
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    installed.append(destination)
    digest, size = hashlib.sha256(), 0
    with os.fdopen(descriptor, "wb") as output:
        while chunk := incoming.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
            output.write(chunk)
    if size != expected["size"] or digest.hexdigest() != expected["sha256"]:
        raise TransferError("El archivo cambió durante el traslado; se canceló la importación.")


def install_files(source, manifest, installed, created_dirs):
    with zipfile.ZipFile(source) as archive:
        for name in manifest["files"]:
            if name in {"database.json", "relations.json"}:
                continue
            if name.startswith("media/") and not isinstance(default_storage, FileSystemStorage):
                relative = safe_name(name).removeprefix("media/")
                # Track before put: an interrupted provider response may mean
                # the object was created even when save() raised locally.
                if default_storage.exists(relative):
                    raise TransferError("El archivo remoto de destino ya existe; no se sobrescribió.")
                installed.append((default_storage, relative))
                with archive.open(name) as incoming:
                    save_new_file(default_storage, relative, incoming, manifest["files"][name])
                continue
            with archive.open(name) as incoming:
                install_local_file(name, incoming, manifest["files"][name], installed, created_dirs)


def source_inventory_mode(manifest, database):
    mode = manifest.get("inventory_persistence")
    if mode is None:
        # Packages predating persistence metadata used files. The first remote
        # package format omitted those files when its DB row was authoritative.
        has_row = any(row["model"] == "catalog.inventorysyncstate" for row in database)
        return "database" if has_row and not INVENTORY_FILES.intersection(manifest["files"]) else "file"
    if mode not in {"file", "database"}:
        raise TransferError("El respaldo no identifica un almacenamiento de inventario válido.")
    return mode


def restore_inventory_backend(source, manifest, database, installed, created_dirs):
    """Keep the active cache when moving in either direction between backends."""
    row = next((row for row in database if row["model"] == "catalog.inventorysyncstate"), None)
    source_mode = source_inventory_mode(manifest, database)
    if getattr(settings, "INOX_INVENTORY_PERSISTENCE", "file") == "file":
        if source_mode == "file" or row is None:
            return  # Its original files have already been restored verbatim.
        if INVENTORY_FILES.intersection(manifest["files"]):
            raise TransferError("La copia contiene dos estados de inventario distintos. No se eligió uno automáticamente.")
        from catalog.inventory import validate_snapshot
        snapshot = row["fields"].get("snapshot")
        status = row["fields"].get("status", {})
        if not isinstance(status, dict):
            raise TransferError("El estado de inventario no tiene un formato válido.")
        payloads = {"inventory/sync-status.json": canonical(status)}
        if len(payloads["inventory/sync-status.json"]) > 10_000:
            raise TransferError("El estado de inventario supera el tamaño permitido.")
        if snapshot is not None:
            validate_snapshot(snapshot)
            payloads["inventory/snapshot.json"] = canonical(snapshot)
        # Do not alter the serialized DB row; its exact digest remains intact.
        # New local files participate in the same cleanup journal as the media.
        for name, payload in payloads.items():
            install_local_file(name, io.BytesIO(payload),
                {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}, installed, created_dirs)
        return
    if source_mode == "database":
        return  # The exact serialized row, including its status, is preserved.
    names = INVENTORY_FILES.intersection(manifest["files"])
    if not names and row is None:
        return
    from catalog.inventory import import_inventory_state
    with zipfile.ZipFile(source) as archive:
        if any(archive.getinfo(name).file_size > MAX_DATABASE for name in names):
            raise TransferError("La copia de inventario supera el límite de traslado.")
        payload = {"snapshot": None, "status": {}}
        if "inventory/snapshot.json" in names:
            payload["snapshot"] = json.loads(archive.read("inventory/snapshot.json"))
        if "inventory/sync-status.json" in names:
            payload["status"] = json.loads(archive.read("inventory/sync-status.json"))
        # A prior cloud->local transfer may retain a dormant original DB row.
        # The signed active-backend marker makes the current files authoritative.
        import_inventory_state(payload, only_if_empty=row is None)


def import_installation(source, check_only=False):
    # Snapshot the verified archive privately to avoid a source replacement
    # between verification and installation. No live data is read or overwritten.
    data, _ = data_roots()
    source = Path(source).resolve()
    if check_only:
        with transaction.atomic():
            lock_tables()
            manifest, _, _ = inspect_archive(source)
            empty_destination()
        return manifest
    installed, created_dirs = [], []
    destination_sequences = None
    sequences_attempted = False
    committed = False
    try:
        with tempfile.TemporaryDirectory(prefix=".installation-import-", dir=data) as temporary:
            snapshot = Path(temporary) / "installation.zip"
            if source.stat().st_size > MAX_ARCHIVE:
                raise TransferError("El paquete supera el límite de tamaño permitido.")
            with source.open("rb") as incoming, snapshot.open("xb") as output:
                size = 0
                while chunk := incoming.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_ARCHIVE:
                        raise TransferError("El paquete supera el límite de tamaño permitido.")
                    output.write(chunk)
            snapshot.chmod(0o600)
            with transaction.atomic():
                lock_tables()
                manifest, database, relations = inspect_archive(snapshot)
                empty_destination()
                destination_sequences = sequence_highwaters()
                # Only generated rows in a verified empty destination are removed.
                Permission.objects.all().delete()
                ContentType.objects.all().delete()
                with connection.constraint_checks_disabled():
                    for item in serializers.deserialize("json", json.dumps(database), using=connection.alias):
                        item.save(using=connection.alias)
                    _, automatic = model_sets()
                    joins = {model._meta.label_lower: model for model in automatic}
                    for item in relations:
                        model = joins[item["model"]]
                        model.objects.bulk_create([model(**row) for row in item["rows"]])
                    connection.check_constraints()
                current, counts = state_payload()
                if counts != manifest["counts"] or any(hashlib.sha256(value).hexdigest() != manifest["files"][name]["sha256"] for name, value in current.items()):
                    raise TransferError("La base restaurada no coincide exactamente con la instalación exportada.")
                install_files(snapshot, manifest, installed, created_dirs)
                sequences_attempted = True
                restore_sequences(manifest["sequences"])
                restore_inventory_backend(snapshot, manifest, database, installed, created_dirs)
            committed = True
        return manifest
    except Exception:
        if committed:
            # TemporaryDirectory exits after atomic() has committed. A failed
            # cleanup must never remove media referenced by the committed rows.
            raise TransferError("La instalación se restauró, pero no se pudo completar la limpieza del paquete temporal privado. Los datos y medios se conservaron; revisa el temporal antes de usar el destino.") from None
        cleanup_failed = False
        for path in reversed(installed):
            try:
                if isinstance(path, tuple):
                    storage, name = path
                    storage.delete(name)
                elif path.resolve().is_relative_to(data):
                    path.unlink(missing_ok=True)
            except Exception:
                cleanup_failed = True
        for directory in reversed(created_dirs):
            if directory.resolve().is_relative_to(data):
                directory.rmdir()
        # PostgreSQL setval() is not transactional. After a failed import keep
        # counters at least as high as both the original and current database;
        # never promise exact sequence rollback or reuse a historical identity.
        if sequences_attempted and destination_sequences and connection.vendor == "postgresql":
            try:
                with transaction.atomic():
                    lock_tables()
                    current = sequence_highwaters()
                    restore_sequences({name: max(value, current[name]) for name, value in destination_sequences.items()})
            except Exception:
                raise TransferError("Los datos importados se revirtieron, pero las secuencias requieren revisión antes de usar el destino.") from None
        if cleanup_failed:
            raise TransferError("Los registros importados se revirtieron, pero no se pudo limpiar todo el almacenamiento. Revisa los objetos privados del destino antes de repetir el traslado.") from None
        raise
    finally:
        ContentType.objects.clear_cache()
