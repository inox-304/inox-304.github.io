from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0006_product_supplier_identity")]

    operations = [
        migrations.CreateModel(
            name="InventorySyncState",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("snapshot", models.JSONField(blank=True, null=True)),
                ("status", models.JSONField(default=dict)),
                ("lease_token", models.CharField(blank=True, default="", max_length=64)),
                ("lease_expires_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "default_permissions": (),
                "constraints": [models.CheckConstraint(condition=models.Q(id=1), name="inventory_sync_singleton")],
            },
        ),
    ]
