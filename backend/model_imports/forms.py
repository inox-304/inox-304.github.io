from django import forms

from catalog.models import Product, ProductVariant


class ProductTargetForm(forms.Form):
    product = forms.ModelChoiceField(label="Equipo del catálogo", queryset=Product.objects.none(), empty_label="Selecciona un equipo")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["product"].queryset = Product.objects.order_by("name", "code")


class ModelImportForm(forms.Form):
    product = forms.ModelChoiceField(queryset=Product.objects.none(), widget=forms.HiddenInput)
    variant = forms.ModelChoiceField(label="Dónde usar el modelo", queryset=ProductVariant.objects.none(), required=False, empty_label="Modelo principal del equipo")
    upload = forms.FileField(label="Archivo de SketchUp", widget=forms.FileInput(attrs={"accept": ".skp"}), help_text="Archivo .skp de hasta 20 MB. Conservaremos el original y prepararemos una copia GLB para revisar.")

    def __init__(self, *args, product=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["product"].queryset = Product.objects.order_by("name", "code")
        if product is not None:
            self.fields["product"].initial = product.pk
            self.fields["variant"].queryset = product.variants.order_by("order", "name", "pk")
        self.fields["variant"].help_text = "Cada variación conserva su propio modelo. No se cambian capacidades, fotos ni precios al importar."

    def clean(self):
        data = super().clean()
        variant, product = data.get("variant"), data.get("product")
        if variant is not None and product is not None and variant.product_id != product.pk:
            self.add_error("variant", "La variación debe pertenecer al equipo elegido.")
        return data
