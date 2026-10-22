from django import forms
from django.core.exceptions import ValidationError
from django.forms.models import BaseInlineFormSet
from django.utils.text import slugify
from uuid import uuid4

from .models import MediaAsset, Product, ProductAdditional, ProductImage, ProductVariant
from .validators import clean_upload


UPLOAD_FIELDS = {"image_upload": ("image_asset", "image"), "technical_upload": ("technical_asset", "pdf"), "model_upload": ("model_asset", "glb"), "poster_upload": ("poster_asset", "image")}


class ProductAdminForm(forms.ModelForm):
    image_upload = forms.FileField(label="Elegir foto principal", required=False, widget=forms.FileInput(attrs={"accept": ".jpg,.jpeg,.png,.webp,.avif"}), help_text="JPG, PNG, WebP o AVIF · hasta 8 MB. Puedes añadirla más adelante. Al guardar reemplaza la foto actual.")
    technical_upload = forms.FileField(label="Elegir ficha técnica", required=False, widget=forms.FileInput(attrs={"accept": ".pdf"}), help_text="PDF · hasta 8 MB. Opcional: súbelo cuando esté listo. Al guardar reemplaza la ficha actual.")
    model_upload = forms.FileField(label="Elegir modelo 3D", required=False, widget=forms.FileInput(attrs={"accept": ".glb"}), help_text="GLB 2.0 · hasta 8 MB, con texturas incluidas. Opcional: puedes guardar el equipo sin modelo y subirlo después.")
    poster_upload = forms.FileField(label="Elegir portada del 3D", required=False, widget=forms.FileInput(attrs={"accept": ".jpg,.jpeg,.png,.webp,.avif"}), help_text="Imagen opcional mientras carga el 3D · hasta 8 MB. No es necesario tenerla para guardar.")

    class Meta:
        model = Product
        fields = "__all__"
        widgets = {"description": forms.Textarea(attrs={"rows": 4}), "characteristics": forms.Textarea(attrs={"rows": 5}), "internal_notes": forms.Textarea(attrs={"rows": 4})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
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
    model_upload = forms.FileField(label="Subir 3D de esta variación", required=False, widget=forms.FileInput(attrs={"accept": ".glb"}), help_text="GLB · hasta 8 MB. Opcional: sin archivo propio, usa el modelo principal.")
    technical_upload = forms.FileField(label="Subir ficha de esta variación", required=False, widget=forms.FileInput(attrs={"accept": ".pdf"}), help_text="PDF · hasta 8 MB. Sin ficha propia, usa la del equipo.")

    class Meta:
        model = ProductVariant
        fields = "__all__"
        labels = {"name": "Nombre de la variación"}
        help_texts = {"name": "Por ejemplo: a gas con horno, eléctrica con cooler o 150 cm.",
                      "material_variant": "Elige un acabado de los que muestra el archivo al subirlo. Si no tiene acabados, déjalo vacío.",
                      "cost": "Referencia manual privada. El costo de fabricación se calcula por su código en la hoja."}

    def clean(self):
        data = super().clean()
        self.instance._prepared_uploads = {}
        for field, target, kind in (("model_upload", "model_asset", "glb"), ("technical_upload", "technical_asset", "pdf")):
            if data.get(field):
                try:
                    cleaned, mime = clean_upload(data[field], kind)
                    self.instance._prepared_uploads[target] = (cleaned, kind, mime)
                except ValidationError as exc:
                    self.add_error(field, exc)
        return data


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
