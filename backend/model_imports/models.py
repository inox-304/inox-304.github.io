import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


def source_path(instance, filename):
    return f"model-imports/{instance.pk}/source.skp"


class ModelImportJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "En cola"
        RUNNING = "running", "Convirtiendo"
        READY = "ready", "Listo para revisar"
        FAILED = "failed", "Requiere atención"
        APPLIED = "applied", "Modelo incorporado"
        CANCELLED = "cancelled", "Cancelado"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="model_imports")
    variant = models.ForeignKey("catalog.ProductVariant", null=True, blank=True, on_delete=models.PROTECT, related_name="model_imports")
    target_key = models.CharField(max_length=100, editable=False)
    source = models.FileField(upload_to=source_path, max_length=200)
    original_name = models.CharField(max_length=180)
    source_sha256 = models.CharField(max_length=64)
    source_size = models.PositiveIntegerField()
    status = models.CharField(max_length=12, choices=Status, default=Status.QUEUED, db_index=True)
    progress = models.CharField(max_length=120, blank=True)
    error_code = models.CharField(max_length=40, blank=True)
    error_message = models.CharField(max_length=500, blank=True)
    stats = models.JSONField(default=dict, blank=True)
    result_asset = models.ForeignKey("catalog.MediaAsset", null=True, blank=True, on_delete=models.PROTECT, related_name="model_import_results")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    lease_token = models.UUIDField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ("-created_at",)
        constraints = [models.UniqueConstraint(fields=("target_key",), condition=Q(status__in=("queued", "running", "ready")), name="one_open_skp_per_target")]
        indexes = [models.Index(fields=("status", "created_at"), name="skp_queue_order")]

    def __str__(self):
        return f"{self.product.code} · {self.original_name}"


class WorkerLease(models.Model):
    """A database-wide lease prevents parallel conversions during rolling deploys."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    token = models.UUIDField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
