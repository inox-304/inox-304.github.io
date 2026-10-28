"""Publish from a private preview without exposing draft uploads or sessions."""
import tempfile
import time
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice

from security.models import SecurityState
from .models import AuditLog, MediaAsset, Product, ProductVariant
from .test_editor import admin_data, model_upload, photo_upload


ORIGIN = "https://inox-304.github.io"


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_EMAIL_ENABLED=False,
                   PUBLIC_CATALOG_ORIGIN=ORIGIN, PUBLIC_CATALOG_ORIGINS=(ORIGIN,))
class CatalogPublicationTests(TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        shell = self.root / "dist" / "equipo" / "index.html"
        shell.parent.mkdir(parents=True)
        shell.write_text('<html><head><title>Equipo</title></head><body><script id="inox-cms-bootstrap" type="application/json">{"mode":"api"}</script></body></html>', encoding="utf-8")
        overrides = override_settings(MEDIA_ROOT=self.root / "media", FRONTEND_DIST=shell.parent.parent)
        overrides.enable()
        self.addCleanup(overrides.disable)
        self.user = get_user_model().objects.create_user(username="publisher@example.test", email="publisher@example.test", password="Synthetic-Publisher-123", is_staff=True, is_superuser=True)
        SecurityState.objects.create(user=self.user)
        device = TOTPDevice.objects.create(user=self.user, confirmed=True)
        self.client.post(reverse("security:login"), {"email": self.user.email, "password": "Synthetic-Publisher-123"})
        otp = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        otp.time = time.time()
        self.client.post(reverse("security:otp"), {"method": "totp", "token": f"{otp.token():06d}"})
        self.product = Product.objects.create(code="NEW-3D", slug="equipo-nuevo", name="Equipo nuevo", category="linea-neutra")
        self.preview_url = reverse("admin:catalog_product_preview", args=(self.product.pk,))
        self.publish_url = reverse("admin:catalog_product_publish", args=(self.product.pk,))

    def publish(self, version=None, client=None):
        return (client or self.client).post(self.publish_url, {"reviewed_version": version or self.product.updated_at.isoformat()})

    @staticmethod
    def consume(response):
        # Django's test client wraps streaming iterators to close files while
        # temporarily disconnecting close_old_connections. Calling close()
        # directly fires request_finished inside TestCase's outer transaction
        # and closes the PostgreSQL connection for the remaining tests.
        return b"".join(response.streaming_content) if response.streaming else response.content

    def prepare_assets(self):
        self.product.image_asset = MediaAsset.objects.create(name="Foto", kind="image", file=photo_upload())
        self.product.model_asset = MediaAsset.objects.create(name="Modelo", kind="glb", file=model_upload())
        self.product.save()

    def test_draft_upload_preview_publish_and_hide_with_cors(self):
        self.prepare_assets()
        anonymous = Client()
        self.assertEqual(anonymous.get("/api/catalog/", HTTP_ORIGIN=ORIGIN).json()["products"], [])
        for asset in (self.product.image_asset, self.product.model_asset):
            self.assertEqual(anonymous.get(asset.public_url, HTTP_ORIGIN=ORIGIN).status_code, 404)
        preview = self.client.get(self.preview_url)
        self.assertContains(preview, "Borrador privado")
        self.assertContains(preview, "Publicar en catálogo")
        self.assertContains(preview, self.product.updated_at.isoformat())
        self.assertContains(preview, reverse("admin:catalog_media_download", args=(self.product.model_asset_id,)))
        self.assertNotIn("Access-Control-Allow-Origin", preview)
        self.assertIn("no-store", preview["Cache-Control"])
        self.assertEqual(preview["X-Robots-Tag"], "noindex, nofollow")
        response = self.publish()
        self.assertRedirects(response, self.preview_url)
        self.product.refresh_from_db()
        self.assertTrue(self.product.is_published)
        record = AuditLog.objects.filter(entity="catalog.product", object_id=str(self.product.pk)).latest("pk")
        self.assertEqual(record.actor, self.user)
        public = anonymous.get("/api/catalog/", HTTP_ORIGIN=ORIGIN)
        self.assertEqual(public["Access-Control-Allow-Origin"], ORIGIN)
        self.assertNotIn("Access-Control-Allow-Credentials", public)
        self.assertIn("Origin", public["Vary"])
        self.assertEqual(public.json()["products"][0]["model3d"], self.product.model_asset.public_url)
        media = anonymous.get(self.product.model_asset.public_url, HTTP_ORIGIN=ORIGIN)
        self.assertEqual(media.status_code, 200)
        self.assertEqual(media["Access-Control-Allow-Origin"], ORIGIN)
        self.assertNotIn("Access-Control-Allow-Credentials", media)
        self.assertTrue(self.consume(media).startswith(b"glTF"))
        self.assertContains(self.client.get(self.preview_url), ORIGIN + "/equipo/?id=NEW-3D")
        self.product.is_published = False
        self.product.save()
        self.assertEqual(anonymous.get(self.product.model_asset.public_url, HTTP_ORIGIN=ORIGIN).status_code, 404)
        self.assertEqual(anonymous.get("/api/catalog/").json()["products"], [])

    def test_public_cors_is_exact_and_never_on_private_downloads(self):
        self.prepare_assets()
        self.product.is_published = True
        self.product.save()
        for origin in ("null", "https://inox-304.github.io.evil.test", "http://inox-304.github.io", ORIGIN + "/", "https://evil.test"):
            for url in ("/api/catalog/", self.product.model_asset.public_url):
                response = self.client.get(url, HTTP_ORIGIN=origin)
                self.assertNotIn("Access-Control-Allow-Origin", response)
                self.consume(response)
        response = self.client.get(reverse("admin:catalog_media_download", args=(self.product.model_asset_id,)), HTTP_ORIGIN=ORIGIN)
        self.assertNotIn("Access-Control-Allow-Origin", response)
        self.consume(response)

    def test_publication_requires_post_mfa_change_permission_and_csrf(self):
        self.prepare_assets()
        self.assertEqual(self.client.get(self.publish_url).status_code, 405)
        self.assertEqual(Client().post(self.publish_url).status_code, 302)
        strict = Client(enforce_csrf_checks=True)
        strict.cookies = self.client.cookies
        self.assertEqual(self.publish(client=strict).status_code, 403)
        self.user.is_superuser = False
        self.user.user_permissions.add(Permission.objects.get(codename="view_product", content_type__app_label="catalog"))
        self.user.save()
        self.assertContains(self.client.get(self.preview_url), "Borrador privado")
        self.assertNotContains(self.client.get(self.preview_url), "Publicar en catálogo")
        self.assertEqual(self.publish().status_code, 403)
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_published)

    def test_missing_photo_inactive_and_stale_review_do_not_publish(self):
        self.publish()
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_published)
        self.assertContains(self.client.get(self.preview_url), "Añade una foto principal")
        self.prepare_assets()
        self.product.is_active = False
        self.product.save()
        self.publish()
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_published)
        self.assertContains(self.client.get(self.preview_url), "Activa el equipo")
        self.product.is_active = True
        self.product.save()
        previous = self.product.updated_at.isoformat()
        self.product.name = "Cambió durante la revisión"
        self.product.save()
        self.publish(version=previous)
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_published)

    def test_photo_only_can_publish_and_inactive_variant_media_stays_private(self):
        self.product.image = "/images/catalogo/mesa.webp"
        self.product.save()
        variant_asset = MediaAsset.objects.create(name="Otra capacidad", kind="glb", file=model_upload())
        variant = ProductVariant.objects.create(product=self.product, name="20 L", model_asset=variant_asset, is_active=False)
        self.publish()
        self.product.refresh_from_db()
        self.assertTrue(self.product.is_published)
        self.assertIsNone(self.product.model_asset_id)
        self.assertEqual(Client().get(variant_asset.public_url, HTTP_ORIGIN=ORIGIN).status_code, 404)
        variant.is_active = True
        variant.save()
        self.assertEqual(Client().get("/api/catalog/").json()["products"][0]["variants"][0]["model3d"], variant_asset.public_url)
        response = Client().get(variant_asset.public_url, HTTP_ORIGIN=ORIGIN)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Access-Control-Allow-Origin"], ORIGIN)
        self.consume(response)

    def test_save_and_review_keeps_new_draft_and_returns_to_preview(self):
        response = self.client.post(reverse("admin:catalog_product_add"), admin_data(name="Nuevo revisable", _review="1", is_published="on", image_upload=photo_upload(), model_upload=model_upload()))
        new = Product.objects.get(name="Nuevo revisable")
        self.assertRedirects(response, reverse("admin:catalog_product_preview", args=(new.pk,)))
        self.assertFalse(new.is_published)
        self.assertIsNotNone(new.model_asset_id)

    def test_review_of_live_product_is_explicitly_not_staging(self):
        self.prepare_assets()
        self.product.is_published = True
        self.product.save()
        self.assertContains(self.client.get(reverse("admin:catalog_product_change", args=(self.product.pk,))), "Guardar actualiza la información pública")
        response = self.client.post(reverse("admin:catalog_product_change", args=(self.product.pk,)), admin_data(name="Nombre actualizado", _review="1", image_asset=str(self.product.image_asset_id), model_asset=str(self.product.model_asset_id)))
        self.assertRedirects(response, self.preview_url)
        self.product.refresh_from_db()
        self.assertTrue(self.product.is_published)
        self.assertEqual(self.product.name, "Nombre actualizado")

    def test_bulk_publication_uses_readiness_checks_without_partial_changes(self):
        complete = Product.objects.create(code="READY", slug="ready", name="Equipo revisable", category="linea-neutra", image="/images/ready.webp")
        url = reverse("admin:catalog_product_changelist")
        response = self.client.post(url, {"action": "publish_products", "confirm": "yes", "_selected_action": [str(self.product.pk), str(complete.pk)]})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(Product.objects.filter(is_published=True).exists())
        self.prepare_assets()
        response = self.client.post(url, {"action": "publish_products", "confirm": "yes", "_selected_action": [str(self.product.pk), str(complete.pk)]})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Product.objects.filter(is_published=True).count(), 2)
