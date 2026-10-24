from django import forms
from django.core.exceptions import ValidationError
from django.forms.models import BaseInlineFormSet
from django.utils.text import slugify
from uuid import uuid4

from .models import MediaAsset, Product, ProductAdditional, ProductImage, ProductVariant
from .validators import clean_upload
from .cooktop import CooktopValidationError, validate_cooktop_config
from .cart import CartValidationError, validate_cart_config
from .widgets import CooktopConfigWidget, CartConfigWidget, VariantAxesWidget, VariantOptionValuesWidget
from .variant_options import VariantOptionsError, validate_variant_axes, validate_option_values, validate_variant_combinations


UPLOAD_FIELDS = {"image_upload": ("image_asset", "image"), "technical_upload": ("technical_asset", "pdf"), "model_upload": ("model_asset", "glb"), "poster_upload": ("poster_asset", "image")}


class ProductAdminForm(forms.ModelForm):
    image_upload = forms.FileField(label="Elegir foto principal", required=False, widget=forms.FileInput(attrs={"accept": ".jpg,.jpeg,.png,.webp,.avif"}), help_text="JPG, PNG, WebP o AVIF · hasta 8 MB. Puedes añadirla más adelante. Al guardar reemplaza la foto actual.")
    technical_upload = forms.FileField(label="Elegir ficha técnica", required=False, widget=forms.FileInput(attrs={"accept": ".pdf"}), help_text="PDF · hasta 8 MB. Opcional: súbelo cuando esté listo. Al guardar reemplaza la ficha actual.")
    model_upload = forms.FileField(label="Elegir modelo 3D", required=False, widget=forms.FileInput(attrs={"accept": ".glb"}), help_text="GLB 2.0 · hasta 8 MB, con texturas incluidas. Opcional: puedes guardar el equipo sin modelo y subirlo después.")
    poster_upload = forms.FileField(label="Elegir portada del 3D", required=False, widget=forms.FileInput(attrs={"accept": ".jpg,.jpeg,.png,.webp,.avif"}), help_text="Imagen opcional mientras carga el 3D · hasta 8 MB. No es necesario tenerla para guardar.")

    class Meta:
        model = Product
        fields = "__all__"
        widgets = {"description": forms.Textarea(attrs={"rows": 4}), "characteristics": forms.Textarea(attrs={"rows": 5}), "internal_notes": forms.Textarea(attrs={"rows": 4}), "cooktop_config": CooktopConfigWidget(), "cart_config": CartConfigWidget(), "variant_axes": VariantAxesWidget()}

    def __init__(self, *args, **kwargs):
        self.can_edit_cooktop = kwargs.pop("can_edit_cooktop", False)
        self.can_edit_cart = kwargs.pop("can_edit_cart", False)
        self.can_edit_variant_axes = kwargs.pop("can_edit_variant_axes", False)
        self.defer_variant_consistency = kwargs.pop("defer_variant_consistency", False)
        super().__init__(*args, **kwargs)
        if not self.can_edit_cooktop:
            self.fields.pop("cooktop_config", None)
        if not self.can_edit_cart:
            self.fields.pop("cart_config", None)
        if not self.can_edit_variant_axes:
            self.fields.pop("variant_axes", None)
        for name in ("code", "slug"):
            if name in self.fields:
                self.fields[name].required = False
                self.fields[name].help_text = "Se genera al guardar. Déjalo vacío si no utilizas un identificador propio."
        # Django excludes editable fields for an account with view-only access.
        if "category" in self.fields:
            categories = [(value, label) for value, label in Product.Category.choices if value != Product.Category.FURNITURE]
            if self.instance.pk and self.instance.category == Product.Category.FURNITURE:
                categories.append((Product.Category.FURNITURE, "Mobiliario (catálogo anterior)"))
            self.fields["category"].choices = [("", "Elige una línea"), *categories]
        help_texts = {
            "is_published": "Déjalo desmarcado para guardar un borrador privado. Puedes completar archivos y publicarlo después.",
            "price": "Opcional. Déjalo vacío y desmarca Mostrar precio para ofrecer el botón Cotizar. No es necesario escribir 0.",
            "show_price": "Desmarcado: se muestra Cotizar y el importe queda privado. Puedes publicar el equipo sin precio.",
            "additional_flat": "Opcional. Se suma al precio después del descuento; no es un adicional que el cliente elige.",
            "cost": "Referencia manual del catálogo. El análisis de fabricación calcula su costo desde Recetas y Costos de la hoja; este valor no se sincroniza automáticamente.",
        }
        for name, help_text in help_texts.items():
            if name in self.fields:
                self.fields[name].help_text = help_text
        if "additional_flat" in self.fields:
            self.fields["additional_flat"].label = "Recargo fijo incluido"

    def _new_identifier(self, field, prefix):
        while True:
            candidate = f"{prefix}-{uuid4().hex[:8]}"
            if not Product.objects.filter(**{field: candidate}).exists():
                return candidate

    def clean(self):
        data = super().clean()
        if not self.can_edit_cooktop and "cooktop_config" in self.data:
            self.add_error(None, "Solo el propietario puede modificar el configurador de cocina.")
        cart_prefix = self.add_prefix("cart_config")
        if not self.can_edit_cart and any(key == cart_prefix or key.startswith(f"{cart_prefix}-") for key in self.data):
            self.add_error(None, "Solo el propietario puede modificar el configurador del carrito.")
        if not self.can_edit_variant_axes and "variant_axes" in self.data:
            self.add_error(None, "Solo el propietario puede definir los tipos de opción y sus valores permitidos.")
        if "code" in self.fields and "code" not in self.errors and not data.get("code"):
            data["code"] = self.instance.code or self._new_identifier("code", "EQ")
        if "slug" in self.fields and "slug" not in self.errors and not data.get("slug"):
            data["slug"] = self.instance.slug or self._new_identifier("slug", slugify(data.get("name", ""))[:140] or "equipo")
        self.instance._prepared_uploads = {}
        for field, (target, kind) in UPLOAD_FIELDS.items():
            if data.get(field):
                try:
                    cleaned, mime = clean_upload(data[field], kind)
                    self.instance._prepared_uploads[target] = (cleaned, kind, mime)
                except ValidationError as exc:
                    self.add_error(field, exc)
        return data

    def clean_cooktop_config(self):
        try:
            value = self.cleaned_data.get("cooktop_config")
            if self.data.get(self.add_prefix("cooktop_config")) in (None, ""):
                value = {}
            return validate_cooktop_config(value)
        except CooktopValidationError as exc:
            raise ValidationError(str(exc)) from exc

    def clean_variant_axes(self):
        try:
            raw = self.cleaned_data.get("variant_axes")
            return validate_variant_axes([] if self.data.get(self.add_prefix("variant_axes")) in (None, "") else raw)
        except VariantOptionsError as exc:
            raise ValidationError(str(exc)) from exc

    def clean_cart_config(self):
        try:
            value = self.cleaned_data.get("cart_config")
            raw = self.fields["cart_config"].widget.value_from_datadict(self.data, self.files, self.add_prefix("cart_config"))
            if raw in (None, ""):
                value = self.instance.cart_config or {}
            return validate_cart_config(value)
        except CartValidationError as exc:
            raise ValidationError(str(exc)) from exc

    def _post_clean(self):
        self.instance._defer_variant_consistency = self.defer_variant_consistency
        try:
            super()._post_clean()
        finally:
            self.instance._defer_variant_consistency = False


class ProductAdditionalForm(forms.ModelForm):
    class Meta:
        model = ProductAdditional
        fields = "__all__"
        widgets = {"description": forms.Textarea(attrs={"rows": 3})}
        help_texts = {
            "price": "Opcional. Sin tarifa pública, el cliente verá A cotizar. La moneda es la del equipo.",
            "show_price": "Publica la tarifa de este adicional, independientemente del precio del equipo. Requiere un importe.",
            "custom_unit": "Solo para cobro personalizado: por ejemplo, juego o instalación.",
            "is_active": "Desmárcalo para retirar la opción de la web conservando sus datos.",
        }


class ProductVariantForm(forms.ModelForm):
    image_upload = forms.FileField(label="Subir foto de esta variación", required=False, widget=forms.FileInput(attrs={"accept": ".jpg,.jpeg,.png,.webp,.avif"}), help_text="Imagen · hasta 8 MB. Sin foto propia, usa la imagen principal del equipo.")
    model_upload = forms.FileField(label="Subir 3D de esta variación", required=False, widget=forms.FileInput(attrs={"accept": ".glb"}), help_text="GLB · hasta 8 MB. Opcional: sin archivo propio, usa el modelo principal.")
    technical_upload = forms.FileField(label="Subir ficha de esta variación", required=False, widget=forms.FileInput(attrs={"accept": ".pdf"}), help_text="PDF · hasta 8 MB. Sin ficha propia, usa la del equipo.")

    class Meta:
        model = ProductVariant
        fields = "__all__"
        widgets = {"option_values": VariantOptionValuesWidget()}
        labels = {"name": "Capacidad, tamaño o nombre de la variación"}
        help_texts = {"name": "Escribe una opción completa con su unidad o referencia. Sirve para cualquier equipo. En productos distribuidos, ofrece solo capacidades y modelos confirmados por el fabricante.",
                      "is_active": "Actívala cuando hayas revisado su foto, modelo, ficha y disponibilidad. Inactiva: se conserva fuera del catálogo.",
                      "material_variant": "Elige un acabado de los que muestra el archivo al subirlo. Si no tiene acabados, déjalo vacío.",
                      "cost": "Referencia manual privada. El costo de fabricación se calcula por su código en la hoja."}

    def _post_clean(self):
        self.instance._defer_variant_consistency = getattr(self, "_variant_inline_validation", False)
        try:
            super()._post_clean()
        finally:
            self.instance._defer_variant_consistency = False

    def clean_option_values(self):
        value = self.cleaned_data.get("option_values")
        return {} if self.data.get(self.add_prefix("option_values")) in (None, "") else value

    def clean(self):
        data = super().clean()
        self.instance._prepared_uploads = {}
        for field, target, kind in (("image_upload", "image_asset", "image"), ("model_upload", "model_asset", "glb"), ("technical_upload", "technical_asset", "pdf")):
            if data.get(field):
                try:
                    cleaned, mime = clean_upload(data[field], kind)
                    self.instance._prepared_uploads[target] = (cleaned, kind, mime)
                except ValidationError as exc:
                    self.add_error(field, exc)
        return data


class VariantInlineFormSet(BaseInlineFormSet):
    def _construct_form(self, i, **kwargs):
        form = super()._construct_form(i, **kwargs)
        form._variant_inline_validation = True
        # Django validates the product before its lazy inline forms. Share that
        # updated instance so coordinated axis changes validate the final state.
        form.instance.product = self.instance
        if "option_values" in form.fields:
            form.fields["option_values"].widget.axes = self.instance.variant_axes
        return form

    def clean(self):
        super().clean()
        if any(self.errors):
            return
        remaining = [form for form in self.forms if form.cleaned_data and not form.cleaned_data.get("DELETE")]
        represented = {form.instance.pk for form in self.forms if form.instance.pk}
        untouched = list(self.get_queryset().exclude(pk__in=represented))
        # Legacy rows remain editable and visible to the owner; do not truncate
        # them when introducing the limit. Only deletion can reduce that total.
        limit = max(100, self.get_queryset().count())
        if len(remaining) + len(untouched) > limit:
            raise ValidationError("Se permiten hasta 100 variaciones por equipo. Revisa las filas antes de añadir más.")
        if sum(bool(form.instance.is_active) for form in remaining) + sum(item.is_active for item in untouched) > 100:
            raise ValidationError("Solo puedes activar hasta 100 variaciones por equipo. Las demás se conservan inactivas.")
        try:
            axes = validate_variant_axes(self.instance.variant_axes)
            pairs = [(item.option_values, item.is_active) for item in untouched]
            for form in remaining:
                form.instance.option_values = validate_option_values(axes, form.instance.option_values, active=form.instance.is_active)
                pairs.append((form.instance.option_values, form.instance.is_active))
            validate_variant_combinations(axes, pairs)
        except VariantOptionsError as exc:
            raise ValidationError(str(exc)) from exc
        self._variant_final_validated = True
        self.instance._variant_inline_validated = True


class ProductImageForm(forms.ModelForm):
    upload = forms.FileField(label="Subir imagen", required=False)

    class Meta:
        model = ProductImage
        fields = "__all__"

    def _post_clean(self):
        # The inline validates the final selection, including pending deletions.
        # The model checks the database again on save, after deletions are applied.
        if not getattr(self, "_gallery_inline_validation", False):
            return super()._post_clean()
        self.instance._defer_gallery_count = True
        try:
            return super()._post_clean()
        finally:
            del self.instance._defer_gallery_count

    def clean(self):
        data = super().clean()
        self.instance._prepared_uploads = {}
        if data.get("upload"):
            try:
                cleaned, mime = clean_upload(data["upload"], "image")
                self.instance._prepared_uploads["asset"] = (cleaned, "image", mime)
            except ValidationError as exc:
                self.add_error("upload", exc)
        return data


def persist_uploads(instance):
    for target, (file, kind, mime) in getattr(instance, "_prepared_uploads", {}).items():
        asset = MediaAsset(name=str(instance)[:180], kind=kind, file=file, content_type=mime)
        asset.save()
        setattr(instance, target, asset)
    instance._prepared_uploads = {}


class GalleryInlineFormSet(BaseInlineFormSet):
    def _construct_form(self, i, **kwargs):
        form = super()._construct_form(i, **kwargs)
        form._gallery_inline_validation = True
        return form

    def clean(self):
        super().clean()
        if any(self.errors):
            return
        active = [form for form in self.forms if form.cleaned_data and not form.cleaned_data.get("DELETE")]
        if len(active) > 8:
            raise ValidationError("Se permiten hasta 8 imágenes adicionales por producto.")
