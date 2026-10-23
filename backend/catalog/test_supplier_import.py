"""The supplier import is additive, private, bounded, and atomic."""
import json
import tempfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from .models import AuditLog, MediaAsset, Product, ProductAdditional, ProductImage, ProductVariant
from .serializers import public_catalog_data


def record(sku="123456"):
    return {
        "code": f"ILUMI-{sku}", "sku": sku, "name": "Amasadora de prueba",
        "category_slug": "amasadoras", "source_url": "https://ilumiperu.com/products/amasadora-test",
        "capacity_text": "20 L de recipiente", "dimensions_text": "50 × 40 × 70 cm",
        "features": ["Capacidad publicada; verificar masa admisible"],
        "image_urls": ["https://ilumiperu.com/cdn/shop/files/equipo-test.jpg?v=1"],
        "technical_sheet_urls": [], "model_3d_urls": [], "warnings": [], "variants": [],
    }


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class SupplierImportTests(TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "catalog.json"
        self.actor = get_user_model().objects.create_user(
            username="supplier-owner@example.test", email="supplier-owner@example.test", password="Isolated-Test-123!",
            is_staff=True, is_active=True, is_superuser=True,
        )

    def manifest(self, rows=None, **changes):
        document = {"schema_version": 1, "brand": "ILUMI", "checked_on": "2026-10-22", "products": rows if rows is not None else [record()]}
        document.update(changes)
        self.path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")

    def run_import(self, *, apply=False, actor=None):
        output = StringIO()
        options = {"stdout": output, "apply": apply}
        if apply:
            options["actor"] = actor if actor is not None else self.actor.email
        call_command("import_supplier_catalog", str(self.path), **options)
        return output.getvalue()

    def test_dry_run_validates_everything_without_writing_rows_or_assets(self):
        self.manifest()
        before = {model.__name__: list(model.objects.values()) for model in (Product, ProductImage, ProductVariant, ProductAdditional, MediaAsset, AuditLog)}
        output = self.run_import()
        self.assertIn("SIMULACIÓN: 1", output)
        for model in (Product, ProductImage, ProductVariant, ProductAdditional, MediaAsset, AuditLog):
            self.assertEqual(list(model.objects.values()), before[model.__name__])

    def test_apply_creates_only_private_supplier_drafts_with_attributed_audit(self):
        row = record()
        row["model_3d_urls"] = ["https://ilumiperu.com/models/referencia-test.glb"]
        row["variants"] = [{"name": "Opción por verificar", "sku": "DIFFERENT"}]
        self.manifest([row])
        self.run_import(apply=True)
        product = Product.objects.get()
        self.assertEqual((product.code, product.brand, product.supplier_model, product.supply_type), (row["code"], "ILUMI", row["sku"], "distributed"))
        self.assertEqual(product.category, "linea-neutra")
        self.assertEqual(product.capacity, "20 L de recipiente")
        self.assertFalse(product.is_published)
        self.assertFalse(product.featured)
        self.assertFalse(product.show_price)
        self.assertIsNone(product.price)
        self.assertIsNone(product.cost)
        self.assertEqual(product.model_3d, "")
        self.assertFalse(product.model_asset_id)
        self.assertFalse(ProductVariant.objects.exists())
        self.assertFalse(ProductAdditional.objects.exists())
        self.assertFalse(MediaAsset.objects.exists())
        self.assertEqual(public_catalog_data()["products"], [])
        self.assertIn("Opción por verificar", product.internal_notes)
        log = AuditLog.objects.get(entity="catalog.product", object_id=str(product.pk))
        self.assertEqual(log.actor, self.actor)
        self.assertEqual(log.operation, "create")

    def test_idempotent_import_preserves_published_products_and_32_legacy_rows(self):
        for index in range(1, 33):
            Product.objects.create(code=f"P{index:02d}", slug=f"legacy-{index}", name="Catálogo existente", category="linea-neutra", is_published=True, price=900 + index, internal_notes="Conservar")
        existing_before = list(Product.objects.values())
        self.manifest()
        self.run_import(apply=True)
        imported = Product.objects.get(code="ILUMI-123456")
        imported.name = "Nombre revisado por el propietario"
        imported.is_published = True
        imported.price = 777
        imported.save()
        all_before = list(Product.objects.values())
        audit_before = AuditLog.objects.count()
        output = self.run_import(apply=True)
        self.assertIn("0 borradores creados; 1 existentes conservados", output)
        self.assertEqual(list(Product.objects.values()), all_before)
        self.assertEqual(list(Product.objects.filter(code__startswith="P").values()), existing_before)
        self.assertEqual(AuditLog.objects.count(), audit_before)

    def test_conflict_late_in_batch_rolls_back_all_candidates(self):
        conflict = Product.objects.create(code="ILUMI-999", slug="other", name="No reemplazar", category="linea-neutra", brand="Otra marca")
        before = list(Product.objects.values())
        logs_before = AuditLog.objects.count()
        self.manifest([record(), record("999")])
        with self.assertRaises(CommandError):
            self.run_import(apply=True)
        self.assertEqual(list(Product.objects.values()), before)
        self.assertEqual(AuditLog.objects.count(), logs_before)
        conflict.refresh_from_db()
        self.assertEqual(conflict.name, "No reemplazar")

    def test_file_failure_after_product_save_rolls_back_product_and_audit(self):
        row = record()
        row["technical_sheet_urls"] = ["https://ilumiperu.com/cdn/shop/files/ficha.jpg"]
        self.manifest([row])
        with patch.object(ProductImage, "save", side_effect=ValidationError("Simulated validation failure")), self.assertRaises(CommandError):
            self.run_import(apply=True)
        self.assertFalse(Product.objects.exists())
        self.assertFalse(AuditLog.objects.exists())

    def test_technical_image_remains_gallery_image_and_pdf_is_only_pdf(self):
        row = record()
        image = "https://ilumiperu.com/cdn/shop/files/ficha-test.jpg"
        pdf = "https://ilumiperu.com/cdn/shop/files/ficha-test.pdf"
        row["technical_sheet_urls"] = [image, pdf]
        self.manifest([row])
        self.run_import(apply=True)
        product = Product.objects.get()
        self.assertEqual(product.technical_sheet, pdf)
        gallery = product.gallery_images.get()
        self.assertEqual(gallery.url, image)
        self.assertIn("Ficha técnica", gallery.caption)
        self.assertIn("imagen", gallery.caption)

    def test_jpg_only_technical_sheet_does_not_populate_pdf_field(self):
        row = record()
        row["technical_sheet_urls"] = ["https://ilumiperu.com/cdn/shop/files/ficha-test.jpg"]
        self.manifest([row])
        self.run_import(apply=True)
        self.assertEqual(Product.objects.get().technical_sheet, "")
        self.assertEqual(ProductImage.objects.count(), 1)

    def test_gallery_is_bounded_deduplicated_and_prioritizes_technical_images(self):
        row = record()
        row["image_urls"] += [f"https://ilumiperu.com/cdn/shop/files/view-{i}.jpg" for i in range(10)]
        row["image_urls"].append(row["image_urls"][1])
        row["technical_sheet_urls"] = ["https://ilumiperu.com/cdn/shop/files/ficha-test.jpg"]
        self.manifest([row])
        self.run_import(apply=True)
        product = Product.objects.get()
        self.assertEqual(product.gallery_images.count(), 8)
        self.assertEqual(product.gallery_images.first().url, row["technical_sheet_urls"][0])
        self.assertEqual(len(set(product.gallery_images.values_list("url", flat=True))), 8)

    def test_invalid_last_source_rejects_entire_manifest_before_mutation(self):
        for source in ("https://example.com/products/fake", "http://ilumiperu.com/products/test", "https://ilumiperu.com/account", "https://user:secret@ilumiperu.com/products/test"):
            second = record("999")
            second["source_url"] = source
            self.manifest([record(), second])
            with self.subTest(source=source), self.assertRaises(CommandError):
                self.run_import(apply=True)
            self.assertFalse(Product.objects.exists())
            self.assertFalse(AuditLog.objects.exists())

    def test_invalid_date_duplicate_sku_unknown_fields_and_limits_are_rejected(self):
        invalid = record()
        invalid["unexpected"] = "not allowed"
        examples = [
            {"checked_on": "2026-02-30"}, {"schema_version": True},
            {"products": [record(), record()]}, {"products": [invalid]},
            {"products": [record(str(i)) for i in range(201)]},
        ]
        for changes in examples:
            self.manifest(**changes)
            with self.subTest(changes=list(changes)), self.assertRaises(CommandError):
                self.run_import(apply=True)
            self.assertFalse(Product.objects.exists())
        self.path.write_bytes(b" " * (1024 * 1024 + 1))
        with self.assertRaises(CommandError):
            self.run_import()

    def test_apply_requires_active_staff_with_catalog_write_permission(self):
        self.manifest()
        with self.assertRaises(CommandError):
            self.run_import(apply=True, actor="")
        self.actor.is_superuser = False
        self.actor.save()
        with self.assertRaises(CommandError):
            self.run_import(apply=True)
        self.actor.is_superuser = True
        self.actor.is_active = False
        self.actor.save()
        with self.assertRaises(CommandError):
            self.run_import(apply=True)
        self.assertFalse(Product.objects.exists())

    def test_supplier_sku_registered_under_another_code_is_conflict(self):
        Product.objects.create(code="OWNER-CODE", slug="owner-code", name="Propietario", category="linea-neutra", brand="ILUMI", supplier_model="123456", supply_type="distributed")
        before = list(Product.objects.values())
        self.manifest()
        with self.assertRaises(CommandError):
            self.run_import(apply=True)
        self.assertEqual(list(Product.objects.values()), before)

    def test_cold_families_keep_individual_family_and_correct_business_line(self):
        rows = []
        for index, family in enumerate(("cremoladeras", "maquinas-helado", "dispensadores-jugo")):
            row = record(str(index))
            row["category_slug"] = family
            rows.append(row)
        self.manifest(rows)
        self.run_import(apply=True)
        self.assertEqual(Product.objects.filter(category="linea-fria").count(), 3)
        self.assertEqual(set(Product.objects.values_list("equipment_family", flat=True)), {row["category_slug"] for row in rows})
