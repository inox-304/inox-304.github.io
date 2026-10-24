from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0009_productvariant_image_asset")]

    operations = [
        migrations.AddField(model_name="product", name="variant_axes", field=models.JSONField(blank=True, default=list, verbose_name="tipos de opción de las variaciones")),
        migrations.AddField(model_name="productvariant", name="option_values", field=models.JSONField(blank=True, default=dict, verbose_name="combinación de opciones")),
    ]
