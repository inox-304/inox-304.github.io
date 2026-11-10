"""Contain receipt processing in this origin, including dedicated OCR workers."""

RECEIPT_PATH = "/admin/finanzas/comprobante/nuevo/"
RECEIPT_CSP = "; ".join((
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
))
# OpenCV in the pinned Paddle worker constructs functions at initialization.
# Allow that only in this worker response, never in the HTML document. Network
# access, imported scripts and child workers remain restricted to this origin.
PADDLE_WORKER_CSP = RECEIPT_CSP.replace("'wasm-unsafe-eval'", "'unsafe-eval'")


def receipt_static_headers(headers, path, url):
    # WhiteNoise serves static files before ordinary Django response middleware.
    # Workers have their own CSP; the HTML page's policy does not constrain them.
    # Include unhashed and hashed worker/runtime paths and compressed responses.
    if url.startswith("/admin-static/inox/ocr-vendor/"):
        filename = url.rsplit("/", 1)[-1]
        paddle_worker = "/paddle-v0.4.2/" in url and filename.startswith("paddle-worker.") and filename.endswith(".js")
        headers["Content-Security-Policy"] = PADDLE_WORKER_CSP if paddle_worker else RECEIPT_CSP
        headers["Referrer-Policy"] = "no-referrer"
        headers["X-Content-Type-Options"] = "nosniff"
