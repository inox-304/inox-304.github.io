"""Private conversion review. A generated model is never published by a GET."""
import re

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.template.loader import render_to_string
from django.template.response import TemplateResponse
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST, require_http_methods, require_safe

from catalog.models import Product, ProductVariant
from catalog.serializers import catalog_product_queryset, public_catalog_data, public_product
from catalog.storage import open_private_file
from catalog.views import media_response

from .forms import ModelImportForm, ProductTargetForm
from .models import ModelImportJob
from .services import apply_job, can_access, cancel_job, create_job, retry_job, review_token, target_revision


ACTIVE = {"queued", "running"}
LABELS = {"queued": "En cola", "running": "Preparando modelo", "ready": "Listo para revisar", "failed": "Necesita atención", "applied": "Modelo aplicado", "cancelled": "Cancelado"}
NOTICES = {
    "queued": "Tu archivo está guardado. La conversión se retomará cuando el servicio esté activo.",
    "running": "Estamos preparando una copia para la web. Puedes cerrar esta pestaña y volver más adelante.",
    "ready": "Revisa la geometría, los materiales y el tamaño antes de usar este modelo en el equipo.",
    "failed": "El modelo actual del catálogo se conserva. Revisa el mensaje antes de volver a intentar.",
    "applied": "Este modelo ya se asignó al destino elegido. La publicación del equipo conserva su estado anterior.",
    "cancelled": "Esta conversión no se aplicará al catálogo. Se conservan el archivo original y el modelo anterior.",
}


def _require_catalog(user, change=False):
    allowed = user.has_perm("catalog.change_product") if change else user.has_perm("catalog.view_product") or user.has_perm("catalog.change_product")
    if not allowed:
        raise PermissionDenied


def _job(request, job_id, change=False):
    job = get_object_or_404(ModelImportJob.objects.select_related("product", "variant", "result_asset", "created_by"), pk=job_id)
    if not can_access(request.user, job, change=change):
        raise PermissionDenied
    return job


def _context(request, **values):
    return {**admin.site.each_context(request), "is_nav_sidebar_enabled": False, **values}


def _integer_id(value):
    if not isinstance(value, str) or not value.isascii() or not value.isdecimal() or len(value) > 18:
        raise Http404
    return int(value)


def _product(value):
    return get_object_or_404(Product, pk=_integer_id(value))


def _feedback(request, error):
    for text in error.messages:
        messages.error(request, text)


@require_GET
def index(request):
    _require_catalog(request.user)
    product = _product(request.GET["product"]) if request.GET.get("product") else None
    jobs = ModelImportJob.objects.select_related("product", "variant", "result_asset", "created_by").order_by("-created_at")
    if product is not None:
        jobs = jobs.filter(product=product)
    rows = [{"job": job, "label": LABELS.get(job.status, "Pendiente")} for job in jobs[:50] if can_access(request.user, job)]
    return TemplateResponse(request, "model_imports/index.html", _context(request, title="Modelos de SketchUp", rows=rows, product=product, can_upload=request.user.has_perm("catalog.change_product")))


@require_http_methods(["GET", "POST"])
def upload(request):
    _require_catalog(request.user, change=True)
    values = request.POST if request.method == "POST" else request.GET
    product = _product(values["product"]) if values.get("product") else None
    target_form = ProductTargetForm(request.GET if request.GET else None)
    form = None
    if product is not None:
        initial = {"product": product.pk}
        if request.method == "GET" and request.GET.get("variant"):
            if not request.user.has_perm("catalog.change_productvariant"):
                raise PermissionDenied
            initial["variant"] = get_object_or_404(ProductVariant, product=product, pk=_integer_id(request.GET["variant"])).pk
        form = ModelImportForm(request.POST or None, request.FILES or None, product=product, initial=initial)
        if not request.user.has_perm("catalog.change_productvariant"):
            form.fields["variant"].queryset = ProductVariant.objects.none()
        if request.method == "POST" and form.is_valid():
            try:
                job = create_job(user=request.user, product=form.cleaned_data["product"], variant=form.cleaned_data["variant"], upload=form.cleaned_data["upload"])
            except ValidationError as error:
                form.add_error(None, error)
            else:
                messages.success(request, "Archivo recibido. Revisa el resultado antes de aplicarlo al equipo.")
                return redirect("model_imports:detail", job_id=job.pk)
    elif request.method == "POST":
        target_form = ProductTargetForm(request.POST)
        target_form.is_valid()
    return TemplateResponse(request, "model_imports/upload.html", _context(request, title="Preparar modelo de SketchUp", product=product, target_form=target_form, form=form))


def _status_data(job):
    return {"id": str(job.pk), "state": job.status, "label": LABELS.get(job.status, "Pendiente"),
            "progress": job.progress, "notice": NOTICES.get(job.status, "Consulta el estado de esta importación."),
            "error": job.error_message if job.status == "failed" else "", "active": job.status in ACTIVE,
            "detailUrl": reverse("model_imports:detail", args=(job.pk,))}


@require_GET
def detail(request, job_id):
    job = _job(request, job_id)
    return TemplateResponse(request, "model_imports/detail.html", _context(request, title="Preparación del modelo", job=job,
        state=_status_data(job), can_change=can_access(request.user, job, change=True),
        is_ready=job.status == "ready" and job.result_asset_id is not None, can_cancel=job.status in ACTIVE | {"ready"}, can_retry=job.status == "failed"))


@require_GET
def status(request, job_id):
    return JsonResponse(_status_data(_job(request, job_id)))


@require_safe
def source(request, job_id):
    job = _job(request, job_id)
    try:
        handle = open_private_file(job.source.storage, job.source.name)
    except (FileNotFoundError, OSError):
        raise Http404 from None
    response = FileResponse(handle, as_attachment=True, filename=job.original_name, content_type="application/octet-stream")
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


@require_safe
def result(request, job_id):
    job = _job(request, job_id)
    if job.status not in {"ready", "applied"} or not job.result_asset_id or job.result_asset.kind != "glb":
        raise Http404
    return media_response(job.result_asset)


@require_GET
def preview(request, job_id):
    from config.views import _render_shell
    job = _job(request, job_id)
    if job.status not in {"ready", "applied"} or not job.result_asset_id:
        messages.info(request, "El modelo todavía no está listo para revisar.")
        return redirect("model_imports:detail", job_id=job.pk)
    product = get_object_or_404(catalog_product_queryset(), pk=job.product_id)
    item = public_product(product, preview=True)
    for key, asset in (("image", product.image_asset), ("technicalSheet", product.technical_asset), ("modelPoster", product.poster_asset)):
        if asset:
            item[key] = reverse("admin:catalog_media_download", args=(asset.pk,))
    item["gallery"] = [reverse("admin:catalog_media_download", args=(image.asset_id,)) if image.asset_id else image.url for image in product.gallery_images.all()]
    if job.variant_id:
        variant = job.variant
        item["name"] = f"{product.name} · {variant.name}"[:250]
        for key, asset in (("image", variant.image_asset), ("technicalSheet", variant.technical_asset)):
            if asset:
                item[key] = reverse("admin:catalog_media_download", args=(asset.pk,))
        if variant.image_asset_id:
            item["gallery"] = []
    # Review the candidate alone, including an inactive variation. Importing a
    # mesh does not authorize the old model's animations or modular geometry.
    item.update(model3d=reverse("model_imports:result", args=(job.pk,)), variants=[], variantAxes=[], cooktopConfig=None, cartConfig=None, doorAnimation="")
    data = public_catalog_data()
    data["products"] = [item]
    response = _render_shell("equipo/index.html", data, title=f"Revisar modelo · {product.name}", description=product.description, preview=True, preview_product_id=product.code)
    if response.status_code == 200:
        compatibility_pending = bool(
            product.cooktop_config.get("enabled") or product.cart_config.get("enabled") or product.door_animation
            or (job.variant_id and (job.variant.material_variant or job.variant.door_animation))
        )
        toolbar = render_to_string("model_imports/preview_controls.html", _context(request, job=job,
            can_apply=job.status == "ready" and can_access(request.user, job, change=True),
            compatibility_pending=compatibility_pending, live=product.is_published and product.is_active,
            revision=target_revision(job), token=review_token(job)), request=request)
        response.content = re.sub(r"(<body\b[^>]*>)", lambda match: match[1] + toolbar, response.content.decode(response.charset), count=1, flags=re.IGNORECASE)
    return response


@require_POST
def apply(request, job_id):
    job = _job(request, job_id, change=True)
    if job.product.is_published and job.product.is_active and request.POST.get("confirm_live") != "yes":
        messages.error(request, "Confirma que quieres reemplazar el modelo de este equipo publicado.")
        return redirect("model_imports:preview", job_id=job.pk)
    try:
        applied = apply_job(user=request.user, job_id=job.pk, revision=request.POST.get("revision", ""), token=request.POST.get("token", ""))
    except ValidationError as error:
        _feedback(request, error)
        return redirect("model_imports:preview", job_id=job.pk)
    messages.success(request, "Modelo aplicado al destino elegido. Revisa el equipo y publícalo cuando esté listo si aún es un borrador.")
    return redirect("admin:catalog_product_preview", product_id=applied.product_id)


@require_POST
def cancel(request, job_id):
    job = _job(request, job_id, change=True)
    try:
        cancel_job(request.user, job.pk)
    except ValidationError as error:
        _feedback(request, error)
    else:
        messages.success(request, "Conversión cancelada. El modelo del catálogo se conserva.")
    return redirect("model_imports:detail", job_id=job.pk)


@require_POST
def retry(request, job_id):
    job = _job(request, job_id, change=True)
    try:
        retry_job(request.user, job.pk)
    except ValidationError as error:
        _feedback(request, error)
    else:
        messages.success(request, "Conversión enviada de nuevo a la cola.")
    return redirect("model_imports:detail", job_id=job.pk)
