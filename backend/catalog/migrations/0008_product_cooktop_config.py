from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0007_inventory_sync_state")]

    operations = [
        migrations.AddField(
            model_name="product",
            name="cooktop_config",
            field=models.JSONField(blank=True, default=dict, help_text="Opciones de fabricación definidas por el propietario para esta cocina. Se publica solo al habilitarlo.", verbose_name="configurador de cocina"),
        ),
        migrations.AlterField(
            model_name="product",
            name="equipment_family",
            field=models.CharField(blank=True, choices=[("amasadoras", "Amasadoras"), ("batidoras", "Batidoras"), ("envasadoras-vacio", "Envasadoras al vacío"), ("extractores-naranja", "Extractores de naranja"), ("cremoladeras", "Máquinas de cremoladas"), ("maquinas-helado", "Máquinas de helado"), ("dispensadores-jugo", "Dispensadores de jugo"), ("cocinas", "Cocinas")], default="", help_text="Agrupa equipos similares dentro de su línea. Déjelo vacío si no corresponde a estas familias.", max_length=32, verbose_name="familia de equipos"),
        ),
    ]
