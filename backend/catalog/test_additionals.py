"""Commercial additions and gallery replacement, using isolated test records."""

import hashlib
import hmac
import json
import tempfile
import zipfile
from decimal import Decimal
from pathlib import Path

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.forms.models import inlineformset_factory
from django.test import RequestFactory, TestCase, override_settings

from .admin import ProductAdmin
from .audit import audit_context
from .backups import canonical, create_backup, inspect_backup, restore_backup, signing_key
from .forms import GalleryInlineFormSet, ProductImageForm
from .models import AuditLog, Product, ProductAdditional, ProductImage
from .serializers import public_catalog_data, public_product


class ProductAdditionalTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(
            code="EXTRA-TEST", slug="mesa-adicionales", name="Mesa", category="linea-neutra",
            is_published=True, price=Decimal("350"), show_price=False,
        )
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        media_settings = override_settings(MEDIA_ROOT=Path(self.temporary.name) / "media")
        media_settings.enable()
        self.addCleanup(media_settings.disable)

    def test_optional_prices_zero_and_each_billing_unit(self):
        optional = ProductAdditional.objects.create(product=self.product, name="Pozas")
        self.assertIsNone(optional.price)
        self.assertFalse(optional.show_price)
        for unit, label in (("unit", "unidad"), ("m", "metro lineal"), ("m2", "m²"), ("custom", "juego")):
            with self.subTest(unit=unit):
                extra = ProductAdditional.objects.create(
                    product=self.product, name=f"Opción {unit}", charge_unit=unit, custom_unit="juego",
                    price=Decimal("0"), show_price=True,
                )
                self.assertEqual(extra.unit_label, label)
                self.assertEqual(extra.price, Decimal("0"))

    def test_invalid_rates_custom_unit_and_duplicate_names_are_rejected(self):
        for values, field in (
            ({"show_price": True}, "price"),
            ({"charge_unit": "custom", "custom_unit": "   "}, "custom_unit"),
            ({"price": Decimal("-0.01")}, "price"),
            ({"cost": Decimal("100000000.01")}, "cost"),
        ):
            with self.subTest(values=values), self.assertRaises(ValidationError) as error:
                ProductAdditional.objects.create(product=self.product, name="Inválida", **values)
            self.assertIn(field, error.exception.message_dict)
        ProductAdditional.objects.create(product=self.product, name="Ruedas")
        with self.assertRaises(ValidationError):
            ProductAdditional.objects.create(product=self.product, name="Ruedas")
        other = Product.objects.create(code="OTHER", slug="otro", name="Otro", category="linea-fria")
        ProductAdditional.objects.create(product=other, name="Ruedas")

    def test_public_rates_are_independent_active_only_and_never_include_costs(self):
        published = ProductAdditional.objects.create(
            product=self.product, name="Respaldar", description="Altura por confirmar", price=Decimal("25.50"),
            cost=Decimal("14.21"), show_price=True, charge_unit="m", order=2,
        )
        hidden = ProductAdditional.objects.create(
            product=self.product, name="Poza", price=Decimal("111.31"), cost=Decimal("59.82"), order=1,
        )
        ProductAdditional.objects.create(product=self.product, name="PRIVADO INACTIVO", price=10, show_price=True, is_active=False)
        item = self.client.get("/api/catalog/").json()["products"][0]
        self.assertIsNone(item["price"])
        self.assertEqual(item["additionals"], [
            {"id": str(hidden.pk), "name": "Poza", "description": "", "price": None, "chargeUnit": "unit", "unitLabel": "unidad"},
            {"id": str(published.pk), "name": "Respaldar", "description": "Altura por confirmar", "price": 25.5, "chargeUnit": "m", "unitLabel": "metro lineal"},
        ])
        serialized = json.dumps(item)
        for private in ("cost", "14.21", "111.31", "59.82", "PRIVADO INACTIVO"):
            self.assertNotIn(private, serialized)
        # Preview/direct serialization also excludes inactive extras without a prefetch.
        self.assertEqual(public_product(self.product)["additionals"], item["additionals"])
        self.product.show_price = True
        self.product.additional_flat = Decimal("5")
        self.product.save()
        item = public_catalog_data()["products"][0]
        self.assertEqual(item["price"], 355)
        self.assertEqual(item["additionalCharges"], [{"id": "included", "name": "Adicional incluido", "price": 5}])
        self.assertIsNone(item["additionals"][0]["price"])

    def test_catalog_prefetches_additionals_for_all_products(self):
        for index in range(4):
            product = Product.objects.create(code=f"PREFETCH-{index}", slug=f"extra-{index}", name="Equipo", category="linea-caliente", is_published=True)
            ProductAdditional.objects.create(product=product, name="Accesorio")
        with self.assertNumQueries(6):
            data = public_catalog_data()
        self.assertEqual(sum(len(item["additionals"]) for item in data["products"]), 4)

    def test_additional_audit_records_creation_change_and_deletion(self):
        user = get_user_model().objects.create_user(username="synthetic-commercial-editor")
        with audit_context(user):
            extra = ProductAdditional.objects.create(product=self.product, name="Ruedas", price=50, cost=20)
            extra.price = Decimal("55")
            extra.save()
            extra_id = extra.pk
            extra.delete()
        entries = AuditLog.objects.filter(entity="catalog.productadditional", object_id=str(extra_id)).order_by("pk")
        self.assertEqual(list(entries.values_list("operation", flat=True)), ["create", "update", "delete"])
        self.assertTrue(all(entry.actor_id == user.pk for entry in entries))
        self.assertEqual(entries[1].before["price"], "50.00")
        self.assertEqual(Decimal(entries[1].after["price"]), Decimal("55"))

    def test_signed_backup_restores_all_commercial_additional_fields(self):
        extra = ProductAdditional.objects.create(
            product=self.product, name="Kit", description="Se define al cotizar", price=Decimal("123.45"),
            cost=Decimal("56.78"), show_price=True, charge_unit="custom", custom_unit="juego", is_active=False, order=3,
        )
        backup = Path(self.temporary.name) / "with-extras.zip"
        create_backup(backup)
        objects, _ = inspect_backup(backup)
        self.assertEqual(sum(isinstance(item.object, ProductAdditional) for item in objects), 1)
        extra.delete()
        restore_backup(backup)
        restored = ProductAdditional.objects.get(product_id=self.product.pk)
        self.assertEqual((restored.name, restored.description, restored.price, restored.cost), ("Kit", "Se define al cotizar", Decimal("123.45"), Decimal("56.78")))
        self.assertEqual((restored.show_price, restored.charge_unit, restored.custom_unit, restored.is_active, restored.order), (True, "custom", "juego", False, 3))

    def _rewrite_signed_records(self, source, target, transform):
        with zipfile.ZipFile(source) as archive:
            contents = {name: archive.read(name) for name in archive.namelist()}
        records = transform(json.loads(contents["catalog.json"]))
        contents["catalog.json"] = canonical(records)
        manifest = json.loads(contents["manifest.json"])
        manifest.pop("signature")
        manifest["files"]["catalog.json"] = {"sha256": hashlib.sha256(contents["catalog.json"]).hexdigest(), "size": len(contents["catalog.json"])}
        manifest["signature"] = hmac.new(signing_key(), canonical(manifest), hashlib.sha256).hexdigest()
        contents["manifest.json"] = canonical(manifest)
        with zipfile.ZipFile(target, "w") as archive:
            for name, value in contents.items():
                archive.writestr(name, value)

    def test_old_v1_backup_without_additionals_remains_restorable(self):
        ProductAdditional.objects.create(product=self.product, name="Posterior a la copia")
        backup = Path(self.temporary.name) / "current.zip"
        legacy = Path(self.temporary.name) / "legacy.zip"
        create_backup(backup)
        self._rewrite_signed_records(backup, legacy, lambda rows: [row for row in rows if row["model"] != "catalog.productadditional"])
        self.product.name = "Cambio posterior"
        self.product.save()
        restore_backup(legacy)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Mesa")
        self.assertFalse(ProductAdditional.objects.exists())

    def test_invalid_signed_additional_rolls_back_restore(self):
        extra = ProductAdditional.objects.create(product=self.product, name="Ruedas", price=50)
        backup = Path(self.temporary.name) / "current.zip"
        invalid = Path(self.temporary.name) / "invalid.zip"
        create_backup(backup)

        def invalidate(rows):
            for row in rows:
                if row["model"] == "catalog.productadditional":
                    row["fields"].update(charge_unit="custom", custom_unit="")
            return rows

        self._rewrite_signed_records(backup, invalid, invalidate)
        extra.price = Decimal("65")
        extra.save()
        with self.assertRaises(ValidationError):
            restore_backup(invalid)
        extra.refresh_from_db()
        self.assertEqual(extra.price, Decimal("65"))
        self.assertEqual(extra.charge_unit, "unit")


class GalleryReplacementTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(code="GALLERY", slug="galeria", name="Galería", category="linea-neutra")
        self.images = [ProductImage.objects.create(product=self.product, url=f"/images/{index}.webp", order=index) for index in range(8)]
        self.formset_type = inlineformset_factory(Product, ProductImage, form=ProductImageForm, formset=GalleryInlineFormSet, fields="__all__", extra=0, can_delete=True, max_num=8)

    def formset(self, delete_first):
        data = {"gallery_images-TOTAL_FORMS": "9", "gallery_images-INITIAL_FORMS": "8", "gallery_images-MAX_NUM_FORMS": "8", "gallery_images-MIN_NUM_FORMS": "0"}
        for index, item in enumerate(self.images):
            for key, value in {"id": str(item.pk), "product": str(self.product.pk), "url": item.url, "order": str(index)}.items():
                data[f"gallery_images-{index}-{key}"] = value
        if delete_first:
            data["gallery_images-0-DELETE"] = "on"
        data.update({"gallery_images-8-product": str(self.product.pk), "gallery_images-8-url": "/images/reemplazo.webp", "gallery_images-8-order": "8"})
        return self.formset_type(instance=self.product, data=data)

    def test_full_gallery_can_replace_one_image_in_one_save(self):
        formset = self.formset(delete_first=True)
        self.assertTrue(formset.is_valid(), (formset.errors, formset.non_form_errors()))
        self.assertFalse(any(hasattr(form.instance, "_defer_gallery_count") for form in formset.forms))
        request = RequestFactory().post("/admin/")
        request.user = get_user_model().objects.create_user(username="synthetic-gallery-editor")
        ProductAdmin(Product, admin.site).save_formset(request, None, formset, True)
        self.assertEqual(self.product.gallery_images.count(), 8)
        self.assertFalse(ProductImage.objects.filter(pk=self.images[0].pk).exists())
        self.assertTrue(self.product.gallery_images.filter(url="/images/reemplazo.webp").exists())

    def test_ninth_image_is_rejected_in_inline_and_direct_save(self):
        formset = self.formset(delete_first=False)
        self.assertFalse(formset.is_valid())
        self.assertIn("8 imágenes", str(formset.non_form_errors()))
        with self.assertRaises(ValidationError):
            ProductImage.objects.create(product=self.product, url="/images/ninth.webp")
        self.assertEqual(self.product.gallery_images.count(), 8)
