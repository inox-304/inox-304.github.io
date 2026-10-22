import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.hashers import check_password
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.db import close_old_connections, connection, connections, transaction
from django.test import Client, RequestFactory, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice

from .models import EnrollmentPermission, LoginThrottle, RecoveryCode, RecoveryDevice, SecurityEvent, SecurityState
from .services import AUTH_AT, LAST_SEEN, PENDING_KEY, client_ip, generate_recovery_codes, verify_device


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], OTP_TOTP_THROTTLE_FACTOR=0)
class SecurityFlowTests(TestCase):
    password = "Orbit-Green-Server-984!"

    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user("owner@example.com", "owner@example.com", cls.password, is_staff=True, is_superuser=True)
        SecurityState.objects.create(user=cls.user)
        cls.device = TOTPDevice.objects.create(user=cls.user, name="default", confirmed=True)

    def token(self, device=None, at=None):
        device = device or self.device
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time() if at is None else at
        return f"{generator.token():06d}"

    def password_step(self, client=None):
        client = client or self.client
        return client.post(reverse("security:login"), {"email": " OWNER@EXAMPLE.COM ", "password": self.password})

    def full_login(self, client=None):
        client = client or self.client
        self.assertRedirects(self.password_step(client), reverse("security:otp"), fetch_redirect_response=False)
        return client.post(reverse("security:otp"), {"method": "totp", "token": self.token()})

    def recovery_set(self):
        with transaction.atomic():
            return generate_recovery_codes(self.user)[1]

    def test_password_only_cannot_access_admin_or_direct_json_or_write(self):
        self.password_step()
        self.assertNotIn("_auth_user_id", self.client.session)
        for path in ["/admin/", "/admin/auth/user/", "/admin/auth/user/add/", "/admin/security/securityevent/"]:
            self.assertEqual(self.client.get(path).status_code, 302)
            self.assertEqual(self.client.get(path, HTTP_ACCEPT="application/json").status_code, 401)
            self.assertEqual(self.client.post(path, {}, HTTP_ACCEPT="application/json").status_code, 401)
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_force_login_without_mfa_is_rejected_and_revoked(self):
        self.client.force_login(self.user)
        old_key = self.client.session.session_key
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertFalse(Session.objects.filter(session_key=old_key).exists())
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_inventory_background_updates_do_not_extend_idle_session(self):
        self.full_login()
        session = self.client.session
        last_human_activity = time.time() - 120
        session[LAST_SEEN] = last_human_activity
        session.save()
        with patch("catalog.inventory_views.load_snapshot", return_value=None):
            response = self.client.get("/admin/inventario/", HTTP_X_INOX_AUTOMATIC="1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.session[LAST_SEEN], last_human_activity)
        # A deliberate navigation counts as activity, unlike the polling request.
        with patch("catalog.inventory_views.load_snapshot", return_value=None):
            self.client.get("/admin/inventario/")
        self.assertGreater(self.client.session[LAST_SEEN], last_human_activity)
        session = self.client.session
        session[LAST_SEEN] = time.time() - 1801
        session.save()
        with patch("catalog.inventory_views.load_snapshot") as read_snapshot:
            response = self.client.post("/admin/inventario/actualizar/", HTTP_X_INOX_AUTOMATIC="1", HTTP_ACCEPT="application/json")
            read_snapshot.assert_not_called()
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_nonstaff_and_inactive_users_are_denied(self):
        for field in ["is_staff", "is_active"]:
            get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
            response = self.password_step()
            self.assertEqual(response.status_code, 200)
            self.assertNotIn(PENDING_KEY, self.client.session)
            get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})

    def test_pending_expiry_and_password_change_invalidate_second_step(self):
        self.password_step()
        session = self.client.session
        session[PENDING_KEY] = {**session[PENDING_KEY], "expires": time.time() - 1}
        session.save()
        self.assertRedirects(self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()}), reverse("security:login"), fetch_redirect_response=False)
        self.password_step()
        self.user.set_password("Changed-New-Password-345!")
        self.user.save()
        self.assertRedirects(self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()}), reverse("security:login"), fetch_redirect_response=False)

    def test_expired_invalid_and_replayed_totp_are_denied(self):
        self.password_step()
        for token in ["invalid", self.token(at=time.time() - 120)]:
            response = self.client.post(reverse("security:otp"), {"method": "totp", "token": token})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("_auth_user_id", self.client.session)
        token = self.token()
        self.assertEqual(self.client.post(reverse("security:otp"), {"method": "totp", "token": token}).status_code, 302)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.client.post(reverse("security:logout"))
        self.password_step()
        self.assertEqual(self.client.post(reverse("security:otp"), {"method": "totp", "token": token}).status_code, 200)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_successful_mfa_rotates_session_and_logout_revokes_cookie(self):
        self.password_step()
        pending_key = self.client.session.session_key
        self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()})
        authenticated_key = self.client.session.session_key
        self.assertNotEqual(pending_key, authenticated_key)
        self.assertFalse(Session.objects.filter(session_key=pending_key).exists())
        clone = Client()
        clone.cookies[settings.SESSION_COOKIE_NAME] = authenticated_key
        self.assertEqual(self.client.get(reverse("security:logout")).status_code, 405)
        self.client.post(reverse("security:logout"))
        self.assertFalse(Session.objects.filter(session_key=authenticated_key).exists())
        self.assertEqual(clone.get("/admin/").status_code, 302)

    def test_recovery_codes_are_hashed_single_use_and_revoke_other_sessions(self):
        codes = self.recovery_set()
        compact = codes[0].replace("-", "")
        stored = RecoveryCode.objects.get(selector=compact[:8])
        self.assertNotEqual(stored.token_hash, compact)
        self.assertTrue(check_password(compact, stored.token_hash))
        other = Client()
        self.full_login(other)
        self.assertEqual(other.get("/admin/").status_code, 200)
        self.password_step()
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertEqual(other.get("/admin/").status_code, 302)
        self.assertEqual(RecoveryCode.objects.filter(used_at__isnull=False).count(), 1)
        self.client.post(reverse("security:logout"))
        self.password_step()
        self.assertEqual(self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]}).status_code, 200)
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertTrue(SecurityEvent.objects.filter(event="recovery_code_used").exists())

    def test_no_device_does_not_enable_unauthorized_enrollment(self):
        self.device.delete()
        self.assertEqual(self.password_step().status_code, 200)
        self.assertNotIn(PENDING_KEY, self.client.session)
        self.assertRedirects(self.client.get(reverse("security:setup")), reverse("security:login"), fetch_redirect_response=False)

    def test_initial_enrollment_requires_confirmation_and_shows_codes_once(self):
        self.device.delete()
        EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() + timedelta(hours=24))
        self.assertRedirects(self.password_step(), reverse("security:setup"), fetch_redirect_response=False)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        response = self.client.get(reverse("security:setup"))
        self.assertEqual(response.status_code, 200)
        device = TOTPDevice.objects.get(user=self.user)
        self.assertFalse(device.confirmed)
        self.assertEqual(self.client.get(reverse("security:setup_qr"))["Content-Type"], "image/png")
        response = self.client.post(reverse("security:setup"), {"token": self.token(device)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["codes"]), 10)
        self.assertContains(response, "download=")
        self.assertNotIn("codes", self.client.session)
        self.assertNotIn(PENDING_KEY, self.client.session)
        device.refresh_from_db()
        self.assertTrue(device.confirmed)
        self.assertGreaterEqual(device.last_t, 0)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertEqual(self.client.get(reverse("security:setup_qr")).status_code, 404)
        self.assertIsNotNone(EnrollmentPermission.objects.get(user=self.user).used_at)

    def test_session_absolute_and_idle_timeouts_are_server_enforced(self):
        self.full_login()
        session = self.client.session
        session[AUTH_AT] = time.time() - 28801
        session[LAST_SEEN] = time.time()
        session.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)
        codes = self.recovery_set()
        self.password_step()
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        session = self.client.session
        session[LAST_SEEN] = time.time() - 1801
        session.save()
        self.assertEqual(self.client.get("/admin/", HTTP_ACCEPT="application/json").status_code, 401)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_disabled_account_cannot_restore_old_session_after_reactivation(self):
        self.full_login()
        get_user_model().objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        get_user_model().objects.filter(pk=self.user.pk).update(is_active=True)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_password_and_otp_limits_are_shared_by_account_and_expire(self):
        for _ in range(8):
            self.client.post(reverse("security:login"), {"email": self.user.email, "password": "wrong"})
        response = self.client.post(reverse("security:login"), {"email": "OWNER@EXAMPLE.COM", "password": self.password}, REMOTE_ADDR="192.0.2.2")
        self.assertEqual(response.status_code, 429)
        LoginThrottle.objects.update(window_started=timezone.now() - timedelta(minutes=16), locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.password_step().status_code, 302)
        for _ in range(5):
            self.assertEqual(self.client.post(reverse("security:otp"), {"method": "totp", "token": "wrong"}).status_code, 200)
        self.assertEqual(self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()}).status_code, 429)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_ip_limit_cannot_be_bypassed_with_different_email(self):
        for index in range(30):
            self.client.post(reverse("security:login"), {"email": f"person{index}@example.com", "password": "wrong"})
        self.assertEqual(self.password_step().status_code, 429)

    def test_csrf_and_private_cache_policy(self):
        strict = Client(enforce_csrf_checks=True)
        self.assertEqual(strict.post(reverse("security:login"), {"email": self.user.email, "password": self.password}).status_code, 403)
        response = self.client.get(reverse("security:login"))
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        self.assertEqual(response["Referrer-Policy"], "same-origin")

    def test_csrf_accepts_same_origin_and_rejects_null_or_foreign_origin(self):
        strict = Client(enforce_csrf_checks=True)
        strict.get(reverse("security:login"))
        data = {"email": self.user.email, "password": self.password, "csrfmiddlewaretoken": strict.cookies[settings.CSRF_COOKIE_NAME].value}
        for origin in ["null", "https://foreign.example"]:
            self.assertEqual(strict.post(reverse("security:login"), data, HTTP_ORIGIN=origin).status_code, 403)
        self.assertRedirects(strict.post(reverse("security:login"), data, HTTP_ORIGIN="http://testserver"), reverse("security:otp"), fetch_redirect_response=False)

    def test_identity_and_device_models_are_not_registered_in_admin(self):
        for model in (get_user_model(), Group, TOTPDevice, RecoveryDevice, RecoveryCode, EnrollmentPermission):
            self.assertFalse(admin.site.is_registered(model))

    def test_proxy_header_is_used_only_when_explicitly_trusted(self):
        request = RequestFactory().get("/", REMOTE_ADDR="192.0.2.1", HTTP_X_INOX_CLIENT_IP="203.0.113.17", HTTP_X_FORWARDED_FOR="198.51.100.99")
        with override_settings(TRUSTED_INOX_PROXY=False):
            self.assertEqual(client_ip(request), "192.0.2.1")
        with override_settings(TRUSTED_INOX_PROXY=True):
            self.assertEqual(client_ip(request), "203.0.113.17")
            request.META.pop("HTTP_X_INOX_CLIENT_IP")
            self.assertEqual(client_ip(request), "192.0.2.1")
            request.META["HTTP_X_INOX_CLIENT_IP"] = "203.0.113.17, 203.0.113.18"
            self.assertIsNone(client_ip(request))

    def test_expired_enrollment_permission_does_not_create_a_device(self):
        self.device.delete()
        EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.password_step().status_code, 200)
        self.assertNotIn(PENDING_KEY, self.client.session)
        self.assertFalse(TOTPDevice.objects.filter(user=self.user).exists())

    def test_regeneration_requires_fresh_totp_and_replaces_old_codes(self):
        codes = self.recovery_set()
        self.password_step()
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assertEqual(self.client.get(reverse("security:regenerate_codes")).status_code, 405)
        self.assertEqual(self.client.post(reverse("security:regenerate_codes"), {"token": "wrong"}).status_code, 400)
        response = self.client.post(reverse("security:regenerate_codes"), {"token": self.token()})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context["codes"]), 10)
        self.assertFalse(RecoveryCode.objects.filter(selector=codes[1].replace("-", "")[:8]).exists())
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertNotIn("codes", self.client.session)

    def test_cli_bootstrap_and_explicit_reset(self):
        output = StringIO()
        with patch("security.management.commands.create_owner.getpass", side_effect=[self.password, self.password]):
            call_command("create_owner", email="NEW@EXAMPLE.COM", stdout=output)
        new_user = get_user_model().objects.get(username="new@example.com")
        self.assertTrue(new_user.is_staff and new_user.is_superuser and new_user.check_password(self.password))
        self.assertTrue(EnrollmentPermission.objects.filter(user=new_user, used_at__isnull=True).exists())
        self.assertNotIn(self.password, output.getvalue())
        self.full_login()
        self.recovery_set()
        call_command("authorize_enrollment", email=self.user.email, stdout=StringIO())
        self.assertFalse(TOTPDevice.objects.filter(user=self.user).exists())
        self.assertFalse(RecoveryCode.objects.filter(device__user=self.user).exists())
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertTrue(EnrollmentPermission.objects.filter(user=self.user, used_at__isnull=True).exists())


@skipUnless(connection.vendor == "postgresql", "Concurrent row-lock behavior requires PostgreSQL; SQLite does not implement SELECT FOR UPDATE.")
@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], OTP_TOTP_THROTTLE_FACTOR=0)
class ConcurrentTokenTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("concurrent@example.com", password="Test-Only-Password-598!", is_staff=True)
        self.device = TOTPDevice.objects.create(user=self.user, name="default", confirmed=True)

    def consume_twice(self, method, token):
        barrier = Barrier(2)
        user_id = self.user.pk

        def consume():
            close_old_connections()
            try:
                user = get_user_model().objects.get(pk=user_id)
                barrier.wait(timeout=10)
                with transaction.atomic():
                    return verify_device(user, method, token) is not None
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(consume) for _ in range(2)]
            results = [future.result(timeout=20) for future in futures]
        self.assertCountEqual(results, [True, False])

    def test_concurrent_totp_redemption_succeeds_exactly_once(self):
        token = TOTP(self.device.bin_key, self.device.step, self.device.t0, self.device.digits, self.device.drift)
        self.consume_twice("totp", f"{token.token():06d}")

    def test_concurrent_recovery_redemption_succeeds_exactly_once(self):
        with transaction.atomic():
            _, codes = generate_recovery_codes(self.user)
        self.consume_twice("recovery", codes[0])
        self.assertEqual(RecoveryCode.objects.filter(used_at__isnull=False).count(), 1)
