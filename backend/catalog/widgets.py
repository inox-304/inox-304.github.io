from django import forms


class CooktopConfigWidget(forms.Textarea):
    template_name = "admin/catalog/widgets/cooktop_config.html"

    def __init__(self, attrs=None):
        super().__init__({"rows": 5, "readonly": True, "hidden": True, **(attrs or {})})

    class Media:
        css = {"all": ("inox/cooktop-editor.css",)}
        js = ("inox/cooktop-editor.js",)
