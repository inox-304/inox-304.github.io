from datetime import timedelta
from io import StringIO
import re
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import (EmailChallenge, EmailDevice, EnrollmentPermission,
                             RecoveryCode, RecoveryDevice, SecurityEvent, SecurityState)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
                   SECURITY_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
                   EMAIL_HOST="smtp.example.com", DEFAULT_FROM_EMAIL="sender@example.com",
                   EMAIL_HOST_USER="sender@example.com", EMAIL_HOST_PASSWORD="synthetic-smtp-test-value",
                   EMAIL_USE_TLS=True, EMAIL_USE_SSL=False)
class InitialEnrollmentCommandTests(TestCase):
    password = "Initial-Owner-Password-395!"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            "owner@example.com", "owner@example.com", self.password, is_staff=True, is_superuser=True,
        )
        self.state = SecurityState.objects.create(user=self.user, mfa_method="email", session_version=8)
        self.permission = EnrollmentPermission.objects.create(
            user=self.user, expires_at=timezone.now() - timedelta(days=2),
        )

    def authorize(self, **options):
        output = StringIO()
        with patch("django.core.mail.send_mail") as send:
            call_command("authorize_initial_enrollment", email=options.pop("email", self.user.email), stdout=output, **options)
            send.assert_not_called()
        return output.getvalue()

    def protected_rows(self):
        return {
            model._meta.label: list(model.objects.order_by("pk").values())
            for model in (get_user_model(), SecurityState, EmailDevice, EmailChallenge,
                          TOTPDevice, RecoveryDevice, RecoveryCode, Session)
        }

    def test_only_requested_permission_and_audit_change_and_rerun_is_idempotent(self):
        other = get_user_model().objects.create_user("other@example.com", "other@example.com", "Other-Test-Password-417!", is_staff=True)
        other_permission = EnrollmentPermission.objects.create(user=other, expires_at=timezone.now() - timedelta(days=1))
        EmailDevice.objects.create(user=self.user, email=self.user.email, confirmed=False)
        TOTPDevice.objects.create(user=self.user, confirmed=False)
        recovery = RecoveryDevice.objects.create(user=self.user, confirmed=False)
        RecoveryCode.objects.create(device=recovery, selector="12345678", token_hash="synthetic-unused-hash")
        Session.objects.create(session_key="synthetic-session", session_data="synthetic-data", expire_date=timezone.now() + timedelta(days=1))
        before = self.protected_rows()
        other_before = EnrollmentPermission.objects.filter(pk=other_permission.pk).values().get()
        output = self.authorize(email=" OWNER@EXAMPLE.COM ")
        self.permission.refresh_from_db()
        self.assertEqual(self.protected_rows(), before)
        self.assertEqual(EnrollmentPermission.objects.filter(pk=other_permission.pk).values().get(), other_before)
        self.assertEqual(self.permission.expires_at - self.permission.created_at, timedelta(hours=24))
        self.assertGreater(self.permission.expires_at, timezone.now() + timedelta(hours=23))
        self.assertIsNone(self.permission.used_at)
        self.assertEqual(SecurityEvent.objects.get().event, "initial_enrollment_authorized_by_cli")
        self.assertNotIn(self.user.password, output)
        self.assertNotIn(self.password, output)
        saved_permission = EnrollmentPermission.objects.filter(pk=self.permission.pk).values().get()
        self.assertIn("no hubo cambios", self.authorize())
        self.assertEqual(EnrollmentPermission.objects.filter(pk=self.permission.pk).values().get(), saved_permission)
        self.assertEqual(SecurityEvent.objects.count(), 1)

    def test_every_confirmed_device_blocks_initial_authorization_without_deleting(self):
        for model in (EmailDevice, TOTPDevice, RecoveryDevice):
            with self.subTest(device=model.__name__):
                device = model.objects.create(user=self.user, confirmed=True)
                before = self.protected_rows()
                with self.assertRaisesMessage(CommandError, "dispositivo confirmado"):
                    self.authorize()
                self.assertEqual(self.protected_rows(), before)
                device.delete()
        self.assertEqual(SecurityEvent.objects.count(), 0)

    def test_previously_completed_activation_is_not_reset(self):
        self.permission.used_at = timezone.now() - timedelta(days=3)
        self.permission.save()
        before = EnrollmentPermission.objects.values().get()
        with self.assertRaisesMessage(CommandError, "activación anterior"):
            self.authorize()
        self.assertEqual(EnrollmentPermission.objects.values().get(), before)
        self.assertEqual(SecurityEvent.objects.count(), 0)

    def test_missing_inactive_and_nonstaff_accounts_are_not_created_or_promoted(self):
        with self.assertRaisesMessage(CommandError, "No existe una cuenta administrativa activa"):
            self.authorize(email="missing@example.com")
        for field in ("is_active", "is_staff"):
            get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
            with self.assertRaisesMessage(CommandError, "No existe una cuenta administrativa activa"):
                self.authorize()
            self.assertFalse(get_user_model().objects.get(pk=self.user.pk).__dict__[field])
            get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})
        self.assertEqual(get_user_model().objects.count(), 1)
        self.assertEqual(SecurityEvent.objects.count(), 0)

    def test_incomplete_account_and_mail_configuration_refuse_without_changes(self):
        before = self.permission.expires_at
        with override_settings(SECURITY_EMAIL_ENABLED=False):
            with self.assertRaisesMessage(CommandError, "servicio de correo"):
                self.authorize()
        device = EmailDevice.objects.create(user=self.user, email="previous@example.com", confirmed=False)
        with self.assertRaisesMessage(CommandError, "otro correo"):
            self.authorize()
        device.delete()
        self.user.email = "invalid"
        self.user.save(update_fields=["email"])
        with self.assertRaisesMessage(CommandError, "correo válido"):
            self.authorize(email=self.user.username)
        self.user.email = self.user.username
        self.user.set_unusable_password()
        self.user.save(update_fields=["email", "password"])
        with self.assertRaisesMessage(CommandError, "contraseña utilizable"):
            self.authorize()
        self.permission.refresh_from_db()
        self.assertEqual(self.permission.expires_at, before)
        self.assertEqual(SecurityEvent.objects.count(), 0)

    def test_totp_initial_authorization_needs_no_mail_and_does_not_create_state(self):
        self.state.mfa_method = "totp"
        self.state.save(update_fields=["mfa_method"])
        self.permission.delete()
        with override_settings(SECURITY_EMAIL_ENABLED=False):
            self.authorize()
        self.assertEqual(EnrollmentPermission.objects.count(), 1)
        self.state.delete()
        with self.assertRaisesMessage(CommandError, "método de verificación válido"):
            self.authorize()
        self.assertEqual(SecurityState.objects.count(), 0)

    def test_explicit_authorization_unblocks_password_then_requires_private_email_confirmation(self):
        credentials = {"email": self.user.email, "password": self.password}
        response = self.client.post(reverse("security:login"), credentials)
        self.assertContains(response, "requiere autorización")
        self.assertEqual(self.client.get("/admin/catalog/product/").status_code, 302)
        self.authorize()
        with override_settings(ENVIRONMENT="test", EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            response = self.client.post(reverse("security:login"), credentials)
            self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
            self.assertEqual(self.client.get("/admin/catalog/product/").status_code, 302)
            self.assertEqual(len(mail.outbox), 1)
            token = re.search(r"\b\d{6}\b", mail.outbox[-1].body).group()
            response = self.client.post(reverse("security:email_verify"), {"token": token})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["codes"]), 10)
        self.assertEqual(self.client.get("/admin/catalog/product/").status_code, 200)
        self.assertEqual(self.client.get("/admin/inventario/").status_code, 200)
        self.permission.refresh_from_db()
        self.assertIsNotNone(self.permission.used_at)
        self.assertTrue(EmailDevice.objects.get(user=self.user).confirmed)
