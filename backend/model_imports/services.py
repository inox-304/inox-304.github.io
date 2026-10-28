"""Durable jobs and explicit review approval; never convert in a web request."""
from datetime import timedelta
import hashlib
import json
from pathlib import PurePath
import uuid

from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone

from catalog.audit import audit_context, snapshot
from catalog.models import AuditLog, Product, ProductVariant
from .models import ModelImportJob as Job, WorkerLease

OPEN = (Job.Status.QUEUED, Job.Status.RUNNING, Job.Status.READY)


def can_access(user, job, change=False):
    if not user.is_authenticated or not user.is_active or not user.is_staff:
        return False
    def allowed(model):
        return user.has_perm(f"catalog.change_{model}") or (not change and user.has_perm(f"catalog.view_{model}"))
    return allowed("product") and (not job.variant_id or allowed("productvariant"))


def _permission(user, job):
    if not can_access(user, job, change=True):
        raise PermissionDenied


def _lease():
    WorkerLease.objects.get_or_create(pk=1)
    return WorkerLease.objects.select_for_update().get(pk=1)


def _audit(job, user, operation):
    AuditLog.objects.create(actor=user, entity="model_imports.modelimportjob", object_id=str(job.pk),
                            label=f"{job.product.code} · SketchUp", operation=operation,
                            before={}, after={"status": job.status, "product": job.product_id, "variant": job.variant_id})


def _queue_space(target_key, excluding=None):
    jobs = Job.objects.filter(status__in=OPEN)
    if excluding:
        jobs = jobs.exclude(pk=excluding)
    if jobs.filter(target_key=target_key).exists():
        raise ValidationError("Ese destino ya tiene un modelo pendiente. Revísalo o cancélalo antes de subir otro.")
    if jobs.count() >= settings.MODEL_IMPORT_MAX_PENDING:
        raise ValidationError("La cola está llena. Aplica o cancela modelos pendientes antes de añadir otro.")


def create_job(*, user, product, variant, upload):
    job = Job(product=product, variant=variant, created_by=user,
              target_key=f"variant:{variant.pk}" if variant else f"product:{product.pk}")
    _permission(user, job)
    if variant is not None and variant.product_id != product.pk:
        raise ValidationError("La variación no pertenece al equipo elegido.")
    name = PurePath(str(upload.name).replace("\\", "/")).name
    if not name.lower().endswith(".skp") or len(name) > 180 or any(ord(c) < 32 for c in name):
        raise ValidationError("Selecciona un archivo .skp con un nombre de hasta 180 caracteres.")
    if upload.size > settings.MODEL_IMPORT_MAX_SOURCE_BYTES or upload.size < 4:
        raise ValidationError("El archivo SketchUp debe pesar como máximo 20 MB.")
    upload.seek(0)
    if upload.read(4) != b"\xff\xfe\xff\x0e":
        raise ValidationError("El contenido no corresponde a un archivo SketchUp.")
    upload.seek(0)
    digest, size = hashlib.sha256(), 0
    for chunk in upload.chunks():
        size += len(chunk)
        if size > settings.MODEL_IMPORT_MAX_SOURCE_BYTES:
            raise ValidationError("El archivo SketchUp supera 20 MB.")
        digest.update(chunk)
    upload.seek(0)
    job.original_name, job.source_size, job.source_sha256 = name, size, digest.hexdigest()
    job.progress = "Esperando turno de conversión"
    saved_name = None
    try:
        with transaction.atomic():
            _lease()
            # Lock the target so it cannot disappear while its source is stored.
            Product.objects.select_for_update().get(pk=product.pk)
            if variant:
                ProductVariant.objects.select_for_update().get(pk=variant.pk, product=product)
            _queue_space(job.target_key)
            # This UUID belongs only to this new job, including partial writes.
            saved_name = f"model-imports/{job.pk}/source.skp"
            job.source.save("source.skp", upload, save=False)
            saved_name = job.source.name
            job.save()
            _audit(job, user, "import")
    except Exception:
        if saved_name:
            job.source.storage.delete(saved_name)
        raise
    return job


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, cls=DjangoJSONEncoder).encode()).hexdigest()


def target_revision(job):
    product = Product.objects.get(pk=job.product_id)
    variant = ProductVariant.objects.get(pk=job.variant_id) if job.variant_id else None
    return _digest({"product": snapshot(product), "variant": snapshot(variant) if variant else None})


def review_token(job):
    return _digest([str(job.pk), job.source_sha256, str(job.result_asset_id), job.stats])


def interaction_block(job):
    product = job.product
    return bool(product.cooktop_config.get("enabled") or product.cart_config.get("enabled") or
                product.door_animation or (job.variant_id and (job.variant.material_variant or job.variant.door_animation)))


@transaction.atomic
def apply_job(*, user, job_id, revision, token):
    job = Job.objects.select_for_update().get(pk=job_id)
    job.product = Product.objects.select_for_update().get(pk=job.product_id)
    if job.variant_id:
        job.variant = ProductVariant.objects.select_for_update().get(pk=job.variant_id, product_id=job.product_id)
    _permission(user, job)
    if job.status != Job.Status.READY or not job.result_asset_id:
        raise ValidationError("Este modelo no está listo para aplicarse.")
    if revision != target_revision(job) or token != review_token(job):
        raise ValidationError("El equipo o el modelo cambió. Abre la vista previa de nuevo antes de confirmar.")
    if interaction_block(job):
        raise ValidationError("Este equipo tiene interacciones preparadas para su modelo actual. Revisa la compatibilidad de puertas, acabados o módulos antes de reemplazarlo. El modelo actual se conserva.")
    target = job.variant if job.variant_id else job.product
    target.model_asset_id = job.result_asset_id
    if not job.variant_id:
        target.model_3d = ""
    with audit_context(user):
        target.save()
    job.status, job.progress, job.finished_at = Job.Status.APPLIED, "Modelo revisado e incorporado", timezone.now()
    job.save(update_fields=("status", "progress", "finished_at", "updated_at"))
    _audit(job, user, "apply")
    return job


@transaction.atomic
def cancel_job(user, job_id):
    job = Job.objects.select_for_update().get(pk=job_id)
    _permission(user, job)
    if job.status not in OPEN:
        raise ValidationError("Esta conversión ya terminó o fue cancelada.")
    job.status, job.progress, job.finished_at = Job.Status.CANCELLED, "Cancelado por administración", timezone.now()
    job.save(update_fields=("status", "progress", "finished_at", "updated_at"))
    _audit(job, user, "cancel")
    return job


@transaction.atomic
def retry_job(user, job_id):
    _lease()
    job = Job.objects.select_for_update().get(pk=job_id)
    _permission(user, job)
    if job.status != Job.Status.FAILED:
        raise ValidationError("Solo se pueden reintentar conversiones fallidas.")
    _queue_space(job.target_key, excluding=job.pk)
    job.status, job.progress = Job.Status.QUEUED, "Esperando un nuevo intento"
    job.error_code = job.error_message = ""
    job.attempts = 0
    job.started_at = job.finished_at = job.lease_token = None
    job.save()
    _audit(job, user, "retry")
    return job


@transaction.atomic
def claim_job():
    lease, now = _lease(), timezone.now()
    if lease.token and lease.expires_at and lease.expires_at > now:
        return None
    # The global lease expired: its process must not be allowed to commit later.
    for old in Job.objects.select_for_update().filter(status=Job.Status.RUNNING):
        old.lease_token = None
        old.started_at = None
        if old.attempts >= settings.MODEL_IMPORT_MAX_ATTEMPTS:
            old.status, old.error_code = Job.Status.FAILED, "interrupted"
            old.error_message = "El servicio interrumpió la conversión. Puedes reintentar o subir un modelo más ligero."
            old.finished_at = now
        else:
            old.status, old.progress = Job.Status.QUEUED, "Retomando conversión interrumpida"
        old.save()
    job = Job.objects.select_for_update().filter(status=Job.Status.QUEUED).order_by("created_at").first()
    if job is None:
        lease.token = lease.expires_at = None
        lease.save()
        return None
    lease.token, lease.expires_at = uuid.uuid4(), now + timedelta(seconds=settings.MODEL_IMPORT_LEASE_SECONDS)
    lease.save()
    job.lease_token, job.status = lease.token, Job.Status.RUNNING
    job.started_at, job.finished_at, job.attempts = now, None, job.attempts + 1
    job.progress, job.error_code, job.error_message = "Convirtiendo geometría y materiales", "", ""
    job.save()
    return job


@transaction.atomic
def heartbeat(job):
    lease = _lease()
    if lease.token != job.lease_token or not Job.objects.filter(pk=job.pk, status=Job.Status.RUNNING, lease_token=job.lease_token).exists():
        return False
    lease.expires_at = timezone.now() + timedelta(seconds=settings.MODEL_IMPORT_LEASE_SECONDS)
    lease.save(update_fields=("expires_at",))
    return True


@transaction.atomic
def finish_job(job, *, asset=None, stats=None, error_code="", error_message=""):
    lease = _lease()
    current = Job.objects.select_for_update().get(pk=job.pk)
    accepted = current.status == Job.Status.RUNNING and current.lease_token == job.lease_token and lease.token == job.lease_token
    if accepted:
        current.status = Job.Status.READY if asset else Job.Status.FAILED
        current.result_asset, current.stats = asset, stats or {}
        current.error_code, current.error_message = error_code, error_message
        current.progress = "Listo para revisar" if asset else "Revisa el mensaje de esta conversión"
        current.finished_at, current.lease_token = timezone.now(), None
        current.save()
    if lease.token == job.lease_token:
        lease.token = lease.expires_at = None
        lease.save()
    return accepted
