"""Variant photos inherit safely and have the same publication boundary as their variant."""
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.forms.models import inlineformset_factory
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse

from .admin import ProductAdmin, ProductVariantInline
from .forms import ProductVariantForm, VariantInlineFormSet, persist_uploads
from .models import AuditLog, MediaAsset, Product, ProductVariant
from .serializers import public_catalog_data
from . import test_editor as editor_fixtures
from .test_editor import admin_data, photo_upload, pdf_upload


class VariantPhotoTests(TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        storage = override_settings(MEDIA_ROOT=temporary.name)
        storage.enable(); self.addCleanup(storage.disable)
        self.product = Product.objects.create(code="PHOTO-TEST", slug="photo-test", name="Equipo de prueba", category="linea-neutra", image="/images/products/test.jpg", is_published=True)
        self.photo = MediaAsset.objects.create(name="Foto de prueba", kind="image", file=photo_upload())
        self.variant = ProductVariant.objects.create(product=self.product, name="Capacidad confirmada", image_asset=self.photo)

    def test_variants_publish_their_own_photo_or_null_to_inherit_without_exposing_private_data(self):
        ProductVariant.objects.create(product=self.product, name="Sin foto propia", order=1, cost=123)
        ProductVariant.objects.create(product=self.product, name="Pendiente de revisión", image_asset=self.photo, order=2, is_active=False)
        item = public_catalog_data()["products"][0]
        self.assertEqual(item["image"], self.product.image)
        self.assertEqual(item["variants"][0]["image"], self.photo.public_url)
        self.assertIsNone(item["variants"][1]["image"])
        self.assertEqual(len(item["variants"]), 2)
        self.assertNotIn("cost", str(item["variants"]))

    def test_photo_is_public_only_while_variant_and_product_are_active_and_published(self):
        for owner, field in ((self.variant, "is_active"), (self.product, "is_active"), (self.product, "is_published")):
            with self.subTest(field=field, model=type(owner).__name__):
                response = self.client.get(self.photo.public_url)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(b"".join(response.streaming_content))
                setattr(owner, field, False); owner.save()
                self.assertEqual(self.client.get(self.photo.public_url).status_code, 404)
                setattr(owner, field, True); owner.save()

    def test_photo_upload_is_optional_validated_and_not_persisted_until_the_form_is_saved(self):
        data = {"product": self.product.pk, "name": "Nueva opción", "order": 0, "availability": "made_to_order"}
        form = ProductVariantForm(data=data, files={"image_upload": photo_upload()})
        before = MediaAsset.objects.count()
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(MediaAsset.objects.count(), before)
        variant = form.save(commit=False); persist_uploads(variant); variant.save()
        self.assertEqual(variant.image_asset.kind, "image")
        self.assertTrue(Path(variant.image_asset.file.path).is_file())
        self.assertFalse(variant.is_active)
        self.assertEqual(self.client.get(variant.image_asset.public_url).status_code, 404)
        invalid = ProductVariantForm(data={**data, "name": "Archivo inválido"}, files={"image_upload": SimpleUploadedFile("fake.png", b"not an image", content_type="image/png")})
        self.assertFalse(invalid.is_valid()); self.assertIn("image_upload", invalid.errors)
        self.assertEqual(MediaAsset.objects.count(), before + 1)

    def test_nonimage_asset_is_rejected_and_referenced_photos_are_protected(self):
        document = MediaAsset.objects.create(name="PDF de prueba", kind="pdf", file=pdf_upload())
        self.variant.image_asset = document
        with self.assertRaises(ValidationError): self.variant.save()
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.image_asset_id, self.photo.pk)
        with self.assertRaises(ProtectedError): self.photo.delete()

    def test_private_preview_and_inline_thumbnail_use_authenticated_media_urls(self):
        self.product.is_published = False; self.product.save()
        owner = get_user_model().objects.create_user("photo-owner@example.test", is_staff=True, is_superuser=True)
        request = RequestFactory().get("/admin/preview/"); request.user = owner
        with patch("config.views._render_shell", return_value=HttpResponse("preview")) as render:
            ProductAdmin(Product, admin.site).preview_view(request, self.product.pk)
        item = next(item for item in render.call_args.args[1]["products"] if item["id"] == self.product.code)
        private_url = reverse("admin:catalog_media_download", args=(self.photo.pk,))
        self.assertEqual(item["variants"][0]["image"], private_url)
        self.assertIn(private_url, str(ProductVariantInline(Product, admin.site).image_current(self.variant)))
        self.assertEqual(self.client.get(self.photo.public_url).status_code, 404)
        self.assertEqual(Client().get(private_url).status_code, 302)

    def test_duplicate_preserves_variant_photo_and_changes_are_auditable(self):
        owner = get_user_model().objects.create_user("copy-photo@example.test", is_staff=True, is_superuser=True)
        request = RequestFactory().post("/admin/"); request.user = owner
        product_admin = ProductAdmin(Product, admin.site)
        with patch.object(product_admin, "message_user"):
            product_admin.duplicate_products(request, Product.objects.filter(pk=self.product.pk))
        duplicate = Product.objects.exclude(pk=self.product.pk).get()
        self.assertFalse(duplicate.is_published)
        self.assertEqual(duplicate.variants.get().image_asset_id, self.photo.pk)
        self.variant.image_asset = None; self.variant.save()
        event = AuditLog.objects.filter(entity="catalog.productvariant", object_id=str(self.variant.pk), operation="update").latest("pk")
        self.assertEqual(event.before["image_asset"], str(self.photo.pk))
        self.assertIsNone(event.after["image_asset"])


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_EMAIL_ENABLED=False)
class VariantPhotoAdminSaveTests(TestCase):
    setUp = editor_fixtures.ProductEditorAdminTests.setUp
    assert_saved = editor_fixtures.ProductEditorAdminTests.assert_saved

    def test_variant_photo_upload_is_saved_by_inline_formset_and_remains_private_when_inactive(self):
        response = self.client.post(self.add_url, admin_data(**{
            "name": "Equipo con variantes", "is_published": "on",
            "variants-TOTAL_FORMS": "1", "variants-0-name": "Tamaño confirmado",
            "variants-0-order": "0", "variants-0-availability": "made_to_order", "variants-0-image_upload": photo_upload(),
        }))
        self.assert_saved(response)
        product = Product.objects.get()
        variant = product.variants.get()
        self.assertEqual(variant.image_asset.kind, "image")
        self.assertFalse(variant.is_active)
        self.assertEqual(Client().get(variant.image_asset.public_url).status_code, 404)
        self.assertEqual(public_catalog_data()["products"][0]["variants"], [])
        self.assertEqual(AuditLog.objects.filter(entity="catalog.productvariant", object_id=str(variant.pk)).get().actor.email, "equipment-editor@example.test")


class VariantCountLimitTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(code="LIMIT-TEST", slug="limit-test", name="Límite de prueba", category="linea-neutra")

    def formset(self, total, existing=(), active=False):
        FormSet = inlineformset_factory(Product, ProductVariant, form=ProductVariantForm, formset=VariantInlineFormSet, fields=("name", "order", "is_active", "availability"), extra=0, max_num=max(100, len(existing)))
        data = {"variants-TOTAL_FORMS": total, "variants-INITIAL_FORMS": len(existing), "variants-MAX_NUM_FORMS": 9999}
        for index in range(total):
            data.update({f"variants-{index}-name": f"Opción {index}", f"variants-{index}-order": index, f"variants-{index}-availability": "made_to_order"})
            if active: data[f"variants-{index}-is_active"] = "on"
            if index < len(existing): data[f"variants-{index}-id"] = existing[index].pk
        return FormSet(instance=self.product, data=data, prefix="variants")

    def test_forged_management_limit_cannot_add_101_variants_but_100_is_valid(self):
        excessive = self.formset(101)
        self.assertFalse(excessive.is_valid())
        self.assertIn("hasta 100", str(excessive.non_form_errors()))
        valid = self.formset(100)
        self.assertTrue(valid.is_valid(), valid.errors)
        self.assertFalse(ProductVariant.objects.exists())

    def test_legacy_rows_are_not_truncated_but_cannot_grow_or_exceed_public_active_limit(self):
        ProductVariant.objects.bulk_create([ProductVariant(product=self.product, name=f"Opción {index}", order=index, is_active=False) for index in range(101)])
        existing = list(self.product.variants.all())
        preserved = self.formset(101, existing)
        self.assertEqual(len(preserved.forms), 101)
        self.assertTrue(preserved.is_valid(), preserved.errors)
        self.assertFalse(self.formset(102, existing).is_valid())
        excessive = self.formset(101, existing, active=True)
        self.assertFalse(excessive.is_valid())
        self.assertIn("activar hasta 100", str(excessive.non_form_errors()))
        self.assertEqual(self.product.variants.count(), 101)
        self.assertEqual(ProductVariantInline(Product, admin.site).get_max_num(RequestFactory().get("/"), self.product), 101)
