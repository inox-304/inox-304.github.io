from types import SimpleNamespace
import time

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import TestCase, override_settings
from django.urls import reverse
from django_otp import DEVICE_ID_SESSION_KEY

from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION

from .models import Product
from .templatetags.admin_overview import catalog_overview


class AdminHomeOverviewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for code, published, active in (
            ("HOME-PUBLIC", True, True),
            ("HOME-HIDDEN", True, False),
            ("HOME-DRAFT", False, True),
        ):
            Product.objects.create(
                code=code,
                slug=code.lower(),
                name=code,
                category=Product.Category.HOT,
                is_published=published,
                is_active=active,
            )

    def test_catalog_counts_require_product_permission(self):
        for user in (AnonymousUser(), SimpleNamespace(has_perm=lambda permission: False)):
            with self.subTest(user=user), self.assertNumQueries(0):
                result = catalog_overview({"request": SimpleNamespace(user=user)})
            self.assertIsNone(result)

    def test_count_visible_products_separately_from_drafts_and_hidden(self):
        for permission in ("catalog.view_product", "catalog.change_product"):
            user = SimpleNamespace(has_perm=lambda value: value == permission)
            with self.subTest(permission=permission), self.assertNumQueries(1):
                result = catalog_overview({"request": SimpleNamespace(user=user)})
            self.assertEqual(result, {"total": 3, "published": 1, "drafts": 1})

    def test_missing_request_does_not_query_catalog(self):
        with self.assertNumQueries(0):
            self.assertIsNone(catalog_overview({}))


@override_settings(
    SECURITY_OWNER_USERNAME="home-owner@example.test",
    SECURITY_PASSKEYS_ENABLED=False,
    SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class AdminTeamAccessHomeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Synthetic MFA sessions only: no installation accounts or real email.
        cls.owner = get_user_model().objects.create_user(
            "home-owner@example.test", "home-owner@example.test", "Synthetic-home-password-532!",
            is_active=True, is_staff=True, is_superuser=True,
        )
        cls.other_admin = get_user_model().objects.create_user(
            "home-admin@example.test", "home-admin@example.test", "Synthetic-home-password-653!",
            is_active=True, is_staff=True, is_superuser=True,
        )
        for user in (cls.owner, cls.other_admin):
            SecurityState.objects.create(user=user, mfa_method="email")
            EmailDevice.objects.create(user=user, name="email", email=user.email, confirmed=True)

    def home(self, user):
        self.client.force_login(user)
        session = self.client.session
        session[DEVICE_ID_SESSION_KEY] = EmailDevice.objects.get(user=user).persistent_id
        session[AUTH_AT] = session[LAST_SEEN] = time.time()
        session[VERSION] = SecurityState.objects.get(user=user).session_version
        session.save()
        return self.client.get(reverse("admin:index"))

    def test_owner_home_explains_accounts_and_keys_without_claiming_registration_is_ready(self):
        response = self.home(self.owner)
        self.assertContains(response, "Accesos del equipo")
        self.assertContains(response, f'href="{reverse("security:accounts")}"')
        self.assertContains(response, f'href="{reverse("security:passkeys")}"')
        self.assertContains(response, "Desactivar la cuenta bloquea todos sus accesos.")
        self.assertContains(response, "Revocar una llave no desactiva la cuenta ni sus otros métodos.")
        self.assertContains(response, "Registro de llaves pendiente.")
        self.assertNotContains(response, 'href="/admin/auth/user/"')

    def test_superuser_status_alone_does_not_expose_owner_management_entry(self):
        response = self.home(self.other_admin)
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Accesos del equipo")
        self.assertNotContains(response, f'href="{reverse("security:accounts")}"')

    @override_settings(
        SECURITY_PASSKEYS_ENABLED=True,
        SECURITY_PASSKEY_RP_ID="panel.example.test",
        SECURITY_PASSKEY_ORIGIN="https://panel.example.test",
    )
    def test_configured_https_removes_pending_notice_without_hiding_management(self):
        response = self.home(self.owner)
        self.assertContains(response, "Accesos del equipo")
        self.assertNotContains(response, "Registro de llaves pendiente.")
