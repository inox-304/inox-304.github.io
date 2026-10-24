import json

from django import forms

from .cart import MODULE_IDS


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


class CartConfigWidget(forms.Widget):
    """Plain form controls keep the editor usable without JavaScript."""
    template_name = "admin/catalog/widgets/cart_config.html"
    labels = {"broastera": "Broastera", "freidora": "Freidora", "conservadora": "Conservadora", "plancha": "Plancha"}

    class Media:
        css = {"all": ("inox/cart-editor.css",)}

    def get_context(self, name, value, attrs):
        context = super().get_context(name, value, attrs)
        try:
            data = json.loads(value) if isinstance(value, str) else value
        except (ValueError, TypeError):
            data = {}
        data = data if isinstance(data, dict) else {}
        source = data.get("modules", [])
        modules = {item.get("id"): item for item in source if isinstance(item, dict) and isinstance(item.get("id"), str)} if isinstance(source, list) else {}
        context["widget"]["enabled"] = data.get("enabled") is True
        context["widget"]["modules"] = [
            {"id": key, "label": modules.get(key, {}).get("label", self.labels[key]), "allowed": key in modules, "included": modules.get(key, {}).get("defaultIncluded", True) is True}
            for key in MODULE_IDS
        ]
        return context

    def value_from_datadict(self, data, files, name):
        # Explicit JSON submissions still pass through the same strict validator.
        if name in data:
            return data.get(name)
        if data.get(f"{name}-present") != "1":
            return None
        enabled = data.get(f"{name}-enabled") == "on"
        modules = [
            {"id": key, "label": data.get(f"{name}-{key}-label", ""), "defaultIncluded": data.get(f"{name}-{key}-included") == "on"}
            for key in MODULE_IDS if data.get(f"{name}-{key}-allowed") == "on"
        ]
        return json.dumps({"version": 1, "enabled": enabled, "modules": modules} if enabled or modules else {}, ensure_ascii=False)

    def value_omitted_from_data(self, data, files, name):
        return name not in data and f"{name}-present" not in data
