from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("security", "0002_securitystate_mfa_method_emaildevice_emailchallenge_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="emaildevice", name="delivery_paused_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="emaildevice", name="delivery_smtp_code",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
