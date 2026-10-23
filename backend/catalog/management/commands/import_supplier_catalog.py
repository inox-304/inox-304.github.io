"""Review and append supplier drafts without fetching files or replacing user data."""
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils.text import slugify

from catalog.audit import audit_context
from catalog.models import CODE_VALIDATOR, Product, ProductImage
from catalog.validators import validate_https, validate_public_url


MAX_MANIFEST_SIZE = 1024 * 1024
PRODUCT_FIELDS = {
    "code", "sku", "name", "category_slug", "source_url", "capacity_text", "dimensions_text",
    "features", "image_urls", "technical_sheet_urls", "model_3d_urls", "warnings", "variants",
}
COLD_FAMILIES = {"cremoladeras", "maquinas-helado", "dispensadores-jugo"}
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".avif")


def text(value, label, maximum, *, required=False):
    if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 for char in value):
        raise CommandError(f"{label}: texto inválido o demasiado largo.")
    value = value.strip()
    if required and not value:
        raise CommandError(f"{label}: no puede quedar vacío.")
    return value


def bounded_list(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise CommandError(f"{label}: lista inválida (máximo {maximum}).")
    return value


def external_asset(value, label, kinds):
    value = text(value, label, 1000, required=True)
    try:
        validate_https(value)
        path = urlsplit(value).path.lower()
        kind = next((kind for kind in kinds if path.endswith({"image": IMAGE_SUFFIXES, "pdf": (".pdf",), "glb": (".glb",)}[kind])), None)
        if kind is None:
            raise ValidationError("Tipo de archivo no compatible.")
        validate_public_url(value, kind)
    except ValidationError as exc:
        raise CommandError(f"{label}: {' '.join(exc.messages)}") from exc
    return value, kind


def official_source(value):
    value = text(value, "source_url", 1000, required=True)
    try:
        validate_https(value)
        url = urlsplit(value)
        if url.hostname != "ilumiperu.com" or not re.fullmatch(r"/(?:products|collections)/[A-Za-z0-9_/-]+", url.path) or ".." in url.path or "//" in url.path:
            raise ValidationError("Use una página oficial de productos o colecciones de ilumiperu.com.")
    except ValidationError as exc:
        raise CommandError(f"source_url: {' '.join(exc.messages)}") from exc
    return value


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CommandError(f"El JSON repite el campo {key}.")
        result[key] = value
    return result


def load_manifest(path):
    try:
        with Path(path).open("rb") as source:
            raw = source.read(MAX_MANIFEST_SIZE + 1)
        if len(raw) > MAX_MANIFEST_SIZE:
            raise CommandError("El manifiesto supera 1 MB.")
        manifest = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise CommandError("No se pudo leer un manifiesto JSON válido.") from exc
    if not isinstance(manifest, dict) or set(manifest) != {"schema_version", "brand", "checked_on", "products"}:
        raise CommandError("El manifiesto requiere schema_version, brand, checked_on y products.")
    if type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1 or manifest["brand"] != "ILUMI":
        raise CommandError("Solo se admite el esquema 1 de ILUMI.")
    checked_on = text(manifest["checked_on"], "checked_on", 10, required=True)
    try:
        if date.fromisoformat(checked_on).isoformat() != checked_on:
            raise ValueError
    except ValueError as exc:
        raise CommandError("checked_on debe ser una fecha válida AAAA-MM-DD.") from exc
    rows = bounded_list(manifest["products"], "products", 200)
    codes, skus, slugs, candidates = set(), set(), set(), []
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict) or set(row) != PRODUCT_FIELDS:
            raise CommandError(f"Producto {index}: campos ausentes o desconocidos.")
        code = text(row["code"], "code", 64, required=True)
        sku = text(row["sku"], "sku", 58, required=True)
        try:
            CODE_VALIDATOR(code)
            CODE_VALIDATOR(sku)
        except ValidationError as exc:
            raise CommandError(f"Producto {index}: código o SKU inválido.") from exc
        if code != f"ILUMI-{sku}":
            raise CommandError(f"Producto {index}: el código debe ser ILUMI- seguido del SKU exacto.")
        slug = f"ilumi-{slugify(sku).replace('_', '-')}"
        if code.casefold() in codes or sku.casefold() in skus or slug in slugs:
            raise CommandError(f"Producto {index}: código, SKU o dirección duplicados.")
        codes.add(code.casefold()); skus.add(sku.casefold()); slugs.add(slug)
        family = text(row["category_slug"], "category_slug", 32, required=True)
        if family not in Product.EquipmentFamily.values:
            raise CommandError(f"Producto {index}: familia no admitida.")
        name = text(row["name"], "name", 250, required=True)
        capacity = text(row["capacity_text"], "capacity_text", 180)
        dimensions = text(row["dimensions_text"], "dimensions_text", 250)
        source_url = official_source(row["source_url"])
        features = [text(item, "features", 250, required=True) for item in bounded_list(row["features"], "features", 50)]
        if dimensions:
            features.append(f"Dimensiones publicadas: {dimensions}")
        characteristics = "\n".join(features)
        if len(characteristics) > 5000:
            raise CommandError(f"Producto {index}: las características superan 5000 caracteres.")
        images = [external_asset(item, "image_urls", ("image",))[0] for item in bounded_list(row["image_urls"], "image_urls", 30)]
        technicals = [external_asset(item, "technical_sheet_urls", ("pdf", "image")) for item in bounded_list(row["technical_sheet_urls"], "technical_sheet_urls", 20)]
        models = [external_asset(item, "model_3d_urls", ("glb",))[0] for item in bounded_list(row["model_3d_urls"], "model_3d_urls", 20)]
        warnings = [text(item, "warnings", 250, required=True) for item in bounded_list(row["warnings"], "warnings", 20)]
        variants = []
        for item in bounded_list(row["variants"], "variants", 100):
            if isinstance(item, dict):
                label = item.get("name") or item.get("title")
                if label is None:
                    raise CommandError("Cada variante de investigación necesita name o title.")
            else:
                label = item
            variants.append(text(label, "variants", 180, required=True))
        notes = [f"Referencia ILUMI consultada el {checked_on}: {source_url}",
                 "Importado como borrador. Revisar ficha, capacidad y opciones antes de publicar. Existencias y precio de INOX pendientes de confirmar.",
                 f"3D pendiente de preparación y verificación. Referencias encontradas: {len(models)}; ninguna asignada al visor."]
        if warnings:
            notes.append("Advertencias de la fuente:\n" + "\n".join(f"- {item}" for item in warnings))
        if variants:
            notes.append("Versiones de investigación sin importar: " + "; ".join(variants[:10]) + (f". Hay {len(variants)} en el manifiesto." if len(variants) > 10 else ""))
        image = images[0] if images else ""
        gallery, used = [], {image}
        # A technical JPG remains an image, never a fictitious PDF. Prioritize it.
        for url, caption in [(url, "Ficha técnica del fabricante (imagen)") for url, kind in technicals if kind == "image"] + [(url, "Vista del fabricante") for url in images[1:]]:
            if url not in used:
                used.add(url)
                gallery.append((url, caption))
        if len(gallery) > 8:
            notes.append(f"Galería limitada a 8 imágenes; {len(gallery) - 8} referencias adicionales conservadas en el manifiesto.")
        product = Product(
            code=code, slug=slug, name=name,
            category=Product.Category.COLD if family in COLD_FAMILIES else Product.Category.NEUTRAL,
            supply_type=Product.SupplyType.DISTRIBUTED, brand="ILUMI", supplier_model=sku,
            equipment_family=family, capacity=capacity, source_url=source_url,
            description=f"Equipo ILUMI distribuido por INOX 304. Modelo del fabricante: {sku}.",
            characteristics=characteristics, internal_notes="\n\n".join(notes), image=image,
            technical_sheet=next((url for url, kind in technicals if kind == "pdf"), ""),
            model_3d="", is_active=True, is_published=False, featured=False,
            price=None, cost=None, show_price=False,
        )
        # Validate every object before consulting conflicts or starting a write.
        try:
            product.full_clean(validate_unique=False, validate_constraints=False)
        except ValidationError as exc:
            raise CommandError(f"Producto {index}: {exc}") from exc
        candidates.append((product, gallery[:8]))
    return candidates


def import_plan(candidates, *, lock=False):
    queryset = Product.objects.all()
    if lock:
        queryset = queryset.select_for_update()
    by_code = {product.code: product for product in queryset.filter(code__in=[item.code for item, _ in candidates])}
    create, skipped = [], 0
    for product, gallery in candidates:
        existing = by_code.get(product.code)
        if existing is not None:
            if (existing.brand, existing.supplier_model, existing.supply_type) != (product.brand, product.supplier_model, product.supply_type):
                raise CommandError(f"Conflicto en {product.code}: el registro existente tiene otra identidad. No se modificó el catálogo.")
            skipped += 1
            continue
        if Product.objects.filter(Q(code__iexact=product.code) | Q(slug=product.slug) | Q(brand="ILUMI", supplier_model__iexact=product.supplier_model)).exists():
            raise CommandError(f"Conflicto en {product.code}: código, dirección o modelo ya registrado. No se modificó el catálogo.")
        create.append((product, gallery))
    return create, skipped


class Command(BaseCommand):
    help = "Revisa un manifiesto ILUMI y, solo con --apply, añade borradores sin reemplazar registros existentes."

    def add_arguments(self, parser):
        parser.add_argument("path", type=Path)
        parser.add_argument("--apply", action="store_true", help="Crear únicamente los borradores nuevos; requiere --actor.")
        parser.add_argument("--actor", help="Correo de una cuenta administrativa activa para atribuir la importación.")

    def handle(self, *args, **options):
        candidates = load_manifest(options["path"])
        if not options["apply"]:
            create, skipped = import_plan(candidates)
            self.stdout.write(f"SIMULACIÓN: {len(create)} borradores nuevos; {skipped} existentes conservados. No se escribió ningún dato ni archivo.")
            return
        email = options.get("actor") or ""
        if not email:
            raise CommandError("--apply requiere --actor con el correo de una cuenta administrativa activa.")
        users = get_user_model().objects.filter(Q(email__iexact=email) | Q(username__iexact=email), is_staff=True, is_active=True)
        if users.count() != 1:
            raise CommandError("El actor debe identificar una única cuenta administrativa activa.")
        actor = users.get()
        if not actor.has_perm("catalog.add_product") or (any(gallery for _, gallery in candidates) and not actor.has_perm("catalog.add_productimage")):
            raise CommandError("El actor necesita permiso para crear productos y sus imágenes de galería.")
        try:
            with transaction.atomic(), audit_context(actor):
                create, skipped = import_plan(candidates, lock=True)
                for product, gallery in create:
                    product.save()
                    for order, (url, caption) in enumerate(gallery):
                        ProductImage.objects.create(product=product, url=url, caption=caption, order=order)
        except (IntegrityError, ValidationError) as exc:
            raise CommandError("La importación se revirtió por un conflicto o dato inválido. No se modificó el catálogo.") from exc
        self.stdout.write(self.style.SUCCESS(f"{len(create)} borradores creados; {skipped} existentes conservados. Ningún producto publicado y ningún inventario modificado."))
