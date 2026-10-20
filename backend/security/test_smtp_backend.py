import smtplib
import ssl
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .management.commands.setup_access import mail_configuration_ready
from .smtp_backend import EmailBackend


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
