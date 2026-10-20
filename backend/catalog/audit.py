import json
from contextlib import contextmanager
from contextvars import ContextVar

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .models import AuditLog, BusinessSettings, Contact, MediaAsset, Product, ProductAdditional, ProductImage, ProductVariant

_actor = ContextVar("catalog_audit_actor", default=None)
_operation = ContextVar("catalog_audit_operation", default=None)
TRACKED_MODELS = (Contact, MediaAsset, Product, ProductVariant, ProductAdditional, ProductImage, BusinessSettings)


@contextmanager
def audit_context(actor=None, operation=None):
    actor_token = _actor.set(actor)
    operation_token = _operation.set(operation)
    try:
        yield
    finally:
        _actor.reset(actor_token)
        _operation.reset(operation_token)


def snapshot(instance):
    values = {}
    for field in instance._meta.concrete_fields:
        value = field.value_from_object(instance)
        values[field.name] = value.name if hasattr(value, "name") else value
    return json.loads(json.dumps(values, cls=DjangoJSONEncoder))


@receiver(pre_save)
def capture_before(sender, instance, raw=False, **kwargs):
    if raw or sender not in TRACKED_MODELS:
        return
    previous = sender.objects.filter(pk=instance.pk).first() if instance.pk else None
    instance._audit_before = snapshot(previous) if previous else {}


@receiver(post_save)
def record_save(sender, instance, created, raw=False, **kwargs):
    if raw or sender not in TRACKED_MODELS:
        return
    before, after = getattr(instance, "_audit_before", {}), snapshot(instance)
    if before == after:
        return
    actor = _actor.get()
    AuditLog.objects.create(actor=actor if actor and actor.is_authenticated else None, entity=sender._meta.label_lower, object_id=str(instance.pk), label=str(instance)[:300], operation=_operation.get() or ("create" if created else "update"), before=before, after=after)


@receiver(post_delete)
def record_delete(sender, instance, **kwargs):
    if sender not in TRACKED_MODELS:
        return
    actor = _actor.get()
    AuditLog.objects.create(actor=actor if actor and actor.is_authenticated else None, entity=sender._meta.label_lower, object_id=str(instance.pk), label=str(instance)[:300], operation="delete", before=snapshot(instance), after={})
