"""Dashboard totals must remain scoped, historical and independent of table state."""
import csv
import io
import json
import time
from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import parse_qs

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from django_otp import DEVICE_ID_SESSION_KEY

from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION
from .metrics import dashboard_metrics
from .models import Account, Audit, Company, CompanyAccess, Item, Movement
from .services import create_draft, post_movement, void_movement


@override_settings(SECURITY_OWNER_USERNAME="dashboard-owner@example.test", SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class FinanceDashboardTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("dashboard-owner@example.test", password="Synthetic-test-only-123!", is_staff=True, is_superuser=True)
        cls.viewer = get_user_model().objects.create_user("dashboard-viewer@example.test", password="Synthetic-test-only-123!", is_staff=True)
        for user in (cls.owner, cls.viewer):
            user.email = user.username
            user.save(update_fields=["email"])
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.username, confirmed=True)
        cls.company = Company.objects.create(code="QA_ONE", name="Empresa de prueba A")
        cls.other = Company.objects.create(code="QA_TWO", name="Empresa privada B")
        cls.cash = Account.objects.create(company=cls.company, code="CASH", name="Caja de prueba", method="cash", currency="PEN")
        cls.yape = Account.objects.create(company=cls.company, code="YAPE", name="Yape de prueba", method="yape", currency="PEN")
        cls.bank = Account.objects.create(company=cls.company, code="BANK", name="Banco de prueba", method="transfer", currency="PEN")
        cls.dollars = Account.objects.create(company=cls.company, code="USD", name="Dólares de prueba", method="cash", currency="USD")
        cls.foreign = Account.objects.create(company=cls.other, code="CASH", name="Caja privada B", method="cash", currency="PEN")
        CompanyAccess.objects.create(company=cls.company, user=cls.viewer, role="view")

    def signin(self, user):
        self.client.force_login(user)
        session = self.client.session
        session[DEVICE_ID_SESSION_KEY] = EmailDevice.objects.get(user=user).persistent_id
        session[AUTH_AT] = session[LAST_SEEN] = time.time()
        session[VERSION] = SecurityState.objects.get(user=user).session_version
        session.save()

    def record(self, amount, *, account=None, kind="income", status="posted", occurred_on=None, description="Prueba de resumen", lines=None):
        account = account or self.cash
        data = {"company": account.company, "account": account, "kind": kind, "description": description,
                "occurred_on": occurred_on or timezone.localdate(), "amount": Decimal(amount), "currency": account.currency}
        if kind == "transfer":
            data["destination_account"] = self.bank
        movement = create_draft(data, self.owner, lines=lines)
        if status in ("posted", "void"):
            movement = post_movement(movement.pk, self.owner, movement.version)
        if status == "void":
            movement = void_movement(movement.pk, self.owner, movement.version, "Anulación sintética para la prueba")
        return movement

    def test_exact_totals_keep_currency_methods_companies_and_transfers_separate(self):
        self.record("0.10")
        self.record("0.20")
        self.record("0.05", kind="expense", account=self.yape)
        self.record("7.00", kind="transfer")
        self.record("80", account=self.dollars)
        self.record("90", account=self.foreign)
        self.record("999", status="draft")
        self.record("888", status="void")
        with CaptureQueriesContext(connection) as queries:
            summaries = dashboard_metrics(Movement.objects.all())
        self.assertEqual(len(queries), 2)
        pen, usd = summaries
        self.assertEqual((pen["currency"], usd["currency"]), ("PEN", "USD"))
        self.assertEqual((pen["income"], pen["expense"], pen["net"], pen["transfer"]), (Decimal("90.30"), Decimal("0.05"), Decimal("90.25"), Decimal("7")))
        self.assertEqual(usd["net"], Decimal("80"))
        company = next(row for row in pen["companies"] if row["id"] == self.company.pk)
        self.assertEqual(company["net"], Decimal("0.25"))
        methods = {row["key"]: row for row in pen["methods"]}
        self.assertEqual(methods["cash"]["income"], Decimal("90.30"))
        self.assertEqual(methods["cash"]["transfer"], Decimal("7"))
        self.assertEqual(methods["yape"]["expense"], Decimal("0.05"))
        self.assertEqual(methods["transfer"]["count"], 0)

    def test_monthly_window_is_bounded_and_totals_still_include_older_history(self):
        year = timezone.localdate().year - 1
        self.record("100", occurred_on=date(year - 1, 12, 5))
        self.record("20", occurred_on=date(year, 1, 3))
        self.record("10", occurred_on=date(year, 12, 5), kind="expense")
        summary = dashboard_metrics(Movement.objects.filter(company=self.company))[0]
        self.assertEqual(summary["income"], Decimal("120"))
        self.assertTrue(summary["chart_truncated"])
        self.assertEqual(len(summary["months"]), 12)
        self.assertEqual(summary["months"][0]["month"], date(year, 1, 1))
        self.assertEqual(summary["months"][-1]["month"], date(year, 12, 1))
        self.assertEqual(summary["months"][0]["income_pct"], 100)
        self.assertEqual(summary["months"][-1]["expense_pct"], 50)
        self.assertEqual(summary["months"][1]["count"], 0)

    def test_chart_with_only_transfers_has_zero_cashflow_without_division_error(self):
        self.record("25", kind="transfer")
        summary = dashboard_metrics(Movement.objects.filter(company=self.company))[0]
        self.assertEqual(summary["net"], Decimal("0"))
        self.assertEqual(summary["chart_max"], Decimal("0"))
        self.assertEqual(summary["months"][0]["income_pct"], 0)
        self.assertEqual(summary["months"][0]["expense_pct"], 0)

    def test_draft_table_keeps_confirmed_summary_and_scoped_review_inbox(self):
        self.record("20", description="Pedido puntual")
        pending = self.record("30", status="draft", description="Pedido puntual por revisar")
        self.record("40", status="draft", description="Otro asunto")
        self.record("50", status="draft", description="Pedido puntual Yape", account=self.yape)
        self.record("60", status="draft", description="Pedido puntual USD", account=self.dollars)
        self.record("70", status="draft", description="Pedido puntual privado", account=self.foreign)
        self.record("80", status="draft", description="Pedido puntual antiguo", occurred_on=timezone.localdate() - timedelta(days=1))
        self.signin(self.viewer)
        response = self.client.get(reverse("finance:dashboard"), {"company": self.company.pk, "q": "Pedido puntual", "method": "cash",
            "currency": "PEN", "status": "draft", "from": timezone.localdate().isoformat(), "to": timezone.localdate().isoformat()})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["summaries"][0]["income"], Decimal("20"))
        self.assertEqual(response.context["pending_review_count"], 1)
        self.assertEqual(list(response.context["scoped_review_preview"]), [pending])
        self.assertEqual(list(response.context["page_obj"]), [pending])
        self.assertFalse(response.context["can_record"])
        self.assertNotContains(response, self.other.name)
        self.assertNotContains(response, "Pedido puntual privado")
        self.assertIn("private", response["Cache-Control"])
        self.assertIn("no-store", response["Cache-Control"])

    def test_posted_table_still_exposes_pending_action_and_preview_is_bounded(self):
        posted = self.record("20")
        for amount in ("1", "2", "3", "4", "5"):
            self.record(amount, status="draft")
        self.signin(self.owner)
        response = self.client.get(reverse("finance:dashboard"), {"status": "posted"})
        self.assertEqual(response.context["pending_review_count"], 5)
        self.assertEqual(len(response.context["scoped_review_preview"]), 3)
        self.assertEqual(list(response.context["page_obj"]), [posted])
        self.assertEqual(parse_qs(response.context["review_querystring"])["status"], ["draft"])

    def test_invalid_dates_do_not_leak_unfiltered_results(self):
        self.record("20")
        self.record("30", status="draft")
        self.signin(self.owner)
        response = self.client.get(reverse("finance:dashboard"), {"from": "not-a-date"})
        self.assertEqual(response.context["summaries"], [])
        self.assertEqual(response.context["pending_review_count"], 0)
        self.assertEqual(len(response.context["scoped_review_preview"]), 0)
        self.assertTrue(response.context["filter_errors"])

    def test_navigation_keeps_filters_and_restricts_company_choices(self):
        self.record("20")
        self.signin(self.viewer)
        params = {"company": self.company.pk, "q": "Prueba & resumen", "method": "cash", "currency": "PEN", "status": "posted", "from": "", "to": ""}
        response = self.client.get(reverse("finance:dashboard"), params)
        self.assertEqual([row["id"] for row in response.context["company_tabs"]], [self.company.pk])
        self.assertTrue(response.context["company_tabs"][0]["selected"])
        shortcuts = response.context["period_shortcuts"]
        self.assertTrue(shortcuts[-1]["selected"])
        history = parse_qs(shortcuts[-1]["querystring"], keep_blank_values=True)
        self.assertEqual((history["from"], history["to"]), ([""], [""]))
        self.assertEqual(history["q"], [params["q"]])
        self.assertEqual(history["company"], [str(self.company.pk)])
        self.assertEqual(history["method"], ["cash"])
        self.assertEqual(self.client.get(reverse("finance:dashboard"), {"company": self.other.pk}).status_code, 404)

    def test_company_and_method_links_use_exact_currency_and_existing_dates(self):
        self.record("20", account=self.dollars)
        self.signin(self.owner)
        response = self.client.get(reverse("finance:dashboard"), {"from": "", "to": ""})
        summary = response.context["summaries"][0]
        method = parse_qs(summary["methods"][0]["querystring"], keep_blank_values=True)
        company = parse_qs(summary["companies"][0]["querystring"], keep_blank_values=True)
        self.assertEqual(method["currency"], ["USD"])
        self.assertEqual(company["currency"], ["USD"])
        self.assertEqual(company["company"], [str(self.company.pk)])
        self.assertEqual(method["from"], [""])

    def test_dashboard_uses_historical_amount_and_preserves_line_snapshot(self):
        item = Item.objects.create(company=self.company, code="TEST_ITEM", name="Ítem de prueba", current_unit_price=Decimal("10"), currency="PEN")
        movement = self.record("20", lines=[{"item": item, "quantity": Decimal("2"), "unit_price": Decimal("10"), "unit_cost": Decimal("4")}])
        item.current_unit_price = Decimal("99")
        item.save()
        before = list(movement.lines.values())
        audits = Audit.objects.count()
        self.signin(self.owner)
        response = self.client.get(reverse("finance:dashboard"))
        self.assertEqual(response.context["summaries"][0]["income"], Decimal("20"))
        self.assertEqual(list(movement.lines.values()), before)
        self.assertEqual(Audit.objects.count(), audits)

    def test_inactive_permitted_company_remains_visible_with_history(self):
        self.record("20")
        self.company.active = False
        self.company.save()
        self.signin(self.viewer)
        response = self.client.get(reverse("finance:dashboard"))
        self.assertEqual(response.context["summaries"][0]["income"], Decimal("20"))
        self.assertFalse(response.context["company_tabs"][0]["active"])
        self.assertFalse(response.context["can_record"])

    def test_one_two_three_or_all_companies_produce_exact_scoped_totals(self):
        third = Company.objects.create(code="QA_THREE", name="Empresa de prueba C")
        fourth = Company.objects.create(code="QA_FOUR", name="Empresa de prueba D")
        accounts = [self.cash, self.foreign]
        for company in (third, fourth):
            accounts.append(Account.objects.create(company=company, code="CASH", name="Caja sintética", method="cash", currency="PEN"))
        for amount, account in zip(("10", "20", "40", "80"), accounts):
            self.record(amount, account=account)
        self.record("90", account=self.dollars)
        self.signin(self.owner)
        ids = [str(account.company_id) for account in accounts]
        for selected, expected in ((ids[:1], "10"), (ids[:2], "30"), (ids[:3], "70"), ([], "150")):
            with self.subTest(selected=selected):
                response = self.client.get(reverse("finance:dashboard"), {"company": selected})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.context["summaries"][0]["income"], Decimal(expected))
                self.assertEqual(response.context["summaries"][1]["income"], Decimal("90"))
                self.assertEqual(response.context["filters"]["company_ids"], selected)
                self.assertEqual(response.context["filters"]["company"], selected[0] if len(selected) == 1 else "")
                self.assertEqual(response.context["selected_company_count"], len(selected) or 4)
                self.assertEqual(response.context["all_companies_selected"], not selected)
                expected_ids = set(map(int, selected or ids))
                self.assertEqual({obj.company_id for obj in response.context["page_obj"]}, expected_ids)

    def test_combined_scope_preserves_method_search_currency_dates_and_review_status(self):
        second_yape = Account.objects.create(company=self.other, code="YAPE", name="Yape sintético B", method="yape", currency="PEN")
        self.record("11", account=self.yape, description="Compra objetivo A")
        self.record("22", account=second_yape, description="Compra objetivo B")
        pending = self.record("33", account=second_yape, description="Compra objetivo pendiente", status="draft")
        self.record("44", account=self.cash, description="Compra objetivo efectivo")
        self.record("55", account=self.yape, description="Otro detalle")
        self.record("66", account=self.yape, description="Compra objetivo anterior", occurred_on=timezone.localdate() - timedelta(days=1))
        self.record("77", account=self.dollars, description="Compra objetivo USD")
        self.signin(self.owner)
        ids = [str(self.company.pk), str(self.other.pk)]
        params = {"company": ids, "method": "yape", "currency": "PEN", "q": "objetivo", "status": "draft",
                  "from": timezone.localdate().isoformat(), "to": timezone.localdate().isoformat()}
        response = self.client.get(reverse("finance:dashboard"), params)
        self.assertEqual(response.context["summaries"][0]["income"], Decimal("33"))
        self.assertEqual(len(response.context["summaries"]), 1)
        self.assertEqual(response.context["pending_review_count"], 1)
        self.assertEqual(list(response.context["page_obj"]), [pending])
        links = [response.context["querystring"], response.context["review_querystring"],
                 response.context["period_shortcuts"][0]["querystring"],
                 response.context["summaries"][0]["methods"][1]["querystring"]]
        for querystring in links:
            parsed = parse_qs(querystring, keep_blank_values=True)
            self.assertEqual(parsed["company"], ids)
            self.assertNotIn("company_ids", parsed)
            self.assertEqual(parsed["q"], ["objetivo"])
            self.assertEqual(parsed["currency"], ["PEN"])
        reset = parse_qs(response.context["reset_filters_querystring"])
        self.assertEqual(reset, {"company": ids})
        self.assertNotIn("company", parse_qs(response.context["all_companies_querystring"]))

    def test_every_company_is_authorized_for_combined_dashboard_and_csv(self):
        self.record("10")
        self.record("20", account=self.foreign)
        self.signin(self.viewer)
        for route in ("finance:dashboard", "finance:export_csv"):
            for values in ([self.company.pk, self.other.pk], [self.other.pk, self.company.pk], [self.company.pk, 999999999999]):
                with self.subTest(route=route, values=values):
                    response = self.client.get(reverse(route), {"company": values})
                    self.assertEqual(response.status_code, 404)
                    self.assertNotContains(response, self.other.name, status_code=404)
            for values in ([self.company.pk, "bad"], [self.company.pk, "１２"], ["1" * 13], [str(self.company.pk)] * 101):
                with self.subTest(route=route, values=values):
                    self.assertEqual(self.client.get(reverse(route), {"company": values}).status_code, 403)
        self.assertEqual(self.client.get(reverse("finance:dashboard"), {"company": ["", ""]}).context["summaries"][0]["income"], Decimal("10"))

    def test_duplicate_and_padded_company_ids_are_normalized_without_double_counting(self):
        self.record("10")
        self.record("20", account=self.foreign)
        self.signin(self.owner)
        response = self.client.get(reverse("finance:dashboard"), {"company": [str(self.company.pk), "", f"00{self.company.pk}", f" {self.other.pk} "]})
        self.assertEqual(response.context["filters"]["company_ids"], [str(self.company.pk), str(self.other.pk)])
        self.assertEqual(response.context["summaries"][0]["income"], Decimal("30"))
        self.assertEqual(response.context["page_obj"].paginator.count, 2)

    def test_combined_export_and_pagination_keep_selection_and_historical_snapshots(self):
        item = Item.objects.create(company=self.company, code="HISTORY", name="Detalle original", current_unit_price=Decimal("10"), currency="PEN")
        movement = self.record("20", description="Reporte A", lines=[{"item": item, "quantity": Decimal("2"), "unit_price": Decimal("10"), "unit_cost": Decimal("4")}])
        for index in range(30):
            self.record("1", account=self.foreign, description=f"Reporte B {index}")
        third = Company.objects.create(code="QA_EXPORT", name="No seleccionada")
        outside = Account.objects.create(company=third, code="CASH", name="Caja externa", method="cash", currency="PEN")
        self.record("999", account=outside, description="Fuera de consulta")
        item.current_unit_price = Decimal("99")
        item.save()
        before, audits = list(movement.lines.values()), Audit.objects.count()
        self.signin(self.owner)
        ids = [str(self.company.pk), str(self.other.pk)]
        params = {"company": ids, "method": "cash", "currency": "PEN", "status": "posted", "q": "Reporte", "from": "", "to": ""}
        response = self.client.get(reverse("finance:dashboard"), {**params, "page": "2"})
        self.assertEqual(response.context["page_obj"].paginator.count, 31)
        self.assertEqual(len(response.context["page_obj"]), 1)
        self.assertEqual(parse_qs(response.context["querystring"])["company"], ids)
        export = self.client.get(reverse("finance:export_csv") + "?" + response.context["querystring"])
        self.assertEqual(export.status_code, 200)
        rows = list(csv.DictReader(io.StringIO(export.content.decode("utf-8-sig"))))
        self.assertEqual(len(rows), 31)
        self.assertEqual({row["Empresa"] for row in rows}, {self.company.name, self.other.name})
        snapshot = next(row["Detalles históricos (JSON)"] for row in rows if row["Código"] == movement.code)
        self.assertEqual(Decimal(json.loads(snapshot)[0]["precio_unitario"]), Decimal("10"))
        self.assertEqual(list(movement.lines.values()), before)
        self.assertEqual(Audit.objects.count(), audits)

    def test_record_permission_is_limited_to_selected_companies(self):
        CompanyAccess.objects.create(company=self.other, user=self.viewer, role="record")
        self.signin(self.viewer)
        response = self.client.get(reverse("finance:dashboard"), {"company": [self.company.pk]})
        self.assertFalse(response.context["can_record"])
        response = self.client.get(reverse("finance:dashboard"), {"company": [self.company.pk, self.other.pk]})
        self.assertTrue(response.context["can_record"])
        self.other.active = False
        self.other.save()
        response = self.client.get(reverse("finance:dashboard"), {"company": [self.company.pk, self.other.pk]})
        self.assertFalse(response.context["can_record"])
