from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0010_product_variant_axes_productvariant_option_values")]

    operations = [
        migrations.AddField(model_name="product", name="cart_config", field=models.JSONField(blank=True, default=dict, help_text="Módulos compatibles aprobados por el propietario. Requiere un modelo 3D preparado para este carrito; se publica solo al habilitarlo.", verbose_name="configurador del carrito")),
        migrations.AlterField(model_name="product", name="equipment_family", field=models.CharField(blank=True, choices=[("amasadoras", "Amasadoras"), ("batidoras", "Batidoras"), ("envasadoras-vacio", "Envasadoras al vacío"), ("extractores-naranja", "Extractores de naranja"), ("cremoladeras", "Máquinas de cremoladas"), ("maquinas-helado", "Máquinas de helado"), ("dispensadores-jugo", "Dispensadores de jugo"), ("cocinas", "Cocinas"), ("carritos-comida", "Carritos de comida")], default="", help_text="Agrupa equipos similares dentro de su línea. Déjelo vacío si no corresponde a estas familias.", max_length=32, verbose_name="familia de equipos")),
    ]
