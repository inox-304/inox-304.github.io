from django.db import migrations


def seed_lease(apps, schema_editor):
    apps.get_model("model_imports", "WorkerLease").objects.get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [("model_imports", "0001_initial")]
    operations = [migrations.RunPython(seed_lease, migrations.RunPython.noop)]
