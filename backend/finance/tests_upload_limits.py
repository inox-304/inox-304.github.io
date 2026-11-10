"""Small synthetic bodies exercise guards without allocating oversized files."""
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.uploadhandler import StopUpload
from django.http import HttpRequest, JsonResponse
from django.test import Client, SimpleTestCase, override_settings
from django.urls import path
from django.views.decorators.csrf import ensure_csrf_cookie

from .upload_limits import FinanceFileLimitHandler, MAX_REQUEST_BYTES

VIEW_CALLS = []


@ensure_csrf_cookie
def token(request):
    return JsonResponse({"ready": True})


def upload(request, pk):
    VIEW_CALLS.append(pk)
    return JsonResponse({"files": len(request.FILES), "bytes": sum(file.size for file in request.FILES.values())}, status=201)


urlpatterns = [path("admin/finanzas/<int:pk>/comprobante/", upload),
    path("admin/finanzas/comprobante/nuevo/", upload, {"pk": 12}),
    path("token/", token), path("unrelated/", token)]


@override_settings(ROOT_URLCONF=__name__, ALLOWED_HOSTS=["testserver"], MIDDLEWARE=[
    "finance.upload_limits.FinanceUploadLimitMiddleware", "django.middleware.csrf.CsrfViewMiddleware",
])
class FinanceUploadLimitTests(SimpleTestCase):
    url = "/admin/finanzas/12/comprobante/"

    def setUp(self):
        VIEW_CALLS.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.client.get("/token/")
        self.csrf = self.client.cookies["csrftoken"].value

    def test_large_header_is_rejected_before_body_or_view(self):
        response = self.client.post(self.url, b"tiny", content_type="application/octet-stream", CONTENT_LENGTH=str(MAX_REQUEST_BYTES + 1))
        self.assertEqual(response.status_code, 413)
        self.assertFalse(VIEW_CALLS)
        self.assertIn("private", response["Cache-Control"])

    def test_missing_length_requires_known_size(self):
        response = self.client.post(self.url, b"tiny", content_type="application/octet-stream", CONTENT_LENGTH="")
        self.assertEqual(response.status_code, 411)
        self.assertFalse(VIEW_CALLS)

    def test_invalid_length_is_rejected(self):
        for length in ("wrong", "-1", "+10", "1.5", "９", "9" * 20):
            with self.subTest(length=length):
                response = self.client.post(self.url, b"tiny", content_type="application/octet-stream", CONTENT_LENGTH=length)
                self.assertEqual(response.status_code, 400)
        self.assertFalse(VIEW_CALLS)

    def test_valid_small_file_keeps_existing_handler_and_csrf_checks(self):
        response = self.client.post(self.url, {"document": SimpleUploadedFile("tiny.pdf", b"fixture")}, HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"files": 1, "bytes": 7})
        self.assertEqual(VIEW_CALLS, [12])
        VIEW_CALLS.clear()
        response = self.client.post(self.url, {"document": SimpleUploadedFile("tiny.pdf", b"fixture")})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(VIEW_CALLS)

    def test_stream_limit_stops_request_before_view_even_if_first_file_completed(self):
        with patch("finance.upload_limits.MAX_FILE_BYTES", 16):
            response = self.client.post(self.url, {
                "document": SimpleUploadedFile("first.pdf", b"a" * 10),
                "extra": SimpleUploadedFile("second.pdf", b"b" * 10),
            }, HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 413)
        self.assertFalse(VIEW_CALLS)

    def test_handler_enforces_cumulative_chunks_without_allocating_large_body(self):
        request = HttpRequest()
        handler = FinanceFileLimitHandler(request)
        with patch("finance.upload_limits.MAX_FILE_BYTES", 16):
            self.assertEqual(handler.receive_data_chunk(b"a" * 8, 0), b"a" * 8)
            self.assertIsNone(handler.file_complete(8))
            self.assertEqual(handler.receive_data_chunk(b"b" * 8, 0), b"b" * 8)
            with self.assertRaises(StopUpload) as raised:
                handler.receive_data_chunk(b"x", 8)
        self.assertTrue(raised.exception.connection_reset)
        self.assertTrue(request._finance_upload_exceeded)

    def test_other_routes_and_get_are_unchanged(self):
        self.assertEqual(self.client.get("/unrelated/").status_code, 200)
        self.assertEqual(self.client.get(self.url).status_code, 201)


class ReceiptUploadLimitTests(FinanceUploadLimitTests):
    """The pre-view body guard does not need a database transaction.

    A rejected multipart stream closes its response and emits request_finished.
    Exercise that lifecycle with SimpleTestCase, outside the wrapping database
    transaction of receipt workspace tests (which PostgreSQL correctly closes).
    """
    url = "/admin/finanzas/comprobante/nuevo/"
