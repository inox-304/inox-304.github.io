from django.apps import AppConfig


class ModelImportsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "model_imports"
    verbose_name = "Importación de modelos"
