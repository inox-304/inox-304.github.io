from pathlib import Path
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_safe

from .models import MediaAsset, Product, ProductVariant
from .serializers import public_catalog_data, public_product_queryset


@never_cache
@require_GET
def catalog_api(request):
    return JsonResponse(public_catalog_data(), json_dumps_params={"ensure_ascii": False})


@never_cache
@require_safe
def public_media(request, asset_id):
    asset = get_object_or_404(MediaAsset, pk=asset_id)
    referenced = Product.objects.filter(is_active=True, is_published=True).filter(Q(image_asset_id=asset_id) | Q(technical_asset_id=asset_id) | Q(model_asset_id=asset_id) | Q(poster_asset_id=asset_id) | Q(gallery_images__asset_id=asset_id)).exists()
    variant_reference = ProductVariant.objects.filter(product__is_active=True, product__is_published=True, is_active=True).filter(Q(model_asset_id=asset_id) | Q(technical_asset_id=asset_id)).exists()
    if not referenced and not variant_reference:
        raise Http404
    return media_response(asset)


def media_response(asset):
    root = Path(settings.MEDIA_ROOT).resolve()
    path = (root / asset.file.name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise Http404
    response = FileResponse(path.open("rb"), content_type=asset.content_type, as_attachment=asset.kind == "pdf", filename=f"{asset.pk}.{ {'image': 'webp', 'pdf': 'pdf', 'glb': 'glb'}[asset.kind] }")
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
