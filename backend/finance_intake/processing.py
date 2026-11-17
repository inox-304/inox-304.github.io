"""Bounded photo jobs. Automatic extraction can prepare a draft, never post money.

External work runs outside transactions. A UUID lease fences every checkpoint;
financial finalization locks company, any existing movement, then receipt.
"""
import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.base import ContentFile
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from catalog.storage import open_private_file
from finance import services as finance_services
from finance.models import Account, Attachment, Audit, Company, Movement
from finance.permissions import is_owner

from .configuration import get_configuration
from .models import IntakeAudit, IntakeMessage

MAX_BYTES = 10 * 1024 * 1024
LEASE_SECONDS = 600
MAX_ATTEMPTS = 3
READY_STATUSES = (IntakeMessage.Status.PENDING, IntakeMessage.Status.NEEDS_REVIEW)
STATE = IntakeMessage.ProcessingState
IDEMPOTENCY_NAMESPACE = uuid.UUID("9b357bdb-28d6-4e1d-a42c-11c0c49af4c9")
logger = logging.getLogger(__name__)
REVIEW_WARNINGS = {
    "company_required": "Selecciona la empresa: no se indicó una empresa inequívoca en el mensaje.",
    "company_inactive": "La empresa indicada está inactiva. Revisa su configuración antes de registrar movimientos.",
    "account_required": "Selecciona una cuenta activa de la empresa que coincida con el medio y la moneda; no se eligió una cuenta por defecto.",
    "kind_required": "Indica si fue un ingreso o egreso. Un traslado interno necesita que revises también la cuenta de destino.",
    "financial_fields_required": "Completa una fecha válida, moneda e importe positivo después de compararlos con el comprobante.",
    "duplicate_photo": "Esta foto ya aparece en otro mensaje o movimiento de la empresa. Si existe un borrador, vincula allí el mensaje. Si ambos mensajes siguen pendientes, conserva uno y descarta el duplicado con un motivo antes de continuar.",
    "conflicting_fields": "Hay datos contradictorios o una lectura poco clara. Compara la foto y el mensaje antes de corregir los campos.",
    "financial_validation": "Revisa que la cuenta y moneda sean correctas, la empresa esté activa y el mes esté abierto. No se creó el borrador.",
}
FAILURE_WARNINGS = {
    "media_not_configured": "Falta configurar el acceso privado a las fotos de WhatsApp. Revisa la conexión del servidor; también puedes cargar el comprobante directamente en el panel.",
    "provider_unavailable": "WhatsApp no entregó la foto. Revisa la conexión y sus permisos antes de reintentar; puedes cargar la foto directamente en el panel.",
    "download_timeout": "La descarga de WhatsApp tardó demasiado. Espera el reintento o carga la foto directamente en el panel.",
    "download_unavailable": "No se pudo conectar con WhatsApp. Espera el reintento o carga la foto directamente en el panel.",
    "incomplete_download": "La foto llegó incompleta. Vuelve a enviarla o carga el archivo original directamente en el panel.",
    "invalid_image": "La foto no pasó la validación. Envía un JPG o PNG estático de hasta 10 MB y 24 megapíxeles.",
    "unsupported_type": "Para lectura automática envía una foto JPG o PNG, no un documento de otro formato.",
    "unsupported_content_type": "El tipo de archivo recibido no coincide con una foto JPG o PNG válida. Vuelve a enviarla como imagen.",
    "image_too_large": "Reduce la foto a un máximo de 10 MB y 24 megapíxeles antes de volver a enviarla.",
    "invalid_size": "El tamaño recibido no es válido o supera el límite. Envía una foto JPG o PNG de hasta 10 MB.",
    "sha256_mismatch": "La foto recibida no coincide con su huella de integridad. No se usó para registrar dinero; envía otra vez el original.",
    "original_integrity": "El archivo conservado no coincide con su huella de integridad. Revisa el almacenamiento privado y vuelve a aportar el original.",
    "original_missing": "No se encontró una foto original completa. Reintenta la descarga o carga el comprobante directamente en el panel.",
    "storage_unavailable": "El almacenamiento privado no respondió. Espera el reintento y comprueba su disponibilidad antes de continuar.",
    "ocr_unavailable": "El lector del servidor no está disponible. Revisa su instalación o descarga la foto y usa «Leer comprobante» en el panel.",
    "ocr_timeout": "La lectura tardó demasiado. Usa una foto más nítida o completa los datos comparándolos con el original.",
    "ocr_failed": "El lector no completó la foto. Prueba con una imagen más nítida o completa y revisa los datos manualmente.",
    "ocr_output_invalid": "El resultado de lectura no es válido. Revisa un solo comprobante por foto y completa los datos manualmente.",
    "source_not_allowed": "El número, operador o grupo ya no está autorizado, o se desactivó la lectura automática. Revisa la conexión antes de reintentar.",
    "attempts_exhausted": "Se alcanzó el límite de intentos. Revisa la conexión y el original antes de solicitar otra lectura.",
}


def _failure_warning(code):
    return FAILURE_WARNINGS.get(code, "La lectura o descarga no superó sus comprobaciones. Revisa la conexión y la foto; puedes completar los datos manualmente cuando el original esté disponible.")


class ProcessingFailure(Exception):
    def __init__(self, code, *, retryable=False):
        self.code, self.retryable = code, retryable
        super().__init__("No se completó la lectura automática; revisa el comprobante.")


@dataclass(frozen=True)
class PhotoJob:
    receipt_id: int
    lease_token: uuid.UUID
    actor_id: int


def _enabled():
    return getattr(settings, "FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED", False) is True


def _owner(*, lock=False):
    name = getattr(settings, "SECURITY_OWNER_USERNAME", "")
    if not name:
        return None
    query = get_user_model().objects.filter(username__iexact=name, is_active=True, is_staff=True)
    if lock:
        query = query.select_for_update()
    candidates = list(query[:2])
    return candidates[0] if len(candidates) == 1 and is_owner(candidates[0]) else None


def _source_allowed(receipt):
    configuration = get_configuration()
    return bool(_enabled() and configuration
        and receipt.receiver_phone_number_id == configuration.phone_number_id
        and receipt.sender_id_kind == configuration.operator_id_kind
        and hmac.compare_digest(receipt.sender_id.encode(), configuration.operator_id.encode())
        and configuration.groups.get(receipt.group_id) == receipt.method
        and receipt.message_type == "image")


def _claimable():
    now = timezone.now()
    due = Q(processing_state__in=(STATE.QUEUED, STATE.RETRY)) & (
        Q(processing_available_at__isnull=True) | Q(processing_available_at__lte=now))
    expired = Q(processing_state=STATE.PROCESSING, processing_lease_until__lte=now)
    return IntakeMessage.objects.filter(due | expired, status__in=READY_STATUSES,
                                        movement__isnull=True, reviewed_at__isnull=True)


def _clear_lease(receipt):
    receipt.processing_lease_token = None
    receipt.processing_lease_until = None
    receipt.processing_available_at = None
    receipt.processing_version += 1


@transaction.atomic
def claim_next():
    """Claim only explicitly queued photos; old manual inbox entries stay manual."""
    actor = _owner()
    if not _enabled() or not get_configuration() or actor is None:
        return None
    for _ in range(20):
        query = _claimable().order_by("received_at", "pk")
        if connection.features.has_select_for_update_skip_locked:
            query = query.select_for_update(skip_locked=True)
        else:
            query = query.select_for_update()
        receipt = query.first()
        if receipt is None:
            return None
        if not _source_allowed(receipt) or receipt.processing_attempts >= MAX_ATTEMPTS:
            receipt.processing_state = STATE.CANCELLED if not _source_allowed(receipt) else STATE.REVIEW
            receipt.processing_error_code = "source_not_allowed" if receipt.processing_state == STATE.CANCELLED else "attempts_exhausted"
            receipt.status = IntakeMessage.Status.NEEDS_REVIEW
            receipt.note = "Lectura automática detenida. El original y el historial se conservan para revisión."
            receipt.ocr_warnings = [*receipt.ocr_warnings, _failure_warning(receipt.processing_error_code)]
            receipt.processed_at = timezone.now()
            _clear_lease(receipt)
            receipt.save()
            IntakeAudit.objects.create(receipt=receipt, actor=actor, action="auto_stopped", detail=receipt.note)
            continue
        token = uuid.uuid4()
        receipt.processing_state = STATE.PROCESSING
        receipt.processing_attempts += 1
        receipt.processing_version += 1
        receipt.processing_lease_token = token
        receipt.processing_lease_until = timezone.now() + timedelta(seconds=LEASE_SECONDS)
        receipt.processing_error_code = ""
        receipt.save(update_fields=["processing_state", "processing_attempts", "processing_version",
                                   "processing_lease_token", "processing_lease_until", "processing_error_code"])
        return PhotoJob(receipt.pk, token, actor.pk)
    return None


def _lease(job, *, lock=False):
    query = IntakeMessage.objects.filter(pk=job.receipt_id, processing_state=STATE.PROCESSING,
        processing_lease_token=job.lease_token, processing_lease_until__gt=timezone.now(),
        status__in=READY_STATUSES, movement__isnull=True, reviewed_at__isnull=True)
    return (query.select_for_update() if lock else query).first()


def _job_actor(job, receipt, *, lock=False):
    actor = _owner(lock=lock)
    if not _source_allowed(receipt) or actor is None or actor.pk != job.actor_id:
        raise ProcessingFailure("source_not_allowed")
    return actor


def _remove_created_file(field):
    if field and field.name:
        try:
            field.storage.delete(field.name)
        except Exception:
            # Cleanup must not replace the database/storage error with a provider
            # diagnostic. This unreferenced private object requires operator cleanup.
            logger.warning("finance_intake_private_cleanup_failed: revisar objetos privados sin referencia; no se confirmó ningún movimiento")


def _original_bytes(receipt):
    if not receipt.original_file or not 0 < receipt.original_size <= MAX_BYTES:
        raise ProcessingFailure("original_missing")
    try:
        with open_private_file(receipt.original_file.storage, receipt.original_file.name) as source:
            raw = source.read(MAX_BYTES + 1)
    except Exception as error:
        raise ProcessingFailure("storage_unavailable", retryable=True) from error
    if len(raw) != receipt.original_size or hashlib.sha256(raw).hexdigest() != receipt.original_sha256:
        raise ProcessingFailure("original_integrity")
    return raw


def _preserve_original(job, raw, content_type):
    extension = ".png" if content_type == "image/png" else ".jpg"
    if content_type not in ("image/png", "image/jpeg"):
        raise ProcessingFailure("unsupported_type")
    try:
        name, mime, raw, digest = finance_services._prepare_document(
            ContentFile(raw, name=f"WA-{job.receipt_id:06d}{extension}"), images_only=True)
    except ValidationError as error:
        raise ProcessingFailure("invalid_image") from error
    created = None
    try:
        with transaction.atomic():
            receipt = _lease(job, lock=True)
            if receipt is None:
                return False
            _job_actor(job, receipt)
            if receipt.original_file:
                if receipt.original_sha256 != digest:
                    raise ProcessingFailure("original_integrity")
                return True
            receipt.original_file.save(name, ContentFile(raw), save=False)
            created = receipt.original_file
            receipt.original_name, receipt.original_content_type = name, mime
            receipt.original_size, receipt.original_sha256 = len(raw), digest
            receipt.processing_version += 1
            receipt.save(update_fields=["original_file", "original_name", "original_content_type",
                "original_size", "original_sha256", "processing_version"])
            return True
    except Exception:
        _remove_created_file(created)
        raise


def _safe_fields(extracted):
    keys = {"amount": 40, "currency": 3, "date": 10, "reference": 120, "description": 500,
            "kind": 16, "company_code": 40, "company_name": 180, "account_code": 40}
    if not isinstance(extracted, dict):
        raise ProcessingFailure("ocr_output_invalid")
    fields = {}
    for key, limit in keys.items():
        value = extracted.get(key, "")
        if not isinstance(value, str) or len(value) > limit:
            raise ProcessingFailure("ocr_output_invalid")
        fields[key] = value.strip()
    for key in ("warnings", "conflicts"):
        values = extracted.get(key, [])
        if not isinstance(values, list) or len(values) > 30 or any(not isinstance(value, str) or len(value) > 500 for value in values):
            raise ProcessingFailure("ocr_output_invalid")
        fields[key] = values
    return fields


def _company_for(fields):
    code, name = fields["company_code"], fields["company_name"]
    if not code and not name:
        return None
    query = Company.objects.all()
    if code:
        query = query.filter(code__iexact=code)
    if name:
        query = query.filter(Q(name__iexact=name) | Q(code__iexact=name))
    matches = list(query[:2])
    return matches[0] if len(matches) == 1 else None


def _automatic_values(receipt, fields, company):
    if fields["conflicts"]:
        raise ProcessingFailure("conflicting_fields")
    if company is None:
        raise ProcessingFailure("company_required")
    if not company.active:
        raise ProcessingFailure("company_inactive")
    # Internal transfers need two manually reviewed accounts. A bank transfer
    # group does not mean the financial kind is an internal transfer.
    if fields["kind"] not in (Movement.Kind.INCOME, Movement.Kind.EXPENSE):
        raise ProcessingFailure("kind_required")
    try:
        when = date.fromisoformat(fields["date"])
        amount = Decimal(fields["amount"])
        if not amount.is_finite() or amount <= 0 or amount >= Decimal("1000000000000") or amount.as_tuple().exponent < -2:
            raise ValueError
        if not date(1900, 1, 1) <= when <= timezone.localdate() or fields["currency"] not in ("PEN", "USD"):
            raise ValueError
    except (ValueError, InvalidOperation):
        raise ProcessingFailure("financial_fields_required") from None
    query = Account.objects.filter(company=company, active=True, method=receipt.method, currency=fields["currency"])
    if fields["account_code"]:
        query = query.filter(code__iexact=fields["account_code"])
    accounts = list(query[:2])
    if len(accounts) != 1:
        raise ProcessingFailure("account_required")
    return {"company": company, "account": accounts[0], "kind": fields["kind"], "occurred_on": when,
        "amount": amount, "currency": fields["currency"], "reference": fields["reference"],
        "description": fields["description"] or "Comprobante recibido por WhatsApp; pendiente de revisión."}


def _duplicate(receipt, company):
    if Attachment.objects.filter(movement__company=company, sha256=receipt.original_sha256).exclude(movement__status=Movement.Status.VOID).exists():
        return True
    previous = IntakeMessage.objects.filter(original_sha256=receipt.original_sha256, proposed_company=company).exclude(pk=receipt.pk)
    previous = previous.exclude(status=IntakeMessage.Status.IGNORED).exclude(movement__status=Movement.Status.VOID)
    return previous.exists()


def _draft_key(receipt):
    return uuid.uuid5(IDEMPOTENCY_NAMESPACE, f"{receipt.provider_message_id}:{receipt.draft_generation}")


def _create_draft_locked(receipt, values, actor, raw, *, automatic):
    if _duplicate(receipt, values["company"]):
        raise ProcessingFailure("duplicate_photo")
    values = {**values, "source": Movement.Source.WHATSAPP, "source_reference": f"whatsapp:WA-{receipt.pk}:{receipt.original_sha256}"}
    movement = finance_services.create_draft(values, actor, idempotency_key=_draft_key(receipt))
    attachment = None
    try:
        attachment = finance_services.attach_document(movement.pk, ContentFile(raw, name=receipt.original_name), actor)
        receipt.movement = movement
        receipt.proposed_company = values["company"]
        receipt.status = IntakeMessage.Status.LINKED
        receipt.processing_state = STATE.DRAFTED
        receipt.processing_error_code = ""
        receipt.processed_at = timezone.now()
        receipt.reviewed_by = None if automatic else actor
        receipt.reviewed_at = None if automatic else timezone.now()
        receipt.note = ("Borrador preparado automáticamente desde la foto. Ninguna persona lo ha revisado ni confirmado."
                        if automatic else "Datos corregidos por el propietario; borrador preparado para revisión y confirmación por separado.")
        _clear_lease(receipt)
        receipt.save()
        IntakeAudit.objects.create(receipt=receipt, actor=actor, action="auto_draft" if automatic else "reviewed_draft", detail=receipt.note)
        Audit.objects.create(company=movement.company, movement=movement, actor=actor,
            action="whatsapp_auto_draft" if automatic else "whatsapp_reviewed_draft", body=receipt.note)
        return movement
    except Exception:
        if attachment:
            _remove_created_file(attachment.file)
        raise


def _finish(job, text, fields, raw):
    company = _company_for(fields)
    attachment = None
    try:
        with transaction.atomic():
            if company:
                company = Company.objects.select_for_update().get(pk=company.pk)
            # Ordinarily absent: pre-lock a previously created movement before
            # the inbox row. New movements cannot be held by another transaction.
            reference = IntakeMessage.objects.only("provider_message_id", "draft_generation").get(pk=job.receipt_id)
            list(Movement.objects.select_for_update().filter(idempotency_key=_draft_key(reference))[:1])
            actor = _owner(lock=True)
            receipt = _lease(job, lock=True)
            if receipt is None:
                return "stale"
            if actor is None or actor.pk != job.actor_id or not _source_allowed(receipt):
                raise ProcessingFailure("source_not_allowed")
            receipt.ocr_text = text
            receipt.ocr_fields = fields
            receipt.ocr_warnings = fields["warnings"]
            receipt.proposed_company = company
            try:
                values = _automatic_values(receipt, fields, company)
                # Nested atomic ensures a failed attachment/validation rolls back
                # its draft while preserving the extracted proposal for review.
                with transaction.atomic():
                    movement = _create_draft_locked(receipt, values, actor, raw, automatic=True)
                    attachment = movement.attachments.filter(sha256=receipt.original_sha256).first()
                return "drafted"
            except (ProcessingFailure, ValidationError, PermissionDenied) as error:
                receipt.movement = None
                receipt.reviewed_by = None
                receipt.reviewed_at = None
                receipt.status = IntakeMessage.Status.NEEDS_REVIEW
                receipt.processing_state = STATE.REVIEW
                receipt.processing_error_code = error.code if isinstance(error, ProcessingFailure) else "financial_validation"
                warning = REVIEW_WARNINGS.get(receipt.processing_error_code)
                if warning and warning not in receipt.ocr_warnings:
                    receipt.ocr_warnings = [*receipt.ocr_warnings, warning]
                receipt.processed_at = timezone.now()
                receipt.note = "Foto conservada y datos propuestos. Completa o corrige los campos y revisa antes de crear un borrador."
                _clear_lease(receipt)
                receipt.save()
                IntakeAudit.objects.create(receipt=receipt, actor=actor, action="auto_review", detail=receipt.note)
                return "review"
    except Exception:
        if attachment:
            _remove_created_file(attachment.file)
        raise


@transaction.atomic
def _failed(job, code, retryable=False):
    receipt = _lease(job, lock=True)
    if receipt is None:
        return "stale"
    allowed = _source_allowed(receipt)
    actor = _owner()
    retryable = bool(retryable and allowed and actor is not None and actor.pk == job.actor_id)
    receipt.processing_state = STATE.RETRY if retryable and receipt.processing_attempts < MAX_ATTEMPTS else (STATE.REVIEW if allowed else STATE.CANCELLED)
    receipt.processing_error_code = code
    warning = _failure_warning(code)
    if warning not in receipt.ocr_warnings:
        receipt.ocr_warnings = [*receipt.ocr_warnings, warning]
    receipt.status = IntakeMessage.Status.NEEDS_REVIEW
    receipt.note = "La lectura no se completó. Se reintentará con un límite." if receipt.processing_state == STATE.RETRY else "La lectura automática se detuvo. Revisa el comprobante; no se creó ni confirmó dinero."
    _clear_lease(receipt)
    if receipt.processing_state == STATE.RETRY:
        receipt.processing_available_at = timezone.now() + timedelta(seconds=min(300, 30 * 2 ** (receipt.processing_attempts - 1)))
    else:
        receipt.processed_at = timezone.now()
    receipt.save()
    IntakeAudit.objects.create(receipt=receipt, actor=actor, action="auto_retry" if receipt.processing_state == STATE.RETRY else "auto_stopped", detail=receipt.note)
    return receipt.processing_state


def process_job(job):
    from .meta_media import MediaDownloadError, download_image
    from .ocr import OCRReadError, read_image
    from .extraction import extract_fields

    receipt = _lease(job)
    if receipt is None:
        return "stale"
    try:
        _job_actor(job, receipt)
        if not receipt.original_file:
            media = receipt.media if isinstance(receipt.media, dict) else {}
            if not isinstance(media.get("id"), str) or not media["id"]:
                raise ProcessingFailure("media_missing")
            downloaded = download_image(media["id"], expected_sha256=media.get("sha256", ""), expected_mime=media.get("mime_type", ""))
            if hashlib.sha256(downloaded.data).hexdigest() != downloaded.sha256:
                raise ProcessingFailure("original_integrity")
            if not _preserve_original(job, downloaded.data, downloaded.content_type):
                return "stale"
            receipt = _lease(job)
            if receipt is None:
                return "stale"
        raw = _original_bytes(receipt)
        result = read_image(raw, receipt.original_content_type)
        text = result.get("text") if isinstance(result, dict) else None
        if not isinstance(text, str) or len(text) > 60000:
            raise ProcessingFailure("ocr_output_invalid")
        fields = _safe_fields(extract_fields(text, receipt.text))
        if receipt.media.get("caption_truncated") is True:
            # A manual retry may download this photo, but discarded caption
            # content could contain a different company/amount. Never auto-draft.
            fields["conflicts"].append("caption_truncated")
            fields["warnings"].append("El mensaje original era demasiado largo y está recortado. Revisa los datos o envía de nuevo una descripción breve; esta lectura no crea un borrador automáticamente.")
        confidence = result.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0.80 <= confidence <= 1:
            fields["conflicts"].append("ocr_confidence")
            fields["warnings"].append("La lectura tiene poca claridad. Revisa los datos con el original.")
        return _finish(job, text, fields, raw)
    except MediaDownloadError as error:
        return _failed(job, error.code, error.retryable)
    except OCRReadError as error:
        return _failed(job, error.code, error.code in ("ocr_unavailable", "ocr_timeout", "ocr_failed"))
    except ProcessingFailure as error:
        return _failed(job, error.code, error.retryable)
    except Exception:
        # No provider response, URL, OCR contents or credentials in errors/logs.
        return _failed(job, "processing_failed", True)


def process_next():
    job = claim_next()
    if job is None:
        return False
    process_job(job)
    return True


def _expected(receipt, expected_version):
    if isinstance(expected_version, bool) or str(expected_version) != str(receipt.processing_version):
        raise ValidationError("Este mensaje cambió. Recarga la página antes de continuar.")


@transaction.atomic
def request_processing(pk, actor, expected_version):
    if not is_owner(actor):
        raise PermissionDenied
    receipt = IntakeMessage.objects.select_for_update().get(pk=pk)
    _expected(receipt, expected_version)
    current_actor = _owner()
    if current_actor is None or current_actor.pk != actor.pk:
        raise PermissionDenied
    if receipt.movement_id or receipt.status not in READY_STATUSES or receipt.reviewed_at:
        raise ValidationError("Este mensaje ya fue revisado o vinculado; no se vuelve a procesar.")
    if not _source_allowed(receipt):
        raise ValidationError("La recepción automática o el origen ya no están autorizados.")
    if receipt.processing_state == STATE.PROCESSING and receipt.processing_lease_until and receipt.processing_lease_until > timezone.now():
        raise ValidationError("La foto se está leyendo. Espera a que termine antes de reintentar.")
    receipt.processing_state = STATE.QUEUED
    receipt.processing_attempts = 0
    receipt.processing_error_code = ""
    receipt.processed_at = None
    _clear_lease(receipt)
    receipt.processing_available_at = timezone.now()
    receipt.save()
    IntakeAudit.objects.create(receipt=receipt, actor=actor, action="retry_requested", detail="El propietario solicitó otra lectura de esta foto; no confirma un movimiento.")
    return receipt


def create_reviewed_draft(pk, data, actor, expected_version):
    """Explicit owner corrections create a draft without rerunning external OCR."""
    if not is_owner(actor):
        raise PermissionDenied
    values = finance_services._values(data)
    company = values.get("company")
    if company is None:
        raise ValidationError("Selecciona la empresa del movimiento.")
    reference = IntakeMessage.objects.get(pk=pk)
    try:
        raw = _original_bytes(reference)
    except ProcessingFailure as error:
        raise ValidationError("No se pudo verificar el original privado. No se creó el borrador; revisa el archivo antes de continuar.") from error
    attachment = None
    try:
        with transaction.atomic():
            company = Company.objects.select_for_update().get(pk=company.pk)
            values["company"] = company
            list(Movement.objects.select_for_update().filter(idempotency_key=_draft_key(reference))[:1])
            current_actor = _owner(lock=True)
            receipt = IntakeMessage.objects.select_for_update().get(pk=pk)
            _expected(receipt, expected_version)
            if current_actor is None or current_actor.pk != actor.pk:
                raise PermissionDenied
            if receipt.movement_id or receipt.status not in READY_STATUSES or receipt.reviewed_at:
                raise ValidationError("Este mensaje ya fue revisado o vinculado.")
            if not receipt.original_file or receipt.original_sha256 != reference.original_sha256:
                raise ValidationError("El original cambió. Recarga la página.")
            account = values.get("account")
            if account is None or account.company_id != company.pk or account.method != receipt.method:
                raise ValidationError("Elige una cuenta de esta empresa y del medio del mensaje.")
            movement = _create_draft_locked(receipt, values, current_actor, raw, automatic=False)
            attachment = movement.attachments.filter(sha256=receipt.original_sha256).first()
            return movement
    except ProcessingFailure as error:
        if attachment:
            _remove_created_file(attachment.file)
        raise ValidationError("Esta foto ya está asociada a un registro de la empresa. Revisa el posible duplicado.") from error
    except Exception:
        if attachment:
            _remove_created_file(attachment.file)
        raise


@transaction.atomic
def reject_automatic_draft(pk, actor, expected_version, reason):
    """Void an unreviewed automatic draft, preserving it before reclassification."""
    if not is_owner(actor):
        raise PermissionDenied
    reason = str(reason or "").strip()
    if not 8 <= len(reason) <= 800:
        raise ValidationError("Explica la corrección de empresa o cuenta (entre 8 y 800 caracteres).")
    reference = IntakeMessage.objects.select_related("movement").get(pk=pk)
    if not reference.movement_id:
        raise ValidationError("Este mensaje no tiene un borrador automático que corregir.")
    Company.objects.select_for_update().get(pk=reference.movement.company_id)
    movement = Movement.objects.select_for_update().get(pk=reference.movement_id)
    current_actor = _owner(lock=True)
    receipt = IntakeMessage.objects.select_for_update().get(pk=pk)
    _expected(receipt, expected_version)
    if current_actor is None or current_actor.pk != actor.pk:
        raise PermissionDenied
    if (receipt.movement_id != movement.pk or receipt.processing_state != STATE.DRAFTED
        or receipt.reviewed_by_id is not None or receipt.reviewed_at is not None
        or movement.status != Movement.Status.DRAFT or movement.source != Movement.Source.WHATSAPP
        or movement.version != 1):
        raise ValidationError("Solo se puede reclasificar aquí un borrador automático sin ediciones ni confirmación. Los cambios posteriores requieren revisar y anular el movimiento desde su ficha.")
    finance_services.void_movement(movement.pk, current_actor, movement.version,
                                  f"Reclasificación solicitada desde {receipt.code}: {reason}")
    receipt.movement = None
    receipt.proposed_company = None
    receipt.status = IntakeMessage.Status.NEEDS_REVIEW
    receipt.processing_state = STATE.REVIEW
    receipt.processing_error_code = "reclassification_requested"
    receipt.draft_generation += 1
    receipt.ocr_fields = {**receipt.ocr_fields, "company_code": "", "company_name": "", "account_code": ""}
    receipt.note = f"{movement.code} anulado sin borrar su historial. El propietario debe elegir la empresa y cuenta correctas antes de crear otro borrador."
    _clear_lease(receipt)
    receipt.save()
    IntakeAudit.objects.create(receipt=receipt, actor=current_actor, action="reclassify", detail=f"{receipt.note} Motivo: {reason}")
    return receipt
