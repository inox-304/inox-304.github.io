import hashlib
import io
import tempfile
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from finance_intake.models import IntakeMessage
from .models import Movement
from . import tests_views as view_fixtures


@override_settings(SECURITY_OWNER_USERNAME="finance-owner@example.test", SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class WhatsAppReviewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        view_fixtures.FinanceWorkspaceTests.setUpTestData.__func__(cls)

    signin = view_fixtures.FinanceWorkspaceTests.signin

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        options = override_settings(MEDIA_ROOT=self.temp.name)
        options.enable()
        self.addCleanup(options.disable)
        data = io.BytesIO()
        Image.new("RGB", (30, 30), "white").save(data, "PNG")
        self.photo = data.getvalue()
        self.receipt = IntakeMessage.objects.create(provider_message_id="synthetic-message", fingerprint="a" * 64,
            group_id="synthetic-cash", sender_id="synthetic-operator", sender_id_kind="bsuid", method="cash",
            message_type="image", text="Empresa: QA_A", status="needs_review", processing_state="review",
            original_content_type="image/png", original_name="receipt.png", original_size=len(self.photo),
            original_sha256=hashlib.sha256(self.photo).hexdigest(), ocr_fields={"description": "Material sintético"})
        self.receipt.original_file.save("receipt.png", ContentFile(self.photo))
        self.url = reverse("finance:whatsapp_review", args=[self.receipt.pk])

    def payload(self, **extra):
        return {"company": str(self.company.pk), "expected_version": str(self.receipt.processing_version),
            "kind": "expense", "occurred_on": timezone.localdate().isoformat(), "account": str(self.account.pk),
            "destination_account": "", "category": "", "amount": "118.00", "currency": "PEN",
            "description": "Materiales de prueba", "reference": "SYN-118", "reviewed": "on", **extra}

    def test_owner_chooses_company_and_unknown_values_stay_blank(self):
        self.signin(self.owner)
        response = self.client.get(self.url)
        self.assertContains(response, "Selecciona una empresa")
        response = self.client.get(self.url, {"company": self.company.pk})
        self.assertEqual(response.status_code, 200)
        form = response.context["form"]
        for name in ("currency", "amount", "occurred_on", "kind"):
            self.assertFalse(form[name].value())
        self.assertEqual(list(form.fields["account"].queryset), [self.account])
        self.assertIn("no-store", response["Cache-Control"])

    def test_automatic_draft_stays_visible_in_pending_inbox_until_reviewed(self):
        self.signin(self.owner)
        self.receipt.movement = self.movement
        self.receipt.status = "linked"
        self.receipt.processing_state = "drafted"
        self.receipt.save()
        response = self.client.get(reverse("finance:connections"))
        self.assertContains(response, self.receipt.code)
        self.assertContains(response, "Corregir la empresa")
        self.receipt.reviewed_by = self.owner
        self.receipt.reviewed_at = timezone.now()
        self.receipt.save()
        self.assertNotContains(self.client.get(reverse("finance:connections")), self.receipt.code)

    def test_original_and_review_are_owner_only_even_for_company_reviewer(self):
        for user in (self.reviewer, self.recorder, self.outsider):
            self.signin(user)
            for url in (self.url, reverse("finance:whatsapp_original", args=[self.receipt.pk])):
                self.assertEqual(self.client.get(url).status_code, 403)
        self.signin(self.owner)
        response = self.client.get(reverse("finance:whatsapp_original", args=[self.receipt.pk]))
        self.assertEqual(b"".join(response.streaming_content), self.photo)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")

    def test_review_creates_only_one_draft_with_private_photo_and_review_audit(self):
        self.signin(self.owner)
        before = Movement.objects.count()
        response = self.client.post(self.url, self.payload())
        self.assertEqual(response.status_code, 302)
        self.receipt.refresh_from_db()
        movement = self.receipt.movement
        self.assertIsNotNone(movement)
        self.assertEqual(movement.status, "draft")
        self.assertEqual(movement.company, self.company)
        self.assertEqual(movement.source, "whatsapp")
        self.assertEqual(movement.attachments.count(), 1)
        self.assertEqual(self.receipt.reviewed_by, self.owner)
        self.assertIsNotNone(self.receipt.reviewed_at)
        self.client.post(self.url, self.payload())
        self.assertEqual(Movement.objects.count(), before + 1)

    def test_review_requires_consent_correct_company_account_and_current_version(self):
        self.signin(self.owner)
        before = Movement.objects.count()
        for extra in ({"reviewed": ""}, {"account": self.foreign_account.pk}, {"account": self.bank.pk},
                      {"expected_version": "999"}, {"company": ""}, {"currency": ""}):
            response = self.client.post(self.url, self.payload(**extra))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.context["form"].errors)
        self.assertEqual(Movement.objects.count(), before)

    def test_post_without_csrf_is_rejected_and_get_does_not_read_ocr(self):
        secure = self.signin(self.owner, Client(enforce_csrf_checks=True))
        self.assertEqual(secure.post(self.url, self.payload()).status_code, 403)
        with patch("finance_intake.ocr.read_image") as ocr:
            secure.get(self.url, {"company": self.company.pk})
        ocr.assert_not_called()
