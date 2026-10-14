"""End-to-end coverage for preparing equipment before its assets are ready."""

import json
import struct
import tempfile
import time
from io import BytesIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice
from PIL import Image

from security.models import SecurityState

from .forms import ProductAdminForm
from .models import MediaAsset, Product


def product_data(**changes):
    data = {
        "name": "Mesa de preparación",
        "category": "linea-neutra",
        "order": "0",
        "currency": "PEN",
        "charge_unit": "unit",
        "discount_percent": "0",
        "additional_flat": "0",
        "availability": "made_to_order",
        "is_active": "on",
    }
    data.update(changes)
    return data


def admin_data(**changes):
    return product_data(
        **{
            "variants-TOTAL_FORMS": "0",
            "variants-INITIAL_FORMS": "0",
            "variants-MIN_NUM_FORMS": "0",
            "variants-MAX_NUM_FORMS": "1000",
            "gallery_images-TOTAL_FORMS": "0",
            "gallery_images-INITIAL_FORMS": "0",
            "gallery_images-MIN_NUM_FORMS": "0",
            "gallery_images-MAX_NUM_FORMS": "8",
            "_continue": "1",
            **changes,
        }
    )


def photo_upload():
    buffer = BytesIO()
    Image.new("RGB", (48, 32), (76, 94, 108)).save(buffer, "PNG")
    return SimpleUploadedFile("equipo.png", buffer.getvalue(), content_type="image/png")


def pdf_upload():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    ]
    document = b"%PDF-1.4\n"
    offsets = [0]
    for index, body in enumerate(objects, 1):
        offsets.append(len(document))
        document += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_offset = len(document)
    document += b"xref\n0 4\n0000000000 65535 f \n"
    document += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    document += f"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode()
    return SimpleUploadedFile("ficha.pdf", document, content_type="application/pdf")


def model_upload():
    document = json.dumps({"asset": {"version": "2.0"}, "scene": 0, "scenes": [{}]}).encode()
    document += b" " * ((-len(document)) % 4)
    data = struct.pack("<4sIIII", b"glTF", 2, 20 + len(document), len(document), 0x4E4F534A) + document
    return SimpleUploadedFile("equipo.glb", data, content_type="model/gltf-binary")


class ProductEditorFormTests(TestCase):
    def test_new_equipment_gets_unique_identifiers_without_assets(self):
        products = []
        for _ in range(2):
            form = ProductAdminForm(data=product_data())
            self.assertTrue(form.is_valid(), form.errors)
            products.append(form.save())
        for product in products:
            self.assertRegex(product.code, r"^EQ-[0-9a-f]{8}$")
            self.assertRegex(product.slug, r"^mesa-de-preparacion-[0-9a-f]{8}$")
            self.assertFalse(product.is_published)
            self.assertIsNone(product.image_asset_id)
            self.assertIsNone(product.technical_asset_id)
            self.assertIsNone(product.model_asset_id)
        self.assertNotEqual(products[0].code, products[1].code)
        self.assertNotEqual(products[0].slug, products[1].slug)
        self.assertFalse(MediaAsset.objects.exists())

    def test_editing_preserves_existing_identifiers_when_left_empty(self):
        product = Product.objects.create(code="LEGACY01", slug="mesa-anterior", name="Mesa", category="mobiliario")
        form = ProductAdminForm(instance=product, data=product_data(code="", slug="", name="Mesa renovada", category="mobiliario"))
        self.assertTrue(form.is_valid(), form.errors)
        saved = form.save()
        self.assertEqual(saved.code, "LEGACY01")
        self.assertEqual(saved.slug, "mesa-anterior")
        self.assertEqual(saved.name, "Mesa renovada")
        self.assertEqual(saved.category, "mobiliario")

    def test_new_equipment_uses_the_three_business_categories(self):
        for category in ("linea-caliente", "linea-fria", "linea-neutra"):
            form = ProductAdminForm(data=product_data(category=category))
            self.assertTrue(form.is_valid(), form.errors)
        form = ProductAdminForm(data=product_data(category="mobiliario"))
        self.assertFalse(form.is_valid())
        self.assertIn("category", form.errors)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_EMAIL_ENABLED=False)
class ProductEditorAdminTests(TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.media_root = Path(temporary.name) / "media"
        settings_override = override_settings(MEDIA_ROOT=self.media_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.add_url = reverse("admin:catalog_product_add")
        user = get_user_model().objects.create_user(
            username="equipment-editor@example.test",
            email="equipment-editor@example.test",
            password="Synthetic-Editor-Password-123",
            is_staff=True,
            is_superuser=True,
        )
        SecurityState.objects.create(user=user)
        device = TOTPDevice.objects.create(user=user, confirmed=True)
        self.client.post(reverse("security:login"), {"email": user.email, "password": "Synthetic-Editor-Password-123"})
        self.assertEqual(self.client.get(self.add_url).status_code, 302)
        generator = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        generator.time = time.time()
        self.client.post(reverse("security:otp"), {"method": "totp", "token": f"{generator.token():06d}"})

    def assert_saved(self, response):
        errors = {}
        if response.context:
            errors = response.context["adminform"].form.errors
            errors["inlines"] = [inline.formset.errors for inline in response.context["inline_admin_formsets"]]
        self.assertEqual(response.status_code, 302, errors)

    def test_admin_guides_creation_and_saves_a_draft_without_assets(self):
        response = self.client.get(self.add_url)
        self.assertContains(response, "Nuevo equipo, paso a paso")
        response = self.client.post(self.add_url, admin_data())
        self.assert_saved(response)
        product = Product.objects.get()
        self.assertFalse(product.is_published)
        self.assertEqual(product.category, "linea-neutra")
        self.assertFalse(MediaAsset.objects.exists())
        self.assertEqual(Client().get("/api/catalog/").json()["products"], [])
        self.assertRedirects(response, reverse("admin:catalog_product_change", args=(product.pk,)))

    def test_assets_can_be_uploaded_later_and_remain_private_until_publication(self):
        self.assert_saved(self.client.post(self.add_url, admin_data()))
        product = Product.objects.get()
        change_url = reverse("admin:catalog_product_change", args=(product.pk,))
        response = self.client.post(change_url, admin_data(
            code=product.code, slug=product.slug,
            image_upload=photo_upload(), technical_upload=pdf_upload(), model_upload=model_upload(),
        ))
        self.assert_saved(response)
        product.refresh_from_db()
        assets = (product.image_asset, product.technical_asset, product.model_asset)
        self.assertEqual(MediaAsset.objects.count(), 3)
        public_client = Client()
        for asset, kind in zip(assets, ("image", "pdf", "glb")):
            self.assertEqual(asset.kind, kind)
            self.assertTrue(Path(asset.file.path).is_file())
            self.assertEqual(public_client.get(asset.public_url).status_code, 404)
            private_response = self.client.get(reverse("admin:catalog_media_download", args=(asset.pk,)))
            self.assertEqual(private_response.status_code, 200)
            private_response.close()
        self.assertEqual(public_client.get("/api/catalog/").json()["products"], [])
        response = self.client.post(change_url, admin_data(
            code=product.code, slug=product.slug, is_published="on",
            image_asset=str(product.image_asset_id), technical_asset=str(product.technical_asset_id), model_asset=str(product.model_asset_id),
        ))
        self.assert_saved(response)
        item = public_client.get("/api/catalog/").json()["products"][0]
        for field, asset in zip(("image", "technicalSheet", "model3d"), assets):
            self.assertEqual(item[field], asset.public_url)
            file_response = public_client.get(asset.public_url)
            self.assertEqual(file_response.status_code, 200)
            file_response.close()
        self.assertEqual(MediaAsset.objects.count(), 3)

    def test_invalid_upload_preserves_the_existing_draft_and_writes_no_assets(self):
        self.assert_saved(self.client.post(self.add_url, admin_data()))
        product = Product.objects.get()
        response = self.client.post(reverse("admin:catalog_product_change", args=(product.pk,)), admin_data(
            code=product.code, slug=product.slug, name="Nombre sin guardar",
            image_upload=photo_upload(), technical_upload=SimpleUploadedFile("falso.pdf", b"not a PDF"), model_upload=model_upload(),
        ))
        self.assertEqual(response.status_code, 200)
        self.assertIn("technical_upload", response.context["adminform"].form.errors)
        self.assertContains(response, "Nombre sin guardar")
        product.refresh_from_db()
        self.assertEqual(product.name, "Mesa de preparación")
        self.assertFalse(product.is_published)
        self.assertFalse(MediaAsset.objects.exists())
        self.assertFalse(self.media_root.exists() and any(self.media_root.rglob("*")))

