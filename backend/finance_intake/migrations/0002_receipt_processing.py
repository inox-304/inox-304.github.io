import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import finance_intake.models


class Migration(migrations.Migration):
    dependencies = [("finance_intake", "0001_initial"), ("finance", "0001_initial")]

    operations = [
        migrations.AlterField("intakeaudit", "actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
        migrations.AddField("intakemessage", "receiver_phone_number_id", models.CharField(blank=True, editable=False, max_length=64)),
        migrations.AddField("intakemessage", "processing_state", models.CharField(choices=[("manual", "Recepción manual"), ("queued", "Foto en cola"), ("processing", "Leyendo foto"), ("retry", "Reintento pendiente"), ("review", "Completar y revisar"), ("drafted", "Borrador automático por revisar"), ("cancelled", "Procesamiento detenido")], default="manual", editable=False, max_length=16)),
        migrations.AddField("intakemessage", "processing_attempts", models.PositiveSmallIntegerField(default=0, editable=False)),
        migrations.AddField("intakemessage", "processing_version", models.PositiveIntegerField(default=1, editable=False)),
        migrations.AddField("intakemessage", "draft_generation", models.PositiveSmallIntegerField(default=0, editable=False)),
        migrations.AddField("intakemessage", "processing_available_at", models.DateTimeField(blank=True, editable=False, null=True)),
        migrations.AddField("intakemessage", "processing_lease_token", models.UUIDField(blank=True, editable=False, null=True)),
        migrations.AddField("intakemessage", "processing_lease_until", models.DateTimeField(blank=True, editable=False, null=True)),
        migrations.AddField("intakemessage", "processing_error_code", models.CharField(blank=True, editable=False, max_length=48)),
        migrations.AddField("intakemessage", "processed_at", models.DateTimeField(blank=True, editable=False, null=True)),
        migrations.AddField("intakemessage", "original_file", models.FileField(blank=True, editable=False, max_length=220, upload_to=finance_intake.models.original_image_path)),
        migrations.AddField("intakemessage", "original_name", models.CharField(blank=True, editable=False, max_length=180)),
        migrations.AddField("intakemessage", "original_content_type", models.CharField(blank=True, editable=False, max_length=64)),
        migrations.AddField("intakemessage", "original_size", models.PositiveIntegerField(default=0, editable=False)),
        migrations.AddField("intakemessage", "original_sha256", models.CharField(blank=True, db_index=True, editable=False, max_length=64)),
        migrations.AddField("intakemessage", "ocr_text", models.TextField(blank=True, editable=False, max_length=60000)),
        migrations.AddField("intakemessage", "ocr_fields", models.JSONField(blank=True, default=dict, editable=False)),
        migrations.AddField("intakemessage", "ocr_warnings", models.JSONField(blank=True, default=list, editable=False)),
        migrations.AddField("intakemessage", "proposed_company", models.ForeignKey(blank=True, editable=False, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="proposed_receipts", to="finance.company")),
        migrations.AddIndex("intakemessage", models.Index(fields=["processing_state", "processing_available_at"], name="finance_inbox_jobs")),
    ]
