from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.management.commands.configure_business_roles import GROUP_NAME, commercial_permission_ids
from security.models import (
    EmailChallenge, EmailDevice, EnrollmentPermission, PasskeyChallenge, PasskeyDevice,
    PasskeyGrant, PasskeyIdentity, RecoveryCode, RecoveryDevice, SecurityEvent, SecurityState,
)


@override_settings(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    SECURITY_OWNER_USERNAME="owner@example.com",
)
class BusinessRoleCommandTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            "owner@example.com", "owner@example.com", "Synthetic-owner-password!", is_staff=True, is_superuser=True,
        )
        self.manager = user_model.objects.create_user(
            "manager@example.com", "manager@example.com", "Synthetic-manager-password!", is_staff=True, is_superuser=True,
        )
        now = timezone.now()
        for user in (self.owner, self.manager):
            SecurityState.objects.create(user=user, mfa_method="email", session_version=7)
            device = EmailDevice.objects.create(user=user, email=user.email, confirmed=True, last_sent_at=now)
            EmailChallenge.objects.create(
                device=device, purpose="login", recipient=user.email, token_hash="synthetic-email-hash",
                session_digest="synthetic-session-digest", auth_hash="synthetic-auth-hash", session_version=7,
                expires_at=now + timedelta(minutes=5),
            )
            TOTPDevice.objects.create(user=user, confirmed=True, key="ab" * 20)
            recovery = RecoveryDevice.objects.create(user=user, confirmed=True)
            RecoveryCode.objects.create(device=recovery, selector=f"{user.pk:08x}", token_hash="synthetic-recovery-hash")
            EnrollmentPermission.objects.create(user=user, expires_at=now, used_at=now)
            PasskeyIdentity.objects.create(user=user)
            PasskeyDevice.objects.create(
                user=user, name="Synthetic laptop", credential_id=f"synthetic-credential-{user.pk}",
                public_key=b"synthetic-public-key", rp_id="panel.example.com", origin="https://panel.example.com", confirmed=True,
            )
            Session.objects.create(session_key=f"synthetic-session-{user.pk}", session_data="synthetic-session-data", expire_date=now + timedelta(days=1))
        grant = PasskeyGrant.objects.create(user=self.manager, authorized_by=self.owner, label="Synthetic manager laptop", expires_at=now + timedelta(hours=1))
        PasskeyChallenge.objects.create(
            user=self.manager, purpose="register", challenge=b"synthetic-challenge", session_digest="synthetic-digest",
            auth_hash="synthetic-auth-hash", session_version=7, rp_id="panel.example.com", origin="https://panel.example.com",
            grant=grant, expires_at=now + timedelta(minutes=5),
        )

    def configure(self, **kwargs):
        output = StringIO()
        with patch("django.core.mail.send_mail") as send:
            call_command("configure_business_roles", owner=kwargs.pop("owner", self.owner.username),
                         manager=kwargs.pop("manager", self.manager.username), stdout=output, **kwargs)
            send.assert_not_called()
        return output.getvalue()

    def protected_rows(self):
        models = (SecurityState, EmailDevice, EmailChallenge, TOTPDevice, RecoveryDevice, RecoveryCode,
                  EnrollmentPermission, PasskeyIdentity, PasskeyDevice, PasskeyGrant, PasskeyChallenge, Session)
        return {model._meta.label: list(model.objects.order_by("pk").values()) for model in models}

    def whole_state(self):
        result = self.protected_rows()
        models = (get_user_model(), Group, Group.permissions.through,
                  get_user_model().groups.through, get_user_model().user_permissions.through, SecurityEvent)
        result.update({model._meta.label: list(model.objects.order_by("pk").values()) for model in models})
        return result

    def assert_abort_preserves_everything(self, message, **kwargs):
        before = self.whole_state()
        with self.assertRaisesMessage(CommandError, message):
            self.configure(**kwargs)
        self.assertEqual(self.whole_state(), before)

    def test_assigns_only_catalog_permissions_and_preserves_credentials_mfa_sessions(self):
        protected = self.protected_rows()
        owner_before = get_user_model().objects.filter(pk=self.owner.pk).values().get()
        manager_before = get_user_model().objects.filter(pk=self.manager.pk).values().get()
        output = self.configure(owner=" OWNER@EXAMPLE.COM ", manager=" MANAGER@EXAMPLE.COM ")
        self.owner.refresh_from_db()
        self.manager.refresh_from_db()
        self.assertTrue(self.owner.is_superuser)
        self.assertFalse(self.manager.is_superuser)
        self.assertTrue(self.manager.is_staff)
        manager_before["is_superuser"] = False
        self.assertEqual(get_user_model().objects.filter(pk=self.owner.pk).values().get(), owner_before)
        self.assertEqual(get_user_model().objects.filter(pk=self.manager.pk).values().get(), manager_before)
        self.assertEqual(self.protected_rows(), protected)
        group = Group.objects.get(name=GROUP_NAME)
        self.assertEqual(set(group.permissions.values_list("pk", flat=True)), commercial_permission_ids())
        self.assertEqual(list(self.manager.groups.all()), [group])
        self.assertTrue(self.manager.has_perm("catalog.change_product"))
        self.assertTrue(self.manager.has_perm("catalog.view_businesssettings"))
        self.assertFalse(self.manager.has_perm("auth.change_user"))
        self.assertFalse(self.manager.has_perm("security.change_securitystate"))
        event = SecurityEvent.objects.get()
        self.assertEqual(event.event, "business_roles_configured_by_cli")
        self.assertEqual(event.user, self.manager)
        self.assertIn(f"owner_id={self.owner.pk};manager_id={self.manager.pk};group_id={group.pk}", event.detail)
        for secret in (self.owner.password, self.manager.password, self.owner.username, self.manager.username):
            self.assertNotIn(secret, event.detail)
            self.assertNotIn(secret, output)
        before = self.whole_state()
        self.assertIn("No hubo cambios", self.configure())
        self.assertEqual(self.whole_state(), before)

    def test_preserves_valid_external_groups_and_direct_catalog_permissions(self):
        permission = Permission.objects.get(content_type__app_label="catalog", codename="view_product")
        group = Group.objects.create(name="Existing commercial readers")
        group.permissions.add(permission)
        self.manager.groups.add(group)
        self.manager.user_permissions.add(permission)
        role = Group.objects.create(name=GROUP_NAME)
        role.permissions.add(permission)
        self.configure()
        self.assertEqual(set(self.manager.groups.values_list("pk", flat=True)), {group.pk, role.pk})
        self.assertEqual(list(group.permissions.values_list("pk", flat=True)), [permission.pk])
        self.assertEqual(list(self.manager.user_permissions.values_list("pk", flat=True)), [permission.pk])

    def test_rejects_direct_privileged_permissions_without_removing_them(self):
        self.manager.user_permissions.add(Permission.objects.get(content_type__app_label="auth", codename="change_user"))
        self.assert_abort_preserves_everything("permisos directos ajenos")

    def test_rejects_inherited_privileged_permissions_without_changing_external_group(self):
        group = Group.objects.create(name="Existing system administrators")
        group.permissions.add(Permission.objects.get(content_type__app_label="security", codename="change_securitystate"))
        self.manager.groups.add(group)
        self.assert_abort_preserves_everything("grupo con permisos ajenos")

    def test_rejects_contaminated_role_even_when_manager_is_not_a_member(self):
        role = Group.objects.create(name=GROUP_NAME)
        role.permissions.add(Permission.objects.get(content_type__app_label="auth", codename="view_user"))
        self.assert_abort_preserves_everything("grupo INOX · Gerencia contiene permisos ajenos")

    def test_custom_catalog_permissions_are_not_silently_inherited(self):
        content_type = ContentType.objects.get(app_label="catalog", model="product")
        permission = Permission.objects.create(content_type=content_type, codename="change_unrestricted", name="Synthetic custom privileged action")
        self.manager.user_permissions.add(permission)
        self.assert_abort_preserves_everything("permisos directos ajenos")

    def test_rejects_mismatched_or_missing_private_owner_configuration(self):
        for value in ("", "someone-else@example.com"):
            with self.subTest(value=value), override_settings(SECURITY_OWNER_USERNAME=value):
                self.assert_abort_preserves_everything("SECURITY_OWNER_USERNAME")

    def test_rejects_same_missing_or_ambiguous_accounts_without_creating_users(self):
        self.assert_abort_preserves_everything("cuentas distintas", manager=self.owner.username)
        self.assert_abort_preserves_everything("única cuenta existente", manager="missing@example.com")
        get_user_model().objects.create_user("MANAGER@EXAMPLE.COM", "other@example.com", "Synthetic duplicate", is_staff=True)
        self.assert_abort_preserves_everything("única cuenta existente")

    def test_rejects_inactive_or_nonstaff_accounts_without_promoting_them(self):
        for user in (self.owner, self.manager):
            for field in ("is_active", "is_staff"):
                with self.subTest(user=user.pk, field=field):
                    get_user_model().objects.filter(pk=user.pk).update(**{field: False})
                    self.assert_abort_preserves_everything("activas y tener acceso administrativo")
                    get_user_model().objects.filter(pk=user.pk).update(**{field: True})

    def test_never_promotes_owner_and_refuses_unreviewed_third_superusers(self):
        get_user_model().objects.filter(pk=self.owner.pk).update(is_superuser=False)
        self.assert_abort_preserves_everything("este comando no la promueve")
        get_user_model().objects.filter(pk=self.owner.pk).update(is_superuser=True)
        get_user_model().objects.create_user("third@example.com", "third@example.com", "Synthetic third", is_staff=True, is_superuser=True)
        self.assert_abort_preserves_everything("otras cuentas de superusuario")

    def test_already_non_superuser_manager_receives_business_access(self):
        get_user_model().objects.filter(pk=self.manager.pk).update(is_superuser=False)
        self.configure()
        self.manager.refresh_from_db()
        self.assertFalse(self.manager.is_superuser)
        self.assertTrue(self.manager.has_perm("catalog.add_product"))

    def test_incomplete_permission_installation_is_not_repaired_automatically(self):
        Permission.objects.get(content_type__app_label="catalog", codename="view_product").delete()
        self.assert_abort_preserves_everything("permisos del catálogo están incompletos")

    def test_audit_failure_rolls_back_role_and_demotion(self):
        before = self.whole_state()
        with patch("security.management.commands.configure_business_roles.audit", side_effect=DatabaseError("synthetic failure")):
            with self.assertRaises(DatabaseError):
                self.configure()
        self.assertEqual(self.whole_state(), before)

    def test_invalid_email_is_refused_without_mutation(self):
        self.assert_abort_preserves_everything("correos válidos", manager="not-an-email")
