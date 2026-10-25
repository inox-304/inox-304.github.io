"""Write-only public intake. No cookie authentication or CRM records are exposed."""
import json
import hashlib
from uuid import UUID

from django.conf import settings
from django.core.exceptions import RequestDataTooBig, ValidationError
from django.db import DatabaseError, IntegrityError, transaction
from django.http import JsonResponse
from django.utils.cache import patch_vary_headers
from django.views.decorators.csrf import csrf_exempt

from security.services import reserve_attempt
from .metrics import record_web_metric
from .models import Opportunity, normalize_phone
from .services import create_opportunity

MAX_BODY = 12 * 1024
PUBLIC_FIELDS = {
    "name": 120, "phone": 40, "email": 254, "company": 150, "city": 100,
    "interest": 2000, "product_code": 64, "configuration": 4000,
    "source": 16, "campaign": 120, "medium": 80,
}


def _allowed_origin(request):
    allowed = {"https://inox-304.github.io", getattr(settings, "PUBLIC_ORIGIN", "").rstrip("/")}
    if settings.DEBUG:
        allowed.add(f"{request.scheme}://{request.get_host()}")
    origin = request.headers.get("Origin", "")
    return origin if origin and origin in allowed else None


def _response(request, data, status=200):
    response = JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})
    patch_vary_headers(response, ("Origin",))
    response["Cache-Control"] = "no-store, private"
    response["X-Content-Type-Options"] = "nosniff"
    origin = _allowed_origin(request)
    if origin:
        response["Access-Control-Allow-Origin"] = origin
        response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type"
    if status == 429:
        response["Retry-After"] = "900"
    return response


def _guard(request):
    if not _allowed_origin(request):
        return None, _response(request, {"ok": False, "error": "Solicitud no permitida."}, 403)
    if request.method == "OPTIONS":
        return None, _response(request, {"ok": True})
    if request.method != "POST":
        result = _response(request, {"ok": False, "error": "Método no permitido."}, 405)
        result["Allow"] = "POST, OPTIONS"
        return None, result
    if request.content_type != "application/json":
        return None, _response(request, {"ok": False, "error": "Formato no permitido."}, 415)
    try:
        if int(request.META.get("CONTENT_LENGTH") or 0) > MAX_BODY:
            raise RequestDataTooBig()
        body = request.body
        if len(body) > MAX_BODY:
            raise RequestDataTooBig()
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError()
    except RequestDataTooBig:
        return None, _response(request, {"ok": False, "error": "Solicitud demasiado extensa."}, 413)
    except (ValueError, UnicodeDecodeError):
        return None, _response(request, {"ok": False, "error": "Revisa los datos de tu solicitud."}, 400)
    return data, None


def _invalid(request):
    return _response(request, {"ok": False, "error": "Revisa tu nombre, teléfono o correo y los detalles de la consulta."}, 400)


def _existing_response(request, submission_id, fingerprint):
    existing = Opportunity.objects.filter(submission_id=submission_id).first()
    if not existing:
        return None
    # Bind retries to the original request, even after a salesperson edits its record.
    if existing.submission_fingerprint != fingerprint:
        return _invalid(request)
    return _response(request, {"ok": True, "reference": existing.code}, 200)


@csrf_exempt
def inquiries(request):
    data, rejected = _guard(request)
    if rejected is not None:
        return rejected
    if set(data) - (set(PUBLIC_FIELDS) | {"submission_id", "website", "consent"}):
        return _invalid(request)
    if data.get("website") or data.get("consent") is not True:
        return _invalid(request)
    try:
        submission_id = UUID(str(data.get("submission_id", "")), version=4)
        if str(submission_id) != data.get("submission_id"):
            raise ValueError()
        fields = {}
        for key, limit in PUBLIC_FIELDS.items():
            value = data.get(key, "website" if key == "source" else "")
            if not isinstance(value, str) or len(value) > limit or "\x00" in value:
                raise ValueError()
            fields[key] = value.strip()
        if not fields["name"] or not fields["interest"] or not (fields["phone"] or fields["email"]):
            raise ValueError()
        if fields["source"] not in Opportunity.Source.values:
            raise ValueError()
        fields["phone"] = normalize_phone(fields["phone"])
        fields["email"] = fields["email"].lower()
        fingerprint = hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        # Render may share one proxy address between visitors. Do not treat it as
        # their identity, or accept untrusted forwarding headers. Reserve a finite
        # overall budget before creating a contact-specific hashed throttle record.
        global_allowed = reserve_attempt("crm-inquiry:global", "public", 120)
        if not global_allowed:
            return _response(request, {"ok": False, "error": "Espera unos minutos antes de volver a enviar. También puedes escribirnos por WhatsApp."}, 429)
        existing = _existing_response(request, submission_id, fingerprint)
        if existing is not None:
            return existing
        if not reserve_attempt("crm-inquiry:contact", fields["email"] or fields["phone"], 5):
            return _response(request, {"ok": False, "error": "Espera unos minutos antes de volver a enviar. También puedes escribirnos por WhatsApp."}, 429)
        try:
            with transaction.atomic():
                opportunity = create_opportunity({**fields, "submission_id": submission_id, "submission_fingerprint": fingerprint}, actor=None)
                record_web_metric(fields["source"], "contact_submit")
        except (IntegrityError, ValidationError):
            # Concurrent retry may have completed between lookup and insertion.
            existing = _existing_response(request, submission_id, fingerprint)
            if existing is not None:
                return existing
            raise
    except (ValueError, TypeError, ValidationError):
        return _invalid(request)
    except DatabaseError:
        return _response(request, {"ok": False, "error": "El servicio no está disponible. Vuelve a intentarlo."}, 503)
    return _response(request, {"ok": True, "reference": opportunity.code}, 201)


@csrf_exempt
def events(request):
    data, rejected = _guard(request)
    if rejected is not None:
        return rejected
    if set(data) != {"event", "source"} or data.get("event") != "click_whatsapp" or data.get("source") not in Opportunity.Source.values:
        return _invalid(request)
    try:
        # Anonymous aggregate budget: no per-visitor identity or IP is recorded.
        if not reserve_attempt("crm-event:global", "public", 300):
            return _response(request, {"ok": False}, 429)
        record_web_metric(data["source"], "click_whatsapp")
    except DatabaseError:
        return _response(request, {"ok": False}, 503)
    return _response(request, {"ok": True}, 201)
