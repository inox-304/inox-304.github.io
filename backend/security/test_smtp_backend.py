import smtplib
import ssl
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .email_auth import send_verification_message
from .management.commands.setup_access import mail_configuration_ready
from .smtp_backend import EmailBackend, smtp_status


class SMTPStatusTests(SimpleTestCase):
    def test_response_exceptions_preserve_only_valid_numeric_status(self):
        for code in (450, 550, 535):
            with self.subTest(code=code):
                self.assertEqual(smtp_status(smtplib.SMTPDataError(code, b"private response")), code)

    def test_recipient_rejections_report_permanent_and_temporary_status(self):
        for code in (550, 450):
            with self.subTest(code=code):
                error = smtplib.SMTPRecipientsRefused({"private@example.test": (code, b"private response")})
                self.assertEqual(smtp_status(error), code)

    def test_malformed_codes_are_not_treated_as_smtp_status(self):
        for code in (None, True, False, "550", b"550", 0, 99, 600, 123456):
            with self.subTest(code=code):
                self.assertIsNone(smtp_status(smtplib.SMTPDataError(code, b"private response")))
                self.assertIsNone(smtp_status(smtplib.SMTPRecipientsRefused({"private@example.test": (code, b"private response")})))

    def test_missing_or_malformed_recipient_details_do_not_raise(self):
        for recipients in (None, [], "private response", {}, {"private@example.test": ()},
                           {"private@example.test": None}, {"private@example.test": "private response"}):
            with self.subTest(recipients=type(recipients).__name__):
                self.assertIsNone(smtp_status(smtplib.SMTPRecipientsRefused(recipients)))
        self.assertIsNone(smtp_status(TimeoutError("private response")))
        self.assertIsNone(smtp_status(smtplib.SMTPServerDisconnected("private response")))

    def test_mixed_recipient_statuses_are_not_reported_as_a_permanent_failure(self):
        for codes in ((550, 450), (450, 550)):
            with self.subTest(codes=codes):
                error = smtplib.SMTPRecipientsRefused({
                    "first@example.test": (codes[0], b"private response"),
                    "second@example.test": (codes[1], b"private response"),
                })
                result = smtp_status(error)
                self.assertTrue(result is None or 400 <= result < 500)


@override_settings(EMAIL_BACKEND="security.smtp_backend.EmailBackend",
                   EMAIL_HOST="smtp.example.test", EMAIL_PORT=587,
                   EMAIL_HOST_USER="sender@example.test", EMAIL_HOST_PASSWORD="synthetic-secret",
                   DEFAULT_FROM_EMAIL="INOX 304 <sender@example.test>",
                   EMAIL_USE_TLS=True, EMAIL_USE_SSL=False)
class VerificationMessageFormatTests(SimpleTestCase):
    def test_message_keeps_sender_and_recipient_with_unique_sender_domain_message_ids(self):
        message_ids = []
        with patch("smtplib.SMTP") as transport:
            transport.return_value.sendmail.return_value = {}
            for _ in range(2):
                self.assertEqual(send_verification_message(
                    "INOX 304 · Código de seguridad", "Contenido sintético privado, sin envío real.", "owner@example.test",
                ), 1)
            self.assertEqual(transport.return_value.sendmail.call_count, 2)
            for call in transport.return_value.sendmail.call_args_list:
                envelope, recipients, serialized = call.args
                self.assertEqual(envelope, "INOX 304 <sender@example.test>")
                self.assertEqual(parseaddr(envelope)[1], "sender@example.test")
                self.assertEqual(recipients, ["owner@example.test"])
                message = BytesParser(policy=policy.default).parsebytes(serialized)
                self.assertEqual(message.get_all("From"), ["INOX 304 <sender@example.test>"])
                self.assertEqual(len(message.get_all("Message-ID")), 1)
                self.assertEqual(message.get_all("To"), ["owner@example.test"])
                self.assertEqual(message.defects, [])
                self.assertEqual(message["Message-ID"].defects, ())
                message_id = str(message["Message-ID"])
                self.assertRegex(message_id, r"^<[^<>\s@]+@example\.test>$")
                message_ids.append(message_id)
        self.assertNotEqual(message_ids[0], message_ids[1])


class SMTPGreetingTests(SimpleTestCase):
    def test_single_label_windows_name_uses_valid_address_literal(self):
        with patch("socket.getfqdn", return_value="DESKTOP-PC"), \
             patch("socket.gethostbyname", return_value="192.0.2.25"), \
             patch("smtplib.SMTP.connect", return_value=(220, b"ready")):
            backend = EmailBackend(host="smtp.example.test", port=587)
            connection = backend.connection_class("smtp.example.test", 587, local_hostname="DESKTOP-PC")
        self.assertEqual(connection.local_hostname, "[192.0.2.25]")

    def test_fully_qualified_host_name_is_selected_by_standard_library(self):
        with patch("socket.getfqdn", return_value="mail.example.test"), \
             patch("smtplib.SMTP.connect", return_value=(220, b"ready")):
            backend = EmailBackend(host="smtp.example.test", port=587)
            connection = backend.connection_class("smtp.example.test", 587, local_hostname="cached-invalid-name")
        self.assertEqual(connection.local_hostname, "mail.example.test")

    def test_starttls_keeps_certificate_verification_credentials_and_timeout(self):
        with patch("smtplib.SMTP") as transport:
            backend = EmailBackend(host="smtp.example.test", port=587, username="sender@example.test", password="synthetic-secret", use_tls=True, use_ssl=False, timeout=12)
            self.assertTrue(backend.open())
            self.assertEqual(transport.call_args.args, ("smtp.example.test", 587))
            self.assertEqual(transport.call_args.kwargs, {"timeout": 12})
            connection = transport.return_value
            context = connection.starttls.call_args.kwargs["context"]
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            connection.login.assert_called_once_with("sender@example.test", "synthetic-secret")
            connection.sendmail.assert_not_called()
            backend.close()

    def test_implicit_tls_keeps_tls_transport_and_certificate_verification(self):
        with patch("smtplib.SMTP_SSL") as transport, patch("smtplib.SMTP") as plaintext:
            backend = EmailBackend(host="smtp.example.test", port=465, use_tls=False, use_ssl=True, timeout=10)
            self.assertTrue(backend.open())
            plaintext.assert_not_called()
            self.assertNotIn("local_hostname", transport.call_args.kwargs)
            self.assertTrue(transport.call_args.kwargs["context"].check_hostname)
            self.assertEqual(transport.call_args.kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
            transport.return_value.starttls.assert_not_called()
            backend.close()

    def test_failed_connection_is_reported_without_a_fake_success(self):
        with patch("smtplib.SMTP", side_effect=smtplib.SMTPServerDisconnected("synthetic connection failure")):
            with self.assertRaises(smtplib.SMTPServerDisconnected):
                EmailBackend(host="smtp.example.test", port=587, use_tls=True, fail_silently=False).open()

    @override_settings(SECURITY_EMAIL_ENABLED=True, EMAIL_BACKEND="security.smtp_backend.EmailBackend",
                       EMAIL_HOST="smtp.example.test", DEFAULT_FROM_EMAIL="sender@example.test",
                       EMAIL_HOST_USER="sender@example.test", EMAIL_HOST_PASSWORD="synthetic-secret",
                       EMAIL_USE_TLS=True, EMAIL_USE_SSL=False)
    def test_access_setup_recognizes_only_supported_configured_transports(self):
        self.assertTrue(mail_configuration_ready())
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"):
            self.assertFalse(mail_configuration_ready())
