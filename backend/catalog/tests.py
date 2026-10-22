import hashlib
import hmac
import json
import os
import struct
import tempfile
import time
import zipfile
from decimal import Decimal
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command, CommandError
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from PIL import Image

from .admin import ProductAdmin
from .audit import audit_context
from .backups import canonical, create_backup, inspect_backup, restore_backup, signing_key
from .forms import ProductAdminForm, ProductImageForm, persist_uploads
from .models import AuditLog, BusinessSettings, Contact, MediaAsset, Product, ProductAdditional, ProductImage, ProductVariant, final_price
from .serializers import public_catalog_data
from .validators import clean_upload, validate_glb, validate_public_url


def image_upload():
    buffer = BytesIO()
    Image.new("RGBA", (1800, 900), (120, 60, 30, 0)).save(buffer, "PNG")
    return SimpleUploadedFile("imagen.png", buffer.getvalue(), content_type="image/png")


def glb(document):
    data = json.dumps(document).encode()
    data += b" " * ((-len(data)) % 4)
    return struct.pack("<4sIIII", b"glTF", 2, 20 + len(data), len(data), 0x4E4F534A) + data


class CatalogTests(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.override = override_settings(MEDIA_ROOT=Path(self.temporary.name) / "media")
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.contact = Contact.objects.create(code="ventas", name="Ventas", whatsapp="964270406")
        self.product = Product.objects.create(code="P01", slug="mesa", name="Mesa", category="mobiliario", is_published=True, image="/images/mesa.webp", price=Decimal("101.05"), cost=Decimal("17.99"), show_price=True, discount_percent=Decimal("10"), additional_flat=Decimal("3.25"), internal_notes="PRIVATE-DO-NOT-EXPOSE", contact=self.contact)

    def test_price_rounding_and_validation(self):
        self.assertEqual(self.product.computed_price, Decimal("94.20"))
        self.assertEqual(final_price(Decimal("0.05"), Decimal("10")), Decimal("0.05"))
        self.product.price = Decimal("-1")
        with self.assertRaises(ValidationError):
            self.product.save()
        self.product.price = Decimal("100")
        self.product.discount_percent = Decimal("101")
        with self.assertRaises(ValidationError):
            self.product.save()
        self.product.discount_percent = Decimal("0")
        self.product.charge_unit = "custom"
        with self.assertRaises(ValidationError):
            self.product.save()

    def test_public_projection_hides_private_fields_and_drafts(self):
        Product.objects.create(code="DRAFT", slug="hidden", name="Hidden", category="linea-fria", is_published=False, price=99, cost=88)
        Product.objects.create(code="INACTIVE", slug="inactive", name="Inactive", category="linea-fria", is_published=True, is_active=False)
        variant = ProductVariant.objects.create(product=self.product, name="Grande", price=Decimal("200"), cost=Decimal("60"))
        ProductVariant.objects.create(product=self.product, name="Oculta", is_active=False)
        Contact.objects.create(code="inactive", name="Inactive", whatsapp="51987654321", is_active=False)
        response = self.client.get("/api/catalog/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn("Access-Control-Allow-Origin", response)
        self.assertEqual(len(response.json()["products"]), 1)
        item = response.json()["products"][0]
        self.assertEqual(item["price"], 94.2)
        self.assertEqual(item["variants"], [{"id": str(variant.pk), "name": "Grande", "price": 183.25, "availability": "made_to_order", "model3d": "", "technicalSheet": "", "materialVariant": "", "doorAnimation": ""}])
        self.assertEqual(item["additionalCharges"][0]["price"], 3.25)
        self.assertEqual(len(response.json()["contacts"]), 1)
        self.assertNotIn("cost", response.content.decode())
        self.assertNotIn("PRIVATE-DO-NOT-EXPOSE", response.content.decode())
        self.assertNotIn("internal_notes", response.content.decode())
        self.assertEqual(self.client.post("/api/catalog/", {}).status_code, 405)
        self.product.show_price = False
        self.product.save()
        hidden_prices = public_catalog_data()["products"][0]
        self.assertIsNone(hidden_prices["price"])
        self.assertIsNone(hidden_prices["variants"][0]["price"])
        self.assertEqual(hidden_prices["additionalCharges"], [])

    def test_query_count_is_bounded_and_settings_have_defaults(self):
        for index in range(5):
            product = Product.objects.create(code=f"P{index+2}", slug=f"p{index}", name="Producto", category="linea-fria", is_published=True)
            ProductVariant.objects.create(product=product, name="Variante")
        with self.assertNumQueries(6):
            data = public_catalog_data()
        self.assertEqual(data["settings"]["empresa"], "INOX 304")

    def test_image_upload_is_optimized_alpha_retained_and_private_until_published(self):
        asset = MediaAsset.objects.create(name="Imagen", kind="image", file=image_upload())
        with Image.open(asset.file.path) as image:
            self.assertEqual(image.size, (1600, 800))
            self.assertIn("A", image.getbands())
            self.assertFalse(image.getexif())
        self.assertEqual(self.client.get(asset.public_url).status_code, 404)
        self.product.image_asset = asset
        self.product.save()
        response = self.client.get(asset.public_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), Path(asset.file.path).read_bytes())
        self.product.is_published = False
        self.product.save()
        self.assertEqual(self.client.get(asset.public_url).status_code, 404)

    def test_upload_forms_accept_direct_files_and_audit_actor(self):
        data = {"code": "P10", "slug": "nuevo", "name": "Nuevo", "category": "linea-fria", "order": 0, "currency": "PEN", "charge_unit": "unit", "discount_percent": "0", "additional_flat": "0", "availability": "available", "is_active": True}
        form = ProductAdminForm(data=data, files={"image_upload": image_upload()})
        self.assertTrue(form.is_valid(), form.errors)
        user = get_user_model().objects.create_user(username="editor")
        request = RequestFactory().post("/admin/")
        request.user = user
        model_admin = ProductAdmin(Product, admin.site)
        product = form.save(commit=False)
        model_admin.save_model(request, product, form, False)
        self.assertIsNotNone(product.image_asset_id)
        log = AuditLog.objects.filter(entity="catalog.product", object_id=str(product.pk)).latest("pk")
        self.assertEqual(log.actor, user)
        gallery = ProductImageForm(data={"product": product.pk, "order": 0}, files={"upload": image_upload()})
        self.assertTrue(gallery.is_valid(), gallery.errors)
        item = gallery.save(commit=False)
        persist_uploads(item)
        item.save()
        self.assertIsNotNone(item.asset_id)

    def test_duplicate_preserves_children_and_creates_private_draft(self):
        ProductVariant.objects.create(product=self.product, name="Grande", price=200, cost=100)
        ProductAdditional.objects.create(product=self.product, name="Ruedas", price=50, cost=20, show_price=False, charge_unit="custom", custom_unit="juego", is_active=False)
        ProductImage.objects.create(product=self.product, url="/images/segunda.webp")
        request = RequestFactory().post("/admin/")
        request.user = get_user_model().objects.create_user(username="duplicator")
        model_admin = ProductAdmin(Product, admin.site)
        with patch.object(model_admin, "message_user"):
            model_admin.duplicate_products(request, Product.objects.filter(pk=self.product.pk))
        duplicate = Product.objects.exclude(pk=self.product.pk).get()
        self.assertFalse(duplicate.is_published)
        self.assertEqual(duplicate.cost, self.product.cost)
        self.assertEqual(duplicate.variants.count(), 1)
        self.assertEqual(duplicate.gallery_images.count(), 1)
        copied_extra = duplicate.additionals.get()
        self.assertEqual(copied_extra.name, "Ruedas")
        self.assertEqual(copied_extra.price, 50)
        self.assertEqual(copied_extra.cost, 20)
        self.assertFalse(copied_extra.show_price)
        self.assertFalse(copied_extra.is_active)
        self.assertEqual(copied_extra.unit_label, "juego")
        self.assertNotEqual(copied_extra.pk, self.product.additionals.get().pk)
        self.assertNotEqual(duplicate.slug, self.product.slug)

    def test_upload_and_url_rejections(self):
        for url in ("javascript:alert(1)", "//evil.test/x.jpg", "/images/../private.jpg", "https://127.0.0.1/x.jpg", "https://example.org/file.svg", "https://user:pass@example.org/a.jpg"):
            with self.subTest(url=url), self.assertRaises(ValidationError):
                validate_public_url(url)
        for kind, data in (("image", b"<svg/>"), ("image", b"MZ.exe"), ("pdf", b"<html>fake.pdf</html>"), ("pdf", b"%PDF-1.4 /JavaScript /JS alert() %%EOF")):
            with self.subTest(kind=kind), self.assertRaises(ValidationError):
                clean_upload(SimpleUploadedFile("fake", data), kind)
        for document in ({"asset": {"version": "2.0"}, "images": [{"uri": "https://evil.test/image.png"}]}, {"asset": {"version": "2.0"}, "extensionsRequired": ["EXT_meshopt_compression"]}, {"asset": {"version": "2.0"}, "accessors": [{"count": 900003}], "meshes": [{"primitives": [{"indices": 0}]}]}):
            with self.assertRaises(ValidationError):
                validate_glb(glb(document))
        validate_glb(glb({"asset": {"version": "2.0"}}))

    def test_seed_never_overwrites_existing_records(self):
        call_command("seed_catalog", stdout=StringIO())
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Mesa")
        count = Product.objects.count()
        call_command("seed_catalog", stdout=StringIO())
        self.assertEqual(Product.objects.count(), count)
        self.assertEqual(BusinessSettings.objects.count(), 1)

    def test_signed_backup_roundtrip_media_private_values_and_no_auth_secrets(self):
        asset = MediaAsset.objects.create(name="Imagen", kind="image", file=image_upload())
        self.product.image_asset = asset
        self.product.save()
        ProductVariant.objects.create(product=self.product, name="Grande", cost=34)
        user = get_user_model().objects.create_user(username="DO-NOT-BACKUP-ACCOUNT", password="AUTH-SECRET-EXCLUDED")
        destination = Path(self.temporary.name) / "backup.zip"
        create_backup(destination)
        with zipfile.ZipFile(destination) as archive:
            content = archive.read("catalog.json").decode()
            self.assertNotIn(user.username, content)
            self.assertNotIn("password", content)
            self.assertIn("PRIVATE-DO-NOT-EXPOSE", content)
        self.product.name = "Cambio"
        self.product.save()
        restored_count = restore_backup(destination)
        self.assertGreater(restored_count, 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Mesa")
        self.assertEqual(self.product.cost, Decimal("17.99"))
        self.assertTrue(Path(self.product.image_asset.file.path).is_file())
        self.assertTrue(get_user_model().objects.filter(pk=user.pk).exists())
        self.assertTrue(AuditLog.objects.filter(operation="restore", entity="catalog.backup").exists())

    def test_tampered_and_traversal_backup_are_rejected_before_mutation(self):
        destination = Path(self.temporary.name) / "backup.zip"
        create_backup(destination)
        with zipfile.ZipFile(destination) as archive:
            original = {name: archive.read(name) for name in archive.namelist()}
        for name, data in (("catalog.json", b"[]"), ("../escape", b"malicious")):
            bad = Path(self.temporary.name) / ("bad.zip" if name == "catalog.json" else "traversal.zip")
            contents = dict(original)
            contents[name] = data
            if name != "catalog.json":
                manifest = json.loads(contents["manifest.json"])
                manifest.pop("signature")
                manifest["files"][name] = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
                manifest["signature"] = hmac.new(signing_key(), canonical(manifest), hashlib.sha256).hexdigest()
                contents["manifest.json"] = canonical(manifest)
            with zipfile.ZipFile(bad, "w") as archive:
                for entry, value in contents.items():
                    archive.writestr(entry, value)
            with self.assertRaises(ValidationError):
                restore_backup(bad)
            self.assertEqual(Product.objects.get(pk=self.product.pk).name, "Mesa")

    def test_failed_restore_rolls_back_catalog(self):
        destination = Path(self.temporary.name) / "backup.zip"
        create_backup(destination)
        self.product.name = "Valor actual"
        self.product.save()
        with patch("catalog.backups.Product.full_clean", side_effect=ValidationError("Invalid")):
            with self.assertRaises(ValidationError):
                restore_backup(destination)
        self.assertEqual(Product.objects.get(pk=self.product.pk).name, "Valor actual")

    def test_quote_uses_server_prices_and_validates_quantity_variant_visibility(self):
        url = reverse("catalog-quote", args=(self.product.code,))
        response = self.client.get(url, {"quantity": "2", "price": "0.01"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], "188.40")
        self.assertEqual(response.json()["unitPrice"], "94.20")
        self.assertIn("no-store", response["Cache-Control"])
        variant = ProductVariant.objects.create(product=self.product, name="Grande", price=Decimal("200"))
        self.assertEqual(self.client.get(url, {"quantity": "3", "variant": variant.pk}).json()["total"], "549.75")
        for quantity in ("NaN", "Infinity", "0", "-1", "1.5", "1.0001", "100001", "abc"):
            with self.subTest(quantity=quantity):
                self.assertEqual(self.client.get(url, {"quantity": quantity}).status_code, 400)
        self.assertEqual(self.client.get(url, {"variant": "999999"}).status_code, 400)
        variant.is_active = False
        variant.save()
        self.assertEqual(self.client.get(url, {"variant": variant.pk}).status_code, 400)
        self.product.charge_unit = "m2"
        self.product.save()
        self.assertEqual(self.client.get(url, {"quantity": "1.25"}).json()["total"], "117.75")
        self.product.show_price = False
        self.product.save()
        self.assertEqual(self.client.get(url).status_code, 404)
        self.product.show_price = True
        self.product.is_published = False
        self.product.save()
        self.assertEqual(self.client.get(url).status_code, 404)

    @override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
    def test_preview_and_draft_files_require_mfa_and_render_no_private_costs(self):
        from django_otp.oath import TOTP
        from django_otp.plugins.otp_totp.models import TOTPDevice
        from security.models import SecurityState

        asset = MediaAsset.objects.create(name="Imagen privada", kind="image", file=image_upload())
        self.product.image_asset = asset
        self.product.is_published = False
        self.product.save()
        preview_url = reverse("admin:catalog_product_preview", args=(self.product.pk,))
        file_url = reverse("admin:catalog_media_download", args=(asset.pk,))
        self.assertEqual(self.client.get(preview_url).status_code, 302)
        self.assertEqual(self.client.get(file_url).status_code, 302)
        self.assertEqual(self.client.get(asset.public_url).status_code, 404)
        user = get_user_model().objects.create_user(username="preview@example.com", email="preview@example.com", password="Preview-Strong-Password-123", is_staff=True, is_superuser=True)
        SecurityState.objects.create(user=user)
        device = TOTPDevice.objects.create(user=user, confirmed=True)
        self.client.post(reverse("security:login"), {"email": user.email, "password": "Preview-Strong-Password-123"})
        self.assertEqual(self.client.get(preview_url).status_code, 302)
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time()
        self.client.post(reverse("security:otp"), {"method": "totp", "token": f"{generator.token():06d}"})
        shell = Path(self.temporary.name) / "dist" / "equipo" / "index.html"
        shell.parent.mkdir(parents=True)
        shell.write_text('<html><title>Preview</title><script id="inox-cms-bootstrap" type="application/json">{"mode":"api"}</script></html>', encoding="utf-8")
        with override_settings(FRONTEND_DIST=shell.parent.parent):
            response = self.client.get(preview_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '"preview": true')
        self.assertContains(response, file_url)
        self.assertNotContains(response, "PRIVATE-DO-NOT-EXPOSE")
        self.assertNotContains(response, '"cost"')
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        file_response = self.client.get(file_url)
        self.assertEqual(file_response.status_code, 200)
        self.assertEqual(b"".join(file_response.streaming_content), Path(asset.file.path).read_bytes())
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.cookies = self.client.cookies
        log = AuditLog.objects.filter(entity="catalog.product", object_id=str(self.product.pk), operation="update").latest("pk")
        restore_url = reverse("admin:catalog_audit_restore", args=(log.pk,))
        self.assertEqual(csrf_client.post(restore_url).status_code, 403)
        self.assertEqual(self.client.get(asset.public_url).status_code, 404)

    def test_backup_commands_check_confirmation_and_safety_copy(self):
        destination = Path(self.temporary.name) / "command-backup.zip"
        call_command("backup_catalog", str(destination), stdout=StringIO())
        self.product.name = "Valor actual"
        self.product.save()
        call_command("restore_catalog", str(destination), check=True, stdout=StringIO())
        self.assertEqual(Product.objects.get(pk=self.product.pk).name, "Valor actual")
        with self.assertRaises(CommandError):
            call_command("restore_catalog", str(destination), stdout=StringIO())
        with override_settings(DATA_DIR=Path(self.temporary.name)):
            call_command("restore_catalog", str(destination), confirm="RESTAURAR", stdout=StringIO())
        self.assertEqual(Product.objects.get(pk=self.product.pk).name, "Mesa")
        backups = list((Path(self.temporary.name) / "backups").glob("antes-restauracion-*.zip"))
        self.assertEqual(len(backups), 1)
        previous, _ = inspect_backup(backups[0])
        self.assertIn("Valor actual", [item.object.name for item in previous if isinstance(item.object, Product)])

    def test_blank_backup_key_uses_server_secret_and_short_key_is_rejected(self):
        with patch.dict(os.environ, {"CATALOG_BACKUP_KEY": ""}), override_settings(SECRET_KEY="long-development-key-for-tests-123456789"):
            self.assertEqual(signing_key(), b"long-development-key-for-tests-123456789")
        with patch.dict(os.environ, {"CATALOG_BACKUP_KEY": "short"}):
            with self.assertRaises(ValidationError):
                signing_key()

    def test_restore_resets_primary_key_sequences_before_new_product(self):
        Product.objects.create(pk=5000, code="HIGH", slug="high", name="Alta", category="mobiliario")
        destination = Path(self.temporary.name) / "high-pk.zip"
        create_backup(destination)
        Product.objects.filter(pk=5000).delete()
        restore_backup(destination)
        new = Product.objects.create(code="NEXT", slug="next", name="Nueva", category="mobiliario")
        self.assertGreater(new.pk, 5000)
