"""Private media storage: objects are served only through permission-aware views."""
import hashlib
import hmac
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured, SuspiciousFileOperation
from django.core.files import File
from django.core.files.storage import FileSystemStorage


def safe_storage_name(name):
    name = str(name)
    path = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or path.is_absolute()
            or path.as_posix() != name or any(part in {"", ".", ".."} for part in name.split("/"))):
        raise SuspiciousFileOperation("Ruta de almacenamiento no permitida.")
    return name


def check_local_path(storage, name):
    """Retain filesystem containment checks without requiring remote .path()."""
    name = safe_storage_name(name)
    if isinstance(storage, FileSystemStorage):
        root = Path(storage.location).resolve()
        target = root / name
        if not target.resolve().is_relative_to(root):
            raise SuspiciousFileOperation("El archivo sale del almacenamiento privado.")
        if any(part.is_symlink() for part in [target, *target.parents] if part != root and part.is_relative_to(root)):
            raise SuspiciousFileOperation("No se permiten enlaces simbólicos en medios privados.")
    return name


def open_private_file(storage, name):
    return storage.open(check_local_path(storage, name), "rb")


def file_digest(handle):
    digest, size = hashlib.sha256(), 0
    while chunk := handle.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
    return {"size": size, "sha256": digest.hexdigest()}


def verify_stored_file(storage, name, expected):
    with open_private_file(storage, name) as handle:
        actual = file_digest(handle)
    if actual["size"] != expected["size"] or not hmac.compare_digest(actual["sha256"], expected["sha256"]):
        raise OSError("El almacenamiento no conservó la suma de verificación del archivo.")


def save_new_file(storage, name, incoming, expected):
    """Call only during a quiescent import; never overwrite an existing object."""
    name = check_local_path(storage, name)
    if storage.exists(name):
        raise FileExistsError("El archivo de destino ya existe.")
    saved = storage.save(name, File(incoming, name=PurePosixPath(name).name))
    if saved != name:
        # Django can rename on conflict. A database reference must stay exact.
        storage.delete(saved)
        raise FileExistsError("El almacenamiento cambió el nombre del archivo; importación cancelada.")
    verify_stored_file(storage, name, expected)
    return name


def storage_names(storage, max_files=10000):
    """Enumerate the complete private storage, including unreferenced media."""
    pending, seen, result = [""], set(), []
    while pending:
        prefix = pending.pop()
        if prefix in seen or len(seen) + len(result) > max_files:
            raise OSError("El almacenamiento supera el límite de archivos o directorios.")
        seen.add(prefix)
        try:
            directories, files = storage.listdir(prefix)
        except FileNotFoundError:
            if not prefix:
                continue
            raise
        for child in directories + files:
            if not child or "/" in child or "\\" in child or child in {".", ".."}:
                raise SuspiciousFileOperation("El almacenamiento devolvió una ruta no permitida.")
            name = check_local_path(storage, f"{prefix}/{child}" if prefix else child)
            if child in directories:
                pending.append(name)
            else:
                result.append(name)
    return sorted(result)


# Import the optional dependency only when configuring the S3 backend. Local
# installations and storage-independent helpers do not need boto3 at startup.
def __getattr__(name):
    if name != "PrivateS3Storage":
        raise AttributeError(name)
    from botocore.config import Config
    from storages.backends.s3 import S3Storage

    class PrivateS3Storage(S3Storage):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            endpoint = urlsplit(self.endpoint_url or "")
            if (endpoint.scheme != "https" or not endpoint.hostname or endpoint.username
                    or endpoint.password or endpoint.query or endpoint.fragment):
                raise ImproperlyConfigured("El almacenamiento privado requiere un endpoint S3 HTTPS válido.")
            if not self.bucket_name or "ACL" in self.object_parameters:
                raise ImproperlyConfigured("El bucket privado es obligatorio y no admite ACL de objetos.")
            if self.default_acl is not None or not self.querystring_auth or self.custom_domain:
                raise ImproperlyConfigured("Los medios deben permanecer privados, sin dominio ni URL pública de bucket.")
            self.default_acl = None
            self.file_overwrite = False
            self.signature_version = "s3v4"
            self.addressing_style = "path"
            self.max_memory_size = 2 * 1024 * 1024
            self.use_ssl = True
            self.verify = True
            self.client_config = Config(
                signature_version="s3v4", s3={"addressing_style": "path"},
                connect_timeout=10, read_timeout=30,
                retries={"mode": "standard", "max_attempts": 3},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            )

        def url(self, name, *args, **kwargs):
            # Admin widgets must not bypass draft visibility via a signed URL.
            match = re.fullmatch(r"catalog/([0-9a-f-]{36})\.(?:webp|pdf|glb)", safe_storage_name(name))
            if not match:
                raise SuspiciousFileOperation("El archivo no tiene una ruta pública del catálogo.")
            return f"/media/{match.group(1)}/"

    globals()[name] = PrivateS3Storage
    return PrivateS3Storage
