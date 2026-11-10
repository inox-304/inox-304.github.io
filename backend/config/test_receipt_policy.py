"""The receipt page and its worker responses both constrain external requests."""
from wsgiref.headers import Headers

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from .middleware import ResponsePolicyMiddleware
from .receipt_policy import PADDLE_WORKER_CSP, RECEIPT_CSP, RECEIPT_PATH, receipt_static_headers


class ReceiptPolicyTests(SimpleTestCase):
    def test_receipt_page_blocks_external_connect_scripts_forms_and_embeds(self):
        response = ResponsePolicyMiddleware(lambda request: HttpResponse())(RequestFactory().get(RECEIPT_PATH))
        policy = response["Content-Security-Policy"]
        self.assertEqual(policy, RECEIPT_CSP)
        for directive in ("connect-src 'self'", "script-src 'self' 'wasm-unsafe-eval'",
                          "worker-src 'self'", "form-action 'self'", "base-uri 'none'",
                          "object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'"):
            self.assertIn(directive, policy)
        self.assertNotIn("'unsafe-eval'", policy)
        self.assertNotIn("https:", policy)
        self.assertNotIn("report-uri", policy, "No third-party reports may contain document URLs.")

    def test_other_admin_pages_keep_their_existing_asset_contract(self):
        for path in ("/admin/", "/admin/finanzas/", "/admin/auth/login/"):
            response = ResponsePolicyMiddleware(lambda request: HttpResponse())(RequestFactory().get(path))
            self.assertNotIn("Content-Security-Policy", response)

    def test_whitenoise_applies_policy_to_hashed_and_unhashed_ocr_workers_only(self):
        for path in ("paddle-v0.4.2/paddle-worker.js", "paddle-v0.4.2/paddle-worker.abc123.js",
                     "v7/worker.min.js", "v7/worker.min.abc123.js", "paddle-v0.4.2/runtime/example.wasm"):
            headers = Headers([])
            receipt_static_headers(headers, "unused", "/admin-static/inox/ocr-vendor/" + path)
            self.assertEqual(headers["Content-Security-Policy"], PADDLE_WORKER_CSP if "paddle-worker." in path else RECEIPT_CSP)
            self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        headers = Headers([])
        receipt_static_headers(headers, "unused", "/admin-static/inox/finance.js")
        self.assertIsNone(headers["Content-Security-Policy"])
