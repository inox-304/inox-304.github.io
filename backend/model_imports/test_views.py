"""The import UI preserves current models, permissions and idle-session expiry."""
import json
from pathlib import Path
import re
import tempfile
import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice

from catalog.models import MediaAsset, Product, ProductVariant
from catalog.test_editor import model_upload, photo_upload
from security.models import SecurityState
from security.services import LAST_SEEN
from .models import ModelImportJob
from .services import create_job, review_token, target_revision


def skp_upload(name="mesa.skp"):
    return SimpleUploadedFile(name, b"\xff\xfe\xff\x0eSynthetic test SketchUp source", content_type="application/octet-stream")


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_EMAIL_ENABLED=False)
class ModelImportViewTests(TestCase):
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
        self.user = get_user_model().objects.create_user(username="model-review@example.test", email="model-review@example.test", password="Synthetic-Model-Review-123", is_staff=True, is_superuser=True)
        SecurityState.objects.create(user=self.user)
        device = TOTPDevice.objects.create(user=self.user, confirmed=True)
        self.client.post(reverse("security:login"), {"email": self.user.email, "password": "Synthetic-Model-Review-123"})
        otp = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
        otp.time = time.time()
        self.client.post(reverse("security:otp"), {"method": "totp", "token": f"{otp.token():06d}"})
        self.product = Product.objects.create(code="SKP-TEST", name="Mesa de prueba", slug="mesa-de-prueba", category="linea-neutra", image_asset=MediaAsset.objects.create(name="Foto", kind="image", file=photo_upload()), model_asset=MediaAsset.objects.create(name="Anterior", kind="glb", file=model_upload()))
        self.old_asset_id = self.product.model_asset_id
        self.job = create_job(user=self.user, product=self.product, variant=None, upload=skp_upload())

    def url(self, name, job=None):
        return reverse("model_imports:" + name, args=((job or self.job).pk,))

    def ready(self, job=None):
        job = job or self.job
        job.result_asset = MediaAsset.objects.create(name="Candidato", kind="glb", file=model_upload())
        job.status = "ready"
        job.save()
        return job

    def role(self, *permissions):
        self.user.is_superuser = False
        self.user.save()
        self.user.user_permissions.set(Permission.objects.filter(content_type__app_label="catalog", codename__in=permissions))
        for key in ("_perm_cache", "_user_perm_cache", "_group_perm_cache"):
            self.user.__dict__.pop(key, None)

    def apply_data(self, **extra):
        return {"revision": target_revision(self.job), "token": review_token(self.job), **extra}

    @staticmethod
    def consume(response):
        return b"".join(response.streaming_content) if response.streaming else response.content

    @staticmethod
    def bootstrap(response):
        value = re.search(r'<script[^>]*id="inox-cms-bootstrap"[^>]*>(.*?)</script>', response.content.decode(), re.S)
        return json.loads(value[1])

    def test_recent_jobs_and_two_step_upload_page(self):
        listing = self.client.get(reverse("model_imports:index"))
        self.assertContains(listing, "De SketchUp a tu catálogo")
        self.assertContains(listing, "mesa.skp")
        self.assertContains(self.client.get(reverse("model_imports:upload")), "¿A qué equipo pertenece?")
        page = self.client.get(reverse("model_imports:upload"), {"product": self.product.pk})
        self.assertContains(page, 'enctype="multipart/form-data"')
        self.assertContains(page, "20 MB")
        self.assertNotContains(page, self.job.source.name)

    def test_upload_is_queued_without_touching_current_model(self):
        other = Product.objects.create(code="SKP-NEW", name="Nuevo", slug="skp-nuevo", category="mobiliario")
        response = self.client.post(reverse("model_imports:upload"), {"product": other.pk, "upload": skp_upload()})
        job = ModelImportJob.objects.get(product=other)
        self.assertRedirects(response, self.url("detail", job))
        self.assertEqual(job.status, "queued")
        self.assertIsNone(job.result_asset_id)
        other.refresh_from_db()
        self.assertFalse(other.is_published)
        self.assertIsNone(other.model_asset_id)

    def test_invalid_source_and_duplicate_target_show_safe_errors(self):
        bad = self.client.post(reverse("model_imports:upload"), {"product": self.product.pk, "upload": SimpleUploadedFile("fake.skp", b"not a sketchup file")})
        self.assertContains(bad, "El contenido no corresponde")
        repeated = self.client.post(reverse("model_imports:upload"), {"product": self.product.pk, "upload": skp_upload()})
        self.assertContains(repeated, "ya tiene un modelo pendiente")
        self.assertEqual(ModelImportJob.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.old_asset_id)

    def test_invalid_or_foreign_target_does_not_leak_or_create(self):
        other = Product.objects.create(code="OTHER", name="Otro", slug="otro", category="mobiliario")
        variation = ProductVariant.objects.create(product=other, name="Ajena")
        for params in ({"product": "1e100"}, {"product": self.product.pk, "variant": "bad"}, {"product": self.product.pk, "variant": "9" * 100}, {"product": self.product.pk, "variant": variation.pk}):
            self.assertEqual(self.client.get(reverse("model_imports:upload"), params).status_code, 404)
        response = self.client.post(reverse("model_imports:upload"), {"product": self.product.pk, "variant": variation.pk, "upload": skp_upload()})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["form"].errors["variant"])
        self.assertEqual(ModelImportJob.objects.count(), 1)

    def test_mfa_and_post_csrf_are_required(self):
        self.ready()
        anonymous = Client()
        for name in ("detail", "preview", "source", "result"):
            self.assertEqual(anonymous.get(self.url(name)).status_code, 302)
        self.assertEqual(anonymous.get(self.url("status"), HTTP_ACCEPT="application/json").status_code, 401)
        strict = Client(enforce_csrf_checks=True)
        strict.cookies = self.client.cookies
        for name in ("apply", "cancel", "retry"):
            self.assertEqual(self.client.get(self.url(name)).status_code, 405)
            self.assertEqual(strict.post(self.url(name), self.apply_data()).status_code, 403)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "ready")

    def test_readonly_can_review_but_cannot_upload_or_apply(self):
        self.ready()
        self.role("view_product")
        self.assertEqual(self.client.get(self.url("preview")).status_code, 200)
        self.assertNotContains(self.client.get(self.url("preview")), "Aplicar modelo al equipo")
        self.assertEqual(self.client.get(reverse("model_imports:upload")).status_code, 403)
        for name in ("apply", "cancel", "retry"):
            self.assertEqual(self.client.post(self.url(name), self.apply_data()).status_code, 403)
        self.role()
        for name in ("detail", "preview", "source", "result", "status"):
            self.assertEqual(self.client.get(self.url(name)).status_code, 403)

    def test_variant_permission_is_required_for_every_private_job_route(self):
        variation = ProductVariant.objects.create(product=self.product, name="Versión privada")
        variant_job = create_job(user=self.user, product=self.product, variant=variation, upload=skp_upload())
        self.ready(variant_job)
        self.role("view_product", "change_product")
        for name in ("detail", "preview", "source", "result", "status"):
            self.assertEqual(self.client.get(self.url(name, variant_job)).status_code, 403)
        self.assertNotContains(self.client.get(reverse("model_imports:index")), "Versión privada")
        self.assertNotContains(self.client.get(reverse("model_imports:upload"), {"product": self.product.pk}), "Versión privada")
        self.assertEqual(self.client.get(reverse("model_imports:upload"), {"product": self.product.pk, "variant": variation.pk}).status_code, 403)
        self.role("view_product", "view_productvariant")
        self.assertEqual(self.client.get(self.url("preview", variant_job)).status_code, 200)
        self.assertEqual(self.client.post(self.url("apply", variant_job), {}).status_code, 403)

    def test_original_and_candidate_remain_private_and_uncached(self):
        self.ready()
        for name in ("source", "result"):
            response = self.client.get(self.url(name), HTTP_ORIGIN="https://inox-304.github.io")
            self.assertEqual(response.status_code, 200)
            self.assertIn("no-store", response["Cache-Control"])
            self.assertNotIn("Access-Control-Allow-Origin", response)
            self.assertEqual(response["X-Content-Type-Options"], "nosniff")
            self.assertTrue(self.consume(response))
        self.assertEqual(Client().get(self.job.result_asset.public_url).status_code, 404)
        self.assertEqual(Client().get("/media/" + self.job.source.name).status_code, 404)
        self.assertEqual(Client().get("/api/catalog/").json()["products"], [])

    def test_not_ready_result_is_not_downloadable(self):
        self.assertEqual(self.client.get(self.url("result")).status_code, 404)
        self.assertRedirects(self.client.get(self.url("preview")), self.url("detail"))
        self.ready()
        self.job.status = "cancelled"
        self.job.save()
        self.assertEqual(self.client.get(self.url("result")).status_code, 404)

    def test_private_preview_contains_only_candidate_and_no_configuration(self):
        self.ready()
        other = Product.objects.create(code="PUBLIC", name="Otro equipo", slug="publico", category="mobiliario", is_published=True)
        response = self.client.get(self.url("preview"))
        self.assertContains(response, "Revisa este modelo por separado")
        self.assertContains(response, 'name="revision"')
        self.assertContains(response, review_token(self.job))
        payload = self.bootstrap(response)
        self.assertTrue(payload["preview"])
        self.assertEqual(payload["previewProductId"], self.product.code)
        self.assertEqual(len(payload["data"]["products"]), 1)
        candidate = payload["data"]["products"][0]
        self.assertEqual(candidate["model3d"], self.url("result"))
        self.assertEqual(candidate["variants"], [])
        self.assertIsNone(candidate["cooktopConfig"])
        self.assertIsNone(candidate["cartConfig"])
        self.assertEqual(candidate["doorAnimation"], "")
        self.assertIn("no-store", response["Cache-Control"])
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.old_asset_id)
        self.assertFalse(self.product.is_published)

    def test_inactive_variant_preview_uses_its_own_candidate_and_photo(self):
        photo = MediaAsset.objects.create(name="Foto variación", kind="image", file=photo_upload())
        variation = ProductVariant.objects.create(product=self.product, name='Grande <script>alert(1)</script>', is_active=False, image_asset=photo)
        job = self.ready(create_job(user=self.user, product=self.product, variant=variation, upload=skp_upload()))
        response = self.client.get(self.url("preview", job))
        self.assertNotContains(response, "<script>alert(1)</script>")
        candidate = self.bootstrap(response)["data"]["products"][0]
        self.assertEqual(candidate["model3d"], self.url("result", job))
        self.assertEqual(candidate["image"], reverse("admin:catalog_media_download", args=(photo.pk,)))
        self.assertEqual(candidate["variants"], [])
        variation.refresh_from_db()
        self.assertFalse(variation.is_active)
        self.assertIsNone(variation.model_asset_id)

    def test_draft_requires_explicit_apply_then_separate_publish(self):
        self.ready()
        response = self.client.post(self.url("apply"), self.apply_data())
        self.assertRedirects(response, reverse("admin:catalog_product_preview", args=(self.product.pk,)))
        self.product.refresh_from_db()
        self.job.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.job.result_asset_id)
        self.assertFalse(self.product.is_published)
        self.assertEqual(self.job.status, "applied")
        self.assertEqual(Client().get(self.job.result_asset.public_url).status_code, 404)

    def test_live_replacement_requires_confirmation_and_stale_review_is_rejected(self):
        self.product.is_published = True
        self.product.save()
        self.ready()
        self.assertContains(self.client.get(self.url("preview")), 'name="confirm_live"')
        self.assertRedirects(self.client.post(self.url("apply"), self.apply_data()), self.url("preview"))
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.old_asset_id)
        old_review = self.apply_data(confirm_live="yes")
        self.product.name = "Nombre corregido"
        self.product.save()
        response = self.client.post(self.url("apply"), old_review, follow=True)
        self.assertContains(response, "El equipo o el modelo cambió")
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.old_asset_id)
        self.client.post(self.url("apply"), self.apply_data(confirm_live="yes"))
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.job.result_asset_id)
        self.assertTrue(self.product.is_published)

    def test_interactive_model_cannot_be_replaced_silently(self):
        self.ready()
        self.product.door_animation = "DoorOpen"
        self.product.save()
        response = self.client.get(self.url("preview"))
        self.assertContains(response, "Antes de reemplazar su modelo")
        self.assertNotContains(response, "Aplicar modelo al equipo")
        self.client.post(self.url("apply"), self.apply_data())
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.old_asset_id)
        self.assertEqual(self.product.door_animation, "DoorOpen")

    def test_retry_and_cancel_are_explicit_transitions(self):
        self.job.status = "failed"
        self.job.error_message = "Modelo demasiado complejo."
        self.job.save()
        self.assertContains(self.client.get(self.url("detail")), "Modelo demasiado complejo.")
        self.assertContains(self.client.get(self.url("detail")), "Volver a intentar")
        self.client.post(self.url("retry"))
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "queued")
        self.client.post(self.url("cancel"))
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "cancelled")
        self.product.refresh_from_db()
        self.assertEqual(self.product.model_asset_id, self.old_asset_id)

    def test_status_poll_does_not_extend_idle_session_and_expiry_returns_401(self):
        session = self.client.session
        before = time.time() - 100
        session[LAST_SEEN] = before
        session.save()
        response = self.client.get(self.url("status"), HTTP_X_INOX_AUTOMATIC="1", HTTP_ACCEPT="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.session[LAST_SEEN], before)
        data = response.json()
        self.assertTrue(data["active"])
        for private in ("source", "source_sha256", "token", "revision", "lease_token"):
            self.assertNotIn(private, data)
        self.assertNotIn(self.job.source.name, response.content.decode())
        self.client.get(self.url("detail"), HTTP_X_INOX_AUTOMATIC="1")
        self.assertGreater(self.client.session[LAST_SEEN], before)
        session = self.client.session
        session[LAST_SEEN] = time.time() - 1900
        session.save()
        response = self.client.get(self.url("status"), HTTP_X_INOX_AUTOMATIC="1", HTTP_ACCEPT="application/json")
        self.assertEqual(response.status_code, 401)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "queued")

    def test_safe_service_errors_are_visible_without_raw_tracebacks(self):
        self.ready()
        with patch("model_imports.views.apply_job", side_effect=ValidationError("Vuelve a abrir la revisión.")):
            response = self.client.post(self.url("apply"), self.apply_data(), follow=True)
        self.assertContains(response, "Vuelve a abrir la revisión.")
        self.assertNotContains(response, "Traceback")
