"""Option definitions, permissions, atomic inline edits and publication boundaries."""
import json
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .forms import ProductAdminForm
from .models import AuditLog, MediaAsset, Product, ProductVariant
from .serializers import public_product
from . import test_editor as editor_fixtures
from .test_editor import admin_data, product_data
from .variant_options import VariantOptionsError, validate_variant_axes, validate_option_values, validate_variant_combinations


def axes_fixture():
    return [{"id": "capacity", "label": "Capacidad", "options": [{"id": "small", "label": "Tamaño confirmado A"}, {"id": "large", "label": "Tamaño confirmado B"}]},
            {"id": "energy", "label": "Energía", "options": [{"id": "gas", "label": "Gas"}, {"id": "electric", "label": "Eléctrico"}]}]


def chosen(capacity="small", energy="gas"):
    return {"capacity": capacity, "energy": energy}


class VariantOptionSchemaTests(SimpleTestCase):
    def test_axes_are_copied_with_stable_ids_and_trimmed_labels(self):
        axes = axes_fixture(); axes[0]["label"] = "  Capacidad  "
        result = validate_variant_axes(axes)
        self.assertEqual(result[0]["label"], "Capacidad")
        result[0]["options"][0]["label"] = "changed"
        self.assertEqual(axes[0]["options"][0]["label"], "Tamaño confirmado A")
        self.assertEqual(validate_variant_axes([]), [])

    def test_schema_limits_and_unknown_properties_are_rejected(self):
        malformed = [None, {}, "[]", [axes_fixture()[0]] * 4]
        for field, value in (("options", []), ("options", [{"id": str(i), "label": "A"} for i in range(11)]), ("label", ""), ("label", "X" * 121), ("label", "A\x00B"), ("label", "\ud800"), ("id", "with space")):
            axes = axes_fixture(); axes[0][field] = value; malformed.append(axes)
        for target in ("axis", "option"):
            axes = axes_fixture(); obj = axes[0] if target == "axis" else axes[0]["options"][0]; obj["unknown"] = True; malformed.append(axes)
        for axes in malformed:
            with self.subTest(value=repr(axes)), self.assertRaises(VariantOptionsError): validate_variant_axes(axes)

    def test_reserved_and_duplicate_ids_are_rejected_at_both_levels(self):
        for value in ("__proto__", "prototype", "constructor", "x" * 65, 12):
            for target in ("axis", "option"):
                axes = axes_fixture(); obj = axes[0] if target == "axis" else axes[0]["options"][0]; obj["id"] = value
                with self.subTest(value=value, target=target), self.assertRaises(VariantOptionsError): validate_variant_axes(axes)
        axes = axes_fixture(); axes[1]["id"] = axes[0]["id"]
        with self.assertRaises(VariantOptionsError): validate_variant_axes(axes)
        axes = axes_fixture(); axes[0]["options"][1]["id"] = axes[0]["options"][0]["id"]
        with self.assertRaises(VariantOptionsError): validate_variant_axes(axes)

    def test_only_complete_product_specific_combinations_are_allowed(self):
        axes = axes_fixture()
        self.assertEqual(validate_option_values(axes, chosen(), active=True), chosen())
        self.assertEqual(validate_option_values(axes, {}, active=False), {})
        self.assertEqual(validate_option_values([], {}, active=True), {})
        for values in ({}, {"capacity": "small"}, chosen(energy="wok"), {**chosen(), "other": "x"}, None, []):
            with self.subTest(values=values), self.assertRaises(VariantOptionsError): validate_option_values(axes, values, active=True)
        with self.assertRaises(VariantOptionsError): validate_option_values([], chosen(), active=False)
        with self.assertRaises(VariantOptionsError): validate_option_values(axes, {"capacity": "small"}, active=False)

    def test_inactive_complete_combinations_also_cannot_duplicate(self):
        axes = axes_fixture()
        validate_variant_combinations(axes, [({}, False), ({}, False), (chosen(), True), (chosen("large"), False)])
        with self.assertRaises(VariantOptionsError): validate_variant_combinations(axes, [(chosen(), True), (chosen(), False)])


class VariantOptionModelTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(code="OPTIONS", slug="options", name="Equipo de prueba", category="linea-caliente", variant_axes=axes_fixture(), is_published=True)

    def test_models_require_complete_active_variants_and_preserve_inactive_drafts(self):
        draft = ProductVariant.objects.create(product=self.product, name="Borrador", is_active=False)
        self.assertEqual(draft.option_values, {})
        draft.is_active = True
        with self.assertRaises(ValidationError): draft.save()
        variant = ProductVariant.objects.create(product=self.product, name="Combinación A", option_values=chosen())
        with self.assertRaises(ValidationError): ProductVariant.objects.create(product=self.product, name="Duplicada inactiva", option_values=chosen(), is_active=False)
        self.assertEqual(ProductVariant.objects.count(), 2)
        self.assertTrue(variant.is_active)

    def test_axis_changes_cannot_invalidate_existing_variants_outside_coordinated_admin(self):
        ProductVariant.objects.create(product=self.product, name="Combinación A", option_values=chosen())
        self.product.variant_axes[0]["options"] = self.product.variant_axes[0]["options"][1:]
        with self.assertRaises(ValidationError): self.product.save()
        self.product.refresh_from_db(); self.assertEqual(self.product.variant_axes, axes_fixture())

    def test_nonowner_form_cannot_define_axes_even_with_forged_post(self):
        form = ProductAdminForm(data=product_data(variant_axes=json.dumps(axes_fixture())))
        self.assertNotIn("variant_axes", form.fields)
        self.assertFalse(form.is_valid()); self.assertIn("Solo el propietario", str(form.non_field_errors()))
        owner = ProductAdminForm(data=product_data(variant_axes=json.dumps(axes_fixture())), can_edit_variant_axes=True)
        self.assertTrue(owner.is_valid(), owner.errors)
        self.assertEqual(owner.instance.variant_axes, axes_fixture())

    def test_public_projection_omits_invalid_and_duplicate_combinations_without_exposing_private_data(self):
        good = ProductVariant.objects.create(product=self.product, name="Validada", option_values=chosen(), cost=99)
        # Simulate legacy/import corruption that bypassed model validation.
        ProductVariant.objects.bulk_create([
            ProductVariant(product=self.product, name="Incompleta", is_active=True, option_values={}),
            ProductVariant(product=self.product, name="No autorizada", is_active=True, option_values=chosen(energy="wok")),
            ProductVariant(product=self.product, name="Duplicada", is_active=True, option_values=chosen()),
            ProductVariant(product=self.product, name="Borrador", is_active=False, option_values=chosen("large")),
        ])
        item = public_product(self.product)
        self.assertEqual(item["variantAxes"], axes_fixture())
        self.assertEqual([value["id"] for value in item["variants"]], [str(good.pk)])
        self.assertEqual(item["variants"][0]["optionValues"], chosen())
        self.assertNotIn("cost", item["variants"][0])
        Product.objects.filter(pk=self.product.pk).update(variant_axes={"invalid": True})
        self.product.refresh_from_db()
        self.assertEqual(public_product(self.product)["variantAxes"], [])
        self.assertEqual(public_product(self.product)["variants"], [])

    def test_corrupt_active_variant_does_not_expose_its_media_or_quotation(self):
        asset = MediaAsset.objects.create(name="Archivo privado", kind="image", file="synthetic-not-on-disk.webp")
        variant = ProductVariant.objects.create(product=self.product, name="Borrador", option_values={}, is_active=False, image_asset=asset, price=100)
        ProductVariant.objects.filter(pk=variant.pk).update(is_active=True)
        with patch("catalog.views.media_response") as media:
            self.assertEqual(self.client.get(asset.public_url).status_code, 404)
            media.assert_not_called()
        # The public quote endpoint must use the same filtered variant set.
        self.product.show_price = True; self.product.price = 200
        Product.objects.filter(pk=self.product.pk).update(show_price=True, price=200)
        response = self.client.get(reverse("catalog-quote", args=[self.product.code]), {"variant": variant.pk})
        self.assertEqual(response.status_code, 400)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_EMAIL_ENABLED=False, SECURITY_OWNER_USERNAME="equipment-editor@example.test")
class VariantOptionAdminTests(TestCase):
    setUp = editor_fixtures.ProductEditorAdminTests.setUp
    assert_saved = editor_fixtures.ProductEditorAdminTests.assert_saved

    def payload(self, rows, *, axes=None, initial=0, **changes):
        data = admin_data(**{"variant_axes": json.dumps(axes_fixture() if axes is None else axes), "variants-TOTAL_FORMS": str(len(rows)), "variants-INITIAL_FORMS": str(initial), **changes})
        for index, row in enumerate(rows):
            values = {"name": f"Variante {index}", "order": str(index), "availability": "made_to_order", **row}
            for key, value in values.items():
                if key == "option_values": value = json.dumps(value)
                data[f"variants-{index}-{key}"] = value
        return data

    def create_with_options(self):
        response = self.client.post(self.add_url, self.payload([{"option_values": chosen(), "is_active": "on"}, {"option_values": chosen("large"), "is_active": "on"}]))
        self.assert_saved(response)
        return Product.objects.get()

    def test_owner_sees_visual_axes_widget_and_variants_use_dropdown_widgets(self):
        response = self.client.get(self.add_url)
        self.assertContains(response, 'data-variant-axes-editor')
        self.assertContains(response, 'data-variant-values-editor')
        self.assertContains(response, 'inox/variant-options.js')

    def test_new_axes_and_variants_save_together_and_drafts_stay_inactive(self):
        response = self.client.post(self.add_url, self.payload([{"option_values": chosen(), "is_active": "on"}, {"name": "Por completar", "option_values": {}}]))
        self.assert_saved(response)
        product = Product.objects.get(); self.assertEqual(product.variant_axes, axes_fixture())
        self.assertEqual(product.variants.get(name="Por completar").option_values, {})
        self.assertFalse(product.variants.get(name="Por completar").is_active)

    def test_owner_can_change_axis_and_update_or_delete_dependent_rows_in_same_save(self):
        product = self.create_with_options(); first, second = product.variants.all()
        axes = axes_fixture(); axes[0]["options"] = [{"id": "replacement", "label": "Nueva opción confirmada"}]
        response = self.client.post(reverse("admin:catalog_product_change", args=[product.pk]), self.payload([
            {"id": first.pk, "name": first.name, "option_values": chosen("replacement"), "is_active": "on"},
            {"id": second.pk, "name": second.name, "option_values": second.option_values, "DELETE": "on"},
        ], axes=axes, initial=2))
        self.assert_saved(response); product.refresh_from_db()
        self.assertEqual(product.variant_axes, axes)
        self.assertEqual(product.variants.get().option_values, chosen("replacement"))

    def test_owner_can_swap_combinations_without_intermediate_duplicate_rejection(self):
        product = self.create_with_options(); first, second = product.variants.all()
        response = self.client.post(reverse("admin:catalog_product_change", args=[product.pk]), self.payload([
            {"id": first.pk, "name": first.name, "option_values": second.option_values, "is_active": "on"},
            {"id": second.pk, "name": second.name, "option_values": first.option_values, "is_active": "on"},
        ], initial=2))
        self.assert_saved(response); first.refresh_from_db(); self.assertEqual(first.option_values, chosen("large"))

    def test_duplicate_or_incomplete_active_variants_return_form_errors_without_partial_save(self):
        for rows in ([{"option_values": chosen(), "is_active": "on"}, {"option_values": chosen()}], [{"option_values": {}, "is_active": "on"}]):
            response = self.client.post(self.add_url, self.payload(rows))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.context["inline_admin_formsets"][0].formset.non_form_errors())
            self.assertFalse(Product.objects.exists())

    def test_omitted_management_rows_cannot_silently_break_attached_variants(self):
        product = self.create_with_options()
        response = self.client.post(reverse("admin:catalog_product_change", args=[product.pk]), self.payload([], axes=[]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["inline_admin_formsets"][0].formset.non_form_errors())
        product.refresh_from_db(); self.assertEqual(product.variant_axes, axes_fixture())

    def test_authorized_nonowner_can_choose_existing_values_but_cannot_redefine_axes(self):
        product = self.create_with_options(); first, second = product.variants.all()
        with override_settings(SECURITY_OWNER_USERNAME="another-owner@example.test"):
            url = reverse("admin:catalog_product_change", args=[product.pk])
            self.assertNotContains(self.client.get(url), 'data-variant-axes-editor')
            rows = [{"id": first.pk, "name": first.name, "option_values": chosen(energy="electric"), "is_active": "on"},
                    {"id": second.pk, "name": second.name, "option_values": second.option_values, "is_active": "on"}]
            data = self.payload(rows, initial=2); data.pop("variant_axes")
            self.assert_saved(self.client.post(url, data)); first.refresh_from_db()
            self.assertEqual(first.option_values, chosen(energy="electric"))
            forged = self.client.post(url, self.payload(rows, initial=2))
            self.assertEqual(forged.status_code, 200); self.assertContains(forged, "Solo el propietario")

    def test_history_cannot_bypass_owner_only_axes_or_cooktop_permissions(self):
        from .test_cooktop import cooktop_fixture
        product = Product.objects.create(code="RESTORE-TEST", slug="restore-test", name="Cocina de prueba", category="linea-caliente", supply_type="manufactured", equipment_family="cocinas", variant_axes=axes_fixture(), cooktop_config=cooktop_fixture())
        for field, replacement in (("variant_axes", []), ("cooktop_config", cooktop_fixture(False))):
            with self.subTest(field=field):
                previous = getattr(product, field)
                setattr(product, field, replacement); product.save()
                log = AuditLog.objects.filter(entity="catalog.product", object_id=str(product.pk), operation="update").latest("pk")
                url = reverse("admin:catalog_audit_restore", args=(log.pk,))
                audit_count = AuditLog.objects.count()
                with override_settings(SECURITY_OWNER_USERNAME="another-owner@example.test"):
                    self.assertEqual(self.client.post(url).status_code, 403)
                product.refresh_from_db(); self.assertEqual(getattr(product, field), replacement)
                self.assertEqual(AuditLog.objects.count(), audit_count)
                self.assertEqual(self.client.post(url).status_code, 302)
                product.refresh_from_db(); self.assertEqual(getattr(product, field), previous)

    def test_nonowner_can_still_restore_ordinary_fields_when_protected_definitions_stay_unchanged(self):
        product = self.create_with_options()
        previous_name = product.name
        product.name = "Otro nombre revisado"; product.save()
        log = AuditLog.objects.filter(entity="catalog.product", object_id=str(product.pk), operation="update").latest("pk")
        with override_settings(SECURITY_OWNER_USERNAME="another-owner@example.test"):
            response = self.client.post(reverse("admin:catalog_audit_restore", args=(log.pk,)))
        self.assertEqual(response.status_code, 302)
        product.refresh_from_db(); self.assertEqual(product.name, previous_name)
        self.assertEqual(product.variant_axes, axes_fixture())

