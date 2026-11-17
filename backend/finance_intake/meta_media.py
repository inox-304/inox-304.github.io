"""Authenticated, bounded image retrieval from Meta; never follow webhook URLs.

Protocol: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
Only backend workers call this module. It does not persist or post financial data.
"""
import base64
import binascii
import hashlib
import hmac
from dataclasses import dataclass, field
from io import BytesIO
import json
import re
import time
from urllib.parse import urlencode, urlsplit
import warnings

from django.views.decorators.debug import sensitive_variables
from PIL import Image, UnidentifiedImageError
import requests
from urllib3.exceptions import HTTPError as TransportError

from .configuration import get_media_configuration


MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_METADATA_BYTES = 64 * 1024
MAX_IMAGE_PIXELS = 24_000_000
REQUEST_TIMEOUT = (5, 15)
TRANSFER_SECONDS = 30
MEDIA_HOSTS = frozenset({"lookaside.fbsbx.com"})
IMAGE_MIMES = frozenset({"image/jpeg", "image/png"})


class MediaDownloadError(ValueError):
    """Safe classification only: never retain provider bodies, URLs or tokens."""

    def __init__(self, code, *, retryable=False):
        self.code = code
        self.retryable = retryable
        super().__init__(code)


@dataclass(frozen=True)
class DownloadedImage:
    data: bytes = field(repr=False)
    content_type: str
    sha256: str


def _numeric_id(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9]{1,64}", value) is not None


def _digest(value, *, optional=False):
    if optional and value == "":
        return None
    if not isinstance(value, str) or len(value) > 64:
        raise MediaDownloadError("invalid_sha256")
    if re.fullmatch(r"[0-9a-fA-F]{64}", value):
        return bytes.fromhex(value)
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise MediaDownloadError("invalid_sha256") from None
    if len(decoded) != 32:
        raise MediaDownloadError("invalid_sha256")
    return decoded


def _size(value, *, maximum):
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,12}", value):
        value = int(value)
    if type(value) is not int or value <= 0 or value > maximum:
        raise MediaDownloadError("invalid_size")
    return value


def _media_url(value):
    # No wildcard domain, userinfo, custom port, backslash, fragment, or URL from
    # the webhook. A host change at Meta requires a reviewed allowlist update.
    if (not isinstance(value, str) or len(value) > 4096 or not value.isascii()
            or any(ord(character) <= 32 or ord(character) == 127 for character in value)
            or "\\" in value):
        raise MediaDownloadError("untrusted_media_url")
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname in MEDIA_HOSTS
                 and parsed.port in (None, 443) and parsed.username is None
                 and parsed.password is None and not parsed.fragment
                 and parsed.path == "/whatsapp_business/attachments/")
    except ValueError:
        valid = False
    if not valid:
        raise MediaDownloadError("untrusted_media_url")
    return value


def _mime(value):
    return value.split(";", 1)[0].strip().lower() if isinstance(value, str) else ""


@sensitive_variables()
def _fetch(session, url, *, headers, limit, mime_types, retry_not_found=False):
    started = time.monotonic()
    try:
        with session.get(url, headers=headers, timeout=REQUEST_TIMEOUT,
                         allow_redirects=False, stream=True) as response:
            if response.status_code != 200:
                raise MediaDownloadError("provider_unavailable", retryable=(
                    response.status_code in (408, 429) or 500 <= response.status_code <= 599
                    or (retry_not_found and response.status_code == 404)))
            if response.headers.get("Content-Encoding", "identity").lower() not in ("", "identity"):
                raise MediaDownloadError("unsupported_encoding")
            mime = _mime(response.headers.get("Content-Type"))
            if mime not in mime_types:
                raise MediaDownloadError("unsupported_content_type")
            length = response.headers.get("Content-Length")
            declared = _size(length, maximum=limit) if length is not None else None
            chunks, size = [], 0
            while True:
                # read1 returns available bytes instead of waiting for a full
                # 64-KiB chunk while a peer slowly trickles data. The deadline
                # is rechecked after each bounded socket read (15s timeout).
                if time.monotonic() - started > TRANSFER_SECONDS:
                    raise MediaDownloadError("download_timeout", retryable=True)
                chunk = response.raw.read1(64 * 1024, decode_content=False)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise MediaDownloadError("invalid_size")
                chunks.append(chunk)
            if not size or (declared is not None and declared != size):
                raise MediaDownloadError("incomplete_download", retryable=True)
            return b"".join(chunks), mime
    except (requests.RequestException, TransportError, OSError):
        # Requests exception text may contain the signed media URL, which must
        # never become a log entry, intake note or HTML error.
        raise MediaDownloadError("download_unavailable", retryable=True) from None


def _validate_image(data, mime):
    if ((mime == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"))
            or (mime == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"))):
        raise MediaDownloadError("invalid_image")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if (Image.MIME.get(image.format) != mime or getattr(image, "n_frames", 1) != 1
                        or image.width <= 0 or image.height <= 0
                        or image.width * image.height > MAX_IMAGE_PIXELS):
                    raise MediaDownloadError("invalid_image")
                image.verify()
    except (OSError, SyntaxError, ValueError, UnidentifiedImageError,
            Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise MediaDownloadError("invalid_image") from None


@sensitive_variables()
def download_image(media_id, expected_sha256="", expected_mime=""):
    """Return original image bytes only after origin, ownership and hash checks."""
    configuration = get_media_configuration()
    if configuration is None:
        raise MediaDownloadError("media_not_configured")
    if not _numeric_id(media_id):
        raise MediaDownloadError("invalid_media_id")
    expected_digest = _digest(expected_sha256, optional=True)
    if not isinstance(expected_mime, str) or (expected_mime and expected_mime not in IMAGE_MIMES):
        raise MediaDownloadError("unsupported_content_type")
    headers = {"Authorization": "Bearer " + configuration.token, "Accept-Encoding": "identity"}
    endpoint = f"https://graph.facebook.com/{configuration.version}/{media_id}?" + urlencode({"phone_number_id": configuration.phone_number_id})
    with requests.Session() as session:
        # Ignore HTTP(S)_PROXY and .netrc inherited from the server environment.
        session.trust_env = False
        session.max_redirects = 0
        metadata_bytes, _ = _fetch(session, endpoint, headers={**headers, "Accept": "application/json"},
                                   limit=MAX_METADATA_BYTES, mime_types={"application/json"})
        try:
            metadata = json.loads(metadata_bytes)
        except (ValueError, UnicodeError, RecursionError):
            raise MediaDownloadError("invalid_metadata") from None
        if (not isinstance(metadata, dict) or metadata.get("id") != media_id
                or metadata.get("messaging_product", "whatsapp") != "whatsapp"):
            raise MediaDownloadError("invalid_metadata")
        mime = metadata.get("mime_type")
        if not isinstance(mime, str) or mime not in IMAGE_MIMES or (expected_mime and mime != expected_mime):
            raise MediaDownloadError("unsupported_content_type")
        size = _size(metadata.get("file_size"), maximum=MAX_IMAGE_BYTES)
        metadata_digest = _digest(metadata.get("sha256"))
        if expected_digest is not None and not hmac.compare_digest(expected_digest, metadata_digest):
            raise MediaDownloadError("sha256_mismatch")
        media_url = _media_url(metadata.get("url"))
        data, downloaded_mime = _fetch(session, media_url, headers={**headers, "Accept": mime},
                                        limit=MAX_IMAGE_BYTES, mime_types=IMAGE_MIMES, retry_not_found=True)
    digest = hashlib.sha256(data).digest()
    if len(data) != size:
        raise MediaDownloadError("incomplete_download", retryable=True)
    if downloaded_mime != mime:
        raise MediaDownloadError("unsupported_content_type")
    if not hmac.compare_digest(digest, metadata_digest):
        raise MediaDownloadError("sha256_mismatch")
    _validate_image(data, mime)
    return DownloadedImage(data=data, content_type=mime, sha256=digest.hex())
