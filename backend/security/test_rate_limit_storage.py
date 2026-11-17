from datetime import timedelta
from unittest.mock import patch

from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import LoginThrottle, SecurityEvent
from .services import allow_attempt


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class AuthenticationAbuseStorageTests(TestCase):
    """Rejected public requests must not grow private storage without a bound."""

    def setUp(self):
        self.request = RequestFactory().post("/admin/auth/login/", REMOTE_ADDR="192.0.2.1")

    def block_ip(self):
        for index in range(30):
            self.assertTrue(allow_attempt(self.request, "password", f"unknown-{index}@example.test"))
        self.assertFalse(allow_attempt(self.request, "password", "blocked@example.test"))

    def test_blocked_ip_cannot_create_throttles_for_arbitrary_account_names(self):
        self.block_ip()
        count = LoginThrottle.objects.count()
        for index in range(50):
            self.assertFalse(allow_attempt(self.request, "password", f"more-{index}@example.test"))
        self.assertEqual(LoginThrottle.objects.count(), count)

    def test_blocked_ip_cannot_lock_other_accounts_through_rejected_requests(self):
        self.block_ip()
        for _ in range(10):
            self.assertFalse(allow_attempt(self.request, "password", "victim@example.test"))
        other_ip = RequestFactory().post("/admin/auth/login/", REMOTE_ADDR="192.0.2.2")
        for _ in range(8):
            self.assertTrue(allow_attempt(other_ip, "password", "victim@example.test"))
        self.assertFalse(allow_attempt(other_ip, "password", "victim@example.test"))

    def test_repeated_blocked_login_has_bounded_audit_and_throttle_storage(self):
        self.block_ip()
        endpoint = reverse("security:login")
        first = self.client.post(endpoint, {"email": "first@example.test", "password": "wrong"}, REMOTE_ADDR="192.0.2.1")
        self.assertEqual(first.status_code, 429)
        self.assertEqual(first["Retry-After"], "900")
        throttles = LoginThrottle.objects.count()
        self.assertEqual(SecurityEvent.objects.filter(event="rate_limited").count(), 1)
        for index in range(25):
            response = self.client.post(endpoint, {"email": f"blocked-{index}@example.test", "password": "wrong"}, REMOTE_ADDR="192.0.2.1")
            self.assertEqual(response.status_code, 429)
        self.assertEqual(LoginThrottle.objects.count(), throttles)
        self.assertEqual(SecurityEvent.objects.filter(event="rate_limited").count(), 1)

    def test_rate_limit_audit_is_not_suppressed_for_other_ips_or_later_windows(self):
        endpoint = reverse("security:login")
        for address in ("192.0.2.1", "192.0.2.2"):
            request = RequestFactory().post(endpoint, REMOTE_ADDR=address)
            for index in range(31):
                allow_attempt(request, "password", f"{address}-{index}@example.test")
            response = self.client.post(endpoint, {"email": "blocked@example.test", "password": "wrong"}, REMOTE_ADDR=address)
            self.assertEqual(response.status_code, 429)
        self.assertEqual(SecurityEvent.objects.filter(event="rate_limited").count(), 2)
        later = timezone.now() + timedelta(minutes=16)
        with patch("security.services.timezone.now", return_value=later):
            self.block_ip()
            response = self.client.post(endpoint, {"email": "blocked-again@example.test", "password": "wrong"}, REMOTE_ADDR="192.0.2.1")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(SecurityEvent.objects.filter(event="rate_limited").count(), 3)

    def test_anonymous_logout_cannot_fill_security_event_storage(self):
        for _ in range(10):
            response = self.client.post(reverse("security:logout"))
            self.assertEqual(response.status_code, 302)
        self.assertFalse(SecurityEvent.objects.filter(event="logout").exists())
