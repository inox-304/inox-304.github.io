"""Bound finance uploads before Django/CSRF can spool an unbounded multipart body."""
import re

from django.core.files.uploadhandler import FileUploadHandler, StopUpload
from django.http import HttpResponse

MAX_REQUEST_BYTES = 11 * 1024 * 1024
MAX_FILE_BYTES = 10 * 1024 * 1024
UPLOAD_PATH = re.compile(r"^/admin/finanzas/(?:[0-9]+/comprobante|comprobante/nuevo)/$")


def limit_response(status):
    messages = {400: "Longitud de solicitud no válida.", 411: "La carga necesita una longitud conocida.",
                413: "El comprobante supera el límite de carga. Usa un archivo de hasta 10 MB."}
    response = HttpResponse(messages[status], status=status, content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "no-store, private"
    return response


class FinanceFileLimitHandler(FileUploadHandler):
    """Cumulative file-byte budget, including unexpected extra file parts."""
    chunk_size = 64 * 1024

    def __init__(self, request=None):
        super().__init__(request)
        self.received_bytes = 0

    def receive_data_chunk(self, raw_data, start):
        self.received_bytes += len(raw_data)
        if self.received_bytes > MAX_FILE_BYTES:
            self.request._finance_upload_exceeded = True
            # Do not continue draining an attacker-controlled stream into temporary storage.
            raise StopUpload(connection_reset=True)
        return raw_data

    def file_complete(self, file_size):
        # Existing memory/temporary handlers still produce the uploaded file.
        return None


class FinanceUploadLimitMiddleware:
    """Install before CsrfViewMiddleware; it does not replace authentication or CSRF."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        target = request.method == "POST" and UPLOAD_PATH.fullmatch(request.path_info)
        if target:
            length = request.META.get("CONTENT_LENGTH")
            if length in (None, ""):
                return limit_response(411)
            if not isinstance(length, str) or not length.isascii() or not length.isdecimal() or len(length) > 12:
                return limit_response(400)
            if int(length) > MAX_REQUEST_BYTES:
                return limit_response(413)
            request._finance_bounded_upload = True
            request._finance_upload_exceeded = False
            request.upload_handlers.insert(0, FinanceFileLimitHandler(request))
        response = self.get_response(request)
        if target and getattr(request, "_finance_upload_exceeded", False):
            response.close()
            return limit_response(413)
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        if not getattr(request, "_finance_bounded_upload", False):
            return None
        # Parsing here means a later invalid file part cannot leave an earlier
        # valid part available to a view that would persist it before returning 413.
        # Valid requests still pass all following CSRF and admin MFA checks.
        request.POST
        if getattr(request, "_finance_upload_exceeded", False):
            return limit_response(413)
        return None
