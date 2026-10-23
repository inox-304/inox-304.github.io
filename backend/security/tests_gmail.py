"""Gmail HTTPS delivery contract; all HTTP is mocked and recipients synthetic."""
import base64
import json
from email import policy
from email.parser import BytesParser
from unittest.mock import MagicMock, Mock, patch
from urllib.parse import parse_qs

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from google.oauth2.credentials import Credentials

from .email_auth import _log_delivery_failure
from .gmail_backend import EmailBackend, GmailDeliveryError, SEND_ENDPOINT, SEND_SCOPE, TOKEN_ENDPOINT
from .mail_config import gmail_configuration_ready, mail_transport_ready
from .management.commands.setup_access import mail_configuration_ready
from .models import EmailChallenge, EmailDevice, SecurityEvent, SecurityState
from .smtp_backend import SUPPORTED_SMTP_BACKENDS, smtp_status


GMAIL_TEST_SETTINGS = {
    "ENVIRONMENT": "test",
    "EMAIL_BACKEND": "security.gmail_backend.EmailBackend",
    "DEFAULT_FROM_EMAIL": "INOX 304 <sender@example.test>",
    "GMAIL_API_SENDER": "sender@example.test",
    "GMAIL_API_CLIENT_ID": "synthetic-client-id",
    "GMAIL_API_CLIENT_SECRET": "synthetic-client-secret",
    "GMAIL_API_REFRESH_TOKEN": "synthetic-refresh-token",
    "EMAIL_TIMEOUT": 11,
    "EMAIL_HOST": "",
    "EMAIL_HOST_USER": "",
    "EMAIL_HOST_PASSWORD": "",
    "SECURITY_EMAIL_ENABLED": True,
    "PASSWORD_HASHERS": ["django.contrib.auth.hashers.MD5PasswordHasher"],
    "ALLOWED_HOSTS": ["testserver"],
}


def response(status, payload):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps(payload).encode()
    result._content_consumed = True
    result.headers["Content-Type"] = "application/json"
    result.close = Mock(wraps=result.close)
    return result


class FakeGmailTransport:
    def setUp(self):
        super().setUp()
        self.session = MagicMock(spec=requests.Session)
        self.session.request.return_value = response(200, {
            "access_token": "synthetic-access-token", "expires_in": 3600,
            "token_type": "Bearer", "scope": SEND_SCOPE,
        })
        self.session.post.return_value = response(200, {"id": "synthetic-message-id"})
        factory = patch("security.gmail_backend.requests.Session")
        self.factory = factory.start()
        self.addCleanup(factory.stop)
        self.factory.return_value.__enter__.return_value = self.session

    def message(self, **kwargs):
        return EmailMessage("Código de seguridad", "Contenido sintético privado.",
                            kwargs.pop("from_email", settings.DEFAULT_FROM_EMAIL),
                            kwargs.pop("to", ["owner@example.test"]), **kwargs)


@override_settings(**GMAIL_TEST_SETTINGS)
class GmailBackendTests(FakeGmailTransport, SimpleTestCase):
    def test_complete_mime_uses_only_gmail_send_scope_and_exact_https_endpoint(self):
        message = EmailMultiAlternatives(
            "INOX 304 · Código", "Texto con acentos: verificación.", settings.DEFAULT_FROM_EMAIL,
            ["owner@example.test"], headers={"Message-ID": "<synthetic-id@example.test>",
                                          "Date": "Thu, 22 Oct 2026 10:00:00 +0000"})
        message.attach_alternative("<p>Verificación.</p>", "text/html")
        message.attach("synthetic.txt", b"attachment contents", "application/octet-stream")
        mime = message.message()
        expected = mime.as_bytes()
        with patch.object(message, "message", return_value=mime), \
                patch("security.gmail_backend.Credentials", wraps=Credentials) as credentials:
            self.assertEqual(EmailBackend().send_messages([message]), 1)
        credentials.assert_called_once_with(
            token=None, refresh_token="synthetic-refresh-token", token_uri=TOKEN_ENDPOINT,
            client_id="synthetic-client-id", client_secret="synthetic-client-secret", scopes=[SEND_SCOPE])
        self.assertEqual(SEND_SCOPE, "https://www.googleapis.com/auth/gmail.send")
        self.assertEqual(SEND_ENDPOINT, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        self.session.post.assert_called_once()
        call = self.session.post.call_args
        self.assertEqual(call.args, (SEND_ENDPOINT,))
        self.assertEqual(call.kwargs["headers"], {"Authorization": "Bearer synthetic-access-token"})
        self.assertEqual(set(call.kwargs["json"]), {"raw"})
        serialized = base64.urlsafe_b64decode(call.kwargs["json"]["raw"])
        self.assertEqual(serialized, expected)
        parsed = BytesParser(policy=policy.default).parsebytes(serialized)
        self.assertEqual(parsed["To"], "owner@example.test")
        self.assertEqual(parsed["From"], settings.DEFAULT_FROM_EMAIL)
        self.assertEqual(parsed["Message-ID"], "<synthetic-id@example.test>")
        self.assertEqual(parsed.defects, [])
        attachment = list(parsed.iter_attachments())[0]
        self.assertEqual(attachment.get_payload(decode=True), b"attachment contents")
        self.session.post.return_value.close.assert_called_once()

    def test_oauth_and_message_timeout_redirects_and_tls_are_bounded(self):
        self.assertEqual(EmailBackend().send_messages([self.message()]), 1)
        self.session.request.assert_called_once()
        token_call = self.session.request.call_args
        self.assertEqual(token_call.args, ("POST", "https://oauth2.googleapis.com/token"))
        grant = parse_qs(token_call.kwargs["data"].decode())
        self.assertEqual(grant["scope"], [SEND_SCOPE])
        self.assertEqual(grant["grant_type"], ["refresh_token"])
        self.assertEqual(grant["refresh_token"], ["synthetic-refresh-token"])
        for kwargs in (token_call.kwargs, self.session.post.call_args.kwargs):
            self.assertEqual(kwargs["timeout"], 11)
            self.assertIs(kwargs["allow_redirects"], False)
            self.assertIs(kwargs.get("verify", True), True)

    def test_http_401_429_500_are_never_retried_or_classified_as_smtp(self):
        for status in (401, 429, 500):
            with self.subTest(status=status):
                self.session.post.reset_mock()
                failure = response(status, {"error": "synthetic-secret-response owner@example.test 123456"})
                self.session.post.return_value = failure
                with self.assertRaises(GmailDeliveryError) as caught:
                    EmailBackend().send_messages([self.message()])
                self.assertEqual(caught.exception.http_status, status)
                self.assertIsNone(smtp_status(caught.exception))
                self.assertEqual(str(caught.exception), "Gmail HTTPS delivery failed.")
                self.session.post.assert_called_once()
                failure.close.assert_called_once()
                with self.assertLogs("security.email_auth", level="WARNING") as captured:
                    _log_delivery_failure(caught.exception)
                self.assertIn("GmailDeliveryError", " ".join(captured.output))
                for secret in ("synthetic-secret-response", "owner@example.test", "123456",
                               "synthetic-access-token", "synthetic-refresh-token", "synthetic-client-secret"):
                    self.assertNotIn(secret, " ".join(captured.output))

    def test_timeout_is_not_retried_and_provider_exception_text_is_discarded(self):
        self.session.post.side_effect = requests.Timeout("private-token owner@example.test 123456")
        with self.assertRaises(GmailDeliveryError) as caught:
            EmailBackend().send_messages([self.message()])
        self.session.post.assert_called_once()
        self.assertIsNone(caught.exception.http_status)
        self.assertIsNone(smtp_status(caught.exception))
        self.assertNotIn("private-token", str(caught.exception))

    def test_redirect_is_rejected_without_a_second_message_request(self):
        self.session.post.return_value = response(302, {"location": "https://untrusted.example.test"})
        with self.assertRaises(GmailDeliveryError):
            EmailBackend().send_messages([self.message()])
        self.session.post.assert_called_once()
        self.assertIs(self.session.post.call_args.kwargs["allow_redirects"], False)

    def test_oauth_failure_does_not_send_or_expose_refresh_secrets(self):
        self.session.request.return_value = response(400, {
            "error": "invalid_grant", "error_description": "synthetic-refresh-token synthetic-client-secret"})
        with self.assertRaises(GmailDeliveryError) as caught:
            EmailBackend().send_messages([self.message()])
        self.session.post.assert_not_called()
        self.assertEqual(str(caught.exception), "Gmail HTTPS delivery failed.")

    def test_unconfirmed_response_body_does_not_report_success(self):
        for payload in ({}, {"id": ""}, [], "unexpected"):
            with self.subTest(payload=payload):
                self.session.post.return_value = response(200, payload)
                with self.assertRaises(GmailDeliveryError):
                    EmailBackend().send_messages([self.message()])

    def test_sender_mismatch_is_rejected_before_message_delivery(self):
        with self.assertRaises(GmailDeliveryError):
            EmailBackend().send_messages([self.message(from_email="other@example.test")])
        self.session.post.assert_not_called()
        with override_settings(DEFAULT_FROM_EMAIL="other@example.test"):
            self.factory.reset_mock()
            with self.assertRaises(GmailDeliveryError):
                EmailBackend().send_messages([self.message()])
            self.factory.assert_not_called()

    def test_empty_list_and_no_recipients_never_send(self):
        for messages in (None, []):
            self.assertEqual(EmailBackend().send_messages(messages), 0)
        self.factory.assert_not_called()
        self.assertEqual(EmailBackend().send_messages([self.message(to=[])]), 0)
        self.session.post.assert_not_called()

    def test_fail_silently_returns_only_messages_confirmed_sent(self):
        self.session.post.side_effect = [response(200, {"id": "first"}), response(500, {"error": "synthetic"})]
        self.assertEqual(EmailBackend(fail_silently=True).send_messages([self.message(), self.message()]), 1)
        self.assertEqual(self.session.post.call_count, 2)
        self.session.post.side_effect = requests.Timeout("synthetic-private-token")
        self.assertEqual(EmailBackend(fail_silently=True).send_messages([self.message()]), 0)
        with override_settings(GMAIL_API_REFRESH_TOKEN=""):
            self.assertEqual(EmailBackend(fail_silently=True).send_messages([self.message()]), 0)


@override_settings(**GMAIL_TEST_SETTINGS)
class GmailReadinessTests(SimpleTestCase):
    def test_https_configuration_is_ready_without_smtp(self):
        self.assertTrue(gmail_configuration_ready(settings))
        self.assertTrue(mail_transport_ready(settings))
        self.assertTrue(mail_configuration_ready())
        with override_settings(SECURITY_EMAIL_ENABLED=False):
            self.assertFalse(mail_configuration_ready())

    def test_missing_configuration_or_mismatched_sender_is_not_ready(self):
        for field in ("GMAIL_API_CLIENT_ID", "GMAIL_API_CLIENT_SECRET", "GMAIL_API_REFRESH_TOKEN",
                      "GMAIL_API_SENDER", "DEFAULT_FROM_EMAIL"):
            with self.subTest(field=field), override_settings(**{field: ""}):
                self.assertFalse(gmail_configuration_ready(settings))
                self.assertFalse(mail_configuration_ready())
        with override_settings(DEFAULT_FROM_EMAIL="Someone <other@example.test>"):
            self.assertFalse(mail_configuration_ready())
        with override_settings(DEFAULT_FROM_EMAIL="INOX <SENDER@example.test>"):
            self.assertTrue(mail_configuration_ready())

    def test_existing_smtp_transports_remain_supported_without_gmail_credentials(self):
        for backend in SUPPORTED_SMTP_BACKENDS:
            with self.subTest(backend=backend), override_settings(
                    EMAIL_BACKEND=backend, EMAIL_HOST="smtp.example.test", EMAIL_USE_TLS=True,
                    EMAIL_USE_SSL=False, EMAIL_HOST_USER="sender@example.test", EMAIL_HOST_PASSWORD="synthetic",
                    GMAIL_API_CLIENT_ID="", GMAIL_API_CLIENT_SECRET="", GMAIL_API_REFRESH_TOKEN=""):
                self.assertTrue(mail_configuration_ready())
                self.assertFalse(gmail_configuration_ready(settings))
                with override_settings(EMAIL_HOST_PASSWORD=""):
                    self.assertFalse(mail_configuration_ready())
                with override_settings(EMAIL_USE_TLS=False):
                    self.assertFalse(mail_configuration_ready())
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"):
            self.assertFalse(mail_configuration_ready())


@override_settings(**GMAIL_TEST_SETTINGS)
class GmailMFAFailureTests(FakeGmailTransport, TestCase):
    def test_http_failures_invalidate_challenges_without_pausing_account_or_leaking_data(self):
        password = "Synthetic-password-for-tests"
        for status in (401, 429, 500):
            with self.subTest(status=status):
                user = get_user_model().objects.create_user(
                    f"owner-{status}@example.test", f"owner-{status}@example.test", password,
                    is_staff=True, is_superuser=True)
                SecurityState.objects.create(user=user, mfa_method="email")
                device = EmailDevice.objects.create(user=user, email=user.email, confirmed=True)
                self.session.post.reset_mock()
                self.session.post.return_value = response(status, {"error": "secret-provider-body 123456"})
                with patch("security.email_auth.secrets.randbelow", return_value=123456), \
                        self.assertLogs("security.email_auth", level="WARNING") as captured:
                    result = self.client.post(reverse("security:login"), {"email": user.username, "password": password})
                self.assertEqual(result.status_code, 400)
                self.assertNotIn("_auth_user_id", self.client.session)
                device.refresh_from_db()
                self.assertIsNone(device.delivery_paused_at)
                self.assertIsNone(device.delivery_smtp_code)
                self.assertIsNotNone(EmailChallenge.objects.get(device=device).invalidated_at)
                self.assertFalse(SecurityEvent.objects.filter(user=user, event="email_delivery_paused").exists())
                self.assertTrue(SecurityEvent.objects.filter(user=user, event="email_delivery_failed").exists())
                self.session.post.assert_called_once()
                visible = result.content.decode() + " ".join(captured.output)
                for secret in (user.email, "secret-provider-body", "123456", "synthetic-access-token",
                               "synthetic-refresh-token", "synthetic-client-secret"):
                    self.assertNotIn(secret, visible)
                self.client.logout()
