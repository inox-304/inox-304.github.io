import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalog.models import BusinessSettings, Contact, Product, ProductImage


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def flag(value, fallback=False):
    return value.strip().lower() in ("true", "1", "si", "sí") if value else fallback


class Command(BaseCommand):
    help = "Importa las plantillas comerciales solo cuando el registro aún no existe; nunca sobrescribe cambios."

    def add_arguments(self, parser):
        parser.add_argument("--source", type=Path, default=settings.BASE_DIR.parent / "public" / "cms" / "plantillas")

    @transaction.atomic
    def handle(self, *args, **options):
        source = options["source"]
        try:
            contact_rows = rows(source / "Contactos.csv")
            product_rows = rows(source / "Catalogo.csv")
            setting_rows = rows(source / "Ajustes.csv")
        except (OSError, csv.Error) as exc:
            raise CommandError(f"No se pudieron leer las plantillas: {exc}") from exc
        created_count = 0
        for row in contact_rows:
            Contact.objects.get_or_create(code=row["id"], defaults={"name": row["nombre"], "whatsapp": row["whatsapp"], "phone": row.get("telefono", ""), "email": row.get("correo", ""), "message": row.get("mensaje", ""), "is_active": flag(row.get("activo", ""), True)})
        for row in product_rows:
            if Product.objects.filter(code=row["id"]).exists() or Product.objects.filter(slug=row["slug"]).exists():
                continue
            try:
                price = Decimal(row["precio"].replace(",", ".")) if row.get("precio") else None
            except InvalidOperation as exc:
                raise CommandError(f"Precio inválido: {row['id']}") from exc
            product = Product.objects.create(code=row["id"], slug=row["slug"], name=row["nombre"], category=row["categoria"], description=row.get("descripcion", ""), characteristics="\n".join(part.strip() for part in row.get("caracteristicas", "").split("|") if part.strip()), image=row.get("imagen", ""), is_published=flag(row.get("publicar", "")), featured=flag(row.get("destacado", "")), order=int(row.get("orden") or 0), contact=Contact.objects.filter(code=row.get("contacto_id", "")).first(), price=price, currency=row.get("moneda") or "PEN", show_price=flag(row.get("mostrar_precio", "")), technical_sheet=row.get("ficha_tecnica", ""), model_3d=row.get("modelo_3d", ""), model_poster=row.get("poster_3d", ""))
            for index, url in enumerate(filter(None, (part.strip() for part in row.get("galeria", "").split("|")))):
                ProductImage.objects.create(product=product, url=url, order=index)
            created_count += 1
        if not BusinessSettings.objects.exists():
            values = {row["clave"]: row["valor"] for row in setting_rows}
            BusinessSettings.objects.create(company=values.get("empresa", "INOX 304"), address=values.get("direccion", ""), address_reference=values.get("referencia_direccion", ""), facebook=values.get("facebook", ""), contact_main=Contact.objects.filter(code=values.get("contacto_principal", "")).first(), contact_installation=Contact.objects.filter(code=values.get("contacto_instalaciones", "")).first(), contact_custom=Contact.objects.filter(code=values.get("contacto_medida", "")).first(), contact_form=Contact.objects.filter(code=values.get("contacto_formulario", "")).first())
        self.stdout.write(self.style.SUCCESS(f"{created_count} productos nuevos. Los registros existentes se conservaron."))
