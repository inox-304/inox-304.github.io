import smtplib
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import EmailChallenge, EmailDevice, LoginThrottle, RecoveryCode, SecurityEvent, SecurityState
from .test_email import EMAIL_TEST_SETTINGS, EmailFlowHelpers


@override_settings(**EMAIL_TEST_SETTINGS)
class EmailDeliveryControlTests(EmailFlowHelpers, TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(
            "owner@example.com", "mailbox@example.com", cls.password, is_staff=True,
        )
        SecurityState.objects.create(user=cls.user, mfa_method="email")
        cls.device = EmailDevice.objects.create(user=cls.user, name="email", email=cls.user.email, confirmed=True)

    def test_permanent_refusal_stops_retries_across_sessions_and_keeps_recovery(self):
        recovery = self.recovery_set()
        error = smtplib.SMTPRecipientsRefused({self.user.email: (550, b"private server text")})
        with patch("security.email_auth.send_verification_message", side_effect=error) as send, \
                self.assertLogs("security.email_auth", level="WARNING") as logged:
            response = self.password_step()
            self.assertContains(response, "El envío de códigos está pausado", status_code=400)
            self.assertNotContains(response, "Volver a intentar el envío", status_code=400)
            EmailDevice.objects.filter(pk=self.device.pk).update(last_sent_at=timezone.now() - timedelta(hours=1))
            self.assertEqual(self.client.post(reverse("security:email_resend")).status_code, 400)
            self.assertEqual(self.password_step(Client()).status_code, 400)
        send.assert_called_once()
        self.assertIn("smtp_code=550", logged.output[0])
        self.assertNotIn("private server text", str(logged.output))
        self.device.refresh_from_db()
        self.assertIsNotNone(self.device.delivery_paused_at)
        self.assertEqual(self.device.delivery_smtp_code, 550)
        self.assertTrue(self.device.confirmed)
        self.assertEqual(EmailChallenge.objects.count(), 1)
        self.assertFalse(EmailChallenge.objects.filter(invalidated_at__isnull=True).exists())
        self.assertEqual(SecurityEvent.objects.filter(event="email_delivery_paused").count(), 1)
        response = self.client.post(reverse("security:otp"), {"method": "recovery", "token": recovery[0]})
        self.assertRedirects(response, reverse("admin:index"), fetch_redirect_response=False)

    def test_transient_refusal_has_no_automatic_retry_and_allows_later_manual_attempt(self):
        with patch("security.email_auth.send_verification_message", side_effect=smtplib.SMTPDataError(450, b"temporary")) as send:
            self.assertEqual(self.password_step().status_code, 400)
        send.assert_called_once()
        self.device.refresh_from_db()
        self.assertIsNone(self.device.delivery_paused_at)
        EmailDevice.objects.filter(pk=self.device.pk).update(last_sent_at=timezone.now() - timedelta(minutes=2))
        response = self.client.post(reverse("security:email_resend"))
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        self.assertEqual(len(mail.outbox), 1)

    def test_operator_control_changes_only_delivery_and_preserves_valid_code(self):
        self.recovery_set()
        challenge, code = self.start_email()
        user_before = get_user_model().objects.values().get(pk=self.user.pk)
        state_before = SecurityState.objects.values().get(user=self.user)
        recovery_before = list(RecoveryCode.objects.values().order_by("pk"))
        quotas_before = list(LoginThrottle.objects.values().order_by("pk"))
        device_before = EmailDevice.objects.values().get(pk=self.device.pk)
        for action in ("pause", "resume"):
            with self.assertRaises(CommandError):
                call_command("email_delivery", email=self.user.username, action=action, stdout=StringIO())
        self.assertEqual(EmailDevice.objects.values().get(pk=self.device.pk), device_before)
        for action in ("status", "pause", "resume", "pause"):
            call_command("email_delivery", email=self.user.username, action=action, confirm_reviewed=True, stdout=StringIO())
        device_after = EmailDevice.objects.values().get(pk=self.device.pk)
        self.assertIsNotNone(device_after.pop("delivery_paused_at"))
        device_before.pop("delivery_paused_at")
        self.assertEqual(device_before, device_after)
        self.assertEqual(get_user_model().objects.values().get(pk=self.user.pk), user_before)
        self.assertEqual(SecurityState.objects.values().get(user=self.user), state_before)
        self.assertEqual(list(RecoveryCode.objects.values().order_by("pk")), recovery_before)
        self.assertEqual(list(LoginThrottle.objects.values().order_by("pk")), quotas_before)
        challenge.refresh_from_db()
        self.assertIsNone(challenge.invalidated_at)
        self.assertRedirects(self.verify(code), reverse("admin:index"), fetch_redirect_response=False)

    def test_resuming_delivery_does_not_bypass_existing_send_quota(self):
        with override_settings(SECURITY_EMAIL_RESEND_SECONDS=0):
            self.start_email()
            for _ in range(4):
                self.client.post(reverse("security:email_resend"))
            self.assertEqual(len(mail.outbox), 5)
            for action in ("pause", "resume"):
                call_command("email_delivery", email=self.user.username, action=action, confirm_reviewed=True, stdout=StringIO())
            self.assertEqual(self.client.post(reverse("security:email_resend")).status_code, 429)
            self.assertEqual(len(mail.outbox), 5)

    def test_status_does_not_claim_delivery_or_create_devices(self):
        output = StringIO()
        call_command("email_delivery", email=self.user.username, stdout=output)
        self.assertIn("no confirma entrega", output.getvalue())
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(SecurityEvent.objects.exists())
        self.assertFalse(EmailChallenge.objects.exists())
        with self.assertRaises(CommandError):
            call_command("email_delivery", email="unknown@example.com", action="pause", confirm_reviewed=True)
        self.assertEqual(EmailDevice.objects.count(), 1)
