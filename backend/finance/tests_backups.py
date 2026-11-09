import hashlib
import json
import tempfile
import zipfile
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase, override_settings

from .backups import build_backup
from .models import Account, Company
from .services import attach_document, create_draft


@override_settings(SECURITY_OWNER_USERNAME="finance-backup@example.test")
class FinanceBackupTests(TransactionTestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user("finance-backup@example.test", password="not-real", is_staff=True)
        self.other = get_user_model().objects.create_user("other-backup@example.test", is_staff=True, is_superuser=True)
        self.company = Company.objects.create(code="QA", name="Synthetic company")
        self.account = Account.objects.create(company=self.company, code="CASH", name="Test cash", method="cash")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        settings = override_settings(MEDIA_ROOT=self.temp.name)
        settings.enable()
        self.addCleanup(settings.disable)

    def movement(self):
        return create_draft({"company": self.company, "account": self.account, "kind": "income",
                             "occurred_on": date(2018, 1, 1), "description": "Historical synthetic price",
                             "amount": Decimal("200.00"), "currency": "PEN"}, self.owner,
                            lines=[{"item_name": "Synthetic item", "unit": "unidad", "quantity": Decimal("1"),
                                    "unit_price": Decimal("200"), "unit_cost": None}])

    def test_export_preserves_decimal_snapshots_and_originals_without_authentication_records(self):
        movement = self.movement()
        # Minimal valid PNG fixture, no external document or private data.
        from PIL import Image
        import io
        image = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(image, format="PNG")
        payload = image.getvalue()
        attachment = attach_document(movement.pk, SimpleUploadedFile("test.png", payload, content_type="image/png"), self.owner)
        with build_backup(self.owner) as result, zipfile.ZipFile(result) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["record_counts"]["finance.Movement"], 1)
            self.assertNotIn("data/auth.user.json", archive.namelist())
            lines = json.loads(archive.read("data/finance.movementline.json"))
            self.assertEqual(lines[0]["fields"]["unit_price"], "200.00")
            self.assertIsNone(lines[0]["fields"]["unit_cost"])
            for name, details in manifest["files"].items():
                content = archive.read(name)
                self.assertEqual(hashlib.sha256(content).hexdigest(), details["sha256"])
                self.assertEqual(len(content), details["size"])
            documents = [name for name in archive.namelist() if name.startswith("documents/")]
            self.assertEqual(len(documents), 1)
            self.assertEqual(archive.read(documents[0]), payload)

    def test_unassigned_superuser_is_not_the_finance_owner(self):
        with self.assertRaises(PermissionDenied):
            build_backup(self.other)

    def test_limits_fail_without_returning_partial_backup(self):
        self.movement()
        with patch("finance.backups.MAX_RECORDS", 1), self.assertRaises(ValidationError):
            build_backup(self.owner)
        with patch("finance.backups.MAX_BYTES", 20), self.assertRaises(ValidationError):
            build_backup(self.owner)
