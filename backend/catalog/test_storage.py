import hashlib
from pathlib import Path
import tempfile

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import Storage, default_storage
from django.test import TestCase, override_settings

from catalog.backups import create_backup, restore_backup
from catalog.models import MediaAsset, Product
from catalog.storage import save_new_file, storage_names


class ObjectTestStorage(Storage):
    """Network-free object backend: filesystem paths and bucket URLs forbidden."""
    def __init__(self):
        self.objects = {}
        self.fail_after_write = False

    def _open(self, name, mode="rb"):
        if name not in self.objects:
            raise FileNotFoundError(name)
        return ContentFile(self.objects[name], name=name)

    def _save(self, name, content):
        self.objects[name] = b"".join(content.chunks())
        if self.fail_after_write:
            self.fail_after_write = False
            raise OSError("synthetic interrupted upload")
        return name

    def exists(self, name):
        return name in self.objects

    def delete(self, name):
        self.objects.pop(name, None)

    def size(self, name):
        return len(self.objects[name])

    def listdir(self, path):
        prefix = path.rstrip("/") + "/" if path else ""
        directories, files = set(), set()
        for name in self.objects:
            if name.startswith(prefix):
                tail = name[len(prefix):]
                if "/" in tail:
                    directories.add(tail.split("/", 1)[0])
                elif tail:
                    files.add(tail)
        return sorted(directories), sorted(files)

    def path(self, name):
        raise AssertionError("Remote storage must not need a filesystem path")

    def url(self, name):
        raise AssertionError("Private bucket URLs must not reach callers")


OBJECT_STORAGES = {
    "default": {"BACKEND": "catalog.test_storage.ObjectTestStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@override_settings(STORAGES=OBJECT_STORAGES, SECRET_KEY="synthetic-storage-backup-signing-key-1234567890")
class ObjectMediaTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        default_storage.objects.clear()
        self.name = "catalog/11111111-1111-4111-8111-111111111111.pdf"
        self.payload = b"%PDF-1.4 synthetic storage fixture"
        default_storage.save(self.name, ContentFile(self.payload))
        self.asset = MediaAsset.objects.create(name="Synthetic PDF", kind="pdf", file=self.name, content_type="application/pdf")
        self.product = Product.objects.create(code="STORAGE-01", slug="storage-test", name="Synthetic product", category="mobiliario", technical_asset=self.asset, is_published=False)

    def test_public_route_keeps_drafts_private_and_streams_published_files(self):
        self.assertEqual(self.client.get(self.asset.public_url).status_code, 404)
        self.product.is_published = True
        self.product.save()
        response = self.client.get(self.asset.public_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), self.payload)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertIn("sandbox", response["Content-Security-Policy"])
        self.product.is_active = False
        self.product.save()
        self.assertEqual(self.client.get(self.asset.public_url).status_code, 404)

    def test_missing_published_object_returns_404_without_bucket_url(self):
        self.product.is_published = True
        self.product.save()
        default_storage.delete(self.name)
        self.assertEqual(self.client.get(self.asset.public_url).status_code, 404)

    def test_signed_backup_restores_missing_remote_object_and_private_records(self):
        target = Path(self.temp.name) / "catalog.zip"
        create_backup(target)
        default_storage.delete(self.name)
        self.product.name = "Changed"
        self.product.save()
        restore_backup(target)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Synthetic product")
        self.assertFalse(self.product.is_published)
        self.assertEqual(default_storage.objects[self.name], self.payload)

    def test_remote_conflict_aborts_before_records_or_existing_objects_change(self):
        target = Path(self.temp.name) / "catalog.zip"
        create_backup(target)
        default_storage.objects[self.name] = b"Existing different data"
        self.product.name = "Current product"
        self.product.save()
        with self.assertRaisesMessage(ValidationError, "contenido distinto"):
            restore_backup(target)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Current product")
        self.assertEqual(default_storage.objects[self.name], b"Existing different data")

    def test_interrupted_object_write_rolls_back_records_and_uploaded_object(self):
        target = Path(self.temp.name) / "catalog.zip"
        create_backup(target)
        default_storage.delete(self.name)
        self.product.name = "Current product"
        self.product.save()
        default_storage.fail_after_write = True
        with self.assertRaisesMessage(OSError, "interrupted upload"):
            restore_backup(target)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Current product")
        self.assertFalse(default_storage.exists(self.name))

    def test_save_checks_readback_hash_and_enumerates_unreferenced_files(self):
        name = "catalog/unreferenced.txt"
        payload = b"private orphan"
        with self.assertRaisesMessage(OSError, "suma de verificación"):
            save_new_file(default_storage, name, ContentFile(payload), {"size": len(payload), "sha256": hashlib.sha256(b"wrong").hexdigest()})
        self.assertEqual(storage_names(default_storage), [self.name, name])

    def test_s3_defaults_are_private_https_sigv4_path_style_without_urls(self):
        from catalog.storage import PrivateS3Storage
        from django.core.exceptions import ImproperlyConfigured
        storage = PrivateS3Storage(bucket_name="synthetic-private", endpoint_url="https://s3.example.com", region_name="us-east-1", access_key="synthetic", secret_key="synthetic")
        self.assertIsNone(storage.default_acl)
        self.assertTrue(storage.querystring_auth)
        self.assertFalse(storage.file_overwrite)
        self.assertEqual(storage.client_config.signature_version, "s3v4")
        self.assertEqual(storage.client_config.s3["addressing_style"], "path")
        self.assertEqual(storage.url(self.name), "/media/11111111-1111-4111-8111-111111111111/")
        with self.assertRaises(ImproperlyConfigured):
            PrivateS3Storage(bucket_name="test", endpoint_url="http://s3.example.com")
        with self.assertRaises(ImproperlyConfigured):
            PrivateS3Storage(bucket_name="test", endpoint_url="https://s3.example.com", object_parameters={"ACL": "public-read"})
