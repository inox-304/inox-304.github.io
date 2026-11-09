"""Synthetic callbacks only. No provider, real credentials or messaging required."""
import hashlib
import hmac
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import OperationalError
from django.test import TestCase, override_settings
from django.urls import reverse

from .configuration import connection_status, get_configuration
from .models import IntakeMessage
from .services import ignore_receipt, link_receipt

CONFIG = {
    "FINANCE_WHATSAPP_ENABLED": True,
    "FINANCE_WHATSAPP_APP_SECRET": "synthetic-app-secret-not-live",
    "FINANCE_WHATSAPP_VERIFY_TOKEN": "synthetic-verify-token",
    "FINANCE_WHATSAPP_PHONE_NUMBER_ID": "123456",
    "FINANCE_WHATSAPP_OPERATOR_ID": "US.synthetic.operator",
    "FINANCE_WHATSAPP_OPERATOR_ID_KIND": "bsuid",
    "FINANCE_WHATSAPP_GROUP_YAPE": "group-yape",
    "FINANCE_WHATSAPP_GROUP_CASH": "group-cash",
    "FINANCE_WHATSAPP_GROUP_TRANSFER": "group-transfer",
    "SECURITY_OWNER_USERNAME": "finance-owner@example.test",
}


def message(**changes):
    return {"group_id": "group-yape", "from_user_id": "US.synthetic.operator",
            "from": "51999999999", "id": "wamid.synthetic.1", "timestamp": "1794243600",
            "type": "text", "text": {"body": "INOX 304 egreso PEN 120 material"}, **changes}


def payload(*messages):
    return {"object": "whatsapp_business_account", "entry": [{"id": "synthetic-waba",
        "changes": [{"field": "messages", "value": {"messaging_product": "whatsapp",
            "metadata": {"phone_number_id": "123456"}, "messages": list(messages)}}]}]}


@override_settings(**CONFIG)
class ReceiptWebhookTests(TestCase):
    def send(self, value, *, signature=None, raw=None, content_type="application/json"):
        body = raw if raw is not None else json.dumps(value, ensure_ascii=False).encode("utf-8")
        signature = signature if signature is not None else "sha256=" + hmac.new(
            CONFIG["FINANCE_WHATSAPP_APP_SECRET"].encode(), body, hashlib.sha256).hexdigest()
        return self.client.post(reverse("finance_intake:webhook"), body,
            content_type=content_type, HTTP_X_HUB_SIGNATURE_256=signature)

    def test_disabled_or_partial_configuration_is_fail_closed(self):
        with override_settings(FINANCE_WHATSAPP_ENABLED=False):
            self.assertEqual(self.send(payload(message())).status_code, 503)
            self.assertFalse(connection_status()["configured"])
        with override_settings(FINANCE_WHATSAPP_APP_SECRET=""):
            self.assertEqual(self.send(payload(message())).status_code, 503)
        with override_settings(FINANCE_WHATSAPP_GROUP_CASH="group-yape"):
            self.assertIsNone(get_configuration())
        self.assertEqual(IntakeMessage.objects.count(), 0)

    def test_challenge_requires_matching_secret(self):
        url = reverse("finance_intake:webhook")
        data = {"hub.mode": "subscribe", "hub.verify_token": "synthetic-verify-token", "hub.challenge": "123"}
        self.assertEqual(self.client.get(url, data).content, b"123")
        data["hub.verify_token"] = "wrong"
        self.assertEqual(self.client.get(url, data).status_code, 403)
        data["hub.verify_token"] = ""
        self.assertEqual(self.client.get(url, data).status_code, 403)

    def test_signature_is_mandatory_and_verified_on_exact_bytes(self):
        for signature in ("", "sha256=" + "0" * 64, "sha1=" + "0" * 64):
            self.assertEqual(self.send(payload(message()), signature=signature).status_code, 403)
        signed = json.dumps(payload(message())).encode()
        signature = "sha256=" + hmac.new(CONFIG["FINANCE_WHATSAPP_APP_SECRET"].encode(), signed, hashlib.sha256).hexdigest()
        self.assertEqual(self.send(None, raw=signed + b" ", signature=signature).status_code, 403)
        self.assertFalse(IntakeMessage.objects.exists())

    def test_three_folders_share_operator_without_assuming_company(self):
        from finance.models import Movement
        receipt_messages = [message(id=f"wamid.{index}", group_id=group) for index, group in enumerate(
            ("group-yape", "group-cash", "group-transfer"))]
        response = self.send(payload(*receipt_messages))
        self.assertEqual(response.json(), {"received": 3, "queued": 3})
        self.assertEqual(set(IntakeMessage.objects.values_list("method", flat=True)), {"yape", "cash", "transfer"})
        self.assertFalse(IntakeMessage.objects.exclude(movement=None).exists())
        self.assertFalse(Movement.objects.exists())

    def test_retries_are_idempotent_without_duplicate_movements(self):
        self.assertEqual(self.send(payload(message())).json()["queued"], 1)
        self.assertEqual(self.send(payload(message())).json()["queued"], 0)
        self.assertEqual(IntakeMessage.objects.count(), 1)

    def test_same_id_changed_content_is_rejected_without_overwriting(self):
        self.send(payload(message()))
        response = self.send(payload(message(text={"body": "changed value"})))
        self.assertEqual(response.status_code, 409)
        self.assertIn("PEN 120", IntakeMessage.objects.get().text)

    def test_unauthorized_operator_group_and_business_are_rejected(self):
        for extra in ({"from_user_id": "US.other"}, {"group_id": "another-group"}, {"group_id": ""}):
            self.assertIn(self.send(payload(message(**extra))).status_code, (400, 403))
        value = payload(message())
        value["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = "another-number"
        self.assertEqual(self.send(value).status_code, 403)
        self.assertFalse(IntakeMessage.objects.exists())

    def test_bsuid_can_be_used_without_phone_and_phone_does_not_bypass_it(self):
        value = message()
        value.pop("from")
        self.assertEqual(self.send(payload(value)).status_code, 200)
        value = message(id="wamid.2", from_user_id="US.other")
        self.assertEqual(self.send(payload(value)).status_code, 403)

    def test_explicit_phone_mode_is_supported_without_implicit_identity_fallback(self):
        with override_settings(FINANCE_WHATSAPP_OPERATOR_ID_KIND="phone", FINANCE_WHATSAPP_OPERATOR_ID="51999999999"):
            self.assertEqual(self.send(payload(message())).status_code, 200)
            changed = message(id="wamid.2")
            changed["from"] = "51988888888"
            self.assertEqual(self.send(payload(changed)).status_code, 403)

    def test_status_only_and_other_event_fields_do_not_become_receipts(self):
        value = payload()
        value["entry"][0]["changes"][0]["value"]["statuses"] = [{"id": "wamid.outgoing", "status": "delivered"}]
        self.assertEqual(self.send(value).json(), {"received": 0, "queued": 0})
        value["entry"][0]["changes"].append({"field": "group_participants_update", "value": {}})
        value["entry"][0]["changes"][0]["value"]["messages"] = [message()]
        self.assertEqual(self.send(value).json(), {"received": 1, "queued": 1})

    def test_media_only_stores_reference_never_downloads_or_runs_ai(self):
        value = message(type="document", document={"id": "media-test", "mime_type": "application/pdf",
            "filename": "factura.pdf", "caption": "Empresa por confirmar", "url": "https://untrusted.invalid/file"})
        self.assertEqual(self.send(payload(value)).status_code, 200)
        row = IntakeMessage.objects.get()
        self.assertEqual(row.status, "needs_review")
        self.assertNotIn("url", row.media)
        self.assertEqual(row.text, "Empresa por confirmar")

    def test_oversize_invalid_shapes_types_and_timestamps_fail_without_writes(self):
        self.assertEqual(self.send(None, raw=b" " * (3 * 1024 * 1024 + 1)).status_code, 413)
        for value in ([], {"object": "wrong"}, payload(message(timestamp="oops")), payload(message(text=[])),
                      payload(message(type="document", document={})), payload(message(id="a" * 513))):
            self.assertEqual(self.send(value).status_code, 400)
        self.assertEqual(self.send(None, raw=b"not-json").status_code, 400)
        self.assertEqual(self.send(payload(message()), content_type="text/plain").status_code, 415)
        self.assertFalse(IntakeMessage.objects.exists())

    def test_batch_validation_happens_before_any_store(self):
        self.assertEqual(self.send(payload(message(), message(id="second", from_user_id="attacker"))).status_code, 403)
        self.assertFalse(IntakeMessage.objects.exists())

    def test_duplicate_conflict_rolls_back_entire_batch(self):
        self.send(payload(message()))
        response = self.send(payload(message(id="second"), message(text={"body": "different"})))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(IntakeMessage.objects.count(), 1)

    def test_unavailable_database_is_not_acknowledged(self):
        self.client.raise_request_exception = False
        with patch("finance_intake.webhook.capture_receipts", side_effect=OperationalError("synthetic database unavailable")):
            response = self.send(payload(message()))
        self.assertEqual(response.status_code, 500)

    def test_configuration_status_does_not_expose_secrets_or_ids(self):
        serialized = json.dumps(connection_status())
        for key in ("FINANCE_WHATSAPP_APP_SECRET", "FINANCE_WHATSAPP_VERIFY_TOKEN", "FINANCE_WHATSAPP_OPERATOR_ID"):
            self.assertNotIn(CONFIG[key], serialized)
        self.assertFalse(connection_status()["ai_enabled"])


@override_settings(**CONFIG)
class InboxReviewTests(TestCase):
    def setUp(self):
        from datetime import date
        from decimal import Decimal
        from finance.models import Account, Company
        from finance.services import create_draft
        users = get_user_model()
        self.owner = users.objects.create_user("finance-owner@example.test", is_staff=True, is_superuser=True)
        self.other = users.objects.create_user("finance-other@example.test", is_staff=True, is_superuser=True)
        self.company = Company.objects.create(code="TEST", name="Empresa sintética")
        self.account = Account.objects.create(company=self.company, code="YAPE", name="Caja sintética", method="yape", currency="PEN")
        self.movement = create_draft({"company": self.company, "account": self.account, "kind": "expense", "amount": Decimal("120.00"),
            "currency": "PEN", "occurred_on": date(2026, 11, 9), "description": "Prueba"}, actor=self.owner)
        self.receipt = IntakeMessage.objects.create(provider_message_id="wamid.manual", fingerprint="a" * 64,
            group_id="group-yape", method="yape", sender_id="US.synthetic.operator", sender_id_kind="bsuid",
            message_type="text", text="Referencia de prueba")

    def test_only_configured_owner_can_review_unassigned_company_receipts(self):
        with self.assertRaises(PermissionDenied):
            ignore_receipt(self.receipt.pk, "No es financiero", actor=self.other)
        with self.assertRaises(PermissionDenied):
            link_receipt(self.receipt.pk, self.movement, actor=self.other)

    def test_link_draft_is_audited_once_without_posting(self):
        row = link_receipt(self.receipt.pk, self.movement, actor=self.owner)
        self.assertEqual(row.status, "linked")
        self.assertEqual(row.events.count(), 1)
        self.movement.refresh_from_db()
        self.assertEqual(self.movement.status, "draft")
        with self.assertRaises(ValidationError):
            link_receipt(self.receipt.pk, self.movement, actor=self.owner)

    def test_method_mismatch_is_not_silently_assigned(self):
        self.receipt.method = "cash"
        self.receipt.save(update_fields=["method"])
        with self.assertRaises(ValidationError):
            link_receipt(self.receipt.pk, self.movement, actor=self.owner)
        self.receipt.refresh_from_db()
        self.assertIsNone(self.receipt.movement_id)

    def test_ignore_preserves_original_and_demands_reason(self):
        with self.assertRaises(ValidationError):
            ignore_receipt(self.receipt.pk, "", actor=self.owner)
        row = ignore_receipt(self.receipt.pk, "Es una consulta sin movimiento", actor=self.owner)
        self.assertEqual(row.status, "ignored")
        self.assertEqual(row.text, "Referencia de prueba")
        self.assertEqual(row.events.count(), 1)
