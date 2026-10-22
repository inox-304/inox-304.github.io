from django.db import migrations


def preserve_management_inventory(apps, schema_editor):
    """Keep the explicitly authorized management group, not every catalog reader."""
    alias = schema_editor.connection.alias
    ContentType = apps.get_model("contenttypes", "ContentType")
    Permission = apps.get_model("auth", "Permission")
    Group = apps.get_model("auth", "Group")
    content_type, _ = ContentType.objects.using(alias).get_or_create(app_label="catalog", model="product")
    permission, _ = Permission.objects.using(alias).get_or_create(
        content_type=content_type, codename="view_inventory",
        defaults={"name": "Puede consultar y actualizar la copia del inventario"},
    )
    group = Group.objects.using(alias).filter(name="INOX · Gerencia").first()
    if group is not None:
        group.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0004_product_door_animation_and_more"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]
    operations = [
        migrations.AlterModelOptions(
            name="product",
            options={"ordering": ("order", "name", "pk"), "verbose_name": "producto",
                     "verbose_name_plural": "productos",
                     "permissions": [("view_inventory", "Puede consultar y actualizar la copia del inventario")]},
        ),
        migrations.RunPython(preserve_management_inventory, migrations.RunPython.noop),
    ]
