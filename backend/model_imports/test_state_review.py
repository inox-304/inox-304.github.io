"""Independent state-machine and authorization regression checks; synthetic files only."""
from datetime import timedelta
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from catalog.models import MediaAsset, Product, ProductVariant
from catalog.tests import glb
from catalog.storage import storage_names
from catalog.test_storage import OBJECT_STORAGES

from .models import ModelImportJob as Job, WorkerLease
from .services import apply_job, cancel_job, claim_job, create_job, finish_job, heartbeat, retry_job, review_token, target_revision
from .runner import process_job


class ImportStateReviewTests(TransactionTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = override_settings(MEDIA_ROOT=Path(self.temp.name) / "media", MODEL_IMPORT_MAX_PENDING=3, MODEL_IMPORT_MAX_ATTEMPTS=2)
        override.enable()
        self.addCleanup(override.disable)
        self.owner = get_user_model().objects.create_superuser("synthetic-import-owner", password="synthetic-not-used")
        self.product = Product.objects.create(code="IMPORT-STATE", slug="import-state", name="Equipo", category="mobiliario")
        self.variant = ProductVariant.objects.create(product=self.product, name="Grande")
        self.asset = MediaAsset.objects.create(name="Candidate", kind="glb", file=ContentFile(glb({"asset": {"version": "2.0"}}), name="candidate.glb"))

    def create(self, **kwargs):
        values = {"user": self.owner, "product": self.product, "variant": None,
                  "upload": SimpleUploadedFile("Equipo.skp", b"\xff\xfe\xff\x0esynthetic backup-safe input")}
        values.update(kwargs)
        return create_job(**values)

    def ready(self, **kwargs):
        queued = self.create(**kwargs)
        claimed = claim_job()
        self.assertEqual(queued.pk, claimed.pk)
        self.assertTrue(finish_job(claimed, asset=self.asset, stats={"triangles": 0}))
        queued.refresh_from_db()
        return queued

    def test_read_only_staff_cannot_upload_or_change_queue(self):
        viewer = get_user_model().objects.create_user("synthetic-viewer", is_staff=True)
        viewer.user_permissions.add(Permission.objects.get(codename="view_product", content_type__app_label="catalog"))
        with self.assertRaises(PermissionDenied):
            self.create(user=viewer)
        job = self.create()
        with self.assertRaises(PermissionDenied):
            cancel_job(viewer, job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "queued")

    def test_variant_permission_and_parent_membership_are_required(self):
        editor = get_user_model().objects.create_user("synthetic-product-editor", is_staff=True)
        editor.user_permissions.add(Permission.objects.get(codename="change_product", content_type__app_label="catalog"))
        with self.assertRaises(PermissionDenied):
            self.create(user=editor, variant=self.variant)
        other = Product.objects.create(code="OTHER-IMPORT", slug="other-import", name="Otro", category="mobiliario")
        with self.assertRaisesMessage(ValidationError, "no pertenece"):
            self.create(product=other, variant=self.variant)
        self.assertFalse(Job.objects.exists())

    def test_cancelled_running_job_cannot_commit_late_result(self):
        self.create()
        claimed = claim_job()
        cancel_job(self.owner, claimed.pk)
        self.assertFalse(heartbeat(claimed))
        self.assertFalse(finish_job(claimed, asset=self.asset))
        self.product.refresh_from_db()
        self.assertIsNone(self.product.model_asset_id)
        self.assertEqual(Job.objects.get(pk=claimed.pk).status, "cancelled")

    def test_expired_claim_is_fenced_from_new_attempt_and_only_new_attempt_can_finish(self):
        self.create()
        first = claim_job()
        WorkerLease.objects.filter(pk=1).update(expires_at=timezone.now() - timedelta(seconds=1))
        second = claim_job()
        self.assertEqual(second.pk, first.pk)
        self.assertNotEqual(second.lease_token, first.lease_token)
        self.assertFalse(heartbeat(first))
        self.assertFalse(finish_job(first, asset=self.asset))
        self.assertTrue(heartbeat(second))
        self.assertTrue(finish_job(second, asset=self.asset))
        self.assertEqual(Job.objects.get(pk=second.pk).status, "ready")

    def test_open_destination_cannot_be_duplicated_and_failed_job_retries_explicitly(self):
        self.create()
        with self.assertRaisesMessage(ValidationError, "pendiente"):
            self.create()
        claimed = claim_job()
        finish_job(claimed, error_code="invalid_source", error_message="Synthetic failure")
        retried = retry_job(self.owner, claimed.pk)
        self.assertEqual(retried.status, "queued")
        self.assertEqual(retried.attempts, 0)
        self.assertIsNone(retried.lease_token)
        self.assertEqual(retried.error_message, "")
        self.assertIsNone(self.product.model_asset_id)

    def test_stale_review_cannot_replace_model_after_product_changes(self):
        job = self.ready()
        revision, token = target_revision(job), review_token(job)
        self.product.description = "New engineering information"
        self.product.save()
        with self.assertRaisesMessage(ValidationError, "cambió"):
            apply_job(user=self.owner, job_id=job.pk, revision=revision, token=token)
        self.product.refresh_from_db()
        job.refresh_from_db()
        self.assertIsNone(self.product.model_asset_id)
        self.assertEqual(job.status, "ready")

    def test_variant_apply_preserves_product_and_publication_and_cannot_repeat(self):
        job = self.ready(variant=self.variant)
        self.assertEqual(self.client.get(self.asset.public_url).status_code, 404)
        apply_job(user=self.owner, job_id=job.pk, revision=target_revision(job), token=review_token(job))
        self.product.refresh_from_db()
        self.variant.refresh_from_db()
        self.assertIsNone(self.product.model_asset_id)
        self.assertFalse(self.product.is_published)
        self.assertEqual(self.variant.model_asset_id, self.asset.pk)
        self.assertEqual(self.client.get(self.asset.public_url).status_code, 404)
        job.refresh_from_db()
        with self.assertRaisesMessage(ValidationError, "no está listo"):
            apply_job(user=self.owner, job_id=job.pk, revision=target_revision(job), token=review_token(job))

    def test_existing_variant_door_animation_blocks_incompatible_replacement(self):
        # Updating directly keeps this test independent from animation-picker UI.
        ProductVariant.objects.filter(pk=self.variant.pk).update(door_animation="Abrir puerta")
        self.variant.refresh_from_db()
        job = self.ready(variant=self.variant)
        with self.assertRaisesMessage(ValidationError, "interacciones"):
            apply_job(user=self.owner, job_id=job.pk, revision=target_revision(job), token=review_token(job))
        self.variant.refresh_from_db()
        self.assertIsNone(self.variant.model_asset_id)

    def test_runner_prepares_private_result_without_changing_product(self):
        from django.core.files.storage import default_storage
        self.create()
        job = claim_job()
        def convert(source, output, *, alive):
            self.assertTrue(alive())
            self.assertTrue(source.read_bytes().startswith(b"\xff\xfe\xff\x0e"))
            output.write_bytes(glb({"asset": {"version": "2.0"}}))
            return {"triangles": 0, "warnings": ["Synthetic preview"]}
        with patch("model_imports.runner.convert_process", side_effect=convert):
            process_job(job)
        job.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(job.status, "ready")
        self.assertTrue(default_storage.exists(job.source.name))
        self.assertTrue(default_storage.exists(job.result_asset.file.name))
        self.assertEqual(self.client.get(job.result_asset.public_url).status_code, 404)
        self.assertIsNone(self.product.model_asset_id)
        self.assertFalse(self.product.is_published)

    def test_runner_rejects_source_hash_change_before_invoking_converter(self):
        from django.core.files.storage import default_storage
        self.create()
        job = claim_job()
        default_storage.delete(job.source.name)
        default_storage.save(job.source.name, ContentFile(b"changed content"))
        with patch("model_imports.runner.convert_process") as convert:
            process_job(job)
        convert.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertEqual(job.error_code, "source_changed")
        self.assertIsNone(job.result_asset_id)

    def test_runner_rejects_invalid_glb_without_crashing_or_leaking_asset(self):
        from django.core.files.storage import default_storage
        self.create()
        job = claim_job()
        before = storage_names(default_storage)
        count = MediaAsset.objects.count()
        def convert(source, output, *, alive):
            output.write_bytes(b"not a GLB")
            return {}
        with patch("model_imports.runner.convert_process", side_effect=convert):
            process_job(job)
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertIsNone(job.result_asset_id)
        self.assertEqual(MediaAsset.objects.count(), count)
        self.assertEqual(storage_names(default_storage), before)

    def test_runner_losing_fence_after_asset_save_removes_unowned_result(self):
        from django.core.files.storage import default_storage
        self.create()
        job = claim_job()
        before = storage_names(default_storage)
        count = MediaAsset.objects.count()
        def convert(source, output, *, alive):
            output.write_bytes(glb({"asset": {"version": "2.0"}}))
            return {}
        def finish_after_cancel(current, **values):
            cancel_job(self.owner, current.pk)
            return finish_job(current, **values)
        with patch("model_imports.runner.convert_process", side_effect=convert), patch("model_imports.runner.finish_job", side_effect=finish_after_cancel):
            process_job(job)
        job.refresh_from_db()
        self.assertEqual(job.status, "cancelled")
        self.assertIsNone(job.result_asset_id)
        self.assertEqual(MediaAsset.objects.count(), count)
        self.assertEqual(storage_names(default_storage), before)

    @override_settings(STORAGES=OBJECT_STORAGES)
    def test_runner_partial_remote_asset_write_does_not_leak_unowned_object(self):
        from django.core.files.storage import default_storage
        default_storage.objects.clear()
        self.create()
        job = claim_job()
        before = storage_names(default_storage)
        count = MediaAsset.objects.count()
        def convert(source, output, *, alive):
            output.write_bytes(glb({"asset": {"version": "2.0"}}))
            default_storage.fail_after_write = True
            return {}
        with patch("model_imports.runner.convert_process", side_effect=convert):
            process_job(job)
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertIsNone(job.result_asset_id)
        self.assertEqual(MediaAsset.objects.count(), count)
        self.assertEqual(storage_names(default_storage), before)
