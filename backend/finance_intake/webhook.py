"""Meta callback: verify signature, allowlist, persist, then acknowledge.

No financial posting, remote media retrieval, AI call or outgoing message occurs here.
"""
import hashlib
import hmac
import json
from datetime import datetime, timezone as dt_timezone

from django.core.exceptions import RequestDataTooBig
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .configuration import get_configuration, get_verification_token
from .models import IntakeMessage

MAX_BODY_BYTES = 3 * 1024 * 1024
MAX_UPDATES = 1000
MAX_TEXT = 16000
MEDIA_TYPES = {"image", "document", "audio", "video", "sticker"}


class InvalidPayload(ValueError):
    pass


class DisallowedPayload(ValueError):
    pass


class MessageConflict(ValueError):
    pass


def _string(value, limit, *, empty=False):
    if not isinstance(value, str) or len(value) > limit or (not value and not empty):
        raise InvalidPayload
    return value


def _same(a, b):
    return isinstance(a, str) and hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _list(value):
    if not isinstance(value, list) or len(value) > MAX_UPDATES:
        raise InvalidPayload
    return value


def _object(value):
    if not isinstance(value, dict):
        raise InvalidPayload
    return value


def _receipt(message, configuration):
    group = _string(message.get("group_id"), 512)
    identity_field = "from_user_id" if configuration.operator_id_kind == "bsuid" else "from"
    sender = message.get(identity_field)
    if group not in configuration.groups or not _same(sender, configuration.operator_id):
        raise DisallowedPayload
    message_id = _string(message.get("id"), 512)
    message_type = _string(message.get("type"), 32)
    text, media, note = "", {}, ""
    status = IntakeMessage.Status.PENDING
    if message_type == "text":
        body = _object(message.get("text")).get("body")
        if not isinstance(body, str):
            raise InvalidPayload
        text = body[:MAX_TEXT]
        if len(body) > MAX_TEXT:
            status, note = IntakeMessage.Status.NEEDS_REVIEW, "Texto recortado por longitud; revisar el mensaje original."
    elif message_type in MEDIA_TYPES:
        info = _object(message.get(message_type))
        for key, limit in (("id", 256), ("mime_type", 128), ("sha256", 128), ("filename", 255)):
            if key in info:
                media[key] = _string(info[key], limit, empty=True)
        if not media.get("id"):
            raise InvalidPayload
        caption = info.get("caption", "")
        if not isinstance(caption, str):
            raise InvalidPayload
        text = caption[:MAX_TEXT]
        status, note = IntakeMessage.Status.NEEDS_REVIEW, "Archivo pendiente de descargar y revisar. No se ha procesado con IA."
        if len(caption) > MAX_TEXT:
            # This flag is generated here, never accepted from a provider field.
            # Missing trailing context must not silently become a financial draft.
            media["caption_truncated"] = True
            note = "El pie de foto supera el límite y fue recortado. Revisa el mensaje completo antes de preparar un borrador."
    else:
        status, note = IntakeMessage.Status.NEEDS_REVIEW, "Tipo de mensaje pendiente de revisión manual."
    timestamp = message.get("timestamp")
    try:
        if not isinstance(timestamp, str) or not timestamp.isascii() or not timestamp.isdigit() or len(timestamp) > 12:
            raise ValueError
        timestamp = datetime.fromtimestamp(int(timestamp), tz=dt_timezone.utc)
    except (ValueError, OverflowError, OSError):
        raise InvalidPayload from None
    fingerprint = hashlib.sha256(json.dumps(message, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    return {"provider_message_id": message_id, "fingerprint": fingerprint, "group_id": group,
            "method": configuration.groups[group], "sender_id": sender, "sender_id_kind": configuration.operator_id_kind,
            "message_type": message_type, "text": text, "media": media,
            "provider_timestamp": timestamp, "status": status, "note": note,
            "receiver_phone_number_id": configuration.phone_number_id}


def extract_receipts(payload, configuration):
    if _object(payload).get("object") != "whatsapp_business_account":
        raise InvalidPayload
    receipts, updates = [], 0
    for entry in _list(payload.get("entry")):
        for change in _list(_object(entry).get("changes")):
            change = _object(change)
            updates += 1
            if updates > MAX_UPDATES:
                raise InvalidPayload
            if change.get("field") != "messages":
                continue
            value = _object(change.get("value"))
            if value.get("messaging_product") != "whatsapp":
                raise InvalidPayload
            metadata = _object(value.get("metadata"))
            if not _same(metadata.get("phone_number_id"), configuration.phone_number_id):
                raise DisallowedPayload
            # Delivery/read statuses are not financial inputs, including mixed callbacks.
            for message in _list(value.get("messages", [])):
                if len(receipts) >= MAX_UPDATES:
                    raise InvalidPayload
                receipts.append(_receipt(_object(message), configuration))
    return receipts


@transaction.atomic
def capture_receipts(receipts):
    created_count = 0
    for data in receipts:
        data = dict(data)
        message_id = data.pop("provider_message_id")
        if data["message_type"] == "image" and data["media"].get("caption_truncated"):
            data["processing_state"] = "review"
            data["processing_error_code"] = "caption_too_long"
            data["ocr_warnings"] = ["El pie de foto está recortado; verifica el mensaje completo y corrige los datos antes de crear el borrador."]
        elif (data["message_type"] == "image"
                and getattr(settings, "FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED", False) is True):
            # Defaults apply only to a newly captured message. Repeated Meta
            # deliveries must never restart processing or overwrite a review.
            data["processing_state"] = "queued"
            data["processing_available_at"] = timezone.now()
        row, created = IntakeMessage.objects.get_or_create(provider_message_id=message_id, defaults=data)
        if not created and row.fingerprint != data["fingerprint"]:
            raise MessageConflict
        created_count += int(created)
    return created_count


@csrf_exempt  # Meta signs the exact raw body; it cannot supply a browser CSRF token.
@never_cache
@require_http_methods(["GET", "POST"])
def whatsapp_webhook(request):
    if request.method == "GET":
        verify_token = get_verification_token()
        if verify_token is None:
            return HttpResponse("Verificación no habilitada.", status=503, content_type="text/plain")
        challenge = request.GET.get("hub.challenge", "")
        if (request.GET.get("hub.mode") != "subscribe"
                or not _same(request.GET.get("hub.verify_token"), verify_token)
                or not challenge or len(challenge) > 256):
            return HttpResponse(status=403)
        return HttpResponse(challenge, content_type="text/plain")
    configuration = get_configuration()
    if configuration is None:
        return HttpResponse("Recepción no habilitada.", status=503, content_type="text/plain")
    if request.content_type != "application/json":
        return HttpResponse(status=415)
    signature = request.headers.get("X-Hub-Signature-256", "")
    if len(signature) != 71 or not signature.startswith("sha256="):
        return HttpResponse(status=403)
    try:
        content_length = int(request.META.get("CONTENT_LENGTH", 0) or 0)
        if content_length < 0 or content_length > MAX_BODY_BYTES:
            return HttpResponse(status=413)
        body = request.body
    except (ValueError, RequestDataTooBig):
        return HttpResponse(status=413)
    if len(body) > MAX_BODY_BYTES:
        return HttpResponse(status=413)
    expected = "sha256=" + hmac.new(configuration.app_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not _same(signature, expected):
        return HttpResponse(status=403)
    try:
        payload = json.loads(body)
        receipts = extract_receipts(payload, configuration)
        created_count = capture_receipts(receipts)
    except DisallowedPayload:
        return HttpResponse(status=403)
    except MessageConflict:
        return HttpResponse(status=409)
    except (ValueError, RecursionError):
        # Includes invalid JSON/UTF-8 and Python's bounded integer parser.
        return HttpResponse(status=400)
    # Database failure deliberately returns a server error so Meta retries.
    return JsonResponse({"received": len(receipts), "queued": created_count})
