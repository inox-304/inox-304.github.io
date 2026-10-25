import json
from unittest.mock import patch
from uuid import uuid4

from django.db import OperationalError
from django.test import Client, TestCase, override_settings
from django.urls import path
from security.services import reserve_attempt

from . import public_views
from .models import Activity, Opportunity, WebMetric

urlpatterns = [path("inquiries/", public_views.inquiries), path("events/", public_views.events)]
ORIGIN = "https://inox-304.github.io"


@override_settings(ROOT_URLCONF=__name__, DEBUG=False, PUBLIC_ORIGIN="https://inox304-panel.onrender.com", ALLOWED_HOSTS=["testserver"], SECURE_SSL_REDIRECT=False)
class PublicCaptureTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)

    def payload(self, **updates):
        value = {"name": "Cliente de prueba", "phone": "999 111 222", "email": "", "interest": "Necesito una cocina de seis hornillas", "source": "google", "campaign": "cocinas", "medium": "social", "submission_id": str(uuid4()), "consent": True, "website": ""}
        value.update(updates)
        return value

    def send(self, data, origin=ORIGIN, endpoint="/inquiries/"):
        return self.client.post(endpoint, json.dumps(data), content_type="application/json", HTTP_ORIGIN=origin)

    def test_intake_is_write_only_and_does_not_create_an_authenticated_session(self):
        response = self.send(self.payload())
        self.assertEqual(response.status_code, 201)
        record = Opportunity.objects.get()
        self.assertEqual(response.json(), {"ok": True, "reference": record.code})
        self.assertEqual(record.phone, "+51999111222")
        self.assertEqual(record.stage, "new")
        self.assertIsNone(record.assignee)
        self.assertIsNone(record.quote_amount)
        self.assertEqual(Activity.objects.count(), 1)
        self.assertEqual(WebMetric.objects.get(event="contact_submit").count, 1)
        self.assertNotIn("sessionid", response.cookies)
        self.assertNotIn("Access-Control-Allow-Credentials", response)
        self.assertEqual(response["Access-Control-Allow-Origin"], ORIGIN)

    def test_same_submission_is_idempotent_and_changed_payload_cannot_reuse_it(self):
        payload = self.payload(email="Client@example.com")
        first, retry = self.send(payload), self.send(payload)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(first.json(), retry.json())
        changed = self.send({**payload, "name": "Otra persona"})
        self.assertEqual(changed.status_code, 400)
        self.assertEqual(Opportunity.objects.count(), 1)
        self.assertEqual(Activity.objects.count(), 1)
        self.assertEqual(WebMetric.objects.get().count, 1)

    def test_retry_still_succeeds_after_salesperson_edits_the_contact(self):
        payload = self.payload()
        first = self.send(payload)
        record = Opportunity.objects.get()
        record.name = "Nombre corregido por ventas"
        record.company = "Empresa confirmada"
        record.save()
        retry = self.send(payload)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json(), first.json())
        self.assertEqual(Opportunity.objects.count(), 1)
        self.assertEqual(WebMetric.objects.get().count, 1)

    def test_retries_do_not_exhaust_the_new_inquiry_contact_budget(self):
        payload = self.payload()
        self.assertEqual(self.send(payload).status_code, 201)
        for _ in range(6):
            self.assertEqual(self.send(payload).status_code, 200)
        self.assertEqual(self.send(self.payload()).status_code, 201)
        self.assertEqual(Opportunity.objects.count(), 2)

    def test_origin_is_required_and_preflight_never_allows_credentials(self):
        for origin in ["", "null", "https://inox-304.github.io.evil.example", "http://inox-304.github.io", "https://evil.example"]:
            response = self.send(self.payload(), origin=origin)
            self.assertEqual(response.status_code, 403)
            self.assertNotIn("Access-Control-Allow-Origin", response)
        preflight = self.client.options("/inquiries/", HTTP_ORIGIN=ORIGIN, HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST")
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight["Access-Control-Allow-Methods"], "POST, OPTIONS")
        self.assertEqual(preflight["Access-Control-Allow-Headers"], "Content-Type")
        self.assertNotIn("Access-Control-Allow-Credentials", preflight)
        own_site = self.send(self.payload(), origin="https://inox304-panel.onrender.com")
        self.assertEqual(own_site.status_code, 201)

    def test_fields_and_content_type_prevent_privilege_changes_and_invalid_input(self):
        for field, value in [("stage", "won"), ("assignee", 1), ("quote_amount", "2000"), ("user", 1), ("is_staff", True)]:
            self.assertEqual(self.send(self.payload(**{field: value})).status_code, 400)
        for changes in [{"name": " "}, {"phone": "", "email": ""}, {"email": "bad", "phone": ""}, {"name": ["wrong"]}, {"interest": ""}, {"source": "bad"}, {"website": "https://spam.test"}, {"consent": False}, {"submission_id": "bad"}]:
            self.assertEqual(self.send(self.payload(**changes)).status_code, 400)
        response = self.client.post("/inquiries/", self.payload(), HTTP_ORIGIN=ORIGIN)
        self.assertEqual(response.status_code, 415)
        self.assertFalse(Opportunity.objects.exists())

    def test_body_bound_method_and_malformed_json(self):
        response = self.client.post("/inquiries/", b"x" * (12 * 1024 + 1), content_type="application/json", HTTP_ORIGIN=ORIGIN)
        self.assertEqual(response.status_code, 413)
        for invalid in ["{", "[]", '"text"']:
            self.assertEqual(self.client.post("/inquiries/", invalid, content_type="application/json", HTTP_ORIGIN=ORIGIN).status_code, 400)
        self.assertEqual(self.client.get("/inquiries/", HTTP_ORIGIN=ORIGIN).status_code, 405)
        self.assertFalse(Opportunity.objects.exists())

    def test_real_throttle_limits_repeated_intake_without_echoing_contact(self):
        for _ in range(5):
            self.assertEqual(self.send(self.payload()).status_code, 201)
        response = self.send(self.payload())
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response["Retry-After"], "900")
        self.assertEqual(Opportunity.objects.count(), 5)
        self.assertNotContains(response, "999111222", status_code=429)

    def test_global_intake_budget_bounds_unique_contact_throttles(self):
        for _ in range(119):
            self.assertTrue(reserve_attempt("crm-inquiry:global", "public", 120))
        self.assertEqual(self.send(self.payload()).status_code, 201)
        self.assertEqual(self.send(self.payload(phone="999111333")).status_code, 429)
        self.assertEqual(Opportunity.objects.count(), 1)

    def test_events_use_their_own_global_budget_not_shared_proxy_identity(self):
        for _ in range(299):
            self.assertTrue(reserve_attempt("crm-event:global", "public", 300))
        payload = {"event": "click_whatsapp", "source": "facebook"}
        self.assertEqual(self.send(payload, endpoint="/events/").status_code, 201)
        self.assertEqual(self.send(payload, endpoint="/events/").status_code, 429)
        self.assertEqual(WebMetric.objects.get().count, 1)
        self.assertEqual(self.send(self.payload()).status_code, 201)

    def test_whatsapp_signal_is_only_an_aggregate_and_never_an_opportunity(self):
        for _ in range(2):
            response = self.send({"event": "click_whatsapp", "source": "facebook"}, endpoint="/events/")
            self.assertEqual(response.status_code, 201)
        self.assertEqual(WebMetric.objects.get().count, 2)
        self.assertFalse(Opportunity.objects.exists())
        self.assertFalse(Activity.objects.exists())
        for payload in [{"event": "contact_submit", "source": "facebook"}, {"event": "click_whatsapp", "source": "facebook", "email": "private@example.com"}, {"event": "page_view", "source": "facebook"}]:
            self.assertEqual(self.send(payload, endpoint="/events/").status_code, 400)
        self.assertEqual(WebMetric.objects.get().count, 2)

    def test_unavailable_database_produces_generic_retryable_response(self):
        with patch("crm.public_views.reserve_attempt", side_effect=OperationalError("private database details")):
            response = self.send(self.payload())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private database", response.content.decode())
