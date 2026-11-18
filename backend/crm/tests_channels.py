"""Source links route explicit inquiries into sales without importing conversations."""
import json
import time
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django_otp import DEVICE_ID_SESSION_KEY

from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION
from .models import Activity, Opportunity, WebMetric


ORIGIN = "https://inox-304.github.io"
SOURCES = ("facebook", "instagram", "tiktok", "google", "whatsapp", "website")


@override_settings(SECURITY_OWNER_USERNAME="channels-owner@example.test", SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", DEBUG=False,
    PUBLIC_ORIGIN="https://inox304-panel.onrender.com", ALLOWED_HOSTS=["testserver"],
    SECURE_SSL_REDIRECT=False, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class SalesChannelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.sales = get_user_model().objects.create_user("channels-sales@example.test", is_staff=True)
        cls.viewer = get_user_model().objects.create_user("channels-viewer@example.test", is_staff=True)
        cls.inventory = get_user_model().objects.create_user("channels-inventory@example.test", is_staff=True)
        cls.sales.user_permissions.set(Permission.objects.filter(content_type__app_label="crm", content_type__model="opportunity"))
        cls.viewer.user_permissions.add(Permission.objects.get(content_type__app_label="crm", codename="view_opportunity"))
        for user in (cls.sales, cls.viewer, cls.inventory):
            user.email = user.username
            user.save(update_fields=["email"])
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.username, confirmed=True)

    def signin(self, user, client=None):
        client = client or self.client
        client.force_login(user)
        session = client.session
        session[DEVICE_ID_SESSION_KEY] = EmailDevice.objects.get(user=user).persistent_id
        session[AUTH_AT] = session[LAST_SEEN] = time.time()
        session[VERSION] = SecurityState.objects.get(user=user).session_version
        session.save()
        return client

    def test_channels_require_existing_sales_permission_and_second_factor(self):
        url = reverse("crm:channels")
        self.assertEqual(self.client.get(url).status_code, 302)
        self.client.force_login(self.sales)
        self.assertEqual(self.client.get(url).status_code, 302)
        self.signin(self.inventory)
        self.assertEqual(self.client.get(url).status_code, 403)
        for user in (self.viewer, self.sales):
            self.signin(user)
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertIn("private", response["Cache-Control"])
            self.assertIn("no-store", response["Cache-Control"])
            self.assertEqual(response.context["can_add"], user == self.sales)
        self.assertFalse(Opportunity.objects.exists())
        self.assertFalse(Activity.objects.exists())
        self.assertFalse(WebMetric.objects.exists())

    def test_channels_are_read_only_and_keep_csrf_protection(self):
        self.signin(self.sales)
        self.assertEqual(self.client.post(reverse("crm:channels"), {"source": "facebook"}).status_code, 405)
        csrf_client = self.signin(self.sales, Client(enforce_csrf_checks=True))
        self.assertEqual(csrf_client.post(reverse("crm:channels"), {"source": "facebook"}).status_code, 403)
        self.assertFalse(Opportunity.objects.exists())

    def test_share_links_use_fixed_public_contact_page_and_bounded_campaign(self):
        self.signin(self.sales)
        response = self.client.get(reverse("crm:channels"), {"campaign": "  Cocinas   Cusco 2026  "})
        self.assertEqual(response.context["campaign"], "Cocinas Cusco 2026")
        links = response.context["channel_links"]
        self.assertEqual(tuple(row["source"] for row in links), SOURCES)
        for row in links:
            parsed = urlsplit(row["url"])
            self.assertEqual((parsed.scheme, parsed.netloc, parsed.path, parsed.fragment),
                ("https", "inox-304.github.io", "/contacto/", ""))
            attribution = parse_qs(parsed.query)
            self.assertEqual(set(attribution), {"utm_source", "utm_medium", "utm_campaign"})
            self.assertEqual(attribution["utm_source"], [row["source"]])
            self.assertEqual(attribution["utm_campaign"], ["Cocinas Cusco 2026"])
            self.assertTrue(attribution["utm_medium"][0])
            manual = urlsplit(row["manual_url"])
            self.assertEqual(manual.path, reverse("crm:create"))
            self.assertEqual(parse_qs(manual.query), {"source": [row["source"]]})
        response = self.client.get(reverse("crm:channels"), {"campaign": "a" * 500})
        self.assertEqual(len(response.context["campaign"]), 120)

    def test_untrusted_query_does_not_replace_destination_or_leak_into_campaign(self):
        self.signin(self.sales)
        for campaign in ("https://evil.example/private", "user@example.test", "<script>alert(1)</script>",
                         "next=private", "campaign?token=secret", "private\r\nheader", "private\x7f"):
            with self.subTest(campaign=campaign):
                response = self.client.get(reverse("crm:channels"), {
                    "campaign": campaign, "next": "https://evil.example/", "source": "evil",
                    "name": "private-client", "phone": "999111222",
                })
                self.assertEqual(response.context["campaign"], "")
                for row in response.context["channel_links"]:
                    parsed = urlsplit(row["url"])
                    self.assertEqual(parsed.netloc, "inox-304.github.io")
                    self.assertEqual(set(parse_qs(parsed.query)), {"utm_source", "utm_medium"})

    def test_manual_registration_prefills_only_valid_source_and_post_controls_saved_source(self):
        self.signin(self.sales)
        url = reverse("crm:create")
        response = self.client.get(url, {"source": "instagram", "name": "Untrusted name", "stage": "won"})
        form = response.context["form"]
        self.assertEqual(form["source"].value(), "instagram")
        self.assertFalse(form["name"].value())
        self.assertEqual(form["stage"].value(), "new")
        response = self.client.get(url, {"source": "<script>"})
        self.assertEqual(response.context["form"]["source"].value(), "unknown")
        payload = {"name": "Consulta sintética", "email": "synthetic-client@example.test", "interest": "Cocina",
                   "source": "referral", "stage": "new", "currency": "PEN"}
        response = self.client.post(url + "?source=instagram", payload)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Opportunity.objects.get().source, "referral")
        self.assertEqual(Opportunity.objects.get().name, payload["name"])

    def test_each_shared_source_becomes_a_lead_only_after_explicit_public_submission(self):
        self.signin(self.sales)
        links = self.client.get(reverse("crm:channels"), {"campaign": "cocinas-cusco"}).context["channel_links"]
        visitor = Client(enforce_csrf_checks=True)
        self.assertFalse(Opportunity.objects.exists())
        for index, row in enumerate(links):
            with self.subTest(source=row["source"]):
                attribution = {key.removeprefix("utm_"): values[0]
                    for key, values in parse_qs(urlsplit(row["url"]).query).items()}
                before = Opportunity.objects.count()
                event = visitor.post("/api/crm/events/", json.dumps({"event": "click_whatsapp", "source": row["source"]}),
                    content_type="application/json", HTTP_ORIGIN=ORIGIN)
                self.assertEqual(event.status_code, 201)
                self.assertEqual(Opportunity.objects.count(), before)
                self.assertEqual(Activity.objects.count(), before)
                payload = {"name": "Consulta sintética", "email": f"source-{index}@example.test", "phone": "",
                    "interest": "Quiero cotizar una cocina", "submission_id": str(uuid4()), "consent": True,
                    "website": "", **attribution}
                response = visitor.post("/api/crm/inquiries/", json.dumps(payload),
                    content_type="application/json", HTTP_ORIGIN=ORIGIN)
                self.assertEqual(response.status_code, 201)
                lead = Opportunity.objects.get(email=payload["email"])
                self.assertEqual(response.json(), {"ok": True, "reference": lead.code})
                self.assertEqual((lead.source, lead.campaign, lead.medium),
                    (row["source"], "cocinas-cusco", attribution["medium"]))
                self.assertEqual(lead.stage, "new")
                self.assertIsNone(lead.assignee)
                self.assertIsNone(lead.quote_amount)
                self.assertIsNone(lead.activities.get().actor)
                self.assertEqual(Opportunity.objects.count(), before + 1)
        self.assertEqual(Opportunity.objects.count(), len(SOURCES))
        self.assertEqual(Activity.objects.count(), len(SOURCES))
        self.assertEqual(WebMetric.objects.filter(event="contact_submit").count(), len(SOURCES))
        self.assertEqual(WebMetric.objects.filter(event="click_whatsapp").count(), len(SOURCES))
