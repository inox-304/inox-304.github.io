from django import forms
from django.core.exceptions import ValidationError
from django.forms.models import BaseInlineFormSet

from .models import MediaAsset, Product, ProductImage
from .validators import clean_upload


UPLOAD_FIELDS = {"image_upload": ("image_asset", "image"), "technical_upload": ("technical_asset", "pdf"), "model_upload": ("model_asset", "glb"), "poster_upload": ("poster_asset", "image")}


class ProductAdminForm(forms.ModelForm):
    image_upload = forms.FileField(label="Subir imagen principal", required=False, help_text="JPG, PNG, WebP o AVIF. Máximo 8 MB; se optimiza automáticamente.")
    technical_upload = forms.FileField(label="Subir ficha técnica PDF", required=False, help_text="Máximo 8 MB.")
    model_upload = forms.FileField(label="Subir modelo GLB", required=False, help_text="GLB 2.0 con recursos incrustados. Máximo 8 MB.")
    poster_upload = forms.FileField(label="Subir poster del modelo 3D", required=False)

    class Meta:
        model = Product
        fields = "__all__"

    def clean(self):
        data = super().clean()
        self.instance._prepared_uploads = {}
        for field, (target, kind) in UPLOAD_FIELDS.items():
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
    def clean(self):
        super().clean()
        if any(self.errors):
            return
        active = [form for form in self.forms if form.cleaned_data and not form.cleaned_data.get("DELETE")]
        if len(active) > 8:
            raise ValidationError("Se permiten hasta 8 imágenes adicionales por producto.")
