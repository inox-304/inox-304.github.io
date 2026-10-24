import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0008_product_cooktop_config")]

    operations = [
        migrations.AddField(
            model_name="productvariant",
            name="image_asset",
            field=models.ForeignKey(blank=True, limit_choices_to={"kind": "image"}, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="variant_images", to="catalog.mediaasset", verbose_name="foto de esta variación"),
        ),
    ]
