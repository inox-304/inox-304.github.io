"""Bound all admin multipart parsing before CSRF can create temporary files."""
from dataclasses import dataclass
import re

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadhandler import FileUploadHandler, StopUpload
from django.http import HttpResponse

from .validators import MAX_FILE_SIZE


PRODUCT_EDITOR = re.compile(r"^/admin/catalog/product/(?:add|[0-9]+/change)/$")
MEDIA_UPLOAD = "/admin/catalog/mediaasset/add/"
MODEL_UPLOAD = "/admin/modelos/nuevo/"
FORM_OVERHEAD = 64 * 1024


@dataclass(frozen=True)
class UploadBudget:
    per_file: int
    total_files: int
    request: int


def _positive_setting(name, default):
    value = getattr(settings, name, default)
    if type(value) is not int or value <= 0:
        raise ImproperlyConfigured(f"{name} must be a positive integer.")
    return value


def upload_budget(path):
    # This includes the main product and its variation/gallery inline forms.
    form_bytes = _positive_setting("ADMIN_MULTIPART_MAX_FORM_BYTES", 12 * 1024 * 1024)
    if PRODUCT_EDITOR.fullmatch(path):
        total = _positive_setting("CATALOG_UPLOAD_MAX_TOTAL_BYTES", 64 * 1024 * 1024)
        return UploadBudget(MAX_FILE_SIZE, total, total + form_bytes + FORM_OVERHEAD)
    if path == MEDIA_UPLOAD:
        return UploadBudget(MAX_FILE_SIZE, MAX_FILE_SIZE, MAX_FILE_SIZE + form_bytes + FORM_OVERHEAD)
    if path == MODEL_UPLOAD:
        total = _positive_setting("MODEL_IMPORT_MAX_SOURCE_BYTES", 20 * 1024 * 1024)
        return UploadBudget(total, total, total + form_bytes + FORM_OVERHEAD)
    # Other admin forms do not accept uploads. This includes the read-only
    # mediaasset change page and prevents bypass by choosing a different URL.
    return UploadBudget(0, 0, form_bytes + FORM_OVERHEAD)


def limit_response(status):
    messages = {
        400: "Longitud de solicitud no válida.",
        411: "La carga necesita una longitud conocida.",
        413: "Esta carga no está permitida o supera el límite. Revisa el tamaño de los archivos y, si son varios, súbelos en grupos más pequeños.",
    }
    response = HttpResponse(messages[status], status=status, content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "no-store, private"
    return response


class AdminFileLimitHandler(FileUploadHandler):
    chunk_size = 64 * 1024

    def __init__(self, request, budget):
        super().__init__(request)
        self.budget = budget
        self.total_bytes = 0
        self.file_bytes = 0

    def _reject(self):
        self.request._admin_upload_exceeded = True
        raise StopUpload(connection_reset=True)

    def new_file(self, *args, **kwargs):
        if not self.budget.per_file:
            # Reject even an empty or unexpected file before another handler
            # creates it on disk; normal text-only multipart forms still work.
            self._reject()
        self.file_bytes = 0
        super().new_file(*args, **kwargs)

    def receive_data_chunk(self, raw_data, start):
        self.file_bytes += len(raw_data)
        self.total_bytes += len(raw_data)
        if self.file_bytes > self.budget.per_file or self.total_bytes > self.budget.total_files:
            self._reject()
        return raw_data

    def file_complete(self, file_size):
        return None


class AdminUploadLimitMiddleware:
    """After finance's upload guard and before CsrfViewMiddleware."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        target = (
            request.method == "POST" and request.path_info.startswith("/admin/")
            and request.content_type == "multipart/form-data"
            and not getattr(request, "_finance_bounded_upload", False)
        )
        if target:
            budget = upload_budget(request.path_info)
            length = request.META.get("CONTENT_LENGTH")
            if length in (None, ""):
                return limit_response(411)
            if not isinstance(length, str) or not length.isascii() or not length.isdecimal() or len(length) > 12:
                return limit_response(400)
            if int(length) > budget.request:
                return limit_response(413)
            request._admin_bounded_upload = True
            request._admin_upload_exceeded = False
            request.upload_handlers.insert(0, AdminFileLimitHandler(request, budget))
        response = self.get_response(request)
        if target and getattr(request, "_admin_upload_exceeded", False):
            response.close()
            return limit_response(413)
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        if not getattr(request, "_admin_bounded_upload", False):
            return None
        # Finish bounded parsing before a view can persist the first valid file
        # while a later file in the same request exceeds the cumulative limit.
        request.POST
        if getattr(request, "_admin_upload_exceeded", False):
            return limit_response(413)
        return None
