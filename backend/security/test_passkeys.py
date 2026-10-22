"""WebAuthn regressions using real ES256 verification and synthetic accounts.

Only the initial, already-verified email session is seeded in most tests. Every
passkey registration and assertion goes through the real HTTP view and verifier.
Private authenticator keys exist only in the in-memory fixture.
"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest import skipUnless

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.db import close_old_connections, connection, connections, transaction
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp import DEVICE_ID_SESSION_KEY
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

from .models import (
    EmailDevice, PasskeyChallenge, PasskeyDevice, PasskeyGrant,
    RecoveryCode, SecurityEvent, SecurityState,
)
from .passkey_test_helpers import SyntheticAuthenticator
from .passkeys import configuration
from .services import AUTH_AT, LAST_SEEN, PENDING_KEY, VERSION, generate_recovery_codes


PASSKEY_TEST_SETTINGS = {
    "ENVIRONMENT": "test",
    "ALLOWED_HOSTS": ["testserver", "localhost"],
    "EMAIL_BACKEND": "django.core.mail.backends.locmem.EmailBackend",
    "DEFAULT_FROM_EMAIL": "access@example.com",
    "SECURITY_EMAIL_ENABLED": True,
    "SECURITY_PASSKEYS_ENABLED": True,
    "SECURITY_PASSKEY_RP_ID": "localhost",
    "SECURITY_PASSKEY_ORIGIN": "http://localhost:8000",
    "SECURITY_OWNER_USERNAME": "owner@example.com",
    "PASSWORD_HASHERS": ["django.contrib.auth.hashers.MD5PasswordHasher"],
}


class PasskeyFlowHelpers:
    password = "Synthetic-Passkey-Password-763!"

    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user(
            "owner@example.com", "owner-mail@example.com", cls.password,
            is_staff=True, is_superuser=False,
        )
        # Superuser privileges deliberately do not confer ownership of keys.
        cls.manager = get_user_model().objects.create_user(
            "manager@example.com", "manager-mail@example.com", cls.password,
            is_staff=True, is_superuser=True,
        )
        for user in (cls.owner, cls.manager):
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.email, confirmed=True)

    def setUp(self):
        self.mfa_session(self.client, self.owner)

    def mfa_session(self, client, user):
        """Seed an existing verified session for synthetic test users only."""
        client.force_login(user)
        session = client.session
        session[DEVICE_ID_SESSION_KEY] = EmailDevice.objects.get(user=user).persistent_id
        session[AUTH_AT] = session[LAST_SEEN] = time.time()
        session[VERSION] = SecurityState.objects.get(user=user).session_version
        session.set_expiry(28800)
        session.save()

    def post_json(self, name, data, client=None):
        return (client or self.client).post(
            reverse("security:" + name), json.dumps(data),
            content_type="application/json", HTTP_ACCEPT="application/json",
        )

    def options(self, client=None, **extra):
        response = self.post_json("passkey_register_options", {
            "password": self.password, "label": "Mi computadora", **extra,
        }, client)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def new_authenticator(self, options):
        return SyntheticAuthenticator(
            rp_id="localhost", origin="http://localhost:8000",
            user_handle=base64url_to_bytes(options["publicKey"]["user"]["id"]),
        )

    def register(self, options, authenticator, client=None, **overrides):
        return self.post_json("passkey_register_verify", {
            "challenge_id": options["challengeId"],
            "credential": authenticator.registration(options["publicKey"]["challenge"], **overrides),
        }, client)

    def enroll(self, client=None, authenticator=None, **extra):
        options = self.options(client, **extra)
        authenticator = authenticator or self.new_authenticator(options)
        self.assertEqual(self.register(options, authenticator, client).status_code, 200)
        device = PasskeyDevice.objects.get(credential_id=authenticator.credential_id_b64)
        return authenticator, device

    def begin_login(self, client, user=None):
        user = user or self.owner
        response = client.post(reverse("security:login"), {"email": user.username, "password": self.password})
        self.assertRedirects(response, reverse("security:passkey_login"), fetch_redirect_response=False)
        self.assertNotIn("_auth_user_id", client.session)
        self.assertEqual(client.get(reverse("security:passkey_login")).status_code, 200)
        response = self.post_json("passkey_login_options", {}, client)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def authenticate(self, client, options, authenticator, **overrides):
        return self.post_json("passkey_login_verify", {
            "challenge_id": options["challengeId"],
            "credential": authenticator.authentication(options["publicKey"]["challenge"], **overrides),
        }, client)

    def grant(self, user=None, client=None, **extra):
        user = user or self.manager
        response = (client or self.client).post(reverse("security:passkey_grant"), {
            "user_id": user.pk, "password": self.password, "label": "PC de gerencia", **extra,
        })
        self.assertRedirects(response, reverse("security:passkeys"), fetch_redirect_response=False)
        return PasskeyGrant.objects.filter(user=user).latest("created_at")


@override_settings(**PASSKEY_TEST_SETTINGS)
class PasskeyRegistrationTests(PasskeyFlowHelpers, TestCase):
    def test_oversized_credential_is_rejected_and_challenge_stays_consumed(self):
        options = self.options()
        key = SyntheticAuthenticator(rp_id="localhost", origin="http://localhost:8000",
            credential_id=b"x" * 1200,
            user_handle=base64url_to_bytes(options["publicKey"]["user"]["id"]))
        self.assertEqual(self.register(options, key).status_code, 400)
        self.assertFalse(PasskeyDevice.objects.exists())
        self.assertIsNotNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)

    def test_email_mfa_then_registration_and_real_passkey_login(self):
        self.client.logout()
        response = self.client.post(reverse("security:login"), {"email": self.owner.username, "password": self.password})
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        codes = re.findall(r"\b[0-9]{6}\b", mail.outbox[-1].body)
        self.assertEqual(len(codes), 1)
        self.assertRedirects(self.client.post(reverse("security:email_verify"), {"token": codes[0]}),
                             reverse("admin:index"), fetch_redirect_response=False)
        options = self.options()
        self.assertEqual(options["publicKey"]["rp"]["id"], "localhost")
        self.assertEqual(options["publicKey"]["authenticatorSelection"]["userVerification"], "required")
        key = self.new_authenticator(options)
        self.assertEqual(self.register(options, key).status_code, 200)
        device = PasskeyDevice.objects.get(user=self.owner)
        self.assertEqual(bytes(device.public_key), key.credential_public_key)
        self.assertEqual(device.sign_count, 0)
        self.assertFalse(self.owner.is_superuser)
        login_client = Client()
        before_mail = len(mail.outbox)
        login_options = self.begin_login(login_client)
        before_session = login_client.session.session_key
        self.assertEqual(login_options["publicKey"]["userVerification"], "required")
        self.assertEqual(self.authenticate(login_client, login_options, key).status_code, 200)
        self.assertNotEqual(login_client.session.session_key, before_session)
        self.assertEqual(login_client.session[DEVICE_ID_SESSION_KEY], device.persistent_id)
        self.assertEqual(login_client.get(reverse("admin:index")).status_code, 200)
        self.assertEqual(len(mail.outbox), before_mail)
        device.refresh_from_db()
        self.assertEqual(device.sign_count, 1)
        self.assertIsNotNone(device.last_used_at)
        self.assertEqual(SecurityState.objects.get(user=self.owner).mfa_method, "email")

    def test_registration_requires_existing_mfa_and_current_password(self):
        anonymous = Client()
        self.assertEqual(self.post_json("passkey_register_options", {"password": self.password}, anonymous).status_code, 401)
        password_only = Client()
        password_only.force_login(self.owner)
        self.assertEqual(self.post_json("passkey_register_options", {"password": self.password}, password_only).status_code, 401)
        response = self.post_json("passkey_register_options", {"password": "wrong", "label": "PC"})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(PasskeyChallenge.objects.exists())
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_superuser_manager_requires_owner_grant_and_cannot_manage_other_keys(self):
        _, device = self.enroll()
        manager_client = Client()
        self.mfa_session(manager_client, self.manager)
        response = self.post_json("passkey_register_options", {"password": self.password, "label": "PC"}, manager_client)
        self.assertEqual(response.status_code, 403)
        response = manager_client.post(reverse("security:passkey_grant"), {"user_id": self.manager.pk, "password": self.password, "label": "PC"})
        self.assertEqual(response.status_code, 403)
        response = manager_client.post(reverse("security:passkey_revoke", args=[device.pk]), {"password": self.password})
        self.assertEqual(response.status_code, 403)
        device.refresh_from_db()
        self.assertIsNone(device.revoked_at)
        self.assertFalse(PasskeyGrant.objects.exists())
        self.assertNotContains(manager_client.get(reverse("security:passkeys")), device.name)

    def test_owner_grant_is_personal_single_use_and_fixes_device_label(self):
        authorization = self.grant()
        manager_client = Client()
        self.mfa_session(manager_client, self.manager)
        _, device = self.enroll(manager_client, grant_id=str(authorization.pk), label="Nombre no autorizado")
        self.assertEqual(device.user_id, self.manager.pk)
        self.assertEqual(device.name, authorization.label)
        authorization.refresh_from_db()
        self.assertIsNotNone(authorization.used_at)
        self.assertEqual(self.post_json("passkey_register_options", {
            "password": self.password, "grant_id": str(authorization.pk),
        }, manager_client).status_code, 403)

    def test_foreign_expired_and_used_grants_cannot_authorize_registration(self):
        manager_client = Client()
        self.mfa_session(manager_client, self.manager)
        now = timezone.now()
        for values in (
            {"user": self.owner, "expires_at": now + timedelta(hours=1)},
            {"user": self.manager, "expires_at": now - timedelta(seconds=1)},
            {"user": self.manager, "expires_at": now + timedelta(hours=1), "used_at": now},
        ):
            authorization = PasskeyGrant.objects.create(authorized_by=self.owner, label="PC", **values)
            response = self.post_json("passkey_register_options", {
                "password": self.password, "grant_id": str(authorization.pk),
            }, manager_client)
            self.assertEqual(response.status_code, 403)
        self.assertFalse(PasskeyChallenge.objects.exists())
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_grant_expiring_between_options_and_verification_is_rejected(self):
        authorization = self.grant()
        manager_client = Client()
        self.mfa_session(manager_client, self.manager)
        options = self.options(manager_client, grant_id=str(authorization.pk))
        PasskeyGrant.objects.filter(pk=authorization.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.register(options, self.new_authenticator(options), manager_client).status_code, 403)
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_revoked_grant_cannot_complete_an_outstanding_registration(self):
        authorization = self.grant()
        manager_client = Client()
        self.mfa_session(manager_client, self.manager)
        options = self.options(manager_client, grant_id=str(authorization.pk))
        url = reverse("security:passkey_grant_revoke", args=[authorization.pk])
        self.assertEqual(manager_client.post(url, {"password": self.password}).status_code, 403)
        self.assertEqual(self.client.post(url, {"password": "wrong"}).status_code, 403)
        self.assertRedirects(self.client.post(url, {"password": self.password}), reverse("security:passkeys"), fetch_redirect_response=False)
        self.assertEqual(self.register(options, self.new_authenticator(options), manager_client).status_code, 403)
        authorization.refresh_from_db()
        self.assertIsNotNone(authorization.revoked_at)
        self.assertIsNone(authorization.used_at)
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_registration_challenge_cannot_cross_browser_sessions_or_be_replayed(self):
        options = self.options()
        key = self.new_authenticator(options)
        other = Client()
        self.mfa_session(other, self.owner)
        self.assertEqual(self.register(options, key, other).status_code, 400)
        self.assertIsNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)
        self.assertEqual(self.register(options, key).status_code, 200)
        self.assertEqual(self.register(options, key).status_code, 400)
        self.assertEqual(PasskeyDevice.objects.count(), 1)

    def test_registration_invalidated_by_password_change(self):
        options = self.options()
        self.owner.set_password("New-Synthetic-Password-734!")
        self.owner.save(update_fields=["password"])
        self.assertEqual(self.register(options, self.new_authenticator(options)).status_code, 401)
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_registration_invalidated_by_session_revocation(self):
        options = self.options()
        SecurityState.objects.filter(user=self.owner).update(session_version=1)
        self.assertEqual(self.register(options, self.new_authenticator(options)).status_code, 401)
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_expired_registration_challenge_cannot_create_device(self):
        options = self.options()
        PasskeyChallenge.objects.filter(pk=options["challengeId"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.register(options, self.new_authenticator(options)).status_code, 400)
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_new_options_replace_only_this_sessions_registration_challenge(self):
        first = self.options()
        second = self.options()
        self.assertIsNotNone(PasskeyChallenge.objects.get(pk=first["challengeId"]).consumed_at)
        self.assertEqual(self.register(first, self.new_authenticator(first)).status_code, 400)
        self.assertEqual(self.register(second, self.new_authenticator(second)).status_code, 200)

    def test_duplicate_credential_cannot_be_registered_twice(self):
        key, _ = self.enroll()
        options = self.options()
        self.assertIn(key.credential_id_b64, [row["id"] for row in options["publicKey"]["excludeCredentials"]])
        self.assertEqual(self.register(options, key).status_code, 409)
        self.assertEqual(PasskeyDevice.objects.count(), 1)

    def test_configuration_changes_invalidate_outstanding_registration(self):
        options = self.options()
        with self.settings(SECURITY_PASSKEY_ORIGIN="https://localhost:8000"):
            self.assertEqual(self.register(options, self.new_authenticator(options)).status_code, 400)
        self.assertFalse(PasskeyDevice.objects.exists())

    def test_management_mutations_require_current_password(self):
        _, device = self.enroll()
        self.assertEqual(self.client.post(reverse("security:passkey_grant"), {
            "user_id": self.manager.pk, "label": "PC", "password": "wrong",
        }).status_code, 403)
        self.assertEqual(self.client.post(reverse("security:passkey_revoke", args=[device.pk]), {"password": "wrong"}).status_code, 403)
        self.assertFalse(PasskeyGrant.objects.exists())
        device.refresh_from_db()
        self.assertIsNone(device.revoked_at)

    def test_csrf_is_required_for_options_and_management_forms(self):
        strict = Client(enforce_csrf_checks=True)
        self.mfa_session(strict, self.owner)
        self.assertEqual(self.post_json("passkey_register_options", {"password": self.password, "label": "PC"}, strict).status_code, 403)
        self.assertEqual(strict.post(reverse("security:passkey_grant"), {"password": self.password, "user_id": self.manager.pk, "label": "PC"}).status_code, 403)
        self.assertFalse(PasskeyChallenge.objects.exists())
        self.assertFalse(PasskeyGrant.objects.exists())


@override_settings(**PASSKEY_TEST_SETTINGS)
class PasskeyLoginTests(PasskeyFlowHelpers, TestCase):
    def setUp(self):
        super().setUp()
        self.key, self.device = self.enroll()
        self.login_client = Client()

    def test_assertion_requires_password_verified_pending_session(self):
        self.assertEqual(self.post_json("passkey_login_options", {}, self.login_client).status_code, 403)
        self.assertEqual(self.post_json("passkey_login_verify", {}, self.login_client).status_code, 403)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_successful_assertion_is_consumed_and_cannot_authenticate_again(self):
        options = self.begin_login(self.login_client)
        credential = self.key.authentication(options["publicKey"]["challenge"])
        payload = {"challenge_id": options["challengeId"], "credential": credential}
        self.assertEqual(self.post_json("passkey_login_verify", payload, self.login_client).status_code, 200)
        self.assertIsNotNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)
        self.assertEqual(self.post_json("passkey_login_verify", payload, self.login_client).status_code, 403)
        self.assertEqual(SecurityEvent.objects.filter(event="login_success", user=self.owner).count(), 1)

    def test_assertion_cannot_cross_browser_sessions(self):
        options = self.begin_login(self.login_client)
        other = Client()
        self.begin_login(other)
        self.assertEqual(self.authenticate(other, options, self.key).status_code, 400)
        self.assertNotIn("_auth_user_id", other.session)
        self.assertIsNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 200)

    def test_assertion_bound_to_account_even_with_valid_other_credential(self):
        authorization = self.grant()
        manager_client = Client()
        self.mfa_session(manager_client, self.manager)
        other_key, _ = self.enroll(manager_client, grant_id=str(authorization.pk))
        options = self.begin_login(self.login_client)
        self.assertEqual(self.authenticate(self.login_client, options, other_key).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_invalid_signature_is_rejected_by_real_verifier(self):
        options = self.begin_login(self.login_client)
        impostor = SyntheticAuthenticator(rp_id="localhost", origin="http://localhost:8000",
            credential_id=self.key.credential_id, user_handle=self.key.user_handle)
        self.assertEqual(self.authenticate(self.login_client, options, impostor).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_key_added_after_options_is_outside_original_allow_credentials(self):
        options = self.begin_login(self.login_client)
        second_key, _ = self.enroll(label="Nueva computadora")
        self.assertNotIn(second_key.credential_id_b64, [row["id"] for row in options["publicKey"]["allowCredentials"]])
        self.assertEqual(self.authenticate(self.login_client, options, second_key).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_signed_assertion_cannot_change_registered_device_type(self):
        options = self.begin_login(self.login_client)
        self.assertEqual(self.authenticate(self.login_client, options, self.key, backup_eligible=True).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_signed_assertion_for_a_different_challenge_is_rejected(self):
        options = self.begin_login(self.login_client)
        credential = self.key.authentication(b"unrelated-synthetic-challenge")
        self.assertEqual(self.post_json("passkey_login_verify", {
            "challenge_id": options["challengeId"], "credential": credential,
        }, self.login_client).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_assertion_counter_must_advance_if_authenticator_uses_one(self):
        PasskeyDevice.objects.filter(pk=self.device.pk).update(sign_count=4)
        options = self.begin_login(self.login_client)
        self.assertEqual(self.authenticate(self.login_client, options, self.key, sign_count=4).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_counterless_authenticator_and_absent_user_handle_are_supported(self):
        options = self.begin_login(self.login_client)
        self.assertEqual(self.authenticate(self.login_client, options, self.key, sign_count=0, user_handle=None).status_code, 200)
        self.device.refresh_from_db()
        self.assertEqual(self.device.sign_count, 0)

    def test_expired_challenge_is_consumed_without_authentication(self):
        options = self.begin_login(self.login_client)
        PasskeyChallenge.objects.filter(pk=options["challengeId"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 400)
        self.assertIsNotNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_challenge_and_options_do_not_extend_pending_login_lifetime(self):
        self.begin_login(self.login_client)
        session = self.login_client.session
        pending = dict(session[PENDING_KEY])
        pending["expires"] = time.time() + 20
        session[PENDING_KEY] = pending
        session.save()
        options = self.post_json("passkey_login_options", {}, self.login_client).json()
        challenge = PasskeyChallenge.objects.get(pk=options["challengeId"])
        # Datetime stores microseconds whereas time.time() can have finer precision.
        self.assertLessEqual(challenge.expires_at.timestamp(), pending["expires"] + 0.000001)
        self.assertEqual(self.login_client.session[PENDING_KEY]["expires"], pending["expires"])
        self.assertEqual(self.login_client.get(reverse("security:passkey_login")).status_code, 200)
        self.assertEqual(self.login_client.session[PENDING_KEY]["expires"], pending["expires"])

    def test_password_change_invalidates_pending_assertion(self):
        options = self.begin_login(self.login_client)
        self.owner.set_password("Changed-Synthetic-Password-912!")
        self.owner.save(update_fields=["password"])
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 403)
        self.assertNotIn(PENDING_KEY, self.login_client.session)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_session_revocation_invalidates_pending_assertion(self):
        options = self.begin_login(self.login_client)
        SecurityState.objects.filter(user=self.owner).update(session_version=1)
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 403)
        self.assertNotIn(PENDING_KEY, self.login_client.session)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_disabled_user_cannot_complete_pending_assertion(self):
        options = self.begin_login(self.login_client)
        get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 403)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_revoked_key_cannot_complete_pending_assertion(self):
        options = self.begin_login(self.login_client)
        self.assertRedirects(self.client.post(reverse("security:passkey_revoke", args=[self.device.pk]), {"password": self.password}),
                             reverse("security:passkeys"), fetch_redirect_response=False)
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)

    def test_revoking_one_key_preserves_session_using_another_key(self):
        second_key, second_device = self.enroll(label="Segunda computadora")
        options = self.begin_login(self.login_client)
        self.assertEqual(self.authenticate(self.login_client, options, self.key).status_code, 200)
        second_client = Client()
        options = self.begin_login(second_client)
        self.assertEqual(self.authenticate(second_client, options, second_key).status_code, 200)
        self.assertRedirects(self.client.post(reverse("security:passkey_revoke", args=[self.device.pk]), {"password": self.password}),
                             reverse("security:passkeys"), fetch_redirect_response=False)
        self.assertEqual(self.login_client.get(reverse("admin:index")).status_code, 302)
        self.assertNotIn("_auth_user_id", self.login_client.session)
        self.assertEqual(second_client.get(reverse("admin:index")).status_code, 200)
        self.assertEqual(second_client.session[DEVICE_ID_SESSION_KEY], second_device.persistent_id)
        self.assertEqual(SecurityState.objects.get(user=self.owner).session_version, 0)

    def test_recovery_remains_available_and_each_code_is_single_use(self):
        with transaction.atomic():
            _, codes = generate_recovery_codes(self.owner)
        self.begin_login(self.login_client)
        response = self.login_client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]})
        self.assertRedirects(response, reverse("admin:index"), fetch_redirect_response=False)
        self.assertEqual(self.login_client.get(reverse("admin:index")).status_code, 200)
        self.assertEqual(RecoveryCode.objects.filter(used_at__isnull=False).count(), 1)
        self.assertTrue(PasskeyDevice.objects.get(pk=self.device.pk).confirmed)
        second_client = Client()
        self.begin_login(second_client)
        self.assertEqual(second_client.post(reverse("security:otp"), {"method": "recovery", "token": codes[0]}).status_code, 200)
        self.assertNotIn("_auth_user_id", second_client.session)
        self.assertEqual(len(mail.outbox), 0)

    def test_email_fallback_requires_explicit_post_and_keeps_pending_deadline(self):
        self.begin_login(self.login_client)
        pending = dict(self.login_client.session[PENDING_KEY])
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self.login_client.get(reverse("security:passkey_email_fallback")).status_code, 405)
        self.assertEqual(len(mail.outbox), 0)
        response = self.login_client.post(reverse("security:passkey_email_fallback"))
        self.assertRedirects(response, reverse("security:email_verify"), fetch_redirect_response=False)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.login_client.session[PENDING_KEY]["mode"], "email")
        self.assertEqual(self.login_client.session[PENDING_KEY]["expires"], pending["expires"])

    def test_malformed_client_data_is_rejected_without_server_error(self):
        options = self.begin_login(self.login_client)
        credential = self.key.authentication(options["publicKey"]["challenge"])
        credential["response"]["clientDataJSON"] = bytes_to_base64url(b"[]")
        self.assertEqual(self.post_json("passkey_login_verify", {"challenge_id": options["challengeId"], "credential": credential}, self.login_client).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)


# Each case gets a fresh database, session, and quota. These values are signed by
# the authenticator and rejected by the production verifier, without crypto mocks.
def registration_rejection(**overrides):
    def test(self):
        options = self.options()
        self.assertEqual(self.register(options, self.new_authenticator(options), **overrides).status_code, 400)
        self.assertFalse(PasskeyDevice.objects.exists())
        self.assertIsNotNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)
    return test


def authentication_rejection(**overrides):
    def test(self):
        options = self.begin_login(self.login_client)
        self.assertEqual(self.authenticate(self.login_client, options, self.key, **overrides).status_code, 400)
        self.assertNotIn("_auth_user_id", self.login_client.session)
        self.device.refresh_from_db()
        self.assertEqual(self.device.sign_count, 0)
    return test


for _name, _override in {
    "missing_user_presence": {"user_present": False},
    "missing_user_verification": {"user_verified": False},
    "wrong_origin": {"origin": "https://attacker.example"},
    "wrong_rp": {"rp_id": "attacker.example"},
    "cross_origin": {"cross_origin": True},
    "wrong_ceremony": {"ceremony_type": "webauthn.get"},
}.items():
    setattr(PasskeyRegistrationTests, "test_registration_rejects_" + _name, registration_rejection(**_override))

for _name, _override in {
    "missing_user_presence": {"user_present": False},
    "missing_user_verification": {"user_verified": False},
    "wrong_origin": {"origin": "https://attacker.example"},
    "wrong_rp": {"rp_id": "attacker.example"},
    "cross_origin": {"cross_origin": True},
    "wrong_ceremony": {"ceremony_type": "webauthn.create"},
    "wrong_user_handle": {"user_handle": b"another-synthetic-account"},
}.items():
    setattr(PasskeyLoginTests, "test_assertion_rejects_" + _name, authentication_rejection(**_override))


@override_settings(**PASSKEY_TEST_SETTINGS)
class PasskeyConfigurationTests(TestCase):
    def test_localhost_is_supported_only_outside_production(self):
        self.assertEqual(configuration(), ("localhost", "http://localhost:8000"))
        with self.settings(ENVIRONMENT="production"):
            self.assertIsNone(configuration())

    def test_https_origin_must_exactly_match_configured_rp(self):
        for rp, origin in (
            ("127.0.0.1", "http://127.0.0.1:8000"),
            ("panel.example.com", "https://evil.example.com"),
            ("panel.example.com", "http://panel.example.com"),
            ("panel.example.com", "https://panel.example.com/path"),
            ("panel.example.com", "https://user@panel.example.com"),
        ):
            with self.subTest(origin=origin), self.settings(SECURITY_PASSKEY_RP_ID=rp, SECURITY_PASSKEY_ORIGIN=origin):
                self.assertIsNone(configuration())
        with self.settings(ENVIRONMENT="production", SECURITY_PASSKEY_RP_ID="panel.example.com", SECURITY_PASSKEY_ORIGIN="https://panel.example.com"):
            self.assertEqual(configuration(), ("panel.example.com", "https://panel.example.com"))

    def test_disabled_feature_has_no_relying_party(self):
        with self.settings(SECURITY_PASSKEYS_ENABLED=False):
            self.assertIsNone(configuration())


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locking")
@override_settings(**PASSKEY_TEST_SETTINGS)
class PasskeyConcurrencyTests(PasskeyFlowHelpers, TransactionTestCase):
    def setUp(self):
        # TransactionTestCase intentionally does not invoke setUpTestData.
        self.setUpTestData()
        super().setUp()

    def parallel_posts(self, name, clients_and_payloads):
        barrier = Barrier(2)

        def submit(item):
            close_old_connections()
            client, payload = item
            try:
                barrier.wait(timeout=10)
                return self.post_json(name, payload, client).status_code
            finally:
                # Worker threads own their connections. Healthy persistent
                # connections otherwise outlive the executor and block DROP
                # DATABASE when the PostgreSQL test runner tears down.
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(submit, clients_and_payloads))

    def test_simultaneous_assertion_replay_authenticates_exactly_once(self):
        key, _ = self.enroll()
        first = Client()
        options = self.begin_login(first)
        second = Client()
        second.cookies[settings.SESSION_COOKIE_NAME] = first.cookies[settings.SESSION_COOKIE_NAME].value
        payload = {"challenge_id": options["challengeId"], "credential": key.authentication(options["publicKey"]["challenge"])}
        statuses = self.parallel_posts("passkey_login_verify", [(first, payload), (second, payload)])
        self.assertEqual(statuses.count(200), 1)
        self.assertTrue(all(status in (200, 400, 403) for status in statuses))
        self.assertEqual(SecurityEvent.objects.filter(event="login_success", user=self.owner).count(), 1)
        self.assertIsNotNone(PasskeyChallenge.objects.get(pk=options["challengeId"]).consumed_at)

    def test_simultaneous_registrations_cannot_consume_one_grant_twice(self):
        authorization = self.grant()
        requests = []
        for _ in range(2):
            client = Client()
            self.mfa_session(client, self.manager)
            options = self.options(client, grant_id=str(authorization.pk))
            key = self.new_authenticator(options)
            requests.append((client, {"challenge_id": options["challengeId"], "credential": key.registration(options["publicKey"]["challenge"])}))
        self.assertEqual(sorted(self.parallel_posts("passkey_register_verify", requests)), [200, 403])
        self.assertEqual(PasskeyDevice.objects.filter(user=self.manager).count(), 1)
        authorization.refresh_from_db()
        self.assertIsNotNone(authorization.used_at)
