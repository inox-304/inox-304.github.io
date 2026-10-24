from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import json

from django.core.exceptions import SuspiciousFileOperation
from django.db.models import Q
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.cache import patch_vary_headers
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_safe

from .models import MediaAsset, Product, ProductVariant
from .serializers import public_catalog_data, public_cooktop_config, public_product_queryset
from .storage import open_private_file
from .cooktop import CooktopValidationError, cooktop_selection_summary, validate_cooktop_selection


@never_cache
@require_GET
def catalog_api(request):
    return JsonResponse(public_catalog_data(), json_dumps_params={"ensure_ascii": False})


def _cooktop_response(request, data, *, status=200):
    response = JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})
    patch_vary_headers(response, ("Origin",))
    if request.headers.get("Origin") == "https://inox-304.github.io":
        response["Access-Control-Allow-Origin"] = "https://inox-304.github.io"
    return response


def _cooktop_product(code):
    return get_object_or_404(Product.objects.only("code", "cooktop_config", "supply_type", "category", "equipment_family"), code=code, is_active=True, is_published=True)


@never_cache
@require_GET
def public_cooktop(request, code):
    product = _cooktop_product(code)
    return _cooktop_response(request, {"productId": product.code, "cooktopConfig": public_cooktop_config(product)})


def _unique_json_object(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise ValueError("Repeated JSON key")
        data[key] = value
    return data


@never_cache
@require_GET
def check_cooktop_selection(request, code):
    product = _cooktop_product(code)
    config = public_cooktop_config(product)
    raw = request.GET.get("selection", "")
    if not config:
        return _cooktop_response(request, {"productId": product.code, "valid": False, "error": "Este configurador no está habilitado."}, status=400)
    if len(request.GET.getlist("selection")) != 1 or not raw or len(raw) > 6000:
        return _cooktop_response(request, {"productId": product.code, "valid": False, "error": "Envíe una selección de hasta 6000 caracteres."}, status=400)
    try:
        selection = json.loads(raw, object_pairs_hook=_unique_json_object)
    except (ValueError, RecursionError):
        return _cooktop_response(request, {"productId": product.code, "valid": False, "error": "La selección no tiene un formato válido."}, status=400)
    try:
        selection = validate_cooktop_selection(config, selection)
        summary = cooktop_selection_summary(config, selection)
    except CooktopValidationError as exc:
        return _cooktop_response(request, {"productId": product.code, "valid": False, "error": str(exc)}, status=400)
    return _cooktop_response(request, {"productId": product.code, "valid": True, "selection": selection, "summary": summary})


@never_cache
@require_safe
def public_media(request, asset_id):
    asset = get_object_or_404(MediaAsset, pk=asset_id)
    referenced = Product.objects.filter(is_active=True, is_published=True).filter(Q(image_asset_id=asset_id) | Q(technical_asset_id=asset_id) | Q(model_asset_id=asset_id) | Q(poster_asset_id=asset_id) | Q(gallery_images__asset_id=asset_id)).exists()
    variant_reference = ProductVariant.objects.filter(product__is_active=True, product__is_published=True, is_active=True).filter(Q(image_asset_id=asset_id) | Q(model_asset_id=asset_id) | Q(technical_asset_id=asset_id)).exists()
    if not referenced and not variant_reference:
        raise Http404
    return media_response(asset)


def media_response(asset):
    try:
        source = open_private_file(asset.file.storage, asset.file.name)
    except (FileNotFoundError, SuspiciousFileOperation):
        raise Http404 from None
    response = FileResponse(source, content_type=asset.content_type, as_attachment=asset.kind == "pdf", filename=f"{asset.pk}.{ {'image': 'webp', 'pdf': 'pdf', 'glb': 'glb'}[asset.kind] }")
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


@never_cache
@require_GET
def public_quote(request, code):
    product = get_object_or_404(public_product_queryset(), code=code, show_price=True)
    try:
        quantity = Decimal(request.GET.get("quantity", "1"))
        if not quantity.is_finite() or quantity <= 0 or quantity > 100000 or quantity.as_tuple().exponent < -3:
            raise ValueError
        if product.charge_unit == "unit" and quantity != quantity.to_integral_value():
            raise ValueError
    except (InvalidOperation, ValueError):
        return JsonResponse({"error": "Ingrese una cantidad válida, mayor que cero y con hasta tres decimales; por unidad solo se admiten enteros."}, status=400)
    variant_id = request.GET.get("variant", "")
    variant = next((item for item in product.variants.all() if str(item.pk) == variant_id), None) if variant_id else None
    if variant_id and variant is None:
        return JsonResponse({"error": "La variante no está disponible para este producto."}, status=400)
    price = variant.computed_price if variant else product.computed_price
    if price is None:
        raise Http404
    total = (price * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return JsonResponse({"productId": product.code, "variantId": str(variant.pk) if variant else None, "quantity": str(quantity), "unitPrice": str(price), "total": str(total), "currency": product.currency, "chargeUnit": product.charge_unit, "unitLabel": product.unit_label})
