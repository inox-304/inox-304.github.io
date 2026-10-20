import re
import smtplib
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core import mail
from django.core.management import call_command
from django.db import close_old_connections, connection, connections, transaction
from django.test import Client, RequestFactory, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .email_auth import EMAIL_REGENERATE_KEY, verify_email_challenge
from .models import (
    EmailChallenge,
    EmailDevice,
    EnrollmentPermission,
    RecoveryCode,
    SecurityEvent,
    SecurityState,
)
from .services import PENDING_KEY, generate_recovery_codes


EMAIL_TEST_SETTINGS = {
    "ENVIRONMENT": "test",
    "ALLOWED_HOSTS": ["testserver"],
    "EMAIL_BACKEND": "django.core.mail.backends.locmem.EmailBackend",
    "DEFAULT_FROM_EMAIL": "access@example.com",
    "SECURITY_EMAIL_ENABLED": True,
    "SECURITY_EMAIL_CODE_SECONDS": 300,
    "SECURITY_EMAIL_RESEND_SECONDS": 60,
    "PASSWORD_HASHERS": ["django.contrib.auth.hashers.MD5PasswordHasher"],
}


class EmailFlowHelpers:
    password = "Test-Only-Mail-Password-934!"

    def password_step(self, client=None, **extra):
        data = {"email": self.user.username, "password": self.password, **extra}
        return (client or self.client).post(reverse("security:login"), data)

    def start_email(self, client=None):
        client = client or self.client
        previous_messages = len(mail.outbox)
        self.assertRedirects(
            self.password_step(client), reverse("security:email_verify"),
            fetch_redirect_response=False,
        )
        self.assertEqual(len(mail.outbox), previous_messages + 1)
        pending = client.session[PENDING_KEY]
        self.assertNotIn("_auth_user_id", client.session)
        self.assertEqual(pending["mode"], "email")
        challenge = EmailChallenge.objects.get(pk=pending["email_challenge_id"])
        return challenge, self.message_code()

    def message_code(self):
        codes = re.findall(r"\b[0-9]{6}\b", mail.outbox[-1].body)
        self.assertEqual(len(codes), 1, "Each message must contain exactly one six-digit code.")
        return codes[0]

    def verify(self, code, client=None, **extra):
        return (client or self.client).post(reverse("security:email_verify"), {"token": code, **extra})

    def assert_anonymous(self, client=None):
        self.assertNotIn("_auth_user_id", (client or self.client).session)

    def recovery_set(self):
        with transaction.atomic():
            return generate_recovery_codes(self.user)[1]


@override_settings(**EMAIL_TEST_SETTINGS)
class EmailMFAFlowTests(EmailFlowHelpers, TestCase):
    @classmethod
    def setUpTestData(cls):
        # The login identifier deliberately differs from the delivery address.
        cls.user = get_user_model().objects.create_user(
            "owner@example.com", "authorized-mailbox@example.com", cls.password,
            is_staff=True, is_superuser=True,
        )
        SecurityState.objects.create(user=cls.user, mfa_method="email")
        cls.device = EmailDevice.objects.create(user=cls.user, name="email", email=cls.user.email, confirmed=True)

    def test_invalid_credentials_never_send_or_create_challenges(self):
        for data in [
            {"email": self.user.username, "password": "wrong-password"},
            {"email": "unknown@example.com", "password": self.password},
        ]:
            with self.subTest(email=data["email"]):
                response = self.client.post(reverse("security:login"), data)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(mail.outbox), 0)
                self.assertFalse(EmailChallenge.objects.exists())
                self.assertNotIn(PENDING_KEY, self.client.session)
                self.assert_anonymous()

    def test_inactive_or_nonstaff_account_never_sends(self):
        for field in ["is_active", "is_staff"]:
            with self.subTest(field=field):
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
                self.assertEqual(self.password_step().status_code, 200)
                self.assertEqual(len(mail.outbox), 0)
                self.assertFalse(EmailChallenge.objects.exists())
                self.assertNotIn(PENDING_KEY, self.client.session)
                self.assert_anonymous()
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})

    @override_settings(SECURITY_EMAIL_ENABLED=False)
    def test_disabled_email_delivery_cannot_authenticate(self):
        self.password_step()
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(EmailChallenge.objects.filter(invalidated_at__isnull=True).exists())
        self.assert_anonymous()

    def test_nondelivery_backends_cannot_create_usable_codes(self):
        for backend in ["console", "filebased", "dummy"]:
            with self.subTest(backend=backend), override_settings(EMAIL_BACKEND=f"django.core.mail.backends.{backend}.EmailBackend"):
                with patch("security.email_auth.send_mail") as send:
                    self.assertEqual(self.password_step().status_code, 400)
                send.assert_not_called()
                self.assertFalse(EmailChallenge.objects.exists())
                self.assert_anonymous()

    @override_settings(EMAIL_BACKEND="security.smtp_backend.EmailBackend", EMAIL_HOST="smtp.example.test",
                       EMAIL_PORT=587, EMAIL_USE_TLS=True, EMAIL_USE_SSL=False,
                       EMAIL_HOST_USER="sender@example.test", EMAIL_HOST_PASSWORD="synthetic-secret")
    def test_smtp_backend_delivers_only_to_account_and_still_requires_email_verification(self):
        with patch("smtplib.SMTP") as transport:
            transport.return_value.sendmail.return_value = {}
            response = self.password_step(recipient="attacker@example.test")
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        sender, recipients, message = transport.return_value.sendmail.call_args.args
        self.assertEqual(sender, "access@example.com")
        self.assertEqual(recipients, [self.user.email])
        self.assertNotIn(b"attacker@example.test", message)
        self.assertEqual(EmailChallenge.objects.filter(invalidated_at__isnull=True).count(), 1)
        self.assert_anonymous()

    def test_delivery_uses_account_address_and_ignores_posted_recipients(self):
        response = self.password_step(
            recipient="attacker@example.com", to="attacker@example.com",
            delivery_email="attacker@example.com", next="https://attacker.example/",
        )
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        self.assertEqual(mail.outbox[0].cc, [])
        self.assertEqual(mail.outbox[0].bcc, [])
        challenge = EmailChallenge.objects.get()
        self.assertEqual(challenge.recipient, self.user.email)
        self.assertNotIn("attacker@example.com", mail.outbox[0].body)
        self.assert_anonymous()

    def test_password_only_cannot_read_or_write_admin(self):
        self.start_email()
        for path in ["/admin/", "/admin/auth/user/", "/admin/auth/user/add/"]:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 302)
                self.assertEqual(self.client.get(path, HTTP_ACCEPT="application/json").status_code, 401)
                self.assertEqual(self.client.post(path, {}, HTTP_ACCEPT="application/json").status_code, 401)
        self.assertEqual(get_user_model().objects.count(), 1)
        self.assert_anonymous()

    def test_code_is_six_digits_hashed_and_expires_after_five_minutes(self):
        challenge, code = self.start_email()
        self.assertRegex(code, r"^[0-9]{6}$")
        self.assertNotEqual(challenge.token_hash, code)
        self.assertGreater(len(challenge.token_hash), len(code))
        self.assertNotIn(code, self.client.session.values())
        self.assertNotIn(code, self.client.session[PENDING_KEY].values())
        for event in SecurityEvent.objects.all():
            self.assertNotIn(code, event.detail)
        self.assertEqual(challenge.purpose, "login")
        self.assertAlmostEqual((challenge.expires_at - challenge.created_at).total_seconds(), 300, delta=2)
        page = self.client.get(reverse("security:email_verify"))
        self.assertNotContains(page, code)
        self.assertIn("no-store", page["Cache-Control"])
        self.assertEqual(page["X-Robots-Tag"], "noindex, nofollow")

    def test_correct_code_authenticates_rotates_session_and_consumes_once(self):
        challenge, code = self.start_email()
        pending_key = self.client.session.session_key
        clone = Client()
        clone.cookies[settings.SESSION_COOKIE_NAME] = pending_key
        self.assertRedirects(self.verify(code), reverse("admin:index"), fetch_redirect_response=False)
        self.assertEqual(self.client.session["_auth_user_id"], str(self.user.pk))
        self.assertNotIn(PENDING_KEY, self.client.session)
        self.assertNotEqual(self.client.session.session_key, pending_key)
        self.assertFalse(Session.objects.filter(session_key=pending_key).exists())
        challenge.refresh_from_db()
        self.assertIsNotNone(challenge.consumed_at)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertRedirects(self.verify(code, clone), reverse("security:login"), fetch_redirect_response=False)
        self.assert_anonymous(clone)

    def test_challenge_service_cannot_consume_same_code_twice(self):
        challenge, code = self.start_email()
        request = RequestFactory().post(reverse("security:email_verify"))
        request.session = self.client.session
        with transaction.atomic():
            self.assertIsNotNone(verify_email_challenge(request, self.user, challenge.pk, code, "login"))
        with transaction.atomic():
            self.assertIsNone(verify_email_challenge(request, self.user, challenge.pk, code, "login"))

    def test_login_code_is_rejected_for_another_purpose(self):
        challenge, code = self.start_email()
        request = RequestFactory().post(reverse("security:email_verify"))
        request.session = self.client.session
        request.user = self.user
        with transaction.atomic():
            self.assertIsNone(verify_email_challenge(request, self.user, challenge.pk, code, "regenerate"))
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)
        self.assert_anonymous()

    def test_invalid_code_formats_and_wrong_code_do_not_authenticate(self):
        challenge, code = self.start_email()
        wrong_code = f"{(int(code) + 1) % 1000000:06d}"
        for invalid in ["", "abcdef", "12345", "1234567", wrong_code]:
            with self.subTest(token=invalid):
                self.assertEqual(self.verify(invalid).status_code, 200)
                self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_expired_challenge_rejects_correct_code(self):
        challenge, code = self.start_email()
        EmailChallenge.objects.filter(pk=challenge.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.verify(code).status_code, 200)
        self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_expired_pending_session_rejects_correct_code(self):
        challenge, code = self.start_email()
        session = self.client.session
        session[PENDING_KEY] = {**session[PENDING_KEY], "expires": time.time() - 1}
        session.save()
        self.assertRedirects(self.verify(code), reverse("security:login"), fetch_redirect_response=False)
        self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_password_change_invalidates_pending_code(self):
        challenge, code = self.start_email()
        self.user.set_password("Changed-Test-Mail-Password-847!")
        self.user.save(update_fields=["password"])
        self.assertRedirects(self.verify(code), reverse("security:login"), fetch_redirect_response=False)
        self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_session_revocation_invalidates_pending_code(self):
        challenge, code = self.start_email()
        SecurityState.objects.filter(user=self.user).update(session_version=1)
        self.assertRedirects(self.verify(code), reverse("security:login"), fetch_redirect_response=False)
        self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_account_email_change_invalidates_code_sent_to_old_address(self):
        challenge, code = self.start_email()
        get_user_model().objects.filter(pk=self.user.pk).update(email="changed-mailbox@example.com")
        self.verify(code)
        self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_account_email_change_revokes_confirmed_email_session(self):
        _, code = self.start_email()
        self.verify(code)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        get_user_model().objects.filter(pk=self.user.pk).update(email="changed-mailbox@example.com")
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assert_anonymous()

    def test_mfa_method_change_revokes_confirmed_email_session(self):
        _, code = self.start_email()
        self.verify(code)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        SecurityState.objects.filter(user=self.user).update(mfa_method="totp")
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assert_anonymous()

    def test_recovery_cannot_bypass_changed_account_email(self):
        codes = self.recovery_set()
        self.start_email()
        get_user_model().objects.filter(pk=self.user.pk).update(email="changed-mailbox@example.com")
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assert_anonymous()
        self.assertFalse(RecoveryCode.objects.filter(used_at__isnull=False).exists())

    def test_changed_mailbox_requires_explicit_reenrollment_and_confirmation(self):
        new_email = "changed-mailbox@example.com"
        get_user_model().objects.filter(pk=self.user.pk).update(email=new_email)
        self.password_step()
        self.assert_anonymous()
        self.assertEqual(len(mail.outbox), 0)
        call_command("configure_mfa", email=self.user.username, method="email", stdout=StringIO())
        _, code = self.start_email()
        self.assertEqual(mail.outbox[-1].to, [new_email])
        device = EmailDevice.objects.get(user=self.user)
        self.assertFalse(device.confirmed)
        self.assert_anonymous()
        self.assertEqual(self.verify(code).status_code, 200)
        device.refresh_from_db()
        self.assertTrue(device.confirmed)
        self.assertEqual(device.email, new_email)
        self.assertEqual(self.client.get("/admin/").status_code, 200)

    def test_code_without_password_verified_session_is_rejected(self):
        challenge, code = self.start_email()
        stranger = Client()
        self.assertRedirects(self.verify(code, stranger), reverse("security:login"), fetch_redirect_response=False)
        self.assert_anonymous(stranger)
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    def test_copying_pending_state_to_another_session_does_not_transfer_challenge(self):
        challenge, code = self.start_email()
        stranger = Client()
        session = stranger.session
        session[PENDING_KEY] = dict(self.client.session[PENDING_KEY])
        session.save()
        self.assertNotEqual(stranger.session.session_key, self.client.session.session_key)
        self.verify(code, stranger)
        self.assert_anonymous(stranger)
        challenge.refresh_from_db()
        self.assertIsNone(challenge.consumed_at)

    @override_settings(SECURITY_EMAIL_RESEND_SECONDS=0)
    def test_challenge_from_another_account_cannot_be_selected_in_post(self):
        other = get_user_model().objects.create_user(
            "second@example.com", "second-mailbox@example.com", self.password,
            is_staff=True, is_superuser=True,
        )
        SecurityState.objects.create(user=other, mfa_method="email")
        EmailDevice.objects.create(user=other, name="email", email=other.email, confirmed=True)
        first_challenge, first_code = self.start_email()
        second_client = Client()
        response = second_client.post(reverse("security:login"), {"email": other.username, "password": self.password})
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        second_challenge = EmailChallenge.objects.get(pk=second_client.session[PENDING_KEY]["email_challenge_id"])
        second_code = self.message_code()
        # If the random codes collide, a different user still cannot select this challenge.
        request = RequestFactory().post(reverse("security:email_verify"))
        request.session = self.client.session
        with transaction.atomic():
            self.assertIsNone(verify_email_challenge(request, self.user, second_challenge.pk, second_code, "login"))
        self.assert_anonymous()
        second_challenge.refresh_from_db()
        self.assertIsNone(second_challenge.consumed_at)
        self.assertRedirects(
            self.verify(first_code, challenge_id=str(second_challenge.pk), email_challenge_id=str(second_challenge.pk), user_id=other.pk),
            reverse("admin:index"), fetch_redirect_response=False,
        )
        self.assertEqual(self.client.session["_auth_user_id"], str(self.user.pk))
        first_challenge.refresh_from_db()
        self.assertIsNotNone(first_challenge.consumed_at)

    def test_resend_requires_post_and_enforces_cooldown(self):
        challenge, _ = self.start_email()
        self.assertEqual(self.client.get(reverse("security:email_resend")).status_code, 405)
        response = self.client.post(reverse("security:email_resend"))
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(EmailChallenge.objects.count(), 1)
        challenge.refresh_from_db()
        self.assertIsNone(challenge.invalidated_at)
        self.assert_anonymous()

    def test_repeating_password_step_cannot_bypass_email_cooldown(self):
        self.start_email()
        other_browser = Client()
        self.assertEqual(self.password_step(other_browser).status_code, 429)
        self.assertEqual(len(mail.outbox), 1)
        self.assert_anonymous(other_browser)

    @override_settings(SECURITY_EMAIL_RESEND_SECONDS=0)
    def test_resend_invalidates_previous_code_and_sends_only_to_account(self):
        first_challenge, _ = self.start_email()
        response = self.client.post(reverse("security:email_resend"), {"recipient": "attacker@example.com"})
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[-1].to, [self.user.email])
        first_challenge.refresh_from_db()
        self.assertIsNotNone(first_challenge.invalidated_at)
        new_challenge = EmailChallenge.objects.get(pk=self.client.session[PENDING_KEY]["email_challenge_id"])
        self.assertNotEqual(new_challenge.pk, first_challenge.pk)
        old_code = re.findall(r"\b[0-9]{6}\b", mail.outbox[0].body)[0]
        request = RequestFactory().post(reverse("security:email_verify"))
        request.session = self.client.session
        with transaction.atomic():
            self.assertIsNone(verify_email_challenge(request, self.user, first_challenge.pk, old_code, "login"))
        self.assertRedirects(self.verify(self.message_code()), reverse("admin:index"), fetch_redirect_response=False)

    def test_five_wrong_codes_exhaust_challenge_and_account_budget(self):
        challenge, code = self.start_email()
        wrong_code = f"{(int(code) + 1) % 1000000:06d}"
        for _ in range(5):
            self.verify(wrong_code)
            self.assert_anonymous()
        response = self.verify(code)
        self.assertEqual(response.status_code, 429)
        self.assert_anonymous()
        challenge.refresh_from_db()
        self.assertEqual(challenge.attempts, 5)
        self.assertIsNone(challenge.consumed_at)

    @override_settings(SECURITY_EMAIL_RESEND_SECONDS=0)
    def test_resend_does_not_reset_account_verification_budget(self):
        _, code = self.start_email()
        wrong_code = f"{(int(code) + 1) % 1000000:06d}"
        for _ in range(5):
            self.verify(wrong_code)
        self.client.post(reverse("security:email_resend"))
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.verify(self.message_code()).status_code, 429)
        self.assert_anonymous()

    def test_delivery_exception_fails_closed_without_usable_challenge(self):
        with patch("django.core.mail.backends.locmem.EmailBackend.send_messages", side_effect=smtplib.SMTPException("test-only SMTP failure")):
            response = self.password_step()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        self.assert_anonymous()
        self.assertFalse(EmailChallenge.objects.filter(consumed_at__isnull=True, invalidated_at__isnull=True).exists())
        self.assertEqual(self.client.get("/admin/", HTTP_ACCEPT="application/json").status_code, 401)

    def test_backend_reporting_zero_deliveries_fails_closed(self):
        with patch("django.core.mail.backends.locmem.EmailBackend.send_messages", return_value=0):
            response = self.password_step()
        self.assertEqual(response.status_code, 400)
        self.assert_anonymous()
        self.assertFalse(EmailChallenge.objects.filter(consumed_at__isnull=True, invalidated_at__isnull=True).exists())

    def test_email_endpoints_require_csrf_and_valid_origin(self):
        strict = Client(enforce_csrf_checks=True)
        strict.get(reverse("security:login"))
        response = strict.post(reverse("security:login"), {
            "email": self.user.username, "password": self.password,
            "csrfmiddlewaretoken": strict.cookies[settings.CSRF_COOKIE_NAME].value,
        }, HTTP_ORIGIN="http://testserver")
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        code = self.message_code()
        for name in ["email_verify", "email_resend"]:
            with self.subTest(endpoint=name):
                self.assertEqual(strict.post(reverse(f"security:{name}"), {"token": code}).status_code, 403)
                self.assertEqual(strict.post(reverse(f"security:{name}"), {
                    "token": code, "csrfmiddlewaretoken": strict.cookies[settings.CSRF_COOKIE_NAME].value,
                }, HTTP_ORIGIN="https://foreign.example").status_code, 403)
        self.assert_anonymous(strict)
        self.assertEqual(len(mail.outbox), 1)

    def test_first_email_confirmation_requires_enrollment_and_shows_recovery_once(self):
        EmailDevice.objects.filter(pk=self.device.pk).update(confirmed=False)
        permission = EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() + timedelta(hours=1))
        challenge, code = self.start_email()
        self.device.refresh_from_db()
        self.assertFalse(self.device.confirmed)
        self.assertFalse(RecoveryCode.objects.exists())
        self.assert_anonymous()
        response = self.verify(code)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["codes"]), 10)
        self.assertEqual(RecoveryCode.objects.filter(device__user=self.user).count(), 10)
        self.assertNotIn("codes", self.client.session)
        self.device.refresh_from_db()
        permission.refresh_from_db()
        challenge.refresh_from_db()
        self.assertTrue(self.device.confirmed)
        self.assertIsNotNone(permission.used_at)
        self.assertIsNotNone(challenge.consumed_at)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertNotContains(self.client.get(reverse("security:recovery_codes")), response.context["codes"][0])

    def test_unconfirmed_email_without_permission_cannot_enroll(self):
        EmailDevice.objects.filter(pk=self.device.pk).update(confirmed=False)
        self.password_step()
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(EmailChallenge.objects.exists())
        self.assert_anonymous()

    def test_expired_enrollment_permission_cannot_activate_email(self):
        EmailDevice.objects.filter(pk=self.device.pk).update(confirmed=False)
        EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() - timedelta(seconds=1))
        self.password_step()
        self.assertEqual(len(mail.outbox), 0)
        self.assert_anonymous()

    def test_enrollment_permission_is_rechecked_when_code_is_submitted(self):
        EmailDevice.objects.filter(pk=self.device.pk).update(confirmed=False)
        permission = EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() + timedelta(hours=1))
        _, code = self.start_email()
        EnrollmentPermission.objects.filter(pk=permission.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.verify(code)
        self.assert_anonymous()
        self.device.refresh_from_db()
        self.assertFalse(self.device.confirmed)
        self.assertFalse(RecoveryCode.objects.exists())

    def test_recovery_cannot_skip_initial_email_confirmation(self):
        EmailDevice.objects.filter(pk=self.device.pk).update(confirmed=False)
        EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() + timedelta(hours=1))
        codes = self.recovery_set()
        self.start_email()
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assert_anonymous()
        self.device.refresh_from_db()
        self.assertFalse(self.device.confirmed)
        self.assertFalse(RecoveryCode.objects.filter(used_at__isnull=False).exists())

    @override_settings(SECURITY_EMAIL_RESEND_SECONDS=0)
    def test_recovery_is_single_use_and_revokes_other_email_sessions(self):
        codes = self.recovery_set()
        old_client = Client()
        _, first_code = self.start_email(old_client)
        self.assertRedirects(self.verify(first_code, old_client), reverse("admin:index"), fetch_redirect_response=False)
        self.start_email()
        response = self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assertRedirects(response, reverse("admin:index"), fetch_redirect_response=False)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertEqual(old_client.get("/admin/").status_code, 302)
        self.assertEqual(RecoveryCode.objects.filter(used_at__isnull=False).count(), 1)
        self.client.post(reverse("security:logout"))
        self.start_email()
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assert_anonymous()
        self.assertEqual(RecoveryCode.objects.filter(used_at__isnull=False).count(), 1)

    def test_confirmed_account_can_recover_after_delivery_failure(self):
        codes = self.recovery_set()
        with patch("django.core.mail.backends.locmem.EmailBackend.send_messages", side_effect=smtplib.SMTPException("test-only outage")):
            self.assertEqual(self.password_step().status_code, 400)
        self.assert_anonymous()
        response = self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assertRedirects(response, reverse("admin:index"), fetch_redirect_response=False)
        self.assertEqual(self.client.get("/admin/").status_code, 200)

    @override_settings(SECURITY_EMAIL_RESEND_SECONDS=0)
    def test_recovery_regeneration_requires_fresh_email_code_and_replaces_old_codes(self):
        old_codes = self.recovery_set()
        _, login_code = self.start_email()
        self.verify(login_code)
        self.assertEqual(self.client.get(reverse("security:email_regenerate_send")).status_code, 405)
        self.assertEqual(self.client.get(reverse("security:email_regenerate_verify")).status_code, 405)
        self.client.post(reverse("security:email_regenerate_send"), {"recipient": "attacker@example.com"})
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[-1].to, [self.user.email])
        challenge = EmailChallenge.objects.get(pk=self.client.session[EMAIL_REGENERATE_KEY])
        self.assertEqual(challenge.purpose, "regenerate")
        code = self.message_code()
        wrong_code = f"{(int(code) + 1) % 1000000:06d}"
        self.assertEqual(self.client.post(reverse("security:email_regenerate_verify"), {"token": wrong_code}).status_code, 400)
        self.assertTrue(RecoveryCode.objects.filter(selector=old_codes[0].replace("-", "")[:8]).exists())
        response = self.client.post(reverse("security:email_regenerate_verify"), {"token": code})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["codes"]), 10)
        self.assertEqual(RecoveryCode.objects.filter(device__user=self.user).count(), 10)
        self.assertFalse(RecoveryCode.objects.filter(selector=old_codes[0].replace("-", "")[:8]).exists())
        self.assertNotIn(EMAIL_REGENERATE_KEY, self.client.session)
        self.assertNotIn("codes", self.client.session)
        challenge.refresh_from_db()
        self.assertIsNotNone(challenge.consumed_at)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertEqual(self.client.post(reverse("security:email_regenerate_verify"), {"token": code}).status_code, 400)

    def test_pending_login_cannot_send_recovery_regeneration_code(self):
        self.start_email()
        for name in ["email_regenerate_send", "email_regenerate_verify"]:
            with self.subTest(endpoint=name):
                response = self.client.post(reverse(f"security:{name}"), {"token": self.message_code()})
                self.assertEqual(response.status_code, 302)
                self.assert_anonymous()
        self.assertEqual(len(mail.outbox), 1)
        self.assertFalse(EmailChallenge.objects.filter(purpose="regenerate").exists())


@skipUnless(connection.vendor == "postgresql", "Concurrent row locks require PostgreSQL.")
@override_settings(**EMAIL_TEST_SETTINGS)
class ConcurrentEmailTokenTests(EmailFlowHelpers, TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            "concurrent-mail@example.com", "concurrent-mail@example.com", self.password,
            is_staff=True, is_superuser=True,
        )
        SecurityState.objects.create(user=self.user, mfa_method="email")
        EmailDevice.objects.create(user=self.user, name="email", email=self.user.email, confirmed=True)

    def test_concurrent_redemption_consumes_email_code_exactly_once(self):
        challenge, code = self.start_email()
        barrier = Barrier(2)
        session = self.client.session
        user_id = self.user.pk

        def consume():
            close_old_connections()
            try:
                request = RequestFactory().post(reverse("security:email_verify"))
                request.session = session
                user = get_user_model().objects.get(pk=user_id)
                barrier.wait(timeout=10)
                with transaction.atomic():
                    return verify_email_challenge(request, user, challenge.pk, code, "login") is not None
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(consume) for _ in range(2)]
            results = [future.result(timeout=20) for future in futures]
        self.assertCountEqual(results, [True, False])
        challenge.refresh_from_db()
        self.assertIsNotNone(challenge.consumed_at)
