"""Synthetic CRM fixtures only; no data or identity from the live installation."""
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from .forms import OpportunityForm, eligible_assignees
from .metrics import build_metrics, record_web_metric
from .models import Activity, Opportunity, WebMetric
from .services import add_note, create_opportunity, mark_contacted, update_opportunity


def customer(**overrides):
    return {"name": "Cliente de prueba", "phone": "999 123 456", **overrides}


class DomainTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user(username="crm-owner", email="owner@example.test", is_staff=True, is_superuser=True)

    def test_create_is_real_contact_with_normalized_phone_and_history(self):
        lead = create_opportunity(customer(), self.owner)
        self.assertEqual(lead.phone, "+51999123456")
        self.assertEqual(lead.code, f"CRM-{lead.pk:06d}")
        self.assertEqual(lead.whatsapp_url, "https://wa.me/51999123456")
        self.assertEqual(lead.version, 1)
        self.assertEqual(lead.activities.get().kind, Activity.Kind.CREATED)
        email_only = create_opportunity(customer(phone="", email="CUSTOMER@example.test"))
        self.assertEqual(email_only.email, "customer@example.test")
        self.assertEqual(email_only.whatsapp_url, "")

    def test_missing_or_invalid_contact_and_negative_amount_fail(self):
        invalid = [customer(phone=""), customer(phone="llamar luego"), customer(phone="123"), customer(name="  "), customer(email="invalido"), customer(quote_amount=Decimal("-1")), customer(source="inventado"), customer(stage="lost")]
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(ValidationError):
                create_opportunity(data, self.owner)
        self.assertEqual(Opportunity.objects.count(), 0)
        self.assertEqual(Activity.objects.count(), 0)

    def test_compare_and_swap_rejects_stale_update_and_preserves_latest(self):
        lead = create_opportunity(customer(), self.owner)
        latest = update_opportunity(lead.pk, {"company": "Primera edición"}, self.owner, 1)
        self.assertEqual(latest.version, 2)
        with self.assertRaises(ValidationError) as error:
            update_opportunity(lead.pk, {"company": "Edición obsoleta"}, self.owner, 1)
        self.assertEqual(error.exception.code, "conflict")
        lead.refresh_from_db()
        self.assertEqual(lead.company, "Primera edición")
        self.assertEqual(lead.activities.count(), 2)
        for invalid in (None, "invalid", True):
            with self.subTest(version=invalid), self.assertRaises(ValidationError):
                update_opportunity(lead.pk, {"company": "No guardar"}, self.owner, invalid)

    def test_transport_cannot_overwrite_milestones_or_creation_time(self):
        lead = create_opportunity(customer(), self.owner)
        for data in ({"created_at": timezone.now()}, {"won_at": timezone.now()}, {"pk": 100}):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                update_opportunity(lead.pk, data, self.owner, 1)
        unchanged = update_opportunity(lead.pk, {"name": lead.name}, self.owner, 1)
        self.assertEqual(unchanged.version, 1)

    def test_milestones_are_once_only_and_reopening_keeps_confirmed_sale(self):
        lead = create_opportunity(customer(), self.owner)
        lead = update_opportunity(lead.pk, {"stage": "quoted", "quote_amount": Decimal("800")}, self.owner, 1)
        quotation_date = lead.quoted_at
        lead = update_opportunity(lead.pk, {"stage": "won", "next_followup": timezone.now()}, self.owner, 2)
        sale_date = lead.won_at
        self.assertIsNone(lead.next_followup)
        with self.assertRaises(ValidationError):
            update_opportunity(lead.pk, {"stage": "evaluating"}, self.owner, 3)
        lead = update_opportunity(lead.pk, {"stage": "delivered"}, self.owner, 3)
        self.assertEqual(lead.won_at, sale_date)
        self.assertIsNotNone(lead.delivered_at)
        lead = update_opportunity(lead.pk, {"stage": "quoted", "reopen_reason": "El cliente pidió ampliar su compra"}, self.owner, 4)
        self.assertEqual(lead.quoted_at, quotation_date)
        self.assertEqual(lead.won_at, sale_date)
        self.assertIn("El cliente pidió ampliar", lead.activities.first().body)

    def test_loss_reason_and_history_survive_reopen(self):
        lead = create_opportunity(customer(), self.owner)
        lead = update_opportunity(lead.pk, {"stage": "lost", "loss_reason": "price", "loss_detail": "Presupuesto insuficiente"}, self.owner, 1)
        self.assertIn("Presupuesto insuficiente", lead.activities.first().body)
        lead = update_opportunity(lead.pk, {"stage": "evaluating", "reopen_reason": "Confirmó nuevo presupuesto"}, self.owner, 2)
        self.assertEqual(lead.loss_reason, "")
        self.assertIn("Precio", lead.activities.first().body)
        self.assertIsNone(lead.won_at)

    def test_notes_and_contacts_use_cas_and_keep_first_contact(self):
        lead = create_opportunity(customer(), self.owner)
        lead = mark_contacted(lead.pk, self.owner, 1, "Llamada realizada")
        first = lead.first_contact_at
        lead = mark_contacted(lead.pk, self.owner, 2, "Segunda llamada")
        self.assertEqual(lead.first_contact_at, first)
        with self.assertRaises(ValidationError):
            add_note(lead.pk, "Nota antigua", self.owner, 1)
        for body in (" ", "a" * 4001):
            with self.subTest(body=body[:10]), self.assertRaises(ValidationError):
                add_note(lead.pk, body, self.owner, lead.version)
        lead = add_note(lead.pk, "Nueva información", self.owner, lead.version)
        self.assertEqual(lead.activities.first().kind, Activity.Kind.NOTE)
        self.assertEqual(lead.version, 4)

    def test_transaction_rolls_back_if_audit_cannot_be_saved(self):
        lead = create_opportunity(customer(), self.owner)
        with patch("crm.services._activity", side_effect=ValidationError("fallo")):
            with self.assertRaises(ValidationError):
                update_opportunity(lead.pk, {"city": "Otra ciudad"}, self.owner, 1)
        lead.refresh_from_db()
        self.assertEqual(lead.city, "")
        self.assertEqual(lead.version, 1)

    def test_audit_instance_is_immutable_and_delete_permission_not_created(self):
        lead = create_opportunity(customer(), self.owner)
        event = lead.activities.get()
        event.body = "alterado"
        with self.assertRaises(ValidationError):
            event.save()
        with self.assertRaises(ValidationError):
            event.delete()
        self.assertFalse(Permission.objects.filter(content_type__app_label="crm", codename="delete_opportunity").exists())

    def test_submission_reference_is_unique_without_raw_contact_tracking(self):
        submission_id = uuid4()
        lead = create_opportunity(customer(submission_id=submission_id, submission_fingerprint="a" * 64))
        with self.assertRaises(ValidationError):
            create_opportunity(customer(submission_id=submission_id))
        self.assertEqual(Opportunity.objects.count(), 1)
        update_opportunity(lead.pk, {"interest": "Un vendedor aclaró el pedido"}, self.owner, 1)
        lead.refresh_from_db()
        self.assertEqual(lead.submission_fingerprint, "a" * 64)
        with self.assertRaises(ValidationError):
            update_opportunity(lead.pk, {"submission_fingerprint": "b" * 64}, self.owner, 2)

    def test_assignee_needs_read_and_write_access_and_active_staff(self):
        staff = get_user_model().objects.create_user(username="crm-staff", is_staff=True)
        permissions = Permission.objects.filter(content_type__app_label="crm", codename__in=["view_opportunity", "change_opportunity"])
        view = permissions.get(codename="view_opportunity")
        change = permissions.get(codename="change_opportunity")
        staff.user_permissions.add(view)
        self.assertFalse(eligible_assignees().filter(pk=staff.pk).exists())
        with self.assertRaises(ValidationError):
            create_opportunity(customer(assignee=staff), self.owner)
        group = Group.objects.create(name="Equipo CRM de prueba")
        group.permissions.add(change)
        staff.groups.add(group)
        staff = get_user_model().objects.get(pk=staff.pk)
        self.assertTrue(eligible_assignees().filter(pk=staff.pk).exists())
        lead = create_opportunity(customer(assignee=staff), self.owner)
        self.assertEqual(lead.assignee_id, staff.pk)
        staff.is_active = False
        staff.save()
        self.assertFalse(eligible_assignees().filter(pk=staff.pk).exists())


class FormTests(TestCase):
    def form_data(self, **overrides):
        return customer(source="store", stage="new", currency="PEN", **overrides)

    def test_create_and_edit_validation_require_contact_version_and_reopening_reason(self):
        form = OpportunityForm(data=self.form_data())
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["phone"], "+51999123456")
        lead = create_opportunity(form.cleaned_data)
        edit = OpportunityForm(data=self.form_data(), instance=lead)
        self.assertFalse(edit.is_valid())
        self.assertIn("version", edit.errors)
        invalid = OpportunityForm(data=self.form_data(phone=""))
        self.assertFalse(invalid.is_valid())
        self.assertIn("phone", invalid.errors)
        lead = update_opportunity(lead.pk, {"stage": "won"}, None, 1)
        reopening = OpportunityForm(data=self.form_data(version=2), instance=lead)
        self.assertFalse(reopening.is_valid())
        self.assertIn("reopen_reason", reopening.errors)

    def test_form_cannot_save_around_audit_service(self):
        form = OpportunityForm(data=self.form_data())
        self.assertTrue(form.is_valid(), form.errors)
        with self.assertRaises(ValidationError):
            form.save()


class MetricsTests(TestCase):
    def setUp(self):
        self.now = timezone.make_aware(datetime(2026, 10, 25, 12))
        self.start = self.now.date() - timedelta(days=5)
        self.end = self.now.date()

    def fixture(self, *, created=None, contacted_hours=None, **data):
        lead = create_opportunity(customer(**data))
        created = created or self.now - timedelta(days=2)
        changes = {"created_at": created}
        if contacted_hours is not None:
            changes["first_contact_at"] = created + timedelta(hours=contacted_hours)
        Opportunity.objects.filter(pk=lead.pk).update(**changes)
        return lead

    def test_metrics_use_creation_cohort_confirmed_sales_and_separate_money(self):
        self.fixture(source="google", campaign="Cocinas", stage="won", quote_amount=Decimal("100"), contacted_hours=1)
        self.fixture(source="google", campaign="Cocinas", stage="quoted", quote_amount=Decimal("300"), contacted_hours=3, next_followup=self.now - timedelta(hours=1))
        self.fixture(source="facebook", stage="delivered", quote_amount=Decimal("200"), currency="USD", contacted_hours=5)
        self.fixture(source="store", stage="lost", loss_reason="price")
        self.fixture(source="unknown", contacted_hours=-1)
        self.fixture(created=self.now - timedelta(days=30), source="google", stage="won", quote_amount=Decimal("999"))
        record_web_metric("google", "click_whatsapp", date=self.now.date())
        record_web_metric("google", "click_whatsapp", date=self.now.date())
        record_web_metric("google", "contact_submit", date=self.now.date())
        with self.assertNumQueries(9):
            metrics = build_metrics(Opportunity.objects.all(), start=self.start, end=self.end, now=self.now)
        self.assertEqual(metrics["total"], 5)
        self.assertEqual(metrics["won"], 2)
        self.assertEqual(metrics["conversion_rate"], 40)
        self.assertEqual(metrics["median_response_hours"], 3)
        self.assertEqual(metrics["response_sample_count"], 3)
        self.assertEqual(metrics["operational_counts"]["overdue"], 1)
        self.assertEqual(metrics["operational_counts"]["unassigned"], 2)
        amounts = {row["currency"]: row for row in metrics["amounts"]}
        self.assertEqual(amounts["PEN"]["won"], Decimal("100"))
        self.assertEqual(amounts["USD"]["won"], Decimal("200"))
        self.assertEqual(amounts["PEN"]["quoted"], Decimal("300"))
        self.assertEqual(metrics["web_clicks"], 2)
        self.assertEqual(metrics["contact_submissions"], 1)
        self.assertEqual(metrics["campaign_rows"][0]["leads"], 2)
        self.assertEqual(metrics["loss_rows"][0]["label"], "Precio")

    def test_cancelled_or_reopened_sales_keep_history_without_inflating_results(self):
        cancelled = self.fixture(source="facebook", campaign="Cocinas", stage="won", quote_amount=Decimal("100"))
        cancelled_won_at = cancelled.won_at
        cancelled = update_opportunity(cancelled.pk, {
            "stage": "lost", "loss_reason": "cancelled", "reopen_reason": "El cliente canceló la compra",
        }, None, cancelled.version)
        reopened = self.fixture(source="google", campaign="Equipos", stage="delivered", quote_amount=Decimal("200"), currency="USD")
        delivered_at = reopened.delivered_at
        reopened = update_opportunity(reopened.pk, {
            "stage": "evaluating", "reopen_reason": "Devolución pendiente de resolver",
        }, None, reopened.version)
        self.assertEqual(cancelled.won_at, cancelled_won_at)
        self.assertEqual(reopened.delivered_at, delivered_at)
        metrics = build_metrics(Opportunity.objects.all(), start=self.start, end=self.end, now=self.now)
        self.assertEqual(metrics["total"], 2)
        self.assertEqual(metrics["won"], 0)
        self.assertEqual(metrics["delivered"], 0)
        self.assertEqual(metrics["conversion_rate"], 0)
        self.assertTrue(all(row["won"] == 0 for row in metrics["source_rows"]))
        self.assertTrue(all(row["won"] == 0 for row in metrics["campaign_rows"]))
        self.assertTrue(all(row["won"] == Decimal("0") for row in metrics["amounts"]))

    def test_even_response_median_and_source_filter(self):
        self.fixture(source="google", contacted_hours=2)
        self.fixture(source="google", contacted_hours=6)
        self.fixture(source="facebook", contacted_hours=50)
        record_web_metric("google", "click_whatsapp", date=self.now.date())
        record_web_metric("facebook", "click_whatsapp", date=self.now.date())
        metrics = build_metrics(Opportunity.objects.all(), now=self.now, source="google")
        self.assertEqual(metrics["total"], 2)
        self.assertEqual(metrics["median_response_hours"], 4)
        self.assertEqual(metrics["web_clicks"], 1)
        self.assertEqual(metrics["web_scope"], "Google")

    def test_empty_cohort_clicks_do_not_fabricate_leads_or_response(self):
        record_web_metric("website", "click_whatsapp", date=self.now.date())
        metrics = build_metrics(Opportunity.objects.all(), now=self.now)
        self.assertEqual(metrics["total"], 0)
        self.assertEqual(metrics["conversion_rate"], 0)
        self.assertIsNone(metrics["median_response_hours"])
        self.assertEqual(metrics["web_clicks"], 1)
        self.assertEqual(metrics["won"], 0)

    def test_local_date_bounds_include_end_day_and_exclude_next_day(self):
        self.fixture(created=timezone.make_aware(datetime(2026, 10, 25, 23, 59)))
        self.fixture(created=timezone.make_aware(datetime(2026, 10, 26, 0, 0)))
        metrics = build_metrics(Opportunity.objects.all(), start=self.end, end=self.end, now=self.now)
        self.assertEqual(metrics["total"], 1)
        with self.assertRaises(ValidationError):
            build_metrics(Opportunity.objects.all(), start=self.end, end=self.start)

    def test_web_aggregate_is_unique_and_rejects_unbounded_dimensions(self):
        record_web_metric("website", "click_whatsapp")
        record_web_metric("website", "click_whatsapp")
        row = WebMetric.objects.get()
        self.assertEqual(row.count, 2)
        with self.assertRaises(ValidationError):
            record_web_metric("arbitrary-campaign", "click_whatsapp")
        with transaction.atomic():
            with self.assertRaises(IntegrityError), transaction.atomic():
                WebMetric.objects.create(date=row.date, source=row.source, event=row.event)
