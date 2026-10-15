from datetime import timedelta
from getpass import GetPassWarning
from io import StringIO
from unittest.mock import patch
import warnings

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import EmailDevice, EnrollmentPermission, RecoveryDevice, SecurityEvent, SecurityState


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
                   SECURITY_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
                   EMAIL_HOST="smtp.example.com", DEFAULT_FROM_EMAIL="sender@example.com",
                   EMAIL_HOST_USER="sender@example.com", EMAIL_HOST_PASSWORD="private-smtp-secret",
                   EMAIL_USE_TLS=True, EMAIL_USE_SSL=False)
class AccessSetupTests(TestCase):
    password = "Local-Owner-Password-892!"

    def setUp(self):
        self.user = get_user_model().objects.create_user("owner@example.com", "owner@example.com", self.password,
                                                       is_staff=True, is_superuser=True)
        self.state = SecurityState.objects.create(user=self.user, mfa_method="email")
        self.permission = EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() - timedelta(days=2))

    def run_setup(self, answers=(), **options):
        output = StringIO()
        with patch("builtins.input", side_effect=answers), patch("django.core.mail.send_mail") as send:
            call_command("setup_access", email=self.user.email, stdout=output, **options)
            send.assert_not_called()
        return output.getvalue()

    def test_status_is_read_only_and_never_prompts_or_leaks_secrets(self):
        before = self.user.password
        expiry = self.permission.expires_at
        output = self.run_setup(status=True)
        self.user.refresh_from_db()
        self.permission.refresh_from_db()
        self.assertEqual(before, self.user.password)
        self.assertEqual(expiry, self.permission.expires_at)
        self.assertEqual(SecurityEvent.objects.count(), 0)
        self.assertIn("entrega aún no comprobada", output)
        self.assertNotIn("private-smtp-secret", output)
        self.assertNotIn(before, output)

    def test_renew_initial_enrollment_preserves_password_permissions_and_devices(self):
        device = EmailDevice.objects.create(user=self.user, email=self.user.email, confirmed=False)
        before = self.user.password
        self.run_setup(["n", "s"])
        self.permission.refresh_from_db()
        self.user.refresh_from_db()
        self.state.refresh_from_db()
        self.assertGreater(self.permission.expires_at, timezone.now() + timedelta(hours=23))
        self.assertEqual(self.user.password, before)
        self.assertTrue(self.user.is_staff and self.user.is_superuser)
        self.assertEqual(self.state.mfa_method, "email")
        self.assertEqual(self.state.session_version, 0)
        self.assertTrue(EmailDevice.objects.filter(pk=device.pk, confirmed=False).exists())

    def test_renewal_requires_explicit_confirmation(self):
        expiry = self.permission.expires_at
        self.run_setup(["", ""])
        self.permission.refresh_from_db()
        self.assertEqual(expiry, self.permission.expires_at)

    @override_settings(SECURITY_EMAIL_ENABLED=False, EMAIL_HOST="", DEFAULT_FROM_EMAIL="")
    def test_missing_mail_does_not_start_activation_countdown(self):
        expiry = self.permission.expires_at
        output = self.run_setup(["n"])
        self.permission.refresh_from_db()
        self.assertEqual(expiry, self.permission.expires_at)
        self.assertIn("CONFIGURAR-CORREO.cmd", output)
        self.assertIn("sigue pendiente", output)

    def test_confirmed_email_and_recovery_are_never_reset(self):
        email = EmailDevice.objects.create(user=self.user, email=self.user.email, confirmed=True)
        recovery = RecoveryDevice.objects.create(user=self.user, confirmed=True)
        expiry = self.permission.expires_at
        self.run_setup(["n"])
        self.permission.refresh_from_db()
        self.assertEqual(expiry, self.permission.expires_at)
        self.assertTrue(EmailDevice.objects.filter(pk=email.pk, confirmed=True).exists())
        self.assertTrue(RecoveryDevice.objects.filter(pk=recovery.pk, confirmed=True).exists())

    def test_orphan_recovery_or_other_method_cannot_reenable_initial_enrollment(self):
        recovery = RecoveryDevice.objects.create(user=self.user, confirmed=True)
        with self.assertRaisesMessage(CommandError, "dispositivos protegidos"):
            self.run_setup(["n"])
        self.assertTrue(RecoveryDevice.objects.filter(pk=recovery.pk).exists())

    def test_previously_used_enrollment_requires_operator_review(self):
        self.permission.used_at = timezone.now() - timedelta(days=3)
        self.permission.save()
        with self.assertRaisesMessage(CommandError, "activación anterior"):
            self.run_setup(["n"])
        self.permission.refresh_from_db()
        self.assertIsNotNone(self.permission.used_at)

    def test_active_enrollment_not_extended(self):
        expiry = timezone.now() + timedelta(hours=1)
        self.permission.expires_at = expiry
        self.permission.save()
        self.run_setup(["n"])
        self.permission.refresh_from_db()
        self.assertEqual(expiry, self.permission.expires_at)

    def test_unconfirmed_totp_can_be_activated_without_mail(self):
        self.state.mfa_method = "totp"
        self.state.save()
        device = TOTPDevice.objects.create(user=self.user, confirmed=False)
        with override_settings(SECURITY_EMAIL_ENABLED=False):
            self.run_setup(["n", "s"])
        self.permission.refresh_from_db()
        self.assertGreater(self.permission.expires_at, timezone.now())
        self.assertTrue(TOTPDevice.objects.filter(pk=device.pk, confirmed=False).exists())

    def test_inactive_and_nonstaff_accounts_are_not_promoted(self):
        for field in ["is_active", "is_staff"]:
            setattr(self.user, field, False)
            self.user.save()
            with self.assertRaisesMessage(CommandError, "No existe una cuenta administrativa activa"):
                self.run_setup()
            self.user.refresh_from_db()
            self.assertFalse(getattr(self.user, field))
            setattr(self.user, field, True)

    def test_explicit_password_change_revokes_sessions_but_preserves_mfa(self):
        device = EmailDevice.objects.create(user=self.user, email=self.user.email, confirmed=True)
        new_password = "Updated-Private-Password-516!"
        with patch("security.management.commands.setup_access.getpass", side_effect=[new_password, new_password]):
            output = self.run_setup(["s"])
        self.user.refresh_from_db()
        self.state.refresh_from_db()
        self.assertTrue(self.user.check_password(new_password))
        self.assertEqual(self.state.session_version, 1)
        self.assertTrue(EmailDevice.objects.filter(pk=device.pk, confirmed=True).exists())
        self.assertNotIn(new_password, output)

    def test_invalid_or_mismatching_password_preserves_previous_password(self):
        for passwords in [("123", "123"), ("Different-Long-Value-42!", "not-matching")]:
            with patch("security.management.commands.setup_access.getpass", side_effect=passwords):
                with self.assertRaises(CommandError):
                    self.run_setup(["s"])
            self.user.refresh_from_db()
            self.assertTrue(self.user.check_password(self.password))
        self.assertEqual(SecurityEvent.objects.count(), 0)

    def test_create_owner_requires_mail_configuration_for_email(self):
        output = StringIO()
        with override_settings(SECURITY_EMAIL_ENABLED=False), patch("builtins.input", side_effect=["n", "1"]):
            call_command("setup_access", stdout=output)
        self.assertEqual(get_user_model().objects.count(), 1)
        self.assertIn("Todavía no se creó ninguna cuenta", output.getvalue())

    def test_password_prompt_refuses_terminal_that_would_echo_input(self):
        def unprotected_prompt(_):
            warnings.warn("Cannot disable terminal echo", GetPassWarning)
            self.fail("Must stop before an unprotected password read")

        with patch("security.management.commands.setup_access.getpass", side_effect=unprotected_prompt):
            with self.assertRaisesMessage(CommandError, "no permite ocultar"):
                self.run_setup(["s"])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.password))
        self.assertEqual(SecurityEvent.objects.count(), 0)

    def test_new_owner_refuses_terminal_that_would_echo_input(self):
        def unprotected_prompt(_):
            warnings.warn("Cannot disable terminal echo", GetPassWarning)
            self.fail("Must stop before an unprotected password read")

        with patch("builtins.input", side_effect=["n", "1", "new@example.com"]), patch("security.management.commands.create_owner.getpass", side_effect=unprotected_prompt):
            with self.assertRaisesMessage(CommandError, "no permite ocultar"):
                call_command("setup_access", stdout=StringIO())
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_new_owner_can_choose_authenticator_without_mail(self):
        password = "New-Owner-Private-Password-817!"
        with override_settings(SECURITY_EMAIL_ENABLED=False), patch("builtins.input", side_effect=["n", "2", "new@example.com"]), patch("security.management.commands.create_owner.getpass", side_effect=[password, password]):
            call_command("setup_access", stdout=StringIO())
        owner = get_user_model().objects.get(username="new@example.com")
        self.assertTrue(owner.is_active and owner.is_staff and owner.is_superuser)
        self.assertTrue(owner.check_password(password))
        self.assertEqual(SecurityState.objects.get(user=owner).mfa_method, "totp")
        self.assertGreater(EnrollmentPermission.objects.get(user=owner).expires_at, timezone.now())
