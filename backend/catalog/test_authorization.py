"""Catalog mutations must respect permissions even for MFA-verified readers."""
import time
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import PermissionDenied
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import SecurityState

from .admin import ProductAdmin
from .models import AuditLog, Product, ProductAdditional, ProductImage, ProductVariant


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CatalogActionPermissionTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="ACCESS-01", slug="access-01", name="Equipo privado",
            category=Product.Category.HOT, is_published=False,
        )
        self.user = get_user_model().objects.create_user(
            username="catalog-reader@example.test", email="catalog-reader@example.test",
            password="Isolated-test-password-123", is_staff=True,
        )
        self.set_permissions("view_product")
        SecurityState.objects.create(user=self.user)
        device = TOTPDevice.objects.create(user=self.user, confirmed=True)
        self.client.post(reverse("security:login"), {
            "email": self.user.email, "password": "Isolated-test-password-123",
        })
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time()
        response = self.client.post(reverse("security:otp"), {
            "method": "totp", "token": f"{generator.token():06d}",
        })
        self.assertEqual(response.status_code, 302)
        self.model_admin = ProductAdmin(Product, admin.site)

    def set_permissions(self, *codenames):
        self.user.user_permissions.set(Permission.objects.filter(
            content_type__app_label="catalog", codename__in=codenames,
        ))
        self.user = get_user_model().objects.get(pk=self.user.pk)

    def request(self, action):
        request = RequestFactory().post(reverse("admin:catalog_product_changelist"), {
            "action": action, "_selected_action": str(self.product.pk), "confirm": "yes",
        })
        request.user = self.user
        return request

    def assert_forged_action_preserves_catalog(self, action):
        before = list(Product.objects.values())
        audit_count = AuditLog.objects.count()
        response = self.client.post(reverse("admin:catalog_product_changelist"), {
            "action": action, "_selected_action": str(self.product.pk), "confirm": "yes",
        })
        self.assertIn(response.status_code, (200, 302, 403))
        self.assertEqual(list(Product.objects.values()), before)
        self.assertEqual(AuditLog.objects.count(), audit_count)

    def test_reader_cannot_publish_through_forged_action_post(self):
        self.assert_forged_action_preserves_catalog("publish_products")

    def test_reader_cannot_hide_through_forged_action_post(self):
        self.product.is_published = True
        self.product.save()
        self.assert_forged_action_preserves_catalog("hide_products")

    def test_reader_cannot_duplicate_through_forged_action_post(self):
        self.assert_forged_action_preserves_catalog("duplicate_products")

    def test_reader_can_view_product_but_cannot_edit_or_delete_it(self):
        editor_url = reverse("admin:catalog_product_change", args=[self.product.pk])
        before = list(Product.objects.values())
        before_audit = AuditLog.objects.count()
        response = self.client.get(editor_url)
        self.assertContains(response, self.product.name)
        self.assertNotContains(response, 'name="_save"')
        self.assertNotContains(response, 'name="name"')
        self.assertEqual(self.client.post(editor_url, {
            "name": "Unauthorized edit", "is_published": "on", "_save": "Guardar",
        }).status_code, 403)
        self.assertEqual(self.client.post(reverse("admin:catalog_product_delete", args=[self.product.pk]), {
            "post": "yes",
        }).status_code, 403)
        self.assertEqual(list(Product.objects.values()), before)
        self.assertEqual(AuditLog.objects.count(), before_audit)

    def test_product_editor_offers_material_analysis_only_with_inventory_access(self):
        self.set_permissions("view_product", "change_product")
        editor_url = reverse("admin:catalog_product_change", args=[self.product.pk])
        response = self.client.get(editor_url)
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Analizar materiales y fabricación")
        self.assertNotContains(response, reverse("inventory-dashboard"))
        self.assertEqual(self.client.get(reverse("inventory-dashboard")).status_code, 403)
        self.set_permissions("view_product", "change_product", "view_inventory")
        response = self.client.get(editor_url)
        self.assertContains(response, "Analizar materiales y fabricación de ACCESS-01")
        self.assertContains(response, reverse("inventory-dashboard") + "?equipo=ACCESS-01&amp;cantidad=1&amp;almacen=Taller#planificar")
        with patch("catalog.inventory_views.load_snapshot", return_value=None):
            self.assertEqual(self.client.get(reverse("inventory-dashboard")).status_code, 200)

    def test_reader_actions_are_hidden_and_direct_calls_are_denied(self):
        for action in ("publish_products", "hide_products", "duplicate_products"):
            with self.subTest(action=action):
                request = self.request(action)
                self.assertNotIn(action, self.model_admin.get_actions(request))
                with self.assertRaises(PermissionDenied):
                    getattr(self.model_admin, action)(request, Product.objects.all())

    def test_editor_can_change_visibility_but_cannot_create_copies(self):
        self.set_permissions("view_product", "change_product")
        request = self.request("publish_products")
        actions = self.model_admin.get_actions(request)
        self.assertIn("publish_products", actions)
        self.assertIn("hide_products", actions)
        self.assertNotIn("duplicate_products", actions)
        with patch.object(self.model_admin, "message_user"):
            self.model_admin.publish_products(request, Product.objects.all())
        self.product.refresh_from_db()
        self.assertTrue(self.product.is_published)
        with self.assertRaises(PermissionDenied):
            self.model_admin.duplicate_products(request, Product.objects.all())

    def test_duplication_requires_permission_for_every_copied_child_type(self):
        child_permissions = [f"{operation}_{model}" for model in (
            "productvariant", "productadditional", "productimage",
        ) for operation in ("view", "add")]
        all_permissions = ["view_product", "add_product", *child_permissions]
        for missing in all_permissions:
            with self.subTest(missing=missing):
                self.set_permissions(*(item for item in all_permissions if item != missing))
                request = self.request("duplicate_products")
                self.assertNotIn("duplicate_products", self.model_admin.get_actions(request))
                with self.assertRaises(PermissionDenied):
                    self.model_admin.duplicate_products(request, Product.objects.all())
        self.set_permissions(*all_permissions)
        ProductVariant.objects.create(product=self.product, name="A gas")
        ProductAdditional.objects.create(product=self.product, name="Plancha")
        ProductImage.objects.create(product=self.product, url="/images/equipo.webp")
        request = self.request("duplicate_products")
        self.assertIn("duplicate_products", self.model_admin.get_actions(request))
        with patch.object(self.model_admin, "message_user"):
            self.model_admin.duplicate_products(request, Product.objects.filter(pk=self.product.pk))
        copy = Product.objects.exclude(pk=self.product.pk).get()
        self.assertFalse(copy.is_published)
        self.assertEqual(copy.variants.count(), 1)
        self.assertEqual(copy.additionals.count(), 1)
        self.assertEqual(copy.gallery_images.count(), 1)
