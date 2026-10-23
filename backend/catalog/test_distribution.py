"""Supplier equipment stays distinct from manufacture and private until reviewed."""
import time

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.urls import reverse
from django_otp import DEVICE_ID_SESSION_KEY

from security.models import EmailDevice, SecurityState
from security.services import AUTH_AT, LAST_SEEN, VERSION

from .forms import ProductAdminForm
from .models import Product, ProductAdditional
from .serializers import public_catalog_data, public_product
from .test_editor import product_data


class DistributedEquipmentTests(TestCase):
    def create_product(self, **changes):
        values = dict(code="ILU-TEST-01", slug="ilumi-test-01", name="Equipo de proveedor",
                      category=Product.Category.NEUTRAL)
        values.update(changes)
        return Product.objects.create(**values)

    def test_existing_equipment_defaults_to_unclassified_without_inventing_attributes(self):
        product = self.create_product()
        for field in ("supply_type", "brand", "supplier_model", "equipment_family", "capacity", "source_url"):
            self.assertEqual(getattr(product, field), "")
        self.assertFalse(product.is_published)
        self.assertEqual(public_catalog_data()["products"], [])

    def test_supplier_draft_saves_without_files_prices_or_manufacturing_recipe(self):
        form = ProductAdminForm(data=product_data(
            supply_type="distributed", brand="ILUMI", supplier_model="MODEL-TEST",
            equipment_family="amasadoras", capacity="20 L de recipiente",
            source_url="https://ilumiperu.com/products/example-test",
        ))
        self.assertTrue(form.is_valid(), form.errors)
        product = form.save()
        self.assertFalse(product.is_published)
        self.assertIsNone(product.price)
        self.assertFalse(product.model_asset_id)
        self.assertEqual(product.model_3d, "")
        self.assertEqual(public_catalog_data()["products"], [])

    def test_public_projection_exposes_supplier_identity_without_internal_source_or_cost(self):
        product = self.create_product(
            supply_type="distributed", brand="ILUMI", supplier_model="MODEL-TEST",
            equipment_family="amasadoras", capacity="20 L de recipiente",
            source_url="https://ilumiperu.com/products/example-test", cost=100,
            internal_notes="PRIVATE-REVIEW-NOTE", is_published=True,
        )
        projected = public_product(product)
        self.assertEqual({key: projected[key] for key in (
            "supplyType", "brand", "supplierModel", "equipmentFamily", "capacity",
        )}, {
            "supplyType": "distributed", "brand": "ILUMI", "supplierModel": "MODEL-TEST",
            "equipmentFamily": "amasadoras", "capacity": "20 L de recipiente",
        })
        for field in ("source_url", "sourceUrl", "cost", "internal_notes"):
            self.assertNotIn(field, projected)
        self.assertEqual(projected["model3d"], "")

    def test_supplier_source_rejects_insecure_private_or_credentialed_addresses(self):
        for url in ("http://ilumiperu.com/products/test", "https://localhost/test", "https://127.0.0.1/test",
                    "https://user:password@ilumiperu.com/products/test"):
            with self.subTest(url=url), self.assertRaises(ValidationError):
                self.create_product(source_url=url)
        self.assertFalse(Product.objects.exists())

    def test_supplier_family_and_supply_type_are_validated(self):
        for values in ({"equipment_family": "arbitrary-family"}, {"supply_type": "arbitrary-origin"}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                self.create_product(**values)

    def test_classification_preserves_existing_additionals_and_private_recipe_references(self):
        product = self.create_product()
        extra = ProductAdditional.objects.create(product=product, name="Accesorio compatible", manufacturing_code="LEGACY-EXTRA")
        product.supply_type = Product.SupplyType.DISTRIBUTED
        product.save()
        extra.refresh_from_db()
        self.assertEqual(extra.manufacturing_code, "LEGACY-EXTRA")
        self.assertEqual(product.additionals.count(), 1)


@override_settings(
    SECURITY_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class DistributedEditorTests(TestCase):
    def setUp(self):
        # Only synthetic test accounts and an isolated Django test database.
        self.user = get_user_model().objects.create_user(
            "distribution-editor@example.test", "distribution-editor@example.test", "Synthetic-Password-TEST-123",
            is_active=True, is_staff=True,
        )
        self.user.user_permissions.set(Permission.objects.filter(content_type__app_label="catalog", codename__in=("view_product", "view_inventory")))
        self.state = SecurityState.objects.create(user=self.user, mfa_method="email")
        self.device = EmailDevice.objects.create(user=self.user, name="email", email=self.user.email, confirmed=True)
        self.client.force_login(self.user)
        session = self.client.session
        session[DEVICE_ID_SESSION_KEY] = self.device.persistent_id
        session[AUTH_AT] = session[LAST_SEEN] = time.time()
        session[VERSION] = self.state.session_version
        session.save()

    def editor(self, supply_type):
        product = Product.objects.create(code="TEST-01", slug="test-01", name="Equipo", category="linea-neutra", supply_type=supply_type)
        return self.client.get(reverse("admin:catalog_product_change", args=(product.pk,)))

    def test_distributed_readonly_editor_hides_fabrication_and_explains_supplier_options(self):
        response = self.editor("distributed")
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Analizar materiales y fabricación")
        self.assertContains(response, "Producto distribuido: vendemos el modelo del fabricante.")
        self.assertContains(response, "Agrupa solo versiones confirmadas por el fabricante.")
        self.assertContains(response, "Origen, marca y capacidad")

    def test_manufactured_editor_keeps_fabrication_entry_with_inventory_permission(self):
        response = self.editor("manufactured")
        self.assertContains(response, "Analizar materiales y fabricación de TEST-01")

    def test_catalog_reader_without_inventory_permission_cannot_get_fabrication_entry(self):
        self.user.user_permissions.set(Permission.objects.filter(content_type__app_label="catalog", codename="view_product"))
        response = self.editor("manufactured")
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Analizar materiales y fabricación")
