"""Synthetic receipt images: private review, idempotency, isolation and rollback."""
import io
import tempfile
import time
import uuid
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp import DEVICE_ID_SESSION_KEY
from PIL import Image

from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION
from .forms import ReceiptReviewForm
from .models import Account, Attachment, Audit, Company, CompanyAccess, Movement
from .services import close_period, create_receipt_draft, post_movement, void_movement
from .upload_limits import MAX_REQUEST_BYTES


@override_settings(SECURITY_OWNER_USERNAME="receipt-owner@example.test", SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ReceiptWorkspaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = {}
        for role in ("owner", "record", "view", "other"):
            user = get_user_model().objects.create_user(f"receipt-{role}@example.test", password="Synthetic-only-123!", is_staff=True, is_superuser=role in ("owner", "other"))
            user.email = user.username
            user.save(update_fields=["email"])
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.username, confirmed=True)
            users[role] = user
        cls.owner, cls.recorder, cls.viewer, cls.outsider = (users[role] for role in ("owner", "record", "view", "other"))
        cls.company = Company.objects.create(code="RECEIPT_A", name="Empresa sintética A")
        cls.other = Company.objects.create(code="RECEIPT_B", name="Empresa sintética B")
        cls.account = Account.objects.create(company=cls.company, code="CAJA", name="Caja de A", method="cash", currency="PEN")
        cls.foreign_account = Account.objects.create(company=cls.other, code="CAJA", name="Caja de B", method="cash", currency="PEN")
        CompanyAccess.objects.create(company=cls.company, user=cls.recorder, role="record")
        CompanyAccess.objects.create(company=cls.company, user=cls.viewer, role="view")

    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)
        self.url = reverse("finance:receipt_create") + f"?company={self.company.pk}"

    @staticmethod
    def photo(color="white", name="comprobante.png"):
        content = io.BytesIO()
        Image.new("RGB", (200, 300), color).save(content, "PNG")
        return SimpleUploadedFile(name, content.getvalue(), content_type="image/png")

    def signin(self, user, client=None):
        client = client or self.client
        client.force_login(user)
        session = client.session
        session[DEVICE_ID_SESSION_KEY] = EmailDevice.objects.get(user=user).persistent_id
        session[AUTH_AT] = session[LAST_SEEN] = time.time()
        session[VERSION] = SecurityState.objects.get(user=user).session_version
        session.save()
        return client

    def payload(self, **extra):
        return {"idempotency_key": str(uuid.uuid4()), "kind": "expense", "occurred_on": timezone.localdate().isoformat(),
            "account": self.account.pk, "destination_account": "", "category": "", "amount": "120.50", "currency": "PEN",
            "description": "Pago sintético revisado", "reference": "", "reviewed": "on", "document": self.photo(), **extra}

    def values(self, **extra):
        return {"company": self.company, "account": self.account, "kind": "expense", "occurred_on": timezone.localdate(),
            "amount": Decimal("120.50"), "currency": "PEN", "description": "Pago sintético revisado", **extra}

    def create(self, **extra):
        options = {"actor": self.owner, "idempotency_key": uuid.uuid4(), "reviewed": True, **extra}
        return create_receipt_draft(self.values(), self.photo(), **options)

    def test_photo_and_reviewed_fields_save_as_draft_then_require_separate_confirmation(self):
        self.signin(self.owner)
        response = self.client.post(self.url, self.payload())
        self.assertEqual(response.status_code, 302)
        movement = Movement.objects.get()
        self.assertEqual(response.url, reverse("finance:detail", args=[movement.pk]))
        self.assertEqual(movement.status, "draft")
        self.assertEqual(movement.amount, Decimal("120.50"))
        self.assertTrue(movement.source_reference.startswith("receipt:"))
        self.assertEqual(movement.attachments.count(), 1)
        self.assertTrue(movement.audit_entries.filter(action="receipt_reviewed", actor=self.owner).exists())
        document = movement.attachments.get()
        with document.file.open("rb") as original:
            self.assertEqual(original.read(), self.photo().read())
        response = self.client.post(reverse("finance:post", args=[movement.pk]), {"version": movement.version})
        self.assertEqual(response.status_code, 302)
        movement.refresh_from_db()
        self.assertEqual(movement.status, "posted")

    def test_initial_form_never_implies_currency_date_or_income(self):
        form = ReceiptReviewForm(company=self.company)
        for field in ("currency", "kind", "occurred_on"):
            self.assertFalse(form[field].value())

    def test_page_is_private_and_only_permitted_companies_are_offered(self):
        self.signin(self.recorder)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertIn("private", response["Cache-Control"])
        self.assertEqual([company.pk for company in response.context["record_companies"]], [self.company.pk])
        self.assertNotContains(response, self.other.name)

    def test_anonymous_missing_mfa_viewer_and_ungranted_superuser_cannot_upload(self):
        self.assertEqual(self.client.post(self.url, self.payload()).status_code, 302)
        self.client.force_login(self.owner)
        self.assertEqual(self.client.post(self.url, self.payload()).status_code, 302)
        for user in (self.viewer, self.outsider):
            self.signin(user)
            self.assertEqual(self.client.get(self.url).status_code, 403)
            self.assertEqual(self.client.post(self.url, self.payload()).status_code, 403)
        self.assertFalse(Movement.objects.exists())

    def test_recorder_saves_but_cannot_confirm_and_other_company_stays_hidden(self):
        self.signin(self.recorder)
        other_url = reverse("finance:receipt_create") + f"?company={self.other.pk}"
        self.assertEqual(self.client.post(other_url, self.payload()).status_code, 404)
        self.assertEqual(self.client.post(self.url, self.payload(account=self.foreign_account.pk)).status_code, 200)
        self.assertFalse(Movement.objects.exists())
        self.assertEqual(self.client.post(self.url, self.payload()).status_code, 302)
        movement = Movement.objects.get()
        self.assertEqual(self.client.post(reverse("finance:post", args=[movement.pk]), {"version": 1}).status_code, 403)

    def test_provided_company_is_never_silently_replaced(self):
        self.signin(self.recorder)
        for value in ("abc", "-1", "９", "1234567890123"):
            with self.subTest(value=value):
                response = self.client.get(reverse("finance:receipt_create"), {"company": value})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get(reverse("finance:receipt_create"), {"company": self.other.pk}).status_code, 404)
        self.assertFalse(Movement.objects.exists())

    def test_review_and_required_unknown_fields_cannot_be_skipped(self):
        self.signin(self.owner)
        for field in ("reviewed", "kind", "occurred_on", "currency", "account", "document"):
            with self.subTest(field=field):
                data = self.payload()
                del data[field]
                response = self.client.post(self.url, data)
                self.assertEqual(response.status_code, 200)
                self.assertIn(field, response.context["form"].errors)
        self.assertFalse(Movement.objects.exists())
        self.assertFalse(Attachment.objects.exists())

    def test_csrf_still_required_for_authenticated_upload(self):
        client = self.signin(self.owner, Client(enforce_csrf_checks=True))
        self.assertEqual(client.post(self.url, self.payload()).status_code, 403)
        self.assertFalse(Movement.objects.exists())

    def test_new_upload_endpoint_is_bounded_before_views(self):
        self.signin(self.owner)
        response = self.client.post(self.url, b"small", content_type="application/octet-stream", CONTENT_LENGTH=str(MAX_REQUEST_BYTES + 1))
        self.assertEqual(response.status_code, 413)
        response = self.client.post(self.url, b"small", content_type="application/octet-stream", CONTENT_LENGTH="")
        self.assertEqual(response.status_code, 411)
        with patch("finance.upload_limits.MAX_FILE_BYTES", 16):
            response = self.client.post(self.url, self.payload())
        self.assertEqual(response.status_code, 413)
        self.assertFalse(Movement.objects.exists())

    def test_same_submission_retry_returns_one_draft_and_one_original(self):
        self.signin(self.owner)
        data = self.payload()
        first = self.client.post(self.url, data)
        data["document"] = self.photo()
        second = self.client.post(self.url, data)
        self.assertEqual(first.status_code, 302)
        self.assertEqual(first.url, second.url)
        self.assertEqual(Movement.objects.count(), 1)
        self.assertEqual(Attachment.objects.count(), 1)
        self.assertEqual(Audit.objects.filter(action="receipt_reviewed").count(), 1)

    def test_retry_cannot_replace_photo_or_fields(self):
        key = uuid.uuid4()
        self.create(idempotency_key=key)
        with self.assertRaises(ValidationError):
            create_receipt_draft(self.values(), self.photo("black"), self.owner, key, reviewed=True)
        with self.assertRaises(ValidationError):
            create_receipt_draft(self.values(amount=Decimal("999")), self.photo(), self.owner, key, reviewed=True)
        self.assertEqual(Movement.objects.count(), 1)
        self.assertEqual(Attachment.objects.count(), 1)

    def test_same_photo_in_new_submission_is_flagged_within_company(self):
        movement = self.create()
        with self.assertRaises(ValidationError) as raised:
            self.create()
        self.assertIn(movement.code, str(raised.exception))
        self.assertEqual(Movement.objects.count(), 1)

    def test_same_photo_in_another_company_does_not_disclose_or_block_its_records(self):
        foreign = create_receipt_draft(self.values(company=self.other, account=self.foreign_account), self.photo(), self.owner, uuid.uuid4(), reviewed=True)
        movement = create_receipt_draft(self.values(), self.photo(), self.recorder, uuid.uuid4(), reviewed=True)
        self.assertNotEqual(foreign.pk, movement.pk)
        self.assertEqual(Movement.objects.count(), 2)
        self.signin(self.recorder)
        self.assertEqual(self.client.get(reverse("finance:download", args=[foreign.attachments.get().pk])).status_code, 404)

    def test_voided_duplicate_can_be_corrected_as_new_draft(self):
        original = self.create()
        void_movement(original.pk, self.owner, original.version, "La operación correspondía a otra fecha")
        corrected = self.create()
        self.assertNotEqual(original.pk, corrected.pk)
        self.assertEqual(corrected.status, "draft")

    def test_forged_image_pdf_and_empty_bytes_create_nothing(self):
        for document in (SimpleUploadedFile("fake.png", b"<script>unsafe</script>", content_type="image/png"),
                SimpleUploadedFile("document.pdf", b"%PDF-1.7\n%%EOF"), SimpleUploadedFile("empty.jpg", b"")):
            with self.subTest(name=document.name), self.assertRaises(ValidationError):
                create_receipt_draft(self.values(), document, self.owner, uuid.uuid4(), reviewed=True)
        self.assertFalse(Movement.objects.exists())
        self.assertFalse(Attachment.objects.exists())
        self.assertFalse(any(Path(self.media.name).rglob("*.*")))

    def test_storage_failure_rolls_back_draft_and_audit(self):
        with patch.object(Attachment._meta.get_field("file").storage, "save", side_effect=OSError("synthetic storage failure")):
            with self.assertRaises(ValidationError):
                self.create()
        self.assertFalse(Movement.objects.exists())
        self.assertFalse(Attachment.objects.exists())
        self.assertFalse(Audit.objects.exists())

    def test_storage_failure_keeps_reviewed_values_for_retry_without_exposing_provider_details(self):
        self.signin(self.owner)
        with patch.object(Attachment._meta.get_field("file").storage, "save", side_effect=OSError("private-provider-diagnostic")):
            response = self.client.post(self.url, self.payload())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["form"]["amount"].value(), "120.50")
        self.assertIn("document", response.context["form"].errors)
        self.assertNotContains(response, "private-provider-diagnostic")
        self.assertFalse(Movement.objects.exists())
        self.assertFalse(Attachment.objects.exists())

    def test_failure_after_upload_removes_orphan_file_and_rolls_back(self):
        from . import services
        original_audit = services._audit
        def fail_last_audit(movement, actor, action, body):
            if action == "receipt_reviewed":
                raise ValidationError("Synthetic final audit failure")
            return original_audit(movement, actor, action, body)
        with patch("finance.services._audit", side_effect=fail_last_audit), self.assertRaises(ValidationError):
            self.create()
        self.assertFalse(Movement.objects.exists())
        self.assertFalse(Attachment.objects.exists())
        self.assertFalse(Audit.objects.exists())
        self.assertFalse(any(path.is_file() for path in Path(self.media.name).rglob("*")))

    def test_closed_period_and_inactive_account_prevent_draft_and_file(self):
        today = timezone.localdate()
        close_period(self.company, today.year, today.month, self.owner)
        with self.assertRaises(ValidationError):
            self.create()
        self.assertFalse(Attachment.objects.exists())
        self.account.active = False
        self.account.save()
        with self.assertRaises(ValidationError):
            self.create()
        self.assertFalse(Movement.objects.exists())

    def test_service_rechecks_permission_after_company_lock(self):
        from . import services
        real_require = services.require_company
        calls = []
        def permission_revoked_after_lock(actor, company, action):
            calls.append(action)
            if len(calls) > 1:
                raise PermissionDenied("Permission revoked")
            return real_require(actor, company, action)
        with patch("finance.services.require_company", side_effect=permission_revoked_after_lock), self.assertRaises(PermissionDenied):
            self.create(actor=self.recorder)
        self.assertFalse(Movement.objects.exists())
        self.assertFalse(Attachment.objects.exists())

    def test_service_requires_actual_review_boolean(self):
        for value in (False, None, "true", "on", 1):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.create(reviewed=value)
        self.assertFalse(Movement.objects.exists())
