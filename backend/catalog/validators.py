import ipaddress
import json
import re
import struct
from io import BytesIO
from urllib.parse import unquote, urlsplit

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.validators import URLValidator
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_FILE_SIZE = 8 * 1024 * 1024


def validate_public_url(value, kind="image"):
    if not value:
        return
    decoded = unquote(value)
    if any(char in decoded for char in ("\\", "\x00", "\r", "\n")) or ".." in decoded:
        raise ValidationError("La dirección del archivo no es segura.")
    extensions = {"image": (".jpg", ".jpeg", ".png", ".webp", ".avif"), "pdf": (".pdf",), "glb": (".glb",)}
    directories = {"image": "images", "pdf": "documents", "glb": "models"}
    if value.startswith("/"):
        if not re.fullmatch(rf"/{directories[kind]}/[A-Za-z0-9_./-]+", value) or "//" in value:
            raise ValidationError("Use un archivo subido o una ruta pública válida.")
    else:
        validate_https(value)
    if not urlsplit(value).path.lower().endswith(extensions[kind]):
        raise ValidationError("El tipo de archivo de la dirección no es compatible.")


def validate_https(value):
    if not value:
        return
    URLValidator(schemes=["https"])(value)
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValidationError("El puerto de la dirección no es válido.") from exc
    if parsed.username or parsed.password or not parsed.hostname or port not in (None, 443):
        raise ValidationError("Use una dirección HTTPS pública sin credenciales.")
    host = parsed.hostname.lower()
    if host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
        raise ValidationError("La dirección debe ser pública.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return
    if not address.is_global:
        raise ValidationError("La dirección debe ser pública.")


def clean_upload(upload, kind):
    if upload.size > MAX_FILE_SIZE:
        raise ValidationError("El archivo supera 8 MB.")
    upload.seek(0)
    data = upload.read(MAX_FILE_SIZE + 1)
    upload.seek(0)
    if len(data) > MAX_FILE_SIZE:
        raise ValidationError("El archivo supera 8 MB.")
    if kind == "image":
        try:
            with Image.open(BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP", "AVIF"}:
                    raise ValidationError("Use una imagen JPG, PNG, WebP o AVIF.")
                if source.width * source.height > 40_000_000:
                    raise ValidationError("La resolución de la imagen es demasiado grande.")
                source.load()
                picture = ImageOps.exif_transpose(source).convert("RGBA" if "A" in source.getbands() or "transparency" in source.info else "RGB")
                picture.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                result = BytesIO()
                picture.save(result, format="WEBP", quality=86, method=4)
                return ContentFile(result.getvalue(), name="image.webp"), "image/webp"
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            raise ValidationError("La imagen no es válida.") from exc
    if kind == "pdf":
        if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
            raise ValidationError("El archivo no es un PDF válido.")
        normalized = re.sub(rb"#([0-9a-fA-F]{2})", lambda match: bytes([int(match[1], 16)]), data).lower()
        if re.search(rb"/(?:javascript|js|launch|embeddedfile|openaction|aa)\b", normalized):
            raise ValidationError("El PDF contiene acciones o archivos incrustados no permitidos.")
        return ContentFile(data, name="document.pdf"), "application/pdf"
    if kind == "glb":
        validate_glb(data)
        return ContentFile(data, name="model.glb"), "model/gltf-binary"
    raise ValidationError("Tipo de archivo no permitido.")


def validate_glb(data):
    if len(data) < 20:
        raise ValidationError("El modelo GLB no es válido.")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValidationError("Use un archivo GLB 2.0 válido.")
    offset, document = 12, None
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValidationError("El modelo GLB está incompleto.")
        size, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise ValidationError("El modelo GLB está incompleto.")
        if document is None:
            if chunk_type != 0x4E4F534A:
                raise ValidationError("El primer bloque GLB debe ser JSON.")
            try:
                document = json.loads(data[offset:offset + size].decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
                raise ValidationError("El modelo GLB contiene JSON inválido.") from exc
        elif chunk_type != 0x004E4942:
            raise ValidationError("El modelo contiene bloques GLB no compatibles.")
        offset += size
    if not isinstance(document, dict) or not isinstance(document.get("asset"), dict) or document["asset"].get("version") != "2.0":
        raise ValidationError("El modelo GLB debe declarar la versión 2.0.")
    for field in ("buffers", "images", "meshes", "accessors", "extensionsRequired"):
        if field in document and not isinstance(document[field], list):
            raise ValidationError("La estructura del GLB no es válida.")
    if "EXT_meshopt_compression" in document.get("extensionsRequired", []):
        raise ValidationError("Exporte sin Meshopt o use Draco para este visor.")
    triangles = 0
    accessors = document.get("accessors", [])
    for mesh in document.get("meshes", []):
        if not isinstance(mesh, dict) or not isinstance(mesh.get("primitives", []), list):
            raise ValidationError("La malla GLB no es válida.")
        for primitive in mesh.get("primitives", []):
            if not isinstance(primitive, dict) or not isinstance(primitive.get("attributes", {}), dict):
                raise ValidationError("La primitiva GLB no es válida.")
            index = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
            if index is None:
                continue
            if not isinstance(index, int) or index < 0 or index >= len(accessors) or not isinstance(accessors[index], dict):
                raise ValidationError("El acceso a la geometría GLB no es válido.")
            count = accessors[index].get("count", 0)
            if not isinstance(count, int) or count < 0:
                raise ValidationError("El número de vértices GLB no es válido.")
            mode = primitive.get("mode", 4)
            triangles += count // 3 if mode == 4 else max(0, count - 2) if mode in (5, 6) else 0
    if triangles > 300_000:
        raise ValidationError("El modelo supera 300 000 triángulos; simplifique la geometría.")

    def inspect(value, depth=0):
        if depth > 80:
            raise ValidationError("El modelo GLB es demasiado complejo.")
        if isinstance(value, dict):
            for key, item in value.items():
                if key.lower() == "uri" and (not isinstance(item, str) or not item.startswith("data:")):
                    raise ValidationError("El GLB debe incluir sus recursos; no se permiten referencias externas.")
                inspect(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                inspect(item, depth + 1)
    inspect(document)
