"""Integration checks for sales permissions, MFA, audit and conflicting edits."""
import time
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp import DEVICE_ID_SESSION_KEY

from security.accounts import assign_role, current_role, role_permissions
from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION
from .models import Opportunity
from .services import create_opportunity, update_opportunity


@override_settings(SECURITY_OWNER_USERNAME="crm-owner@example.test", SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class SalesWorkspaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("crm-owner@example.test", password="Synthetic-only-123!", is_staff=True, is_superuser=True)
        cls.sales = get_user_model().objects.create_user("crm-sales@example.test", password="Synthetic-only-123!", is_staff=True)
        cls.inventory = get_user_model().objects.create_user("crm-inventory@example.test", password="Synthetic-only-123!", is_staff=True)
        cls.viewer = get_user_model().objects.create_user("crm-viewer@example.test", password="Synthetic-only-123!", is_staff=True)
        cls.sales.user_permissions.set(Permission.objects.filter(content_type__app_label="crm", content_type__model="opportunity"))
        cls.viewer.user_permissions.add(Permission.objects.get(content_type__app_label="crm", codename="view_opportunity"))
        for user in (cls.owner, cls.sales, cls.inventory, cls.viewer):
            user.email = user.username
            user.save(update_fields=["email"])
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.username, confirmed=True)
        cls.lead = create_opportunity({"name": "Cliente de prueba", "email": "synthetic@example.test", "interest": "Cocina central", "source": "facebook", "assignee": cls.sales,
            "next_followup": timezone.now() - timedelta(days=1)}, actor=cls.owner)

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
        return {"name": "Cliente de prueba", "email": "synthetic@example.test", "interest": "Cocina central", "source": "facebook", "stage": "evaluating", "currency": "PEN", "version": 1, **extra}

    def test_password_only_session_does_not_bypass_second_factor(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("crm:dashboard"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/auth/", response.url)

    def test_non_sales_cannot_read_search_export_or_write(self):
        self.signin(self.inventory)
        for name, args in [("dashboard", []), ("detail", [self.lead.pk]), ("create", []), ("export_csv", [])]:
            self.assertEqual(self.client.get(reverse(f"crm:{name}", args=args)).status_code, 403)
        self.assertEqual(self.client.post(reverse("crm:update", args=[self.lead.pk]), self.payload()).status_code, 403)
        home = self.client.get(reverse("admin:index"))
        self.assertNotContains(home, 'href="/admin/crm/"')

    def test_three_views_and_detail_render_for_authorized_sales(self):
        self.signin(self.sales)
        for tab in ("today", "pipeline", "metrics"):
            response = self.client.get(reverse("crm:dashboard"), {"tab": tab})
            self.assertEqual(response.status_code, 200)
            self.assertIn("no-store", response["Cache-Control"])
            self.assertIn("private", response["Cache-Control"])
        response = self.client.get(reverse("crm:detail", args=[self.lead.pk]))
        self.assertContains(response, "Cliente de prueba")
        self.assertEqual(self.client.get(reverse("crm:create")).status_code, 200)

    def test_editing_changes_history_and_rejects_stale_form(self):
        self.signin(self.sales)
        url = reverse("crm:update", args=[self.lead.pk])
        self.assertEqual(self.client.post(url, self.payload()).status_code, 302)
        response = self.client.post(url, self.payload(name="Edición obsoleta"))
        self.assertEqual(response.status_code, 400)
        self.assertContains(response, "Otra persona actualizó", status_code=400)
        self.lead.refresh_from_db()
        self.assertEqual(self.lead.name, "Cliente de prueba")
        self.assertEqual(self.lead.version, 2)
        self.assertEqual(self.lead.activities.count(), 2)

    def test_create_works_without_javascript_and_needs_contact(self):
        self.signin(self.sales)
        response = self.client.post(reverse("crm:create"), self.payload(email="", version=""))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Opportunity.objects.count(), 1)
        response = self.client.post(reverse("crm:create"), self.payload(version=""))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Opportunity.objects.count(), 2)

    def test_writes_are_post_only_csrf_protected_and_require_change(self):
        self.signin(self.viewer)
        for action in ("update", "contact", "note"):
            url = reverse(f"crm:{action}", args=[self.lead.pk])
            self.assertEqual(self.client.post(url, {"version": 1, "body": "Nota"}).status_code, 403)
        client = self.signin(self.sales, Client(enforce_csrf_checks=True))
        for action in ("update", "contact", "note"):
            url = reverse(f"crm:{action}", args=[self.lead.pk])
            self.assertEqual(client.get(url).status_code, 405)
            self.assertEqual(client.post(url, {"version": 1, "body": "Nota"}).status_code, 403)

    def test_notes_and_contact_record_events_without_sending_messages(self):
        self.signin(self.sales)
        self.client.post(reverse("crm:contact", args=[self.lead.pk]), {"version": 1})
        self.lead.refresh_from_db()
        self.assertIsNotNone(self.lead.first_contact_at)
        self.client.post(reverse("crm:note", args=[self.lead.pk]), {"version": 2, "body": "Confirmar medidas mañana"})
        self.lead.refresh_from_db()
        self.assertEqual(self.lead.version, 3)
        self.assertEqual(self.lead.activities.count(), 3)

    def test_search_by_code_filters_and_csv_neutralizes_formulas(self):
        self.signin(self.sales)
        update_opportunity(self.lead.pk, {"company": "  =SUM(1,2)"}, actor=self.sales, expected_version=1)
        dashboard = self.client.get(reverse("crm:dashboard"), {"q": self.lead.code})
        self.assertEqual(dashboard.context["page_obj"].paginator.count, 1)
        csv = self.client.get(reverse("crm:export_csv"), {"source": "facebook"})
        self.assertIn("'  =SUM(1,2)", csv.content.decode())
        self.assertNotIn("Cliente de prueba", self.client.get(reverse("crm:export_csv"), {"source": "google"}).content.decode())

    def test_crm_roles_are_opt_in_and_can_be_revoked_without_changing_security(self):
        roles = role_permissions()
        self.assertFalse(roles["catalog_inventory"] & roles["crm"])
        state = SecurityState.objects.get(user=self.inventory)
        before = state.session_version
        assign_role(self.inventory, "inventory_crm", roles)
        self.inventory.refresh_from_db()
        self.assertEqual(current_role(self.inventory, roles), "inventory_crm")
        assign_role(self.inventory, "inventory", roles)
        self.inventory.refresh_from_db()
        self.assertEqual(current_role(self.inventory, roles), "inventory")
        state.refresh_from_db()
        self.assertEqual(state.session_version, before)
        self.assertTrue(EmailDevice.objects.get(user=self.inventory).confirmed)

    def test_owner_can_deactivate_and_reactivate_crm_account(self):
        self.signin(self.owner)
        state = SecurityState.objects.get(user=self.sales)
        version = state.session_version
        url = reverse("security:account_update", args=[self.sales.pk])
        for action, expected in (("deactivate", False), ("reactivate", True)):
            response = self.client.post(url, {"action": action, f"status-{self.sales.pk}-owner_password": "Synthetic-only-123!"})
            self.assertEqual(response.status_code, 302)
            self.sales.refresh_from_db()
            self.assertEqual(self.sales.is_active, expected)
        state.refresh_from_db()
        self.assertEqual(state.session_version, version + 2)

    def test_export_preserves_zero_amount(self):
        self.signin(self.sales)
        update_opportunity(self.lead.pk, {"quote_amount": "0.00"}, actor=self.sales, expected_version=1)
        response = self.client.get(reverse("crm:export_csv"))
        self.assertIn("0.00,PEN", response.content.decode())
