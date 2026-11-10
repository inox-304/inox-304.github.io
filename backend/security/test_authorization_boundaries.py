"""Recheck authorization at token consumption, not just at request arrival."""
import time
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice

from .models import EnrollmentPermission, RecoveryCode, SecurityEvent, SecurityState
from .services import PENDING_KEY, generate_recovery_codes


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
                   SECURITY_OWNER_USERNAME="owner@example.com")
class AuthorizationBoundaryTests(TestCase):
    password = "Synthetic-security-review-429!"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            "owner@example.com", "owner@example.com", self.password,
            is_staff=True, is_superuser=True)
        SecurityState.objects.create(user=self.user)
        self.device = TOTPDevice.objects.create(user=self.user, confirmed=True)

    def token(self, device=None):
        device = device or self.device
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time()
        return f"{generator.token():06d}"

    def pending(self, client=None, user=None):
        return (client or self.client).post(reverse("security:login"), {
            "email": (user or self.user).username, "password": self.password})

    def change_during_request(self, change):
        def apply(request, *_args):
            change(request)
            return True
        return patch("security.views.allow_attempt", side_effect=apply)

    def change_password(self, _request):
        fresh = get_user_model().objects.get(pk=self.user.pk)
        fresh.set_password("Changed-synthetic-secret-290!")
        fresh.save(update_fields=["password"])

    def test_otp_rechecks_disabled_account_before_consuming_token(self):
        self.pending()
        with self.change_during_request(lambda _: get_user_model().objects.filter(pk=self.user.pk).update(is_active=False)):
            result = self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()})
        self.assertRedirects(result, reverse("security:login"), fetch_redirect_response=False)
        self.assertNotIn("_auth_user_id", self.client.session)
        self.device.refresh_from_db()
        self.assertEqual(self.device.last_t, -1)

    def test_otp_rechecks_password_before_consuming_token(self):
        self.pending()
        with self.change_during_request(self.change_password):
            result = self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()})
        self.assertRedirects(result, reverse("security:login"), fetch_redirect_response=False)
        self.assertNotIn("_auth_user_id", self.client.session)
        self.device.refresh_from_db()
        self.assertEqual(self.device.last_t, -1)

    def test_otp_expiration_is_checked_at_redemption(self):
        self.pending()
        def expire(request):
            request.session[PENDING_KEY] = {**request.session[PENDING_KEY], "expires": time.time() - 1}
        with self.change_during_request(expire):
            result = self.client.post(reverse("security:otp"), {"method": "totp", "token": self.token()})
        self.assertRedirects(result, reverse("security:login"), fetch_redirect_response=False)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_initial_setup_does_not_issue_recovery_codes_after_password_change(self):
        self.device.delete()
        permission = EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now() + timedelta(hours=1))
        self.pending()
        self.client.get(reverse("security:setup"))
        device = TOTPDevice.objects.get(user=self.user, confirmed=False)
        with self.change_during_request(self.change_password):
            result = self.client.post(reverse("security:setup"), {"token": self.token(device)})
        self.assertRedirects(result, reverse("security:login"), fetch_redirect_response=False)
        device.refresh_from_db()
        permission.refresh_from_db()
        self.assertFalse(device.confirmed)
        self.assertIsNone(permission.used_at)
        self.assertFalse(RecoveryCode.objects.exists())

    def test_recovery_regeneration_rechecks_current_password_session(self):
        with transaction.atomic():
            _, codes = generate_recovery_codes(self.user)
        self.pending()
        self.client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        before = list(RecoveryCode.objects.order_by("pk").values())
        with self.change_during_request(self.change_password):
            result = self.client.post(reverse("security:regenerate_codes"), {"token": self.token()})
        self.assertRedirects(result, reverse("security:login"), fetch_redirect_response=False)
        self.assertEqual(list(RecoveryCode.objects.order_by("pk").values()), before)

    def test_security_events_are_owner_only_even_for_other_superusers(self):
        staff = get_user_model().objects.create_user("other@example.com", password=self.password,
                                                    is_staff=True, is_superuser=True)
        SecurityState.objects.create(user=staff)
        device = TOTPDevice.objects.create(user=staff, confirmed=True)
        event = SecurityEvent.objects.create(user=self.user, event="private_owner_activity")
        client = Client()
        self.pending(client, staff)
        client.post(reverse("security:otp"), {"method": "totp", "token": self.token(device)})
        for path in ("/admin/security/securityevent/", f"/admin/security/securityevent/{event.pk}/change/"):
            result = client.get(path)
            self.assertEqual(result.status_code, 403)
            self.assertNotIn(b"private_owner_activity", result.content)
