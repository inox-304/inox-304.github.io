from django import forms


class CooktopConfigWidget(forms.Textarea):
    template_name = "admin/catalog/widgets/cooktop_config.html"

    def __init__(self, attrs=None):
        super().__init__({"rows": 5, "readonly": True, "hidden": True, **(attrs or {})})

    class Media:
        css = {"all": ("inox/cooktop-editor.css",)}
        js = ("inox/cooktop-editor.js",)


class VariantAxesWidget(forms.Textarea):
    template_name = "admin/catalog/widgets/variant_axes.html"

    def __init__(self, attrs=None):
        super().__init__({"readonly": True, "hidden": True, **(attrs or {})})

    class Media:
        css = {"all": ("inox/variant-options.css",)}
        js = ("inox/variant-options.js",)


class VariantOptionValuesWidget(VariantAxesWidget):
    template_name = "admin/catalog/widgets/variant_option_values.html"
    axes = []

    def get_context(self, name, value, attrs):
        context = super().get_context(name, value, attrs)
        context["widget"]["axes"] = self.axes
        context["widget"]["axes_id"] = f"{context['widget']['attrs'].get('id', name)}-axes"
        return context
