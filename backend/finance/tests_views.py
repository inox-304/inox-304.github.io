"""Real view flows use synthetic data, including MFA and cross-company boundaries."""
import csv
import io
import tempfile
import time
import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp import DEVICE_ID_SESSION_KEY
from PIL import Image

from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION
from .models import Account, Audit, Company, CompanyAccess, Item, Movement
from .services import attach_document, create_draft, post_movement


@override_settings(SECURITY_OWNER_USERNAME="finance-owner@example.test", SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class FinanceWorkspaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("finance-owner@example.test", password="Synthetic-only-123!", is_staff=True, is_superuser=True)
        cls.reviewer = get_user_model().objects.create_user("finance-review@example.test", password="Synthetic-only-123!", is_staff=True)
        cls.recorder = get_user_model().objects.create_user("finance-record@example.test", password="Synthetic-only-123!", is_staff=True)
        cls.viewer = get_user_model().objects.create_user("finance-view@example.test", password="Synthetic-only-123!", is_staff=True)
        cls.outsider = get_user_model().objects.create_user("finance-other@example.test", password="Synthetic-only-123!", is_staff=True, is_superuser=True)
        for user in (cls.owner, cls.reviewer, cls.recorder, cls.viewer, cls.outsider):
            user.email = user.username
            user.save(update_fields=["email"])
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.username, confirmed=True)
        cls.company = Company.objects.create(code="QA_A", name="Empresa sintética A")
        cls.other = Company.objects.create(code="QA_B", name="Empresa sintética B")
        cls.account = Account.objects.create(company=cls.company, code="CAJA", name="Caja sintética", method="cash", currency="PEN")
        cls.bank = Account.objects.create(company=cls.company, code="BANCO", name="Banco sintético", method="transfer", currency="PEN")
        cls.foreign_account = Account.objects.create(company=cls.other, code="CAJA", name="Caja B", method="cash", currency="PEN")
        for user, role in ((cls.reviewer, "review"), (cls.recorder, "record"), (cls.viewer, "view")):
            CompanyAccess.objects.create(company=cls.company, user=user, role=role)
        cls.movement = create_draft({"company": cls.company, "account": cls.account, "kind": "income", "description": "Cobro sintético", "occurred_on": timezone.localdate(), "amount": Decimal("120"), "currency": "PEN"}, cls.owner)
        cls.foreign_movement = create_draft({"company": cls.other, "account": cls.foreign_account, "kind": "income", "description": "Secreto empresa B", "occurred_on": timezone.localdate(), "amount": Decimal("25"), "currency": "PEN"}, cls.owner)

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
        return {"idempotency_key": str(uuid.uuid4()), "version": "1", "kind": "income", "occurred_on": timezone.localdate().isoformat(), "account": self.account.pk,
                "destination_account": "", "category": "", "amount": "120.00", "currency": "PEN", "description": "Cobro nuevo", "reference": "",
                "lines-TOTAL_FORMS": "2", "lines-INITIAL_FORMS": "0", "lines-MIN_NUM_FORMS": "0", "lines-MAX_NUM_FORMS": "20", **extra}

    def test_mfa_required_and_ungranted_superuser_does_not_inherit_finance(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("finance:dashboard"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/auth/", response.url)
        self.signin(self.outsider)
        self.assertEqual(self.client.get(reverse("finance:dashboard")).status_code, 403)
        self.assertEqual(self.client.get(reverse("finance:settings")).status_code, 403)

    def test_finance_pages_render_and_are_private(self):
        self.signin(self.owner)
        for url in [reverse("finance:dashboard"), reverse("finance:create") + f"?company={self.company.pk}", reverse("finance:detail", args=[self.movement.pk]), reverse("finance:edit", args=[self.movement.pk]), reverse("finance:connections")]:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertIn("private", response["Cache-Control"])
                self.assertIn("no-store", response["Cache-Control"])
        for tab in ("companies", "accounts", "categories", "items", "access", "periods"):
            response = self.client.get(reverse("finance:settings"), {"tab": tab, "company": self.company.pk})
            self.assertEqual(response.status_code, 200)

    def test_other_company_hidden_and_cannot_be_selected_or_written(self):
        self.signin(self.reviewer)
        response = self.client.get(reverse("finance:dashboard"))
        self.assertNotContains(response, "Secreto empresa B")
        self.assertNotContains(response, self.other.name)
        self.assertEqual(self.client.get(reverse("finance:detail", args=[self.foreign_movement.pk])).status_code, 404)
        self.assertEqual(self.client.get(reverse("finance:dashboard"), {"company": self.other.pk}).status_code, 404)
        self.assertEqual(self.client.post(reverse("finance:create") + f"?company={self.other.pk}", self.payload()).status_code, 404)
        response = self.client.post(reverse("finance:create") + f"?company={self.company.pk}", self.payload(account=self.foreign_account.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Movement.objects.count(), 2)

    def test_recorder_creates_draft_and_retry_does_not_duplicate(self):
        self.signin(self.recorder)
        data = self.payload()
        url = reverse("finance:create") + f"?company={self.company.pk}"
        self.assertEqual(self.client.post(url, data).status_code, 302)
        self.assertEqual(self.client.post(url, data).status_code, 302)
        self.assertEqual(Movement.objects.count(), 3)
        movement = Movement.objects.order_by("-pk").first()
        self.assertEqual(movement.status, "draft")
        self.assertEqual(self.client.post(reverse("finance:post", args=[movement.pk]), {"version": 1}).status_code, 403)

    def test_reviewer_can_post_and_void_with_reason_only(self):
        self.signin(self.reviewer)
        url = reverse("finance:post", args=[self.movement.pk])
        self.client.post(url, {"version": 1})
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.status, "posted")
        self.client.post(reverse("finance:void", args=[self.movement.pk]), {"version": self.movement.version, "reason": ""})
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.status, "posted")
        self.client.post(reverse("finance:void", args=[self.movement.pk]), {"version": self.movement.version, "reason": "Duplicado comprobado en revisión"})
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.status, "void")
        self.assertEqual(self.movement.amount, Decimal("120"))
        self.assertEqual(self.movement.audit_entries.count(), 3)

    def test_edit_rejects_stale_version_and_preserves_snapshots(self):
        self.signin(self.recorder)
        item = Item.objects.create(company=self.company, code="QA_ITEM", name="Ítem sintético", current_unit_price=Decimal("60"), current_unit_cost=Decimal("40"), currency="PEN")
        from .services import update_draft
        update_draft(self.movement.pk, {}, self.owner, 1, lines=[{"item": item, "quantity": Decimal("2"), "unit_price": Decimal("60"), "unit_cost": None}])
        data = self.payload(version=2, **{"lines-TOTAL_FORMS": 3, "lines-INITIAL_FORMS": 1, "lines-0-item": item.pk, "lines-0-item_code": item.code, "lines-0-item_name": item.name, "lines-0-unit": "unidad", "lines-0-quantity": "2", "lines-0-unit_price": "60", "lines-0-unit_cost": ""})
        item.current_unit_cost = Decimal("99")
        item.save()
        url = reverse("finance:edit", args=[self.movement.pk])
        self.assertEqual(self.client.post(url, data).status_code, 302)
        self.assertEqual(self.client.post(url, data).status_code, 200)
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.version, 3)
        self.assertIsNone(self.movement.lines.get().unit_cost)

    def test_viewer_cannot_write_or_manage_settings(self):
        self.signin(self.viewer)
        self.assertEqual(self.client.get(reverse("finance:create") + f"?company={self.company.pk}").status_code, 403)
        for name in ("post", "void", "upload"):
            self.assertEqual(self.client.post(reverse(f"finance:{name}", args=[self.movement.pk]), {}).status_code, 403)
        self.assertEqual(self.client.get(reverse("finance:settings")).status_code, 403)

    def test_post_only_and_csrf_required(self):
        client = self.signin(self.owner, Client(enforce_csrf_checks=True))
        for name, args in (("prepare_companies", []), ("post", [self.movement.pk]), ("void", [self.movement.pk]), ("upload", [self.movement.pk]), ("member_save", [])):
            self.assertEqual(client.get(reverse(f"finance:{name}", args=args)).status_code, 405)
            self.assertEqual(client.post(reverse(f"finance:{name}", args=args), {}).status_code, 403)

    def test_prepare_companies_is_explicit_idempotent_and_names_editable(self):
        self.signin(self.owner)
        self.client.get(reverse("finance:settings"))
        self.assertEqual(Company.objects.count(), 2)
        self.client.post(reverse("finance:prepare_companies"))
        self.client.post(reverse("finance:prepare_companies"))
        self.assertEqual(Company.objects.count(), 6)
        obj = Company.objects.get(code="SHAMO")
        response = self.client.post(reverse("finance:setup_edit", args=["companies", obj.pk]), {"code": "CANNOT_CHANGE", "name": "Shamo actualizado", "default_currency": "USD", "active": "on"})
        self.assertEqual(response.status_code, 302)
        obj.refresh_from_db()
        self.assertEqual(obj.code, "SHAMO")
        self.assertEqual(obj.name, "Shamo actualizado")
        self.assertEqual(obj.default_currency, "USD")
        response = self.client.post(reverse("finance:setup_create", args=["companies"]), {"code": "QUINTA", "name": "Quinta empresa", "default_currency": "PEN", "active": "on"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Company.objects.count(), 7)

    def test_owner_creates_account_and_explicit_access_without_changing_other_roles(self):
        self.signin(self.owner)
        response = self.client.post(reverse("finance:setup_create", args=["accounts"]) + f"?company={self.company.pk}", {"code": "YAPE", "name": "Yape sintético", "method": "yape", "currency": "PEN", "active": "on"})
        self.assertEqual(response.status_code, 302)
        self.client.post(reverse("finance:member_save") + f"?company={self.other.pk}", {"user": self.viewer.pk, "role": "record"})
        self.assertTrue(CompanyAccess.objects.filter(company=self.other, user=self.viewer, role="record").exists())
        self.assertEqual(self.viewer.user_permissions.count(), 0)
        access = CompanyAccess.objects.get(company=self.other, user=self.viewer)
        self.client.post(reverse("finance:member_remove", args=[access.pk]))
        self.assertFalse(CompanyAccess.objects.filter(pk=access.pk).exists())

    def test_summary_separates_currencies_and_excludes_transfers_and_drafts(self):
        self.signin(self.reviewer)
        post_movement(self.movement.pk, self.owner, 1)
        transfer = create_draft({"company": self.company, "account": self.account, "destination_account": self.bank, "kind": "transfer", "description": "Traslado sintético", "occurred_on": timezone.localdate(), "amount": Decimal("50"), "currency": "PEN"}, self.owner)
        post_movement(transfer.pk, self.owner, 1)
        response = self.client.get(reverse("finance:dashboard"))
        summary = response.context["summaries"][0]
        self.assertEqual(summary["income"], Decimal("120"))
        self.assertEqual(summary["net"], Decimal("120"))
        self.assertEqual(summary["transfer"], Decimal("50"))
        self.assertContains(response, "no representa utilidad")

    def test_export_scoped_formula_safe_and_invalid_dates_rejected(self):
        self.signin(self.reviewer)
        create_draft({"company": self.company, "account": self.account, "kind": "expense", "description": '=HYPERLINK("https://invalid.example")', "occurred_on": timezone.localdate(), "amount": Decimal("10"), "currency": "PEN"}, self.owner)
        response = self.client.get(reverse("finance:export_csv"))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Secreto empresa B", response.content.decode("utf-8-sig"))
        self.assertIn("'=HYPERLINK", response.content.decode("utf-8-sig"))
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
        original = next(row for row in rows[1:] if row[0] == self.movement.code)
        self.assertEqual(original[2], self.movement.occurred_on.isoformat())
        self.assertEqual(original[10], "120.00")
        self.assertEqual(original[12], "")
        self.assertEqual(original[14], "[]")
        self.assertEqual(self.client.get(reverse("finance:export_csv"), {"from": "invalid"}).status_code, 400)

    def test_attachments_download_authorized_only_and_never_expose_public_url(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            content = io.BytesIO()
            Image.new("RGB", (4, 4), "white").save(content, "PNG")
            attachment = attach_document(self.movement.pk, SimpleUploadedFile("comprobante.png", content.getvalue(), content_type="image/png"), self.owner)
            self.signin(self.viewer)
            response = self.client.get(reverse("finance:download", args=[attachment.pk]))
            self.assertEqual(response.status_code, 200)
            self.assertIn("attachment", response["Content-Disposition"])
            response.close()
            self.assertNotContains(self.client.get(reverse("finance:detail", args=[self.movement.pk])), "/media/finance")
            CompanyAccess.objects.filter(user=self.viewer).delete()
            self.assertEqual(self.client.get(reverse("finance:download", args=[attachment.pk])).status_code, 403)

    def test_inbox_raw_content_is_owner_only(self):
        from finance_intake.models import IntakeMessage
        IntakeMessage.objects.create(provider_message_id="synthetic-wa-1", fingerprint="a" * 64, group_id="synthetic-group", method="cash", sender_id="test", sender_id_kind="from", message_type="text", text="PRIVADO MULTIEMPRESA")
        self.signin(self.viewer)
        self.assertNotContains(self.client.get(reverse("finance:connections")), "PRIVADO MULTIEMPRESA")
        self.signin(self.owner)
        self.assertContains(self.client.get(reverse("finance:connections")), "PRIVADO MULTIEMPRESA")

    def test_default_new_form_chooses_recordable_company_and_has_no_false_errors(self):
        CompanyAccess.objects.filter(user=self.viewer, company=self.company).update(role="view")
        CompanyAccess.objects.create(user=self.viewer, company=self.other, role="record")
        self.signin(self.viewer)
        response = self.client.get(reverse("finance:create"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["company"], self.other)
        self.assertIn(f'value="{timezone.localdate().isoformat()}"', str(response.context["form"]["occurred_on"]))
        self.assertNotContains(response, "Revisa los datos antes de continuar.")
        self.assertFalse(response.context["open_lines"])
        response = self.client.get(reverse("finance:dashboard"), {"company": self.company.pk})
        self.assertNotContains(response, "＋ Nuevo movimiento")

    def test_inbox_pagination_history_and_direct_code_link(self):
        from finance_intake.models import IntakeMessage
        self.signin(self.owner)
        for number in range(27):
            IntakeMessage.objects.create(provider_message_id=f"synthetic-{number}", fingerprint="b" * 64, group_id="qa-group", method="cash", sender_id="qa", sender_id_kind="from", message_type="text", text=f"Recibo {number}")
        page_one = self.client.get(reverse("finance:connections"))
        self.assertEqual(len(page_one.context["receipts"]), 25)
        page_two = self.client.get(reverse("finance:connections"), {"page": "2"})
        self.assertEqual(len(page_two.context["receipts"]), 2)
        receipt = IntakeMessage.objects.order_by("pk").first()
        response = self.client.post(reverse("finance:receipt_action", args=[receipt.pk]), {"action": "link", "movement_code": self.movement.code})
        self.assertEqual(response.status_code, 302)
        receipt.refresh_from_db()
        self.assertEqual(receipt.movement_id, self.movement.pk)
        linked = self.client.get(reverse("finance:connections"), {"received_status": "linked"})
        self.assertContains(linked, receipt.code)
        self.assertContains(linked, self.movement.code)
