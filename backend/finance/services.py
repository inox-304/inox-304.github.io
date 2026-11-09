"""Atomic, explicitly authorized financial operations and immutable snapshots."""
import hashlib
import io
import json
import uuid
import warnings
from decimal import Decimal
from pathlib import Path

from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from PIL import Image

from .models import Account, Attachment, Audit, Category, ClosedPeriod, Company, Item, Movement, MovementLine
from .permissions import is_owner, require_company

EDITABLE = {"company", "account", "category", "destination_account", "kind", "occurred_on", "description", "reference", "amount", "currency", "source", "source_reference"}
LINE_FIELDS = {"item", "item_code", "item_name", "unit", "quantity", "unit_price", "unit_cost"}
CONFLICT = "Este movimiento cambió desde que abriste la ficha. Recarga y revisa los datos antes de guardar."


def _values(data):
    values = dict(data)
    values.pop("version", None)
    if set(values) - EDITABLE:
        raise ValidationError("La solicitud contiene campos que no se pueden modificar.")
    for field, model in (("company", Company), ("account", Account), ("category", Category), ("destination_account", Account)):
        if field in values and values[field] not in (None, "") and not isinstance(values[field], model):
            try:
                values[field] = model.objects.get(pk=values[field])
            except (model.DoesNotExist, TypeError, ValueError):
                raise ValidationError({field: "Selecciona un registro existente."})
        elif field in values and values[field] == "":
            values[field] = None
    return values


def _version(movement, expected):
    if isinstance(expected, bool) or str(expected) != str(movement.version):
        raise ValidationError(CONFLICT, code="conflict")


def _lock_company(company):
    return Company.objects.select_for_update().get(pk=getattr(company, "pk", company))


def _open_period(company, occurred_on):
    if ClosedPeriod.objects.filter(company=company, year=occurred_on.year, month=occurred_on.month, is_closed=True).exists():
        raise ValidationError("Ese mes está cerrado. El propietario debe reabrirlo con un motivo antes de corregirlo.")


def _current_objects(movement):
    """Re-read master records under the company lock before validating."""
    if not movement.company.active:
        raise ValidationError("Esta empresa está inactiva; sus registros anteriores se conservan.")
    movement.account = Account.objects.get(pk=movement.account_id)
    if not movement.account.active:
        raise ValidationError({"account": "La cuenta está inactiva."})
    if movement.destination_account_id:
        movement.destination_account = Account.objects.get(pk=movement.destination_account_id)
        if not movement.destination_account.active:
            raise ValidationError({"destination_account": "La cuenta de destino está inactiva."})
    if movement.category_id:
        movement.category = Category.objects.get(pk=movement.category_id)
        if not movement.category.active:
            raise ValidationError({"category": "La categoría está inactiva."})


def _audit(movement, actor, action, body):
    return Audit.objects.create(company=movement.company, movement=movement, actor=actor, action=action, body=body)


def _json_value(value):
    if hasattr(value, "pk"):
        return value.pk
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value.normalize())
    return value


def _fingerprint(values, lines):
    payload = {key: _json_value(value) for key, value in values.items()}
    payload["lines"] = [{key: _json_value(value) for key, value in line.items()} for line in (lines or [])]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _put_lines(movement, lines):
    if not isinstance(lines, (tuple, list)) or len(lines) > 100:
        raise ValidationError("Añade como máximo 100 detalles por movimiento.")
    if lines and movement.kind == Movement.Kind.TRANSFER:
        raise ValidationError("Un traslado conserva su importe; no contiene compras ni ventas de ítems.")
    prepared = []
    for values in lines:
        values = dict(values)
        if set(values) - LINE_FIELDS:
            raise ValidationError("El detalle incluye campos no admitidos.")
        item = values.get("item")
        if item:
            try:
                item = Item.objects.get(pk=getattr(item, "pk", item))
            except (Item.DoesNotExist, ValueError, TypeError):
                raise ValidationError("El ítem seleccionado ya no está disponible.")
            if not item.active:
                raise ValidationError("El ítem seleccionado está inactivo.")
            values["item"] = item
            historical = movement.occurred_on < timezone.localdate() or movement.source == Movement.Source.IMPORT
            if historical and "unit_price" not in values:
                raise ValidationError("Indica el precio real histórico del ítem. Una operación anterior no utiliza el precio de hoy.")
            # Unknown historical costs stay unknown; never backfill from today's catalog.
            for field, fallback in (("item_code", item.code), ("item_name", item.name), ("unit", item.unit), ("unit_price", item.current_unit_price), ("unit_cost", None if historical else item.current_unit_cost)):
                # An explicit null cost means unknown, never a lookup of today's cost.
                if field not in values or (field in ("item_code", "item_name", "unit") and not values[field]):
                    values[field] = fallback
        else:
            values["item"] = None
        if values.get("unit_price") is None:
            raise ValidationError("Indica el precio real de cada detalle; no hay precio sugerido disponible.")
        line = MovementLine(movement=movement, **values)
        line.full_clean()
        prepared.append(line)
    movement.lines.all().delete()
    for line in prepared:
        line.save()


@transaction.atomic
def create_draft(data, actor, lines=None, idempotency_key=None):
    values = _values(data)
    company = values.get("company")
    if company is None:
        raise ValidationError({"company": "Selecciona una empresa."})
    require_company(actor, company, "record")
    values["company"] = _lock_company(company)
    require_company(actor, values["company"], "record")
    key = idempotency_key or uuid.uuid4()
    try:
        key = uuid.UUID(str(key))
    except (ValueError, AttributeError, TypeError):
        raise ValidationError("Falta una referencia de envío válida; abre un formulario nuevo.")
    fingerprint = _fingerprint(values, lines)
    existing = Movement.objects.filter(idempotency_key=key).first()
    if existing:
        if existing.company_id != company.pk or existing.created_by_id != actor.pk or existing.submission_fingerprint != fingerprint:
            raise ValidationError("Esta referencia de envío ya corresponde a otro registro. Abre un formulario nuevo.")
        return existing
    movement = Movement(**values, idempotency_key=key, submission_fingerprint=fingerprint, created_by=actor, updated_by=actor)
    movement.full_clean()
    _current_objects(movement)
    _open_period(company, movement.occurred_on)
    movement.save()
    _put_lines(movement, lines or [])
    _audit(movement, actor, "created", f"Borrador creado: {movement.get_kind_display()}, {movement.amount} {movement.currency}. Aún no suma a resultados.")
    return movement


@transaction.atomic
def update_draft(pk, data, actor, expected_version, lines=None):
    reference = Movement.objects.get(pk=pk)
    require_company(actor, reference.company, "record")
    company = _lock_company(reference.company)
    require_company(actor, company, "record")
    movement = Movement.objects.select_for_update().get(pk=pk)
    _version(movement, expected_version)
    if movement.status != Movement.Status.DRAFT:
        raise ValidationError("Solo se editan borradores. Los confirmados se conservan y se anulan con motivo.")
    _open_period(company, movement.occurred_on)
    values = _values(data)
    if "company" in values and values["company"].pk != company.pk:
        raise ValidationError("La empresa de un movimiento guardado no se cambia. Crea un borrador nuevo.")
    for field, value in values.items():
        setattr(movement, field, value)
    movement.company = company
    movement.updated_by = actor
    movement.version += 1
    movement.full_clean()
    _current_objects(movement)
    _open_period(company, movement.occurred_on)
    movement.save()
    if lines is not None:
        _put_lines(movement, lines)
    # Changing currency/type must also validate existing preserved details.
    for line in movement.lines.all():
        line.movement = movement
        line.full_clean()
    if movement.kind == Movement.Kind.TRANSFER and movement.lines.exists():
        raise ValidationError("Retira los detalles de compras o ventas antes de registrar un traslado.")
    _audit(movement, actor, "updated", f"Borrador revisado. Versión {movement.version}; importe {movement.amount} {movement.currency}.")
    return movement


@transaction.atomic
def post_movement(pk, actor, expected_version):
    reference = Movement.objects.get(pk=pk)
    require_company(actor, reference.company, "review")
    company = _lock_company(reference.company)
    require_company(actor, company, "review")
    movement = Movement.objects.select_for_update().get(pk=pk)
    _version(movement, expected_version)
    if movement.status != Movement.Status.DRAFT:
        raise ValidationError("Este movimiento ya fue confirmado o anulado.")
    movement.company = company
    _current_objects(movement)
    _open_period(company, movement.occurred_on)
    movement.full_clean()
    lines = list(movement.lines.all())
    for line in lines:
        line.movement = movement
        line.full_clean()
    if lines and sum((line.total for line in lines), Decimal("0")) != movement.amount:
        raise ValidationError("La suma de los detalles debe coincidir exactamente con el importe del movimiento.")
    if movement.reference and Movement.objects.filter(company=company, account=movement.account, status=Movement.Status.POSTED, reference__iexact=movement.reference).exclude(pk=movement.pk).exists():
        raise ValidationError("Esa referencia de pago ya está confirmada en esta cuenta. Revisa el posible duplicado.")
    movement.status = Movement.Status.POSTED
    movement.posted_at = timezone.now()
    movement.posted_by = actor
    movement.updated_by = actor
    movement.version += 1
    movement._finance_transition = True
    movement.save()
    _audit(movement, actor, "posted", f"Confirmado por revisión humana: {movement.amount} {movement.currency}. Importes y detalles históricos protegidos.")
    return movement


@transaction.atomic
def void_movement(pk, actor, expected_version, reason):
    reference = Movement.objects.get(pk=pk)
    require_company(actor, reference.company, "review")
    company = _lock_company(reference.company)
    require_company(actor, company, "review")
    movement = Movement.objects.select_for_update().get(pk=pk)
    _version(movement, expected_version)
    if movement.status == Movement.Status.VOID:
        raise ValidationError("Este movimiento ya fue anulado.")
    reason = str(reason or "").strip()
    if not reason or len(reason) > 1000:
        raise ValidationError("Escribe un motivo de anulación de hasta 1000 caracteres.")
    _open_period(company, movement.occurred_on)
    movement.status = Movement.Status.VOID
    movement.voided_at = timezone.now()
    movement.voided_by = actor
    movement.void_reason = reason
    movement.updated_by = actor
    movement.version += 1
    movement._finance_transition = True
    movement.save()
    _audit(movement, actor, "voided", f"Anulado sin borrar importes originales. Motivo: {reason}")
    return movement


@transaction.atomic
def close_period(company, year, month, actor):
    require_company(actor, company, "review")
    company = _lock_company(company)
    require_company(actor, company, "review")
    period = ClosedPeriod(company=company, year=int(year), month=int(month), closed_by=actor)
    period.full_clean(exclude=["id"], validate_unique=False, validate_constraints=False)
    if Movement.objects.filter(company=company, occurred_on__year=year, occurred_on__month=month, status=Movement.Status.DRAFT).exists():
        raise ValidationError("Quedan borradores en ese mes. Confírmalos o anúlalos antes de cerrar.")
    existing = ClosedPeriod.objects.filter(company=company, year=year, month=month).first()
    if existing and existing.is_closed:
        raise ValidationError("Ese mes ya está cerrado.")
    if existing:
        period = existing
        period.is_closed = True
        period.closed_by = actor
        period.closed_at = timezone.now()
    period.save()
    Audit.objects.create(company=company, actor=actor, action="period_closed", body=f"Mes {year}-{int(month):02d} cerrado. No admite altas, cambios ni anulaciones.")
    return period


@transaction.atomic
def reopen_period(company, year, month, actor, reason):
    if not is_owner(actor):
        raise PermissionDenied("Solo el propietario puede reabrir un mes.")
    company = _lock_company(company)
    reason = str(reason or "").strip()
    if not reason or len(reason) > 1000:
        raise ValidationError("Escribe un motivo de reapertura de hasta 1000 caracteres.")
    period = ClosedPeriod.objects.filter(company=company, year=year, month=month, is_closed=True).first()
    if not period:
        raise ValidationError("Ese mes no está cerrado.")
    period.is_closed = False
    period.save()
    Audit.objects.create(company=company, actor=actor, action="period_reopened", body=f"Mes {year}-{int(month):02d} reabierto por el propietario. Motivo: {reason}")
    return period


def attach_document(movement_id, uploaded_file, actor):
    """Private download-only documents, no OCR or code execution during upload."""
    max_size = 10 * 1024 * 1024
    if not uploaded_file or uploaded_file.size > max_size:
        raise ValidationError("Adjunta un PDF, JPG o PNG de hasta 10 MB.")
    raw = bytearray()
    for chunk in uploaded_file.chunks():
        raw.extend(chunk)
        if len(raw) > max_size:
            raise ValidationError("El comprobante supera 10 MB.")
    raw = bytes(raw)
    name = Path(str(uploaded_file.name).replace("\\", "/")).name[:180]
    ext = Path(name).suffix.lower()
    if ext == ".pdf" and raw.startswith(b"%PDF-") and b"%%EOF" in raw[-2048:]:
        mime = "application/pdf"
    elif ext in (".jpg", ".jpeg", ".png"):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw)) as image:
                    expected = "PNG" if ext == ".png" else "JPEG"
                    if image.format != expected:
                        raise ValueError("Formato no coincide")
                    image.verify()
            mime = "image/png" if ext == ".png" else "image/jpeg"
        except Exception as error:
            raise ValidationError("La imagen no es un JPG o PNG válido.") from error
    else:
        raise ValidationError("Solo se admiten PDF, JPG y PNG válidos; no archivos ejecutables ni enlaces.")
    digest = hashlib.sha256(raw).hexdigest()
    attachment = None
    try:
        with transaction.atomic():
            reference = Movement.objects.get(pk=movement_id)
            require_company(actor, reference.company, "record")
            company = _lock_company(reference.company)
            require_company(actor, company, "record")
            movement = Movement.objects.select_for_update().get(pk=movement_id)
            if movement.status != Movement.Status.DRAFT:
                raise ValidationError("Añade los comprobantes mientras el movimiento esté por revisar.")
            _open_period(company, movement.occurred_on)
            existing = Attachment.objects.filter(movement=movement, sha256=digest).first()
            if existing:
                return existing
            if movement.attachments.count() >= 10:
                raise ValidationError("Cada movimiento admite como máximo 10 comprobantes.")
            attachment = Attachment(movement=movement, name=name, content_type=mime, size=len(raw), sha256=digest, uploaded_by=actor)
            attachment.file.save(name, ContentFile(raw), save=False)
            attachment.save()
            _audit(movement, actor, "document_added", f"Comprobante adjunto: {name}. Original conservado; SHA-256 {digest}.")
            return attachment
    except Exception:
        if attachment and attachment.file and attachment.file.name:
            attachment.file.storage.delete(attachment.file.name)
        raise
