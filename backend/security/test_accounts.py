"""Owner-controlled account lifecycle against synthetic users and real HTTP views."""
import importlib
import re
import time
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core import mail
from django.db import connection, DatabaseError
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice

from .accounts import assign_role, role_permissions
from .models import (EmailDevice, EnrollmentPermission, PasskeyDevice, PasskeyGrant,
                     RecoveryCode, RecoveryDevice, SecurityEvent, SecurityState)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
                   SECURITY_OWNER_USERNAME="owner@example.com")
class TeamAccountTests(TestCase):
    password = "Synthetic-Owner-Password-950!"
    new_password = "Synthetic-New-Account-398!"

    def setUp(self):
        self.owner = get_user_model().objects.create_user(
            "owner@example.com", "owner@example.com", self.password, is_staff=True, is_superuser=True)
        self.manager = get_user_model().objects.create_user(
            "manager@example.com", "manager@example.com", self.password, is_staff=True)
        for user in (self.owner, self.manager):
            SecurityState.objects.create(user=user, mfa_method="totp")
            TOTPDevice.objects.create(user=user, confirmed=True)
        assign_role(self.manager, "catalog_inventory", role_permissions())
        self.login(self.client, self.owner)

    def login(self, client, user):
        response = client.post(reverse("security:login"), {"email": user.username, "password": self.password})
        self.assertEqual(response.status_code, 302)
        device = TOTPDevice.objects.get(user=user, confirmed=True)
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time()
        response = client.post(reverse("security:otp"), {"method": "totp", "token": f"{generator.token():06d}"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(client.get(reverse("admin:index")).status_code, 200)

    def new_data(self, **extra):
        return {"email": "new@example.com", "name": "Equipo de prueba", "role": "catalog_inventory",
                "mfa_method": "totp", "new_password": self.new_password,
                "confirm_password": self.new_password, "owner_password": self.password, **extra}

    def update(self, action, *, target=None, client=None, password=None, role="catalog_inventory", **extra):
        target = target or self.manager
        prefix = f"account-{target.pk}" if action == "access" else f"{'enrollment' if action == 'renew_enrollment' else 'status'}-{target.pk}"
        return (client or self.client).post(reverse("security:account_update", args=[target.pk]), {
            "action": action, f"{prefix}-owner_password": self.password if password is None else password,
            f"{prefix}-role": role, **extra,
        })

    def protected_state(self):
        return {model._meta.label: list(model.objects.order_by("pk").values()) for model in (
            get_user_model(), TOTPDevice, EmailDevice, RecoveryDevice, RecoveryCode,
            PasskeyDevice, EnrollmentPermission, SecurityState,
            get_user_model().user_permissions.through, get_user_model().groups.through,
        )}

    def test_list_is_private_owner_only_even_if_other_account_is_superuser(self):
        response = self.client.get(reverse("security:accounts"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.manager.username)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotContains(response, self.owner.password)
        self.assertNotContains(response, self.password)
        self.assertNotContains(response, TOTPDevice.objects.get(user=self.owner).key)
        other = Client()
        self.login(other, self.manager)
        self.assertEqual(other.get(reverse("security:accounts")).status_code, 403)
        self.manager.is_superuser = True
        self.manager.save(update_fields=["is_superuser"])
        self.assertEqual(other.get(reverse("security:accounts")).status_code, 403)

    def test_password_only_owner_and_anonymous_cannot_manage(self):
        for logged_in in (False, True):
            client = Client()
            if logged_in:
                client.force_login(self.owner)
            with self.subTest(logged_in=logged_in):
                before = self.protected_state()
                self.assertEqual(client.get(reverse("security:accounts")).status_code, 302)
                self.assertEqual(client.post(reverse("security:account_create"), self.new_data()).status_code, 302)
                self.assertEqual(self.protected_state(), before)

    def test_manager_cannot_create_edit_disable_or_reactivate_any_account(self):
        client = Client()
        self.login(client, self.manager)
        before = self.protected_state()
        self.assertEqual(client.post(reverse("security:account_create"), self.new_data()).status_code, 403)
        for action in ("access", "deactivate", "reactivate", "renew_enrollment"):
            self.assertEqual(self.update(action, client=client).status_code, 403)
        self.assertEqual(self.protected_state(), before)

    def test_creation_sets_exact_role_without_superuser_or_confirmed_mfa(self):
        before_owner = get_user_model().objects.filter(pk=self.owner.pk).values().get()
        with patch("django.core.mail.send_mail") as send:
            response = self.client.post(reverse("security:account_create"), self.new_data(
                email=" NEW@EXAMPLE.COM ", role="inventory", is_superuser="1", is_active="0"))
            send.assert_not_called()
        self.assertRedirects(response, reverse("security:accounts"))
        account = get_user_model().objects.get(username="new@example.com")
        self.assertTrue(account.check_password(self.new_password))
        self.assertTrue(account.is_staff)
        self.assertTrue(account.is_active)
        self.assertFalse(account.is_superuser)
        self.assertEqual(account.get_all_permissions(), {"catalog.view_inventory"})
        permission = EnrollmentPermission.objects.get(user=account)
        self.assertIsNone(permission.used_at)
        self.assertEqual(permission.expires_at - permission.created_at, timedelta(hours=24))
        for model in (TOTPDevice, EmailDevice, RecoveryDevice, PasskeyDevice):
            self.assertFalse(model.objects.filter(user=account).exists())
        self.assertEqual(get_user_model().objects.filter(pk=self.owner.pk).values().get(), before_owner)
        event = SecurityEvent.objects.get(event="team_account_created")
        self.assertEqual(event.user, self.owner)
        self.assertNotIn(self.new_password, event.detail)
        self.assertNotIn(account.password, event.detail)

    def test_new_account_must_complete_own_mfa_before_access(self):
        self.client.post(reverse("security:account_create"), self.new_data())
        account = get_user_model().objects.get(username="new@example.com")
        client = Client()
        response = client.post(reverse("security:login"), {"email": account.username, "password": self.new_password})
        self.assertRedirects(response, reverse("security:setup"), fetch_redirect_response=False)
        self.assertNotIn("_auth_user_id", client.session)
        self.assertEqual(client.get(reverse("admin:index")).status_code, 302)
        self.assertEqual(client.get(reverse("security:setup")).status_code, 200)
        device = TOTPDevice.objects.get(user=account, confirmed=False)
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time()
        response = client.post(reverse("security:setup"), {"token": f"{generator.token():06d}"})
        self.assertEqual(response.status_code, 200)
        device.refresh_from_db()
        self.assertTrue(device.confirmed)
        self.assertEqual(client.get(reverse("admin:index")).status_code, 200)

    def test_weak_mismatched_and_invalid_role_inputs_never_create_account(self):
        for extra in ({"new_password": "short", "confirm_password": "short"},
                      {"confirm_password": "Does-not-match-793!"}, {"role": "superuser"},
                      {"owner_password": "wrong"}, {"mfa_method": "none"}):
            with self.subTest(extra=list(extra)):
                before = self.protected_state()
                response = self.client.post(reverse("security:account_create"), self.new_data(**extra))
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.protected_state(), before)
                self.assertNotContains(response, self.new_password, status_code=400)
                self.assertNotContains(response, self.password, status_code=400)

    def test_email_mfa_requires_transport_and_sends_no_code_during_creation(self):
        with patch("security.account_forms.mail_configuration_ready", return_value=False):
            response = self.client.post(reverse("security:account_create"), self.new_data(mfa_method="email"))
            self.assertEqual(response.status_code, 400)
        with patch("security.account_forms.mail_configuration_ready", return_value=True):
            response = self.client.post(reverse("security:account_create"), self.new_data(mfa_method="email"))
            self.assertEqual(response.status_code, 302)
        account = get_user_model().objects.get(username="new@example.com")
        self.assertEqual(SecurityState.objects.get(user=account).mfa_method, "email")
        self.assertFalse(EmailDevice.objects.filter(user=account).exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_duplicate_email_and_owner_address_never_reset_existing_access(self):
        before = self.protected_state()
        for email in ("MANAGER@EXAMPLE.COM", "OWNER@EXAMPLE.COM"):
            response = self.client.post(reverse("security:account_create"), self.new_data(email=email))
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.protected_state(), before)

    def test_self_and_every_superuser_are_protected_from_all_mutations(self):
        other = get_user_model().objects.create_user("protected@example.com", is_staff=True, is_superuser=True)
        before = self.protected_state()
        for target in (self.owner, other):
            for action in ("access", "deactivate", "reactivate", "renew_enrollment"):
                self.assertEqual(self.update(action, target=target).status_code, 403)
        self.assertEqual(self.protected_state(), before)

    def test_wrong_password_and_unknown_role_do_not_change_existing_account(self):
        before = self.protected_state()
        self.assertEqual(self.update("access", role="inventory", password="wrong").status_code, 400)
        self.assertEqual(self.update("deactivate", password="wrong").status_code, 400)
        self.assertEqual(self.update("access", role="owner").status_code, 400)
        self.assertEqual(self.protected_state(), before)

    def test_real_csrf_blocks_create_and_update_without_token(self):
        client = Client(enforce_csrf_checks=True)
        client.cookies = self.client.cookies
        self.assertEqual(client.post(reverse("security:account_create"), self.new_data()).status_code, 403)
        self.assertEqual(self.update("deactivate", client=client).status_code, 403)
        response = client.get(reverse("security:accounts"))
        token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', response.content.decode())[1]
        data = self.new_data(csrfmiddlewaretoken=token)
        self.assertEqual(client.post(reverse("security:account_create"), data).status_code, 302)

    def test_deactivate_reactivate_invalidates_old_sessions_and_keeps_all_credentials(self):
        manager_client = Client()
        self.login(manager_client, self.manager)
        before_password = self.manager.password
        before_device = list(TOTPDevice.objects.filter(user=self.manager).values())
        grant = PasskeyGrant.objects.create(user=self.manager, authorized_by=self.owner, label="Synthetic laptop",
                                           expires_at=timezone.now() + timedelta(hours=24))
        state = SecurityState.objects.get(user=self.manager)
        self.assertEqual(self.update("deactivate").status_code, 302)
        self.manager.refresh_from_db()
        state.refresh_from_db()
        grant.refresh_from_db()
        self.assertFalse(self.manager.is_active)
        self.assertEqual(state.session_version, 1)
        self.assertIsNotNone(grant.revoked_at)
        self.assertEqual(manager_client.get(reverse("admin:index")).status_code, 302)
        self.assertEqual(self.update("reactivate").status_code, 302)
        self.manager.refresh_from_db()
        state.refresh_from_db()
        self.assertTrue(self.manager.is_active)
        self.assertEqual(state.session_version, 2)
        self.assertEqual(manager_client.get(reverse("admin:index")).status_code, 302)
        self.assertEqual(self.manager.password, before_password)
        self.assertEqual(list(TOTPDevice.objects.filter(user=self.manager).values()), before_device)
        self.assertEqual(self.client.get(reverse("admin:index")).status_code, 200)

    def test_catalog_and_inventory_are_separate_in_both_directions(self):
        roles = role_permissions()
        catalog = get_user_model().objects.create_user("catalog@example.com", "catalog@example.com", self.password, is_staff=True)
        inventory = get_user_model().objects.create_user("inventory@example.com", "inventory@example.com", self.password, is_staff=True)
        for user, role in ((catalog, "catalog"), (inventory, "inventory")):
            assign_role(user, role, roles)
            SecurityState.objects.create(user=user)
            TOTPDevice.objects.create(user=user, confirmed=True)
        catalog_client, inventory_client = Client(), Client()
        self.login(catalog_client, catalog)
        self.login(inventory_client, inventory)
        self.assertEqual(catalog_client.get(reverse("admin:catalog_product_changelist")).status_code, 200)
        for path, method in (("inventory-dashboard", "get"), ("inventory-status", "get"), ("inventory-refresh", "post")):
            with patch("catalog.inventory_views.load_snapshot") as read, patch("catalog.inventory_sync.fetch_sheet") as fetch:
                self.assertEqual(getattr(catalog_client, method)(reverse(path)).status_code, 403)
                read.assert_not_called()
                fetch.assert_not_called()
        self.assertEqual(inventory_client.get(reverse("admin:catalog_product_changelist")).status_code, 403)
        with patch("catalog.inventory_views.load_snapshot", return_value=None):
            response = inventory_client.get(reverse("inventory-dashboard"))
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, reverse("admin:catalog_product_changelist"))

    def test_permission_change_preserves_shared_group_but_removes_target_membership(self):
        group = Group.objects.create(name="INOX · Gerencia")
        group.permissions.set(role_permissions()["catalog_inventory"])
        self.manager.user_permissions.clear()
        self.manager.groups.add(group)
        peer = get_user_model().objects.create_user("peer@example.com", is_staff=True)
        peer.groups.add(group)
        group_before = set(group.permissions.values_list("pk", flat=True))
        self.assertEqual(self.update("access", role="inventory").status_code, 302)
        self.manager.refresh_from_db()
        self.assertEqual(self.manager.get_all_permissions(), {"catalog.view_inventory"})
        self.assertFalse(self.manager.groups.filter(pk=group.pk).exists())
        self.assertTrue(peer.groups.filter(pk=group.pk).exists())
        self.assertEqual(set(group.permissions.values_list("pk", flat=True)), group_before)
        self.assertEqual(SecurityState.objects.get(user=self.manager).session_version, 1)
        self.assertFalse(self.manager.is_superuser)

    def test_permission_change_invalidates_authenticated_and_pending_sessions(self):
        authenticated, pending = Client(), Client()
        self.login(authenticated, self.manager)
        response = pending.post(reverse("security:login"), {
            "email": self.manager.username, "password": self.password})
        self.assertRedirects(response, reverse("security:otp"), fetch_redirect_response=False)
        self.assertIn("security_pending", pending.session)
        self.assertEqual(self.update("access", role="inventory").status_code, 302)
        self.assertEqual(authenticated.get(reverse("admin:catalog_product_changelist")).status_code, 302)
        self.assertNotIn("_auth_user_id", authenticated.session)
        self.assertEqual(pending.get(reverse("security:otp")).status_code, 302)
        self.assertNotIn("security_pending", pending.session)

    def test_existing_credentials_and_identity_cannot_be_changed_by_extra_fields(self):
        before_password = self.manager.password
        before_devices = list(TOTPDevice.objects.filter(user=self.manager).values())
        response = self.update("access", role="inventory", is_superuser="1", username=self.owner.username,
                               email=self.owner.email, password_new=self.new_password, mfa_method="none")
        self.assertEqual(response.status_code, 302)
        self.manager.refresh_from_db()
        self.assertFalse(self.manager.is_superuser)
        self.assertEqual(self.manager.username, "manager@example.com")
        self.assertEqual(self.manager.email, "manager@example.com")
        self.assertEqual(self.manager.password, before_password)
        self.assertEqual(list(TOTPDevice.objects.filter(user=self.manager).values()), before_devices)
        self.assertEqual(SecurityState.objects.get(user=self.manager).mfa_method, "totp")

    def test_idempotent_updates_leave_sessions_and_audit_unchanged(self):
        before = self.protected_state()
        before_events = SecurityEvent.objects.count()
        self.assertEqual(self.update("access").status_code, 302)
        self.assertEqual(self.update("reactivate").status_code, 302)
        self.assertEqual(self.protected_state(), before)
        self.assertEqual(SecurityEvent.objects.count(), before_events)

    def test_expired_initial_permission_cannot_activate_mfa_or_enter_admin(self):
        self.client.post(reverse("security:account_create"), self.new_data())
        account = get_user_model().objects.get(username="new@example.com")
        EnrollmentPermission.objects.filter(user=account).update(expires_at=timezone.now() - timedelta(seconds=1))
        client = Client()
        response = client.post(reverse("security:login"), {"email": account.username, "password": self.new_password})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("_auth_user_id", client.session)
        self.assertEqual(client.get(reverse("security:setup")).status_code, 302)
        self.assertEqual(client.get(reverse("admin:index")).status_code, 302)
        self.assertFalse(TOTPDevice.objects.filter(user=account).exists())

    def test_failed_owner_confirmation_is_rate_limited_without_mutating_accounts(self):
        before = self.protected_state()
        for unused in range(5):
            self.assertEqual(self.update("deactivate", password="wrong").status_code, 400)
        self.assertEqual(self.update("deactivate", password="wrong").status_code, 429)
        self.assertEqual(self.protected_state(), before)

    def test_owner_can_renew_only_expired_initial_activation_without_reset_or_delivery(self):
        self.client.post(reverse("security:account_create"), self.new_data())
        account = get_user_model().objects.get(username="new@example.com")
        original = EnrollmentPermission.objects.get(user=account)
        self.assertEqual(self.update("renew_enrollment", target=account).status_code, 302)
        original.refresh_from_db()
        self.assertEqual(original.created_at + timedelta(hours=24), original.expires_at)
        self.assertEqual(SecurityState.objects.get(user=account).session_version, 0)
        pending = Client()
        pending.post(reverse("security:login"), {"email": account.username, "password": self.new_password})
        self.assertEqual(pending.get(reverse("security:setup")).status_code, 200)
        before_devices = list(TOTPDevice.objects.filter(user=account).values())
        EnrollmentPermission.objects.filter(user=account).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertContains(self.client.get(reverse("security:accounts")), "Renovar activación inicial")
        self.assertEqual(self.update("renew_enrollment", target=account, password="wrong").status_code, 400)
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.cookies = self.client.cookies
        self.assertEqual(self.update("renew_enrollment", target=account, client=csrf_client).status_code, 403)
        self.assertEqual(self.update("renew_enrollment", target=account).status_code, 302)
        original.refresh_from_db()
        account.refresh_from_db()
        self.assertIsNone(original.used_at)
        self.assertEqual(original.expires_at - original.created_at, timedelta(hours=24))
        self.assertGreater(original.created_at, timezone.now() - timedelta(seconds=10))
        self.assertTrue(account.check_password(self.new_password))
        self.assertEqual(list(TOTPDevice.objects.filter(user=account).values()), before_devices)
        self.assertFalse(RecoveryDevice.objects.filter(user=account).exists())
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(SecurityState.objects.get(user=account).session_version, 1)
        self.assertEqual(pending.get(reverse("security:setup")).status_code, 302)
        self.assertTrue(SecurityEvent.objects.filter(event="team_account_access_changed", user=self.owner,
                                                     detail__endswith="action:renew_enrollment").exists())

    def test_initial_activation_renewal_never_resets_any_confirmed_factor(self):
        for model in (TOTPDevice, EmailDevice, RecoveryDevice, PasskeyDevice):
            with self.subTest(model=model.__name__):
                account = get_user_model().objects.create_user(
                    f"{model.__name__}@example.com", password=self.new_password, is_staff=True)
                SecurityState.objects.create(user=account)
                EnrollmentPermission.objects.create(user=account, expires_at=timezone.now() - timedelta(seconds=1))
                kwargs = {"credential_id": "synthetic-credential", "public_key": b"synthetic", "rp_id": "example.com",
                          "origin": "https://example.com"} if model is PasskeyDevice else {}
                model.objects.create(user=account, confirmed=True, **kwargs)
                before = self.protected_state()
                self.assertEqual(self.update("renew_enrollment", target=account).status_code, 400)
                self.assertEqual(self.protected_state(), before)

    def test_initial_activation_renewal_rejects_missing_used_or_inactive_authorizations(self):
        account = get_user_model().objects.create_user("pending@example.com", password=self.new_password, is_staff=True)
        SecurityState.objects.create(user=account)
        before = self.protected_state()
        self.assertEqual(self.update("renew_enrollment", target=account).status_code, 400)
        self.assertEqual(self.protected_state(), before)
        permission = EnrollmentPermission.objects.create(user=account, expires_at=timezone.now() - timedelta(seconds=1), used_at=timezone.now())
        before = self.protected_state()
        self.assertEqual(self.update("renew_enrollment", target=account).status_code, 400)
        self.assertEqual(self.protected_state(), before)
        permission.used_at = None
        permission.save(update_fields=["used_at"])
        account.is_active = False
        account.save(update_fields=["is_active"])
        before = self.protected_state()
        self.assertEqual(self.update("renew_enrollment", target=account).status_code, 400)
        self.assertEqual(self.protected_state(), before)

    def test_unexpected_privileges_cannot_be_silently_replaced_or_reactivated(self):
        self.manager.user_permissions.add(Permission.objects.get(content_type__app_label="auth", codename="change_user"))
        before = self.protected_state()
        self.assertEqual(self.update("access", role="inventory").status_code, 400)
        self.assertEqual(self.protected_state(), before)
        self.assertEqual(self.update("deactivate").status_code, 302)
        self.assertEqual(self.update("reactivate").status_code, 400)
        self.manager.refresh_from_db()
        self.assertFalse(self.manager.is_active)

    def test_audit_failure_rolls_back_account_creation_and_access_changes(self):
        before = self.protected_state()
        with patch("security.account_views.audit", side_effect=DatabaseError("Synthetic audit failure")):
            with self.assertRaises(DatabaseError):
                self.client.post(reverse("security:account_create"), self.new_data())
            self.assertEqual(self.protected_state(), before)
            with self.assertRaises(DatabaseError):
                self.update("deactivate")
            self.assertEqual(self.protected_state(), before)

    def test_get_never_changes_accounts_and_generic_user_admin_stays_disabled(self):
        before = self.protected_state()
        self.assertEqual(self.client.get(reverse("security:account_create")).status_code, 405)
        self.assertEqual(self.client.get(reverse("security:account_update", args=[self.manager.pk])).status_code, 405)
        self.assertEqual(self.protected_state(), before)
        for model in (get_user_model(), Group, TOTPDevice):
            self.assertFalse(admin.site.is_registered(model))

    def test_inventory_migration_preserves_only_the_existing_management_group(self):
        permission = Permission.objects.get(content_type__app_label="catalog", codename="view_inventory")
        group = Group.objects.create(name="INOX · Gerencia")
        other = Group.objects.create(name="Other catalog readers")
        other.permissions.add(Permission.objects.get(content_type__app_label="catalog", codename="view_product"))
        user_before = list(get_user_model().objects.order_by("pk").values())
        migration = importlib.import_module("catalog.migrations.0005_inventory_access_permission")
        migration.preserve_management_inventory(apps, SimpleNamespace(connection=connection))
        self.assertTrue(group.permissions.filter(pk=permission.pk).exists())
        self.assertFalse(other.permissions.filter(pk=permission.pk).exists())
        self.assertEqual(list(get_user_model().objects.order_by("pk").values()), user_before)
