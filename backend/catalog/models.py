import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models

from .validators import clean_upload, validate_https, validate_public_url
from .cooktop import CooktopValidationError, validate_product_cooktop_config


MONEY_VALIDATORS = [MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100000000"))]
CODE_VALIDATOR = RegexValidator(r"^[A-Za-z0-9_-]{1,64}$", "Use letras, números, guiones o guion bajo.")


def media_path(instance, filename):
    extension = {"image": "webp", "pdf": "pdf", "glb": "glb"}[instance.kind]
    return f"catalog/{instance.pk}.{extension}"


def final_price(price, discount_percent=Decimal("0"), additional_flat=Decimal("0")):
    if price is None:
        return None
    return (price * (Decimal("1") - discount_percent / Decimal("100")) + additional_flat).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class ValidatedModel(models.Model):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class Contact(ValidatedModel):
    code = models.CharField("identificador", max_length=64, unique=True, validators=[CODE_VALIDATOR])
    name = models.CharField("nombre", max_length=150)
    whatsapp = models.CharField("WhatsApp", max_length=16, help_text="Incluya el país, por ejemplo 51964270406.")
    phone = models.CharField("teléfono visible", max_length=80, blank=True)
    email = models.EmailField("correo", blank=True)
    message = models.TextField("mensaje inicial de WhatsApp", blank=True, max_length=2000)
    is_active = models.BooleanField("activo", default=True)

    class Meta:
        ordering = ("name",)
        verbose_name = "contacto"
        verbose_name_plural = "contactos"

    def clean(self):
        super().clean()
        import re
        if self.whatsapp and not re.fullmatch(r"[+\d\s().-]+", self.whatsapp):
            raise ValidationError({"whatsapp": "Use solo el número internacional."})
        self.whatsapp = re.sub(r"\D", "", self.whatsapp)
        if re.fullmatch(r"9\d{8}", self.whatsapp):
            self.whatsapp = "51" + self.whatsapp
        if (self.whatsapp or self.is_active) and not re.fullmatch(r"[1-9]\d{7,14}", self.whatsapp):
            raise ValidationError({"whatsapp": "Ingrese un número internacional válido."})

    def __str__(self):
        return self.name


class MediaAsset(ValidatedModel):
    class Kind(models.TextChoices):
        IMAGE = "image", "Imagen"
        PDF = "pdf", "Ficha PDF"
        GLB = "glb", "Modelo GLB"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField("nombre", max_length=180)
    kind = models.CharField("tipo", max_length=8, choices=Kind, default=Kind.IMAGE)
    file = models.FileField("archivo", upload_to=media_path, max_length=200)
    content_type = models.CharField(max_length=80, editable=False, blank=True)
    created_at = models.DateTimeField("subido", auto_now_add=True)

    class Meta:
        verbose_name = "archivo"
        verbose_name_plural = "archivos"
        ordering = ("-created_at",)

    def clean(self):
        super().clean()
        if self.file and not self.file._committed:
            cleaned, self.content_type = clean_upload(self.file, self.kind)
            self.file = cleaned

    def __str__(self):
        return self.name

    @property
    def public_url(self):
        return f"/media/{self.pk}/"


class Product(ValidatedModel):
    class SupplyType(models.TextChoices):
        UNSPECIFIED = "", "Sin clasificar"
        MANUFACTURED = "manufactured", "Fabricación propia"
        DISTRIBUTED = "distributed", "Producto distribuido"

    class EquipmentFamily(models.TextChoices):
        MIXERS = "amasadoras", "Amasadoras"
        BEATERS = "batidoras", "Batidoras"
        VACUUM_PACKERS = "envasadoras-vacio", "Envasadoras al vacío"
        ORANGE_JUICERS = "extractores-naranja", "Extractores de naranja"
        SLUSH_MACHINES = "cremoladeras", "Máquinas de cremoladas"
        ICE_CREAM_MACHINES = "maquinas-helado", "Máquinas de helado"
        JUICE_DISPENSERS = "dispensadores-jugo", "Dispensadores de jugo"
        COOKTOPS = "cocinas", "Cocinas"

    class Category(models.TextChoices):
        COLD = "linea-fria", "Línea fría"
        HOT = "linea-caliente", "Línea caliente"
        NEUTRAL = "linea-neutra", "Línea neutra"
        FURNITURE = "mobiliario", "Mobiliario"

    class ChargeUnit(models.TextChoices):
        UNIT = "unit", "Unidad"
        METER = "m", "Metro lineal"
        AREA = "m2", "Metro cuadrado"
        CUSTOM = "custom", "Personalizada"

    class Availability(models.TextChoices):
        AVAILABLE = "available", "Disponible"
        MADE_TO_ORDER = "made_to_order", "A pedido"
        UNAVAILABLE = "unavailable", "No disponible"

    code = models.CharField("código", max_length=64, unique=True, validators=[CODE_VALIDATOR])
    slug = models.SlugField("dirección del producto", max_length=150, unique=True)
    name = models.CharField("nombre", max_length=250)
    category = models.CharField("categoría", max_length=30, choices=Category)
    supply_type = models.CharField("origen del equipo", max_length=16, choices=SupplyType, blank=True, default="", help_text="Fabricación propia: se diseña en el taller. Distribuido: se vende el modelo del fabricante. Los equipos anteriores quedan sin clasificar hasta revisarlos.")
    brand = models.CharField("marca", max_length=120, blank=True, default="")
    supplier_model = models.CharField("modelo del fabricante", max_length=120, blank=True, default="", help_text="Conserve la referencia oficial. Es distinta del código interno de INOX.")
    equipment_family = models.CharField("familia de equipos", max_length=32, choices=EquipmentFamily, blank=True, default="", help_text="Agrupa equipos similares dentro de su línea. Déjelo vacío si no corresponde a estas familias.")
    capacity = models.CharField("capacidad", max_length=180, blank=True, default="", help_text="Escriba la capacidad y su unidad tal como las confirma el fabricante, por ejemplo litros de recipiente o kg de masa. No son equivalentes.")
    cooktop_config = models.JSONField("configurador de cocina", default=dict, blank=True, help_text="Opciones de fabricación definidas por el propietario para esta cocina. Se publica solo al habilitarlo.")
    source_url = models.URLField("fuente del fabricante (privada)", max_length=1000, blank=True, default="", validators=[validate_https], help_text="Enlace HTTPS de la ficha oficial para verificar datos. No se publica en la web.")
    description = models.TextField("descripción", max_length=5000, blank=True)
    characteristics = models.TextField("características", max_length=5000, blank=True, help_text="Una característica por línea.")
    is_active = models.BooleanField("activo", default=True, help_text="Desactive para conservarlo fuera de la web.")
    is_published = models.BooleanField("publicado en la web", default=False)
    featured = models.BooleanField("destacado", default=False)
    order = models.PositiveIntegerField("orden", default=0)
    contact = models.ForeignKey(Contact, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="contacto")
    price = models.DecimalField("precio base", max_digits=11, decimal_places=2, blank=True, null=True, validators=MONEY_VALIDATORS)
    cost = models.DecimalField("costo interno (privado)", max_digits=11, decimal_places=2, blank=True, null=True, validators=MONEY_VALIDATORS)
    currency = models.CharField("moneda", max_length=3, choices=(("PEN", "Soles"), ("USD", "Dólares")), default="PEN")
    show_price = models.BooleanField("mostrar precio en la web", default=False)
    charge_unit = models.CharField("cobro por", max_length=10, choices=ChargeUnit, default=ChargeUnit.UNIT)
    custom_unit = models.CharField("unidad personalizada", max_length=60, blank=True)
    discount_percent = models.DecimalField("descuento (%)", max_digits=5, decimal_places=2, default=0, validators=[MinValueValidator(0), MaxValueValidator(100)])
    additional_flat = models.DecimalField("adicional fijo", max_digits=11, decimal_places=2, default=0, validators=MONEY_VALIDATORS, help_text="Se suma después del descuento.")
    availability = models.CharField("disponibilidad", max_length=20, choices=Availability, default=Availability.MADE_TO_ORDER)
    internal_notes = models.TextField("notas internas (privadas)", blank=True, max_length=10000)
    image = models.CharField("imagen existente (URL)", blank=True, max_length=1000)
    image_asset = models.ForeignKey(MediaAsset, related_name="product_images", null=True, blank=True, on_delete=models.PROTECT, verbose_name="imagen subida", limit_choices_to={"kind": "image"})
    technical_sheet = models.CharField("ficha PDF existente (URL)", blank=True, max_length=1000)
    technical_asset = models.ForeignKey(MediaAsset, related_name="product_documents", null=True, blank=True, on_delete=models.PROTECT, verbose_name="ficha subida", limit_choices_to={"kind": "pdf"})
    model_3d = models.CharField("modelo GLB existente (URL)", blank=True, max_length=1000)
    model_asset = models.ForeignKey(MediaAsset, related_name="product_models", null=True, blank=True, on_delete=models.PROTECT, verbose_name="modelo subido", limit_choices_to={"kind": "glb"})
    model_poster = models.CharField("poster 3D existente (URL)", blank=True, max_length=1000)
    door_animation = models.CharField("animación de puertas", max_length=120, blank=True, help_text="Nombre exacto del clip incluido en el GLB. Déjalo vacío hasta tener el modelo animado.")
    poster_asset = models.ForeignKey(MediaAsset, related_name="product_posters", null=True, blank=True, on_delete=models.PROTECT, verbose_name="poster subido", limit_choices_to={"kind": "image"})
    created_at = models.DateTimeField("creado", auto_now_add=True)
    updated_at = models.DateTimeField("actualizado", auto_now=True)

    class Meta:
        ordering = ("order", "name", "pk")
        verbose_name = "producto"
        verbose_name_plural = "productos"
        permissions = [("view_inventory", "Puede consultar y actualizar la copia del inventario")]

    def clean(self):
        super().clean()
        errors = {}
        try:
            self.cooktop_config = validate_product_cooktop_config(self.cooktop_config, supply_type=self.supply_type, category=self.category, equipment_family=self.equipment_family)
        except CooktopValidationError as exc:
            # This field is excluded for nonowner editors; a nonfield error also
            # handles an attempted reclassification of an already configured unit.
            errors["__all__"] = str(exc)
        if self.charge_unit == self.ChargeUnit.CUSTOM and not self.custom_unit.strip():
            errors["custom_unit"] = "Indique la unidad de cobro."
        if self.show_price and self.price is None:
            errors["price"] = "Ingrese un precio para mostrarlo en la web."
        for field, kind in (("image", "image"), ("model_poster", "image"), ("technical_sheet", "pdf"), ("model_3d", "glb")):
            try:
                validate_public_url(getattr(self, field), kind)
            except ValidationError as exc:
                errors[field] = exc.messages
        for field, kind in (("image_asset", "image"), ("poster_asset", "image"), ("technical_asset", "pdf"), ("model_asset", "glb")):
            asset = getattr(self, field, None)
            if asset and asset.kind != kind:
                errors[field] = "El tipo de archivo no corresponde."
        if errors:
            raise ValidationError(errors)

    @property
    def computed_price(self):
        return final_price(self.price, self.discount_percent, self.additional_flat)

    @property
    def unit_label(self):
        return self.custom_unit if self.charge_unit == self.ChargeUnit.CUSTOM else {"unit": "unidad", "m": "metro lineal", "m2": "m²"}[self.charge_unit]

    def __str__(self):
        return f"{self.code} · {self.name}"


class ProductVariant(ValidatedModel):
    product = models.ForeignKey(Product, related_name="variants", on_delete=models.CASCADE)
    name = models.CharField("variante / tamaño", max_length=180)
    manufacturing_code = models.CharField("código de fabricación", max_length=64, blank=True, validators=[CODE_VALIDATOR], help_text="Código de esta configuración completa en Inventario y Recetas, por ejemplo EQ-001-GAS. Vacío: consumo aún por definir.")
    model_asset = models.ForeignKey(MediaAsset, related_name="variant_models", null=True, blank=True, on_delete=models.PROTECT, verbose_name="modelo de esta variación", limit_choices_to={"kind": "glb"})
    technical_asset = models.ForeignKey(MediaAsset, related_name="variant_documents", null=True, blank=True, on_delete=models.PROTECT, verbose_name="ficha de esta variación", limit_choices_to={"kind": "pdf"})
    material_variant = models.CharField("acabado en el GLB", max_length=120, blank=True, help_text="Nombre exacto del acabado KHR_materials_variants. No cambia la geometría.")
    door_animation = models.CharField("animación de puertas", max_length=120, blank=True, help_text="Vacío: usa el nombre del equipo principal, si el modelo incluye ese clip.")
    price = models.DecimalField("precio base", max_digits=11, decimal_places=2, blank=True, null=True, validators=MONEY_VALIDATORS, help_text="Vacío: usa el precio base del producto.")
    cost = models.DecimalField("costo interno (privado)", max_digits=11, decimal_places=2, blank=True, null=True, validators=MONEY_VALIDATORS)
    availability = models.CharField("disponibilidad", max_length=20, choices=Product.Availability, default=Product.Availability.MADE_TO_ORDER)
    is_active = models.BooleanField("activa", default=True)
    order = models.PositiveIntegerField("orden", default=0)

    class Meta:
        ordering = ("order", "pk")
        verbose_name = "variante"
        verbose_name_plural = "variantes y tamaños"
        constraints = [models.UniqueConstraint(fields=("product", "name"), name="catalog_variant_unique_name")]

    @property
    def computed_price(self):
        return final_price(self.price if self.price is not None else self.product.price, self.product.discount_percent, self.product.additional_flat)

    def clean(self):
        super().clean()
        errors = {}
        for field, kind in (("model_asset", "glb"), ("technical_asset", "pdf")):
            asset = getattr(self, field, None)
            if asset and asset.kind != kind:
                errors[field] = "El tipo de archivo no corresponde."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return self.name


class ProductAdditional(ValidatedModel):
    product = models.ForeignKey(Product, related_name="additionals", on_delete=models.CASCADE)
    name = models.CharField("nombre del adicional", max_length=180)
    manufacturing_code = models.CharField("código de fabricación", max_length=64, blank=True, validators=[CODE_VALIDATOR], help_text="Código del adicional en Inventario y Recetas. Su consumo y mano de obra se suman a la configuración elegida; no repitas componentes ya incluidos.")
    description = models.TextField("descripción", blank=True, max_length=1500)
    price = models.DecimalField("tarifa", max_digits=11, decimal_places=2, blank=True, null=True, validators=MONEY_VALIDATORS)
    cost = models.DecimalField("costo interno (privado)", max_digits=11, decimal_places=2, blank=True, null=True, validators=MONEY_VALIDATORS)
    show_price = models.BooleanField("mostrar tarifa", default=False)
    charge_unit = models.CharField("cobro por", max_length=10, choices=Product.ChargeUnit, default=Product.ChargeUnit.UNIT)
    custom_unit = models.CharField("unidad personalizada", max_length=60, blank=True)
    is_active = models.BooleanField("activo", default=True)
    order = models.PositiveIntegerField("orden", default=0)

    class Meta:
        ordering = ("order", "pk")
        verbose_name = "adicional"
        verbose_name_plural = "adicionales opcionales"
        constraints = [models.UniqueConstraint(fields=("product", "name"), name="catalog_additional_unique_name")]

    def clean(self):
        super().clean()
        errors = {}
        if self.charge_unit == Product.ChargeUnit.CUSTOM and not self.custom_unit.strip():
            errors["custom_unit"] = "Indique la unidad de cobro."
        if self.show_price and self.price is None:
            errors["price"] = "Ingrese una tarifa para mostrarla en la web."
        if errors:
            raise ValidationError(errors)

    @property
    def unit_label(self):
        return self.custom_unit if self.charge_unit == Product.ChargeUnit.CUSTOM else {"unit": "unidad", "m": "metro lineal", "m2": "m²"}[self.charge_unit]

    def __str__(self):
        return self.name


class ProductImage(ValidatedModel):
    product = models.ForeignKey(Product, related_name="gallery_images", on_delete=models.CASCADE)
    asset = models.ForeignKey(MediaAsset, related_name="gallery_items", on_delete=models.PROTECT, null=True, blank=True, verbose_name="imagen subida", limit_choices_to={"kind": "image"})
    url = models.CharField("imagen existente (URL)", max_length=1000, blank=True)
    caption = models.CharField("descripción", max_length=200, blank=True)
    order = models.PositiveIntegerField("orden", default=0)

    class Meta:
        ordering = ("order", "pk")
        verbose_name = "imagen de galería"
        verbose_name_plural = "imágenes de galería (hasta 8)"

    def clean(self):
        super().clean()
        validate_public_url(self.url)
        if not self.asset_id and not self.url and not getattr(self, "_prepared_uploads", {}).get("asset"):
            raise ValidationError("Suba una imagen o indique una URL.")
        if self.asset_id and self.asset.kind != "image":
            raise ValidationError({"asset": "Seleccione una imagen."})
        if self.product_id and not getattr(self, "_defer_gallery_count", False) and ProductImage.objects.filter(product_id=self.product_id).exclude(pk=self.pk).count() >= 8:
            raise ValidationError("Se permiten hasta 8 imágenes adicionales.")

    @property
    def public_url(self):
        return self.asset.public_url if self.asset_id else self.url


class BusinessSettings(ValidatedModel):
    company = models.CharField("empresa", max_length=150, default="INOX 304")
    address = models.CharField("dirección", max_length=500, blank=True)
    address_reference = models.CharField("referencia de dirección", max_length=300, blank=True)
    facebook = models.URLField("Facebook", blank=True, validators=[validate_https])
    instagram = models.URLField("Instagram", blank=True, validators=[validate_https])
    tiktok = models.URLField("TikTok", blank=True, validators=[validate_https])
    hours = models.TextField("horarios", max_length=1500, blank=True)
    hero_title = models.CharField("título principal de inicio", max_length=250, blank=True)
    hero_description = models.TextField("descripción principal de inicio", max_length=2000, blank=True)
    home_text = models.TextField("texto comercial de inicio", max_length=5000, blank=True)
    contact_main = models.ForeignKey(Contact, related_name="main_settings", on_delete=models.SET_NULL, blank=True, null=True, verbose_name="contacto principal")
    contact_installation = models.ForeignKey(Contact, related_name="installation_settings", on_delete=models.SET_NULL, blank=True, null=True, verbose_name="contacto de instalaciones")
    contact_custom = models.ForeignKey(Contact, related_name="custom_settings", on_delete=models.SET_NULL, blank=True, null=True, verbose_name="contacto a medida")
    contact_form = models.ForeignKey(Contact, related_name="form_settings", on_delete=models.SET_NULL, blank=True, null=True, verbose_name="contacto del formulario")

    class Meta:
        verbose_name = "ajustes del negocio"
        verbose_name_plural = "ajustes del negocio"

    def save(self, *args, **kwargs):
        self.pk = 1
        return super().save(*args, **kwargs)

    def __str__(self):
        return "Datos y textos del negocio"


class AuditLog(models.Model):
    created_at = models.DateTimeField("fecha", auto_now_add=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="usuario")
    entity = models.CharField("tipo", max_length=100)
    object_id = models.CharField("identificador", max_length=100)
    label = models.CharField("registro", max_length=300)
    operation = models.CharField("acción", max_length=20, choices=(("create", "Creación"), ("update", "Cambio"), ("delete", "Eliminación"), ("restore", "Restauración")))
    before = models.JSONField("antes (privado)", default=dict)
    after = models.JSONField("después (privado)", default=dict)

    class Meta:
        ordering = ("-created_at", "-pk")
        verbose_name = "registro de historial"
        verbose_name_plural = "historial de cambios"

    def __str__(self):
        return f"{self.get_operation_display()}: {self.label}"


class InventorySyncState(models.Model):
    """Private singleton; durable Sheets cache and bounded cross-worker lease."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    snapshot = models.JSONField(null=True, blank=True)
    status = models.JSONField(default=dict)
    lease_token = models.CharField(max_length=64, blank=True, default="")
    lease_expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        default_permissions = ()
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="inventory_sync_singleton")]
