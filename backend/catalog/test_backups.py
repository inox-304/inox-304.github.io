"""Private SketchUp originals survive commercial backup and safe restoration."""
import hashlib
import hmac
import json
from pathlib import Path
import tempfile
from datetime import timedelta
import uuid
import zipfile

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from model_imports.models import ModelImportJob, WorkerLease

from .backups import canonical, create_backup, inspect_backup, restore_backup, signing_key
from .models import MediaAsset, Product, ProductVariant
from .test_storage import OBJECT_STORAGES
from .tests import glb


@override_settings(SECRET_KEY="synthetic-model-backup-signing-key-1234567890")
class ModelImportBackupTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        settings = override_settings(MEDIA_ROOT=Path(self.temp.name) / "media")
        settings.enable()
        self.addCleanup(settings.disable)
        self.owner = get_user_model().objects.create_user(username="synthetic-backup-owner")
        self.product = Product.objects.create(code="SKP-BACKUP", slug="skp-backup", name="Equipo", category="mobiliario")
        self.variant = ProductVariant.objects.create(product=self.product, name="Grande")
        self.payload = b"synthetic source fixture: backup does not execute or convert SKP"

    def job(self, **values):
        identity = uuid.uuid4()
        name = f"model-imports/{identity}/source.skp"
        default_storage.save(name, ContentFile(self.payload))
        fields = dict(id=identity, product=self.product, variant=self.variant,
                      target_key=f"variant:{self.variant.pk}", source=name,
                      original_name="Equipo 2023.skp", source_sha256=hashlib.sha256(self.payload).hexdigest(),
                      source_size=len(self.payload), created_by=self.owner)
        fields.update(values)
        return ModelImportJob.objects.create(**fields)

    def backup(self, name="backup.zip"):
        target = Path(self.temp.name) / name
        create_backup(target)
        return target

    def rewrite(self, original, name, transform):
        with zipfile.ZipFile(original) as source:
            contents = {key: source.read(key) for key in source.namelist()}
        manifest = json.loads(contents.pop("manifest.json"))
        records = json.loads(contents["catalog.json"])
        transform(records, contents, manifest)
        contents["catalog.json"] = canonical(records)
        manifest["files"] = {key: {"size": len(value), "sha256": hashlib.sha256(value).hexdigest()} for key, value in contents.items()}
        manifest.pop("signature", None)
        manifest["signature"] = hmac.new(signing_key(), canonical(manifest), hashlib.sha256).hexdigest()
        contents["manifest.json"] = canonical(manifest)
        destination = Path(self.temp.name) / name
        with zipfile.ZipFile(destination, "w") as result:
            for key, value in contents.items():
                result.writestr(key, value)
        return destination

    def test_v2_keeps_private_original_and_variant_but_not_identity_or_worker_lease(self):
        job = self.job()
        WorkerLease.objects.update_or_create(pk=1, defaults={"token": uuid.uuid4(), "expires_at": None})
        archive = self.backup()
        with zipfile.ZipFile(archive) as source:
            manifest = json.loads(source.read("manifest.json"))
            records = json.loads(source.read("catalog.json"))
            self.assertEqual(manifest["format"], "inox-catalog-v2")
            self.assertEqual(source.read(f"media/{job.source.name}"), self.payload)
        record = next(row for row in records if row["model"] == "model_imports.modelimportjob")
        self.assertIsNone(record["fields"]["created_by"])
        self.assertIsNone(record["fields"]["lease_token"])
        self.assertFalse(any(row["model"] in {"auth.user", "model_imports.workerlease"} for row in records))
        default_storage.delete(job.source.name)
        self.product.name = "Changed"
        self.product.save()
        restore_backup(archive)
        job.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(job.variant_id, self.variant.pk)
        self.assertEqual(self.product.name, "Equipo")
        with default_storage.open(job.source.name) as source:
            self.assertEqual(source.read(), self.payload)
        self.assertIsNone(job.created_by_id)
        self.assertIsNone(WorkerLease.objects.get(pk=1).token)
        self.assertTrue(get_user_model().objects.filter(pk=self.owner.pk).exists())

    def test_running_job_restores_as_queued_without_attaching_result(self):
        asset = MediaAsset.objects.create(name="Converted", kind="glb", file=ContentFile(glb({"asset": {"version": "2.0"}}), name="converted.glb"))
        job = self.job(status="running", started_at=timezone.now(), lease_token=uuid.uuid4(), result_asset=asset)
        archive = self.backup()
        restore_backup(archive)
        job.refresh_from_db()
        self.product.refresh_from_db()
        self.variant.refresh_from_db()
        self.assertEqual(job.status, "queued")
        self.assertIsNone(job.started_at)
        self.assertIsNone(job.finished_at)
        self.assertIsNone(job.lease_token)
        self.assertEqual(job.result_asset_id, asset.pk)
        self.assertIsNone(self.product.model_asset_id)
        self.assertIsNone(self.variant.model_asset_id)
        self.assertFalse(self.product.is_published)

    def test_active_worker_blocks_restore_before_any_records_change(self):
        job = self.job()
        archive = self.backup()
        WorkerLease.objects.update_or_create(pk=1, defaults={"token": uuid.uuid4(), "expires_at": timezone.now() + timedelta(minutes=5)})
        self.product.name = "Current"
        self.product.save()
        with self.assertRaisesMessage(ValidationError, "conversión en curso"):
            restore_backup(archive)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Current")
        self.assertTrue(ModelImportJob.objects.filter(pk=job.pk).exists())

    def test_legacy_backup_with_no_jobs_is_supported_but_cannot_erase_new_originals(self):
        archive = self.backup()
        legacy = self.rewrite(archive, "legacy.zip", lambda rows, files, manifest: manifest.update(format="inox-catalog-v1"))
        restore_backup(legacy)
        self.product.refresh_from_db()
        self.variant.refresh_from_db()
        job = self.job()
        with self.assertRaisesMessage(ValidationError, "copia antigua"):
            restore_backup(legacy)
        self.assertTrue(ModelImportJob.objects.filter(pk=job.pk).exists())
        self.assertTrue(default_storage.exists(job.source.name))

    def test_missing_or_changed_original_prevents_partial_backup(self):
        job = self.job()
        default_storage.delete(job.source.name)
        with self.assertRaisesMessage(ValidationError, "Falta el archivo"):
            self.backup("missing.zip")
        self.assertFalse((Path(self.temp.name) / "missing.zip").exists())
        default_storage.save(job.source.name, ContentFile(b"changed"))
        with self.assertRaisesMessage(ValidationError, "no coincide"):
            self.backup("changed.zip")
        self.assertFalse((Path(self.temp.name) / "changed.zip").exists())

    def test_signed_archive_cannot_rebind_source_to_another_job_or_change_digest(self):
        self.job()
        archive = self.backup()
        for field, value in (("source", f"model-imports/{uuid.uuid4()}/source.skp"), ("source_sha256", "0" * 64)):
            def change(rows, files, manifest):
                next(row for row in rows if row["model"] == "model_imports.modelimportjob")["fields"][field] = value
            invalid = self.rewrite(archive, f"invalid-{field}.zip", change)
            with self.assertRaises(ValidationError):
                inspect_backup(invalid)

    @override_settings(STORAGES=OBJECT_STORAGES)
    def test_remote_original_collision_keeps_existing_records_and_bytes(self):
        default_storage.objects.clear()
        job = self.job()
        archive = self.backup()
        default_storage.objects[job.source.name] = b"different remote content"
        self.product.name = "Current"
        self.product.save()
        with self.assertRaisesMessage(ValidationError, "contenido distinto"):
            restore_backup(archive)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Current")
        self.assertEqual(default_storage.objects[job.source.name], b"different remote content")

    @override_settings(STORAGES=OBJECT_STORAGES)
    def test_interrupted_remote_restore_rolls_back_job_and_storage(self):
        default_storage.objects.clear()
        job = self.job()
        archive = self.backup()
        default_storage.delete(job.source.name)
        self.product.name = "Current"
        self.product.save()
        default_storage.fail_after_write = True
        with self.assertRaises(OSError):
            restore_backup(archive)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Current")
        self.assertTrue(ModelImportJob.objects.filter(pk=job.pk).exists())
        self.assertFalse(default_storage.exists(job.source.name))

    def test_installation_payload_excludes_lease_and_requires_original(self):
        from security.installation_transfer import state_payload, validate_model_originals, TransferError
        job = self.job(status="running", lease_token=uuid.uuid4())
        WorkerLease.objects.update_or_create(pk=1, defaults={"token": uuid.uuid4(), "expires_at": timezone.now()})
        payloads, counts = state_payload()
        records = json.loads(payloads["database.json"])
        self.assertEqual(counts["model_imports.workerlease"], 0)
        self.assertFalse(any(row["model"] == "model_imports.workerlease" for row in records))
        record = next(row for row in records if row["model"] == "model_imports.modelimportjob")
        self.assertIsNone(record["fields"]["lease_token"])
        self.assertEqual(record["fields"]["status"], "running")
        with self.assertRaisesMessage(TransferError, "original SketchUp"):
            validate_model_originals(records, {})
        validate_model_originals(records, {f"media/{job.source.name}": {"size": job.source_size, "sha256": job.source_sha256}})


@override_settings(SECRET_KEY="synthetic-transfer-key-keep-stable-1234567890",
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ModelImportInstallationTests(TransactionTestCase):
    from security.test_installation_transfer import InstallationTransferTests as _fixture
    setUp = _fixture.setUp
    export = _fixture.export
    empty = _fixture.empty
    restore = _fixture.restore

    def test_full_installation_restores_original_and_requeues_interrupted_job(self):
        identity = uuid.uuid4()
        payload = b"synthetic source for installation backup"
        source_name = f"model-imports/{identity}/source.skp"
        default_storage.save(source_name, ContentFile(payload))
        product = Product.objects.get(code="TEST-01")
        ModelImportJob.objects.create(
            id=identity, product=product, target_key=f"product:{product.pk}", source=source_name,
            original_name="Equipo.skp", source_sha256=hashlib.sha256(payload).hexdigest(), source_size=len(payload),
            created_by=self.user, status="running", started_at=timezone.now(), lease_token=uuid.uuid4(),
        )
        WorkerLease.objects.update_or_create(pk=1, defaults={"token": uuid.uuid4(), "expires_at": timezone.now()})
        self.export()
        self.empty()
        # New installations may already have the empty singleton from migration.
        WorkerLease.objects.get_or_create(pk=1)
        self.restore(check=True)
        self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        restored = ModelImportJob.objects.get(pk=identity)
        self.assertEqual(restored.status, "queued")
        self.assertIsNone(restored.lease_token)
        self.assertIsNone(restored.started_at)
        self.assertEqual(restored.created_by_id, self.user.pk)
        with default_storage.open(restored.source.name) as source:
            self.assertEqual(source.read(), payload)
        self.assertIsNone(WorkerLease.objects.get(pk=1).token)
        self.assertIsNone(Product.objects.get(pk=product.pk).model_asset_id)

    def test_full_installation_refuses_missing_original_even_when_no_asset_uses_it(self):
        from security.installation_transfer import source_files, TransferError
        identity = uuid.uuid4()
        product = Product.objects.get(code="TEST-01")
        ModelImportJob.objects.create(
            id=identity, product=product, target_key=f"product:{product.pk}", source=f"model-imports/{identity}/source.skp",
            original_name="Missing.skp", source_sha256="0" * 64, source_size=1, created_by=self.user,
        )
        with self.assertRaisesMessage(TransferError, "original SketchUp"):
            source_files()
