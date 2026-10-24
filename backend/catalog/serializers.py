from django.db.models import Prefetch

from .models import BusinessSettings, Contact, Product, ProductAdditional, ProductImage, ProductVariant
from .cooktop import CooktopValidationError, validate_product_cooktop_config
from .cart import CartValidationError, validate_product_cart_config
from .variant_options import VariantOptionsError, validate_variant_axes, validate_option_values, combination_key


def catalog_product_queryset():
    return Product.objects.select_related("contact", "image_asset", "technical_asset", "model_asset", "poster_asset").prefetch_related(Prefetch("variants", queryset=ProductVariant.objects.filter(is_active=True).select_related("image_asset", "model_asset", "technical_asset")), Prefetch("additionals", queryset=ProductAdditional.objects.filter(is_active=True)), Prefetch("gallery_images", queryset=ProductImage.objects.select_related("asset")))


def public_product_queryset():
    return catalog_product_queryset().filter(is_active=True, is_published=True)


def _amount(value):
    return float(value) if value is not None else None


def public_cooktop_config(product, *, preview=False):
    try:
        config = validate_product_cooktop_config(product.cooktop_config, supply_type=product.supply_type, category=product.category, equipment_family=product.equipment_family)
    except CooktopValidationError:
        return None
    return config if config and (config["enabled"] or preview is True) else None


def public_variants(product):
    try:
        axes = validate_variant_axes(product.variant_axes)
    except VariantOptionsError:
        return [], []
    variants, seen = [], set()
    for variant in product.variants.all():
        if not variant.is_active:
            continue
        try:
            values = validate_option_values(axes, variant.option_values, active=True)
        except VariantOptionsError:
            continue
        key = combination_key(values)
        if key is not None and key in seen:
            continue
        seen.add(key)
        variants.append((variant, values))
        if len(variants) == 100:
            break
    return axes, variants


def public_cart_config(product, *, preview=False):
    try:
        config = validate_product_cart_config(product.cart_config, supply_type=product.supply_type, category=product.category, equipment_family=product.equipment_family)
    except CartValidationError:
        return None
    return config if config and (config["enabled"] or preview is True) else None


def public_product(product, *, preview=False):
    variant_axes, variants = public_variants(product)
    return {
        "id": product.code, "slug": product.slug, "name": product.name,
        "category": product.category, "summary": product.description,
        "supplyType": product.supply_type, "brand": product.brand,
        "supplierModel": product.supplier_model, "equipmentFamily": product.equipment_family,
        "capacity": product.capacity,
        "cooktopConfig": public_cooktop_config(product, preview=preview),
        "cartConfig": public_cart_config(product, preview=preview),
        "variantAxes": variant_axes,
        "features": [line.strip() for line in product.characteristics.splitlines() if line.strip()],
        "image": product.image_asset.public_url if product.image_asset_id else (product.image or "/images/brand/inox304-logo.webp"),
        "visible": True, "featured": product.featured, "order": product.order,
        "contactId": product.contact.code if product.contact_id and product.contact.is_active else "",
        "price": _amount(product.computed_price) if product.show_price else None,
        "currency": product.currency, "showPrice": product.show_price,
        "technicalSheet": product.technical_asset.public_url if product.technical_asset_id else product.technical_sheet,
        "model3d": product.model_asset.public_url if product.model_asset_id else product.model_3d,
        "modelPoster": product.poster_asset.public_url if product.poster_asset_id else product.model_poster,
        "doorAnimation": product.door_animation,
        "gallery": [item.public_url for item in product.gallery_images.all()],
        "chargeUnit": product.charge_unit, "unitLabel": product.unit_label, "availability": product.availability,
        "variants": [{"id": str(variant.pk), "name": variant.name, "optionValues": values, "price": _amount(variant.computed_price) if product.show_price else None, "availability": variant.availability,
                      "image": variant.image_asset.public_url if variant.image_asset_id else None,
                      "model3d": variant.model_asset.public_url if variant.model_asset_id else "",
                      "technicalSheet": variant.technical_asset.public_url if variant.technical_asset_id else "",
                      "materialVariant": variant.material_variant, "doorAnimation": variant.door_animation} for variant, values in variants],
        "additionals": [{"id": str(item.pk), "name": item.name, "description": item.description, "price": _amount(item.price) if item.show_price else None, "chargeUnit": item.charge_unit, "unitLabel": item.unit_label} for item in product.additionals.all() if item.is_active],
        "additionalCharges": [{"id": "included", "name": "Adicional incluido", "price": _amount(product.additional_flat)}] if product.show_price and product.additional_flat else [],
    }


def public_catalog_data():
    data = {"products": [public_product(product) for product in public_product_queryset()], "contacts": [{"id": contact.code, "name": contact.name, "whatsapp": contact.whatsapp, "phone": contact.phone, "email": contact.email, "message": contact.message, "active": True} for contact in Contact.objects.filter(is_active=True)], "settings": {"empresa": "INOX 304", "direccion": "", "referencia_direccion": "", "facebook": "", "instagram": "", "tiktok": "", "horarios": "", "hero_title": "", "hero_description": "", "home_text": "", "contacto_principal": "", "contacto_instalaciones": "", "contacto_medida": "", "contacto_formulario": ""}}
    settings = BusinessSettings.objects.select_related("contact_main", "contact_installation", "contact_custom", "contact_form").first()
    if settings:
        fields = {"empresa": "company", "direccion": "address", "referencia_direccion": "address_reference", "facebook": "facebook", "instagram": "instagram", "tiktok": "tiktok", "horarios": "hours", "hero_title": "hero_title", "hero_description": "hero_description", "home_text": "home_text"}
        data["settings"] = {key: getattr(settings, field) for key, field in fields.items()}
        for key, field in {"contacto_principal": "contact_main", "contacto_instalaciones": "contact_installation", "contacto_medida": "contact_custom", "contacto_formulario": "contact_form"}.items():
            contact = getattr(settings, field)
            data["settings"][key] = contact.code if contact and contact.is_active else ""
    return data
