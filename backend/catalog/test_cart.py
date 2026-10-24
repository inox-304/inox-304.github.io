"""Synthetic data only; test DB is independent from hosted catalog data."""
import json
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .admin import AuditLogAdmin, ProductAdmin
from .cart import MODULE_IDS, CartValidationError, cart_selection_summary, validate_cart_config, validate_cart_selection
from .forms import ProductAdminForm
from .models import AuditLog, Product
from .serializers import public_product
from .test_editor import product_data


def cart_fixture(enabled=True):
    return {"version": 1, "enabled": enabled, "modules": [{"id": key, "label": key.capitalize(), "defaultIncluded": True} for key in MODULE_IDS]}


class CartSchemaTests(SimpleTestCase):
    def test_valid_config_is_independently_copied_and_empty_is_unconfigured(self):
        original = cart_fixture(); original["modules"][0]["label"] = "  Broastera  "
        result = validate_cart_config(original)
        self.assertEqual(result["modules"][0]["label"], "Broastera")
        result["modules"][0]["defaultIncluded"] = False
        self.assertTrue(original["modules"][0]["defaultIncluded"])
        self.assertEqual(validate_cart_config({}), {})
        self.assertEqual(validate_cart_config(cart_fixture(False)), cart_fixture(False))

    def test_rejects_foreign_modules_duplicates_types_unbounded_labels_and_private_properties(self):
        candidates = [None, [], False, "", {"enabled": False}]
        for field, value in (("version", True), ("version", 2), ("enabled", 1), ("modules", []), ("modules", cart_fixture()["modules"] * 2), ("modules", [None]), ("privateCost", 1)):
            candidates.append({**cart_fixture(), field: value})
        for field, value in (("id", []), ("id", "wok"), ("id", "freidora"), ("label", ""), ("label", "x" * 81), ("label", "x\x00"), ("label", "\ud800"), ("defaultIncluded", 1), ("nodeName", "anything")):
            config = cart_fixture(); config["modules"][0][field] = value; candidates.append(config)
        for candidate in candidates:
            with self.subTest(candidate=repr(candidate)), self.assertRaises(CartValidationError):
                validate_cart_config(candidate)

    def test_selection_is_bounded_by_product_approval_and_keeps_canonical_order(self):
        config = cart_fixture()
        self.assertEqual(validate_cart_selection(config, {"included": ["plancha", "freidora"]}), {"included": ["freidora", "plancha"]})
        self.assertEqual(cart_selection_summary(config, {"included": ["plancha"]}), {"included": ["Plancha"], "omitted": ["Broastera", "Freidora", "Conservadora"]})
        self.assertEqual(validate_cart_selection(config, {"included": []}), {"included": []})
        config["modules"] = config["modules"][:1]
        for value in (None, [], {"included": "broastera"}, {"included": ["broastera"] * 2}, {"included": ["freidora"]}, {"included": [[]]}, {"included": [True]}, {"included": [], "cost": 1}):
            with self.subTest(value=value), self.assertRaises(CartValidationError): validate_cart_selection(config, value)
        for disabled in ({}, cart_fixture(False)):
            with self.assertRaises(CartValidationError): validate_cart_selection(disabled, {"included": []})


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_OWNER_USERNAME="cart-owner@example.test")
class CartProductTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(code="CART-TEST", slug="cart-test", name="Carrito de prueba", category="linea-caliente", supply_type="manufactured", equipment_family="carritos-comida", cart_config=cart_fixture(), is_published=True, cost=999, internal_notes="PRIVATE-CART")
        self.owner = get_user_model().objects.create_user("cart-owner@example.test", is_staff=True, is_superuser=True)
        self.editor = get_user_model().objects.create_user("cart-editor@example.test", is_staff=True, is_superuser=True)
        self.model_admin = ProductAdmin(Product, admin.site)
        self.url = reverse("catalog-cart", args=[self.product.code])
        self.check_url = reverse("catalog-cart-check", args=[self.product.code])

    def request(self, user):
        request = RequestFactory().post("/admin/catalog/product/"); request.user = user
        return request

    def data(self, **changes):
        return product_data(category="linea-caliente", supply_type="manufactured", equipment_family="carritos-comida", **changes)

    def test_family_guards_cannot_be_bypassed_by_name_or_changed_by_editors(self):
        for field, value in (("category", "linea-neutra"), ("supply_type", "distributed"), ("supply_type", ""), ("equipment_family", "cocinas"), ("equipment_family", "")):
            self.product.refresh_from_db(); setattr(self.product, field, value)
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError): self.product.save()
        self.product.refresh_from_db()
        data = self.data(); data["equipment_family"] = "cocinas"
        form = self.model_admin.get_form(self.request(self.editor), self.product)(instance=self.product, data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("Carritos de comida", str(form.errors))

    def test_public_config_and_selection_are_read_only_no_secrets_and_exact_cors(self):
        before, audit_count = list(Product.objects.values()), AuditLog.objects.count()
        response = self.client.get(self.url, HTTP_ORIGIN="https://inox-304.github.io")
        self.assertEqual(response.json(), {"productId": self.product.code, "cartConfig": cart_fixture()})
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://inox-304.github.io")
        self.assertNotIn("Access-Control-Allow-Credentials", response)
        self.assertIn("Origin", response["Vary"]); self.assertIn("no-store", response["Cache-Control"])
        self.assertNotContains(response, "PRIVATE-CART"); self.assertNotContains(response, "cost")
        result = self.client.get(self.check_url, {"selection": '{"included":["plancha"]}'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["summary"]["included"], ["Plancha"])
        self.assertNotContains(result, "price")
        for origin in ("https://other.example", "https://inox-304.github.io.evil.example", "null"):
            self.assertNotIn("Access-Control-Allow-Origin", self.client.get(self.url, HTTP_ORIGIN=origin))
        self.assertEqual(self.client.post(self.url, {}).status_code, 405)
        self.assertEqual(self.client.post(self.check_url, {}).status_code, 405)
        self.assertEqual(list(Product.objects.values()), before); self.assertEqual(AuditLog.objects.count(), audit_count)

    def test_selection_rejects_duplicate_json_keys_malformed_and_multiple_payloads(self):
        for raw in ("", "x" * 1001, "{", "null", '{"included":[],"included":["plancha"]}', '{"included":["wok"]}', '{"included":["plancha","plancha"]}', '{"included":[],"price":1}'):
            with self.subTest(raw=raw[:40]):
                response = self.client.get(self.check_url, {"selection": raw})
                self.assertEqual(response.status_code, 400); self.assertFalse(response.json()["valid"])
        self.assertEqual(self.client.get(self.check_url, {"selection": ["{}", "{}"]}).status_code, 400)

    def test_drafts_invalid_data_and_wrong_family_fail_closed_without_leaking(self):
        self.product.cart_config = cart_fixture(False); self.product.save()
        self.assertIsNone(public_product(self.product)["cartConfig"])
        self.assertEqual(public_product(self.product, preview=True)["cartConfig"], cart_fixture(False))
        self.assertIsNone(self.client.get(self.url, {"preview": "true"}).json()["cartConfig"])
        self.assertEqual(self.client.get(self.check_url, {"selection": '{"included":[]}'}).status_code, 400)
        for invalid in ([], False, {**cart_fixture(), "secret": "MUST-NOT-LEAK"}):
            Product.objects.filter(pk=self.product.pk).update(cart_config=invalid)
            response = self.client.get(self.url)
            self.assertIsNone(response.json()["cartConfig"]); self.assertNotContains(response, "MUST-NOT-LEAK")
        Product.objects.filter(pk=self.product.pk).update(cart_config=cart_fixture(), supply_type="distributed")
        self.assertIsNone(self.client.get(self.url).json()["cartConfig"])
        for field in ("is_active", "is_published"):
            Product.objects.filter(pk=self.product.pk).update(**{field: False})
            self.assertEqual(self.client.get(self.url).status_code, 404)
            self.assertEqual(self.client.get(self.check_url).status_code, 404)
            Product.objects.filter(pk=self.product.pk).update(**{field: True})

    def test_only_owner_sees_editor_and_can_submit_plain_controls_or_json(self):
        owner_request, editor_request = self.request(self.owner), self.request(self.editor)
        OwnerForm = self.model_admin.get_form(owner_request, self.product)
        EditorForm = self.model_admin.get_form(editor_request, self.product)
        self.assertIn("cart_config", OwnerForm(instance=self.product).fields)
        self.assertNotIn("cart_config", EditorForm(instance=self.product).fields)
        html = str(OwnerForm(instance=self.product)["cart_config"])
        self.assertIn('name="cart_config-broastera-allowed"', html)
        self.assertIn('name="cart_config-enabled"', html)
        self.assertNotIn("<textarea", html)
        plain = {"cart_config-present": "1", "cart_config-enabled": "on", "cart_config-plancha-allowed": "on", "cart_config-plancha-label": "Plancha", "cart_config-plancha-included": "on"}
        form = OwnerForm(instance=self.product, data=self.data(**plain))
        self.assertTrue(form.is_valid(), form.errors)
        self.model_admin.save_model(owner_request, form.save(commit=False), form, True)
        self.product.refresh_from_db(); self.assertEqual([item["id"] for item in self.product.cart_config["modules"]], ["plancha"])
        for forged in (plain, {"cart_config": json.dumps(cart_fixture())}):
            form = EditorForm(instance=self.product, data=self.data(**forged))
            self.assertFalse(form.is_valid()); self.assertIn("Solo el propietario", str(form.errors))
        self.product.cart_config = cart_fixture()
        with self.assertRaises(PermissionDenied): self.model_admin.save_model(editor_request, self.product, None, True)

    def test_editor_ordinary_changes_and_owner_omission_keep_existing_config(self):
        for user in (self.editor, self.owner):
            self.product.refresh_from_db()
            request = self.request(user); Form = self.model_admin.get_form(request, self.product)
            form = Form(instance=self.product, data=self.data(name="Carrito renombrado"))
            self.assertTrue(form.is_valid(), form.errors)
            self.model_admin.save_model(request, form.save(commit=False), form, True)
            self.product.refresh_from_db(); self.assertEqual(self.product.cart_config, cart_fixture())

    def test_owner_can_clear_using_controls_and_cannot_submit_null_or_unknown_schema(self):
        form = ProductAdminForm(instance=self.product, can_edit_cart=True, data=self.data(**{"cart_config-present": "1"}))
        self.assertTrue(form.is_valid(), form.errors); self.assertEqual(form.save().cart_config, {})
        for raw in ("null", "false", "[]", "0", '{"enabled":true}'):
            form = ProductAdminForm(can_edit_cart=True, data=self.data(cart_config=raw))
            self.assertFalse(form.is_valid(), raw)
        form = ProductAdminForm(can_edit_cart=True, data=self.data())
        self.assertTrue(form.is_valid(), form.errors); self.assertEqual(form.save().cart_config, {})

    def test_duplicate_is_disabled_and_source_unchanged(self):
        with patch.object(self.model_admin, "message_user"):
            self.model_admin.duplicate_products(self.request(self.editor), Product.objects.filter(pk=self.product.pk))
        duplicate = Product.objects.exclude(pk=self.product.pk).get()
        self.assertFalse(duplicate.is_published); self.assertEqual(duplicate.cart_config, cart_fixture(False))
        self.product.refresh_from_db(); self.assertTrue(self.product.cart_config["enabled"])

    def test_history_restore_cannot_bypass_owner_approval(self):
        self.product.cart_config = cart_fixture(False); self.product.save()
        log = AuditLog.objects.filter(entity="catalog.product", object_id=str(self.product.pk), operation="update").latest("pk")
        log_admin = AuditLogAdmin(AuditLog, admin.site)
        before = AuditLog.objects.count()
        with self.assertRaises(PermissionDenied):
            log_admin.restore_view(self.request(self.editor), log.pk)
        self.product.refresh_from_db(); self.assertFalse(self.product.cart_config["enabled"])
        self.assertEqual(AuditLog.objects.count(), before)
        with patch.object(log_admin, "message_user"):
            response = log_admin.restore_view(self.request(self.owner), log.pk)
        self.assertEqual(response.status_code, 302)
        self.product.refresh_from_db(); self.assertTrue(self.product.cart_config["enabled"])
