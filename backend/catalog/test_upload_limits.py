"""Synthetic multipart requests must be bounded before CSRF or form parsing."""
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadhandler import TemporaryFileUploadHandler
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import HttpResponse
from django.test import Client, RequestFactory, SimpleTestCase, override_settings

from .upload_limits import AdminFileLimitHandler, AdminUploadLimitMiddleware, upload_budget


@override_settings(ALLOWED_HOSTS=["testserver"], SECURE_SSL_REDIRECT=False, FILE_UPLOAD_MAX_MEMORY_SIZE=0)
class AdminUploadBoundaryTests(SimpleTestCase):
    def test_non_upload_admin_routes_do_not_spool_unexpected_files(self):
        client = Client(enforce_csrf_checks=True)
        client.cookies[settings.CSRF_COOKIE_NAME] = "a" * 32
        original = TemporaryFileUploadHandler.new_file
        for path in ("/admin/auth/login/", "/admin/catalog/product/", "/admin/finanzas/"):
            with self.subTest(path=path), patch("django.core.files.uploadhandler.TemporaryFileUploadHandler.new_file", autospec=True, side_effect=original) as spool:
                response = client.post(path, {"unexpected": SimpleUploadedFile("unexpected.bin", b"synthetic")})
                spool.assert_not_called()
                self.assertEqual(response.status_code, 413)

    def test_valid_small_upload_still_requires_csrf(self):
        client = Client(enforce_csrf_checks=True)
        for path in ("/admin/catalog/product/add/", "/admin/catalog/product/1/change/", "/admin/catalog/mediaasset/add/", "/admin/modelos/nuevo/"):
            with self.subTest(path=path):
                response = client.post(path, {"upload": SimpleUploadedFile("synthetic.bin", b"synthetic")})
                self.assertEqual(response.status_code, 403)

    def test_regular_text_only_multipart_form_is_not_rejected_as_upload(self):
        response = Client(enforce_csrf_checks=True).post("/admin/auth/login/", {"email": "synthetic@example.test"})
        self.assertEqual(response.status_code, 403)


class AdminUploadLimitTests(SimpleTestCase):
    def request(self, path="/admin/catalog/product/add/", files=None):
        return RequestFactory().post(path, files or {"name": "Synthetic product"})

    def run_parser(self, request):
        persisted = []

        def endpoint(current):
            rejected = middleware.process_view(current, None, (), {})
            if rejected is not None:
                return rejected
            persisted.extend(upload.read() for upload in current.FILES.values())
            return HttpResponse("ok")

        middleware = AdminUploadLimitMiddleware(endpoint)
        return middleware(request), persisted

    def test_large_declared_body_is_rejected_before_any_read(self):
        request = self.request()
        request.META["CONTENT_LENGTH"] = str(upload_budget(request.path_info).request + 1)
        with patch.object(request._stream, "read", side_effect=AssertionError("Must not read a rejected body")):
            response = AdminUploadLimitMiddleware(lambda current: self.fail("Reached view"))(request)
        self.assertEqual(response.status_code, 413)
        self.assertIn("no-store", response["Cache-Control"])

    def test_missing_or_malformed_length_is_rejected_before_parsing(self):
        for length, status in ((None, 411), ("", 411), ("-1", 400), ("one", 400), ("1" * 13, 400), ("１２", 400)):
            with self.subTest(length=length):
                request = self.request()
                if length is None:
                    request.META.pop("CONTENT_LENGTH")
                else:
                    request.META["CONTENT_LENGTH"] = length
                response = AdminUploadLimitMiddleware(lambda current: self.fail("Reached view"))(request)
                self.assertEqual(response.status_code, status)

    @override_settings(CATALOG_UPLOAD_MAX_TOTAL_BYTES=12)
    def test_per_file_and_cumulative_limits_prevent_partial_persistence(self):
        files = (
            {"image_upload": SimpleUploadedFile("large.bin", b"x" * 9)},
            {"image_upload": SimpleUploadedFile("first.bin", b"x" * 7), "variants-0-model_upload": SimpleUploadedFile("second.bin", b"x" * 7)},
        )
        for data in files:
            with self.subTest(parts=len(data)), patch("catalog.upload_limits.MAX_FILE_SIZE", 8):
                response, persisted = self.run_parser(self.request(files=data))
                self.assertEqual(response.status_code, 413)
                self.assertEqual(persisted, [])

    @override_settings(CATALOG_UPLOAD_MAX_TOTAL_BYTES=16)
    def test_main_and_variation_files_at_limits_still_reach_the_view(self):
        data = {"image_upload": SimpleUploadedFile("first.bin", b"x" * 8), "variants-0-model_upload": SimpleUploadedFile("second.bin", b"y" * 8)}
        with patch("catalog.upload_limits.MAX_FILE_SIZE", 8):
            response, persisted = self.run_parser(self.request(files=data))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(persisted, [b"x" * 8, b"y" * 8])

    @override_settings(MODEL_IMPORT_MAX_SOURCE_BYTES=8)
    def test_sketchup_uses_source_budget_including_unexpected_extra_files(self):
        data = {"upload": SimpleUploadedFile("model.skp", b"x" * 8), "unexpected": SimpleUploadedFile("extra.bin", b"x")}
        response, persisted = self.run_parser(self.request("/admin/modelos/nuevo/", data))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(persisted, [])
        response, persisted = self.run_parser(self.request("/admin/modelos/nuevo/", {"upload": SimpleUploadedFile("model.skp", b"x" * 8)}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(persisted, [b"x" * 8])

    def test_media_change_cannot_be_used_as_alternate_upload_path(self):
        response, persisted = self.run_parser(self.request("/admin/catalog/mediaasset/11111111-1111-4111-8111-111111111111/change/", {"file": SimpleUploadedFile("unexpected.bin", b"synthetic")}))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(persisted, [])

    def test_finance_guard_retains_ownership_of_its_upload_routes(self):
        request = self.request("/admin/finanzas/comprobante/nuevo/")
        request._finance_bounded_upload = True
        response = AdminUploadLimitMiddleware(lambda current: HttpResponse("finance"))(request)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(any(isinstance(handler, AdminFileLimitHandler) for handler in request.upload_handlers))
