from django.db.models import Prefetch

from .models import BusinessSettings, Contact, Product, ProductImage, ProductVariant


def catalog_product_queryset():
    return Product.objects.select_related("contact", "image_asset", "technical_asset", "model_asset", "poster_asset").prefetch_related(Prefetch("variants", queryset=ProductVariant.objects.filter(is_active=True)), Prefetch("gallery_images", queryset=ProductImage.objects.select_related("asset")))


def public_product_queryset():
    return catalog_product_queryset().filter(is_active=True, is_published=True)


def _amount(value):
    return float(value) if value is not None else None


def public_product(product):
    return {
        "id": product.code, "slug": product.slug, "name": product.name,
        "category": product.category, "summary": product.description,
        "features": [line.strip() for line in product.characteristics.splitlines() if line.strip()],
        "image": product.image_asset.public_url if product.image_asset_id else (product.image or "/images/brand/inox304-logo.webp"),
        "visible": True, "featured": product.featured, "order": product.order,
        "contactId": product.contact.code if product.contact_id and product.contact.is_active else "",
        "price": _amount(product.computed_price) if product.show_price else None,
        "currency": product.currency, "showPrice": product.show_price,
        "technicalSheet": product.technical_asset.public_url if product.technical_asset_id else product.technical_sheet,
        "model3d": product.model_asset.public_url if product.model_asset_id else product.model_3d,
        "modelPoster": product.poster_asset.public_url if product.poster_asset_id else product.model_poster,
        "gallery": [item.public_url for item in product.gallery_images.all()],
        "chargeUnit": product.charge_unit, "unitLabel": product.unit_label, "availability": product.availability,
        "variants": [{"id": str(variant.pk), "name": variant.name, "price": _amount(variant.computed_price) if product.show_price else None, "availability": variant.availability} for variant in product.variants.all()],
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
