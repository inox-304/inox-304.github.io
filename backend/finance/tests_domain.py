"""Synthetic-only money safety, historical snapshots, authorization and locking checks."""
import io
import tempfile
import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from .models import Account, Attachment, Audit, Category, ClosedPeriod, Company, CompanyAccess, Item, Movement, MovementLine
from .permissions import accessible_companies, can_access, can_company, is_owner
from .services import attach_document, close_period, create_draft, post_movement, reopen_period, update_draft, void_movement


@override_settings(SECURITY_OWNER_USERNAME="finance-owner@example.test", PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class FinanceDomainTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        user_model = get_user_model()
        cls.owner = user_model.objects.create_user("finance-owner@example.test", is_staff=True)
        cls.recorder = user_model.objects.create_user("finance-recorder@example.test", is_staff=True)
        cls.reviewer = user_model.objects.create_user("finance-reviewer@example.test", is_staff=True)
        cls.viewer = user_model.objects.create_user("finance-viewer@example.test", is_staff=True)
        cls.stranger = user_model.objects.create_user("finance-stranger@example.test", is_staff=True, is_superuser=True)
        cls.company = Company.objects.create(code="TEST-A", name="Empresa sintética A")
        cls.other = Company.objects.create(code="TEST-B", name="Empresa sintética B")
        cls.bank = Account.objects.create(company=cls.company, code="BANK", name="Banco sintético", method="transfer")
        cls.cash = Account.objects.create(company=cls.company, code="CASH", name="Caja sintética", method="cash")
        cls.usd = Account.objects.create(company=cls.company, code="USD", name="Dólares sintéticos", method="transfer", currency="USD")
        cls.other_bank = Account.objects.create(company=cls.other, code="BANK", name="Otra empresa", method="transfer")
        cls.category = Category.objects.create(company=cls.company, name="Venta sintética", direction="income")
        cls.item = Item.objects.create(company=cls.company, code="ITEM-1", name="Ítem sintético", current_unit_price=Decimal("100.00"), current_unit_cost=Decimal("70.00"))
        for user, role in ((cls.recorder, "record"), (cls.reviewer, "review"), (cls.viewer, "view")):
            CompanyAccess.objects.create(user=user, company=cls.company, role=role)

    def data(self, **kwargs):
        return {"company": self.company, "account": self.bank, "kind": "income", "occurred_on": date(2026, 1, 10), "description": "Cobro sintético", "amount": Decimal("100.00"), "currency": "PEN", **kwargs}

    def create(self, **kwargs):
        return create_draft(self.data(**kwargs), actor=self.owner)

    def test_only_configured_owner_has_implicit_access_not_unrelated_superuser(self):
        self.assertTrue(is_owner(self.owner))
        self.assertFalse(is_owner(self.stranger))
        self.assertFalse(can_access(self.stranger))
        self.assertEqual(set(accessible_companies(self.recorder)), {self.company})
        self.assertTrue(can_company(self.viewer, self.company))
        self.assertFalse(can_company(self.viewer, self.company, "record"))
        self.assertFalse(can_company(self.recorder, self.company, "review"))
        self.assertTrue(can_company(self.reviewer, self.company, "review"))
        with self.assertRaises(PermissionDenied):
            create_draft(self.data(), actor=self.stranger)
        with self.assertRaises(PermissionDenied):
            create_draft(self.data(company=self.other, account=self.other_bank), actor=self.recorder)

    def test_income_requires_review_and_source_values_are_preserved(self):
        movement = create_draft(self.data(), actor=self.recorder)
        self.assertEqual(movement.status, "draft")
        with self.assertRaises(PermissionDenied):
            post_movement(movement.pk, self.recorder, 1)
        movement = post_movement(movement.pk, self.reviewer, 1)
        self.assertEqual((movement.status, movement.amount, movement.version), ("posted", Decimal("100"), 2))
        self.assertEqual(movement.audit_entries.count(), 2)
        with self.assertRaises(ValidationError):
            post_movement(movement.pk, self.reviewer, 1)

    def test_prices_costs_and_item_names_are_snapshots(self):
        movement = create_draft(self.data(occurred_on=timezone.localdate()), self.owner, lines=[{"item": self.item, "quantity": Decimal("1")}])
        line = movement.lines.get()
        self.assertEqual((line.item_code, line.unit_price, line.unit_cost), ("ITEM-1", Decimal("100"), Decimal("70")))
        self.item.current_unit_price = Decimal("130")
        self.item.current_unit_cost = Decimal("95")
        self.item.name = "Nombre nuevo"
        self.item.save()
        movement = post_movement(movement.pk, self.owner, 1)
        line.refresh_from_db()
        self.assertEqual((line.unit_price, line.unit_cost, line.item_name), (Decimal("100"), Decimal("70"), "Ítem sintético"))
        self.assertEqual(line.cost_total, Decimal("70.00"))
        self.assertEqual(movement.amount, Decimal("100"))

    def test_unknown_historic_cost_stays_unknown(self):
        movement = create_draft(self.data(occurred_on=date(2018, 5, 1)), self.owner, lines=[{"item": self.item, "quantity": 1, "unit_price": Decimal("100"), "unit_cost": None}])
        self.assertIsNone(movement.lines.get().unit_cost)
        self.assertIsNone(movement.lines.get().cost_total)

    def test_backdated_item_never_uses_todays_price_or_cost(self):
        with self.assertRaisesMessage(ValidationError, "precio real histórico"):
            create_draft(self.data(occurred_on=date(2018, 5, 1)), self.owner, lines=[{"item": self.item, "quantity": 1}])
        movement = create_draft(self.data(occurred_on=date(2018, 5, 1)), self.owner, lines=[{"item": self.item, "quantity": 1, "unit_price": Decimal("100")}])
        self.assertIsNone(movement.lines.get().unit_cost)

    def test_import_current_date_does_not_default_current_price(self):
        with self.assertRaises(ValidationError):
            create_draft(self.data(occurred_on=timezone.localdate(), source="import"), self.owner, lines=[{"item": self.item, "quantity": 1}])

    def test_financial_and_line_orm_mutations_protected_after_posting(self):
        movement = create_draft(self.data(), self.owner, lines=[{"item": self.item, "quantity": 1, "unit_price": Decimal("100"), "unit_cost": Decimal("70")}])
        line = movement.lines.get()
        movement = post_movement(movement.pk, self.owner, 1)
        movement.amount = Decimal("500")
        with self.assertRaises(ValidationError):
            movement.save()
        with self.assertRaises(ValidationError):
            Movement.objects.filter(pk=movement.pk).update(amount=Decimal("500"))
        with self.assertRaises(ValidationError):
            movement.delete()
        with self.assertRaises(ValidationError):
            movement.lines.all().delete()
        line.unit_cost = Decimal("1")
        with self.assertRaises(ValidationError):
            line.save()
        with self.assertRaises(ValidationError):
            MovementLine.objects.create(movement=movement, item_name="Alteración", quantity=1, unit_price=0)

    def test_price_totals_must_match_before_posting(self):
        movement = create_draft(self.data(amount=Decimal("101")), self.owner, lines=[{"item": self.item, "quantity": 1, "unit_price": Decimal("100")}])
        with self.assertRaisesMessage(ValidationError, "suma de los detalles"):
            post_movement(movement.pk, self.owner, 1)
        movement.refresh_from_db()
        self.assertEqual(movement.status, "draft")

    def test_cents_are_exact_and_round_per_line(self):
        movement = create_draft(self.data(amount=Decimal("0.03")), self.owner, lines=[{"item_name": "Detalle mínimo", "quantity": Decimal("0.3"), "unit_price": Decimal("0.10")}])
        self.assertEqual(movement.lines.get().total, Decimal("0.03"))
        post_movement(movement.pk, self.owner, 1)

    def test_invalid_amounts_and_nonfinite_values_rejected(self):
        for amount in (Decimal("0"), Decimal("-1"), Decimal("NaN"), Decimal("Infinity"), Decimal("1.005"), "no es un importe", "9999999999999.00"):
            with self.subTest(amount=str(amount)), self.assertRaises(ValidationError):
                self.create(amount=amount)
        self.assertEqual(Movement.objects.count(), 0)

    def test_real_cash_dates_reject_future_and_outside_supported_history(self):
        for value in (date(1899, 12, 31), timezone.localdate() + timedelta(days=1)):
            with self.subTest(value=value), self.assertRaisesMessage(ValidationError, "fecha real"):
                self.create(occurred_on=value)
        self.create(occurred_on=date(2018, 1, 1))
        with self.assertRaises(ValidationError):
            self.create(occurred_on="2026-99-40")

    def test_company_currency_and_transfer_rules(self):
        for kwargs in ({"account": self.other_bank}, {"account": self.usd}, {"kind": "transfer"}, {"kind": "transfer", "destination_account": self.bank}, {"kind": "transfer", "destination_account": self.other_bank}, {"kind": "transfer", "destination_account": self.usd}, {"destination_account": self.cash}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                self.create(**kwargs)
        movement = self.create(kind="transfer", destination_account=self.cash)
        post_movement(movement.pk, self.owner, 1)
        self.cash.currency = "USD"
        with self.assertRaises(ValidationError):
            self.cash.save()

    def test_stale_edit_rolls_back(self):
        movement = self.create()
        update_draft(movement.pk, {"description": "Revisado"}, self.owner, 1)
        with self.assertRaisesMessage(ValidationError, "cambió"):
            update_draft(movement.pk, {"amount": Decimal("555")}, self.owner, 1)
        movement.refresh_from_db()
        self.assertEqual((movement.description, movement.amount), ("Revisado", Decimal("100")))

    def test_idempotency_same_payload_returns_same_record_different_payload_rejected(self):
        key = uuid.uuid4()
        first = create_draft(self.data(), self.owner, idempotency_key=key)
        second = create_draft(self.data(), self.owner, idempotency_key=key)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Movement.objects.count(), 1)
        with self.assertRaises(ValidationError):
            create_draft(self.data(amount=Decimal("999")), self.owner, idempotency_key=key)
        with self.assertRaises(ValidationError):
            create_draft(self.data(), self.recorder, idempotency_key=key)

    def test_confirmed_payment_reference_rejects_duplicate(self):
        first = self.create(reference="REF-TEST")
        post_movement(first.pk, self.owner, 1)
        second = self.create(reference="ref-test")
        with self.assertRaisesMessage(ValidationError, "duplicado"):
            post_movement(second.pk, self.owner, 1)

    def test_void_preserves_original_money_and_requires_reason(self):
        movement = self.create()
        movement = post_movement(movement.pk, self.owner, 1)
        with self.assertRaises(ValidationError):
            void_movement(movement.pk, self.owner, 2, "")
        movement = void_movement(movement.pk, self.owner, 2, "Pago registrado dos veces")
        self.assertEqual((movement.status, movement.amount, movement.posted_by), ("void", Decimal("100"), self.owner))
        self.assertIn("dos veces", movement.void_reason)
        self.assertEqual(movement.audit_entries.count(), 3)
        with self.assertRaises(ValidationError):
            update_draft(movement.pk, {"amount": Decimal("200")}, self.owner, 3)

    def test_cancel_draft_and_audit_are_non_destructive(self):
        movement = self.create()
        void_movement(movement.pk, self.owner, 1, "No corresponde a un pago")
        self.assertEqual(Movement.objects.get(pk=movement.pk).status, "void")
        audit = Audit.objects.first()
        with self.assertRaises(ValidationError):
            audit.delete()
        with self.assertRaises(ValidationError):
            Audit.objects.all().update(body="Ocultar")

    def test_close_blocks_all_backdated_changes_until_owner_reopens(self):
        movement = self.create()
        with self.assertRaisesMessage(ValidationError, "borradores"):
            close_period(self.company, 2026, 1, self.reviewer)
        post_movement(movement.pk, self.owner, 1)
        close_period(self.company, 2026, 1, self.reviewer)
        with self.assertRaises(ValidationError):
            self.create()
        with self.assertRaises(ValidationError):
            void_movement(movement.pk, self.owner, 2, "Corrección")
        with self.assertRaises(PermissionDenied):
            reopen_period(self.company, 2026, 1, self.reviewer, "Revisar")
        with self.assertRaises(ValidationError):
            reopen_period(self.company, 2026, 1, self.owner, "")
        reopen_period(self.company, 2026, 1, self.owner, "Corregir duplicado documentado")
        self.assertFalse(ClosedPeriod.objects.get().is_closed)
        void_movement(movement.pk, self.owner, 2, "Corrección")

    def test_inactive_account_cannot_receive_new_confirmed_money(self):
        movement = self.create()
        self.bank.active = False
        self.bank.save()
        with self.assertRaises(ValidationError):
            post_movement(movement.pk, self.owner, 1)

    def test_category_scope_and_historical_direction(self):
        self.create(category=self.category)
        self.category.direction = "expense"
        with self.assertRaises(ValidationError):
            self.category.save()
        other_category = Category.objects.create(company=self.other, name="Otra", direction="income")
        with self.assertRaises(ValidationError):
            self.create(category=other_category)

    def test_private_attachment_validation_deduplication_and_final_lock(self):
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            movement = self.create()
            buffer = io.BytesIO()
            Image.new("RGB", (2, 2), color="white").save(buffer, format="PNG")
            data = buffer.getvalue()
            doc = attach_document(movement.pk, SimpleUploadedFile("../../pago.png", data, content_type="image/png"), self.owner)
            self.assertTrue(doc.file.name.startswith("finance/documents/"))
            self.assertEqual(doc.name, "pago.png")
            duplicate = attach_document(movement.pk, SimpleUploadedFile("pago.png", data), self.owner)
            self.assertEqual(doc.pk, duplicate.pk)
            self.assertEqual(Attachment.objects.count(), 1)
            with self.assertRaises(ValidationError):
                attach_document(movement.pk, SimpleUploadedFile("fake.png", b"<script>bad</script>"), self.owner)
            with self.assertRaises(PermissionDenied):
                attach_document(movement.pk, SimpleUploadedFile("pago.png", data), self.viewer)
            post_movement(movement.pk, self.owner, 1)
            with self.assertRaises(ValidationError):
                attach_document(movement.pk, SimpleUploadedFile("pago.png", data), self.owner)
