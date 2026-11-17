"""Only synthetic receipts and in-memory test databases; no live provider calls."""
import hashlib
import io
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image

from finance.models import Account, Attachment, Audit, ClosedPeriod, Company, Movement
from finance.services import create_draft, post_movement
from .meta_media import DownloadedImage, MediaDownloadError
from .models import IntakeAudit, IntakeMessage
from .ocr import OCRReadError
from .processing import (PhotoJob, claim_next, create_reviewed_draft, process_job, process_next,
                         reject_automatic_draft, request_processing)
from .services import ignore_receipt, link_receipt

CONFIG = {
    "FINANCE_WHATSAPP_ENABLED": True, "FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED": True,
    "FINANCE_WHATSAPP_APP_SECRET": "synthetic-secret", "FINANCE_WHATSAPP_VERIFY_TOKEN": "synthetic-verify",
    "FINANCE_WHATSAPP_PHONE_NUMBER_ID": "123456", "FINANCE_WHATSAPP_OPERATOR_ID": "synthetic-operator",
    "FINANCE_WHATSAPP_OPERATOR_ID_KIND": "bsuid", "FINANCE_WHATSAPP_GROUP_CASH": "cash-group",
    "FINANCE_WHATSAPP_GROUP_YAPE": "yape-group", "FINANCE_WHATSAPP_GROUP_TRANSFER": "transfer-group",
    "SECURITY_OWNER_USERNAME": "owner@example.test", "PASSWORD_HASHERS": ["django.contrib.auth.hashers.MD5PasswordHasher"],
}
CAPTION = "Código empresa: INOX304; Tipo: egreso; Detalle: Material sintético"
OCR = {"text": "FECHA: 01/01/2026\nTOTAL S/ 118.00", "confidence": 0.95, "engine": "tesseract"}


@override_settings(**CONFIG)
class PhotoProcessingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("owner@example.test", is_staff=True)
        cls.other_user = get_user_model().objects.create_user("other@example.test", is_staff=True, is_superuser=True)
        cls.company = Company.objects.create(code="INOX304", name="INOX 304")
        cls.other_company = Company.objects.create(code="SHAMO", name="Shamo")
        cls.account = Account.objects.create(company=cls.company, code="CASH", name="Caja sintética", method="cash", currency="PEN")
        cls.other_account = Account.objects.create(company=cls.other_company, code="CASH", name="Otra caja sintética", method="cash", currency="PEN")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        media = override_settings(MEDIA_ROOT=self.directory.name)
        media.enable()
        self.addCleanup(media.disable)
        image = io.BytesIO()
        Image.new("RGB", (3, 3), "white").save(image, "PNG")
        self.raw = image.getvalue()
        self.downloaded = DownloadedImage(self.raw, "image/png", hashlib.sha256(self.raw).hexdigest())
        self.download = patch("finance_intake.meta_media.download_image", return_value=self.downloaded).start()
        self.ocr = patch("finance_intake.ocr.read_image", return_value=OCR.copy()).start()
        self.addCleanup(patch.stopall)

    def receipt(self, **kwargs):
        values = {"provider_message_id": str(uuid.uuid4()), "fingerprint": "a" * 64,
            "group_id": "cash-group", "method": "cash", "sender_id": "synthetic-operator", "sender_id_kind": "bsuid",
            "message_type": "image", "media": {"id": "789012", "mime_type": "image/png"}, "text": CAPTION,
            "receiver_phone_number_id": "123456", "processing_state": "queued", "processing_available_at": timezone.now()}
        return IntakeMessage.objects.create(**{**values, **kwargs})

    def process(self, receipt):
        job = claim_next()
        self.assertIsNotNone(job)
        self.assertEqual(job.receipt_id, receipt.pk)
        outcome = process_job(job)
        receipt.refresh_from_db()
        return outcome

    def values(self, **extra):
        return {"company": self.company, "account": self.account, "kind": "expense", "occurred_on": date(2026, 1, 1),
                "amount": Decimal("118.00"), "currency": "PEN", "description": "Revisado por la persona", **extra}

    def test_explicit_photo_creates_one_private_draft_never_confirms_it(self):
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "drafted")
        movement = receipt.movement
        self.assertEqual((movement.company_id, movement.account_id, movement.amount), (self.company.pk, self.account.pk, Decimal("118.00")))
        self.assertEqual((movement.status, movement.source), ("draft", "whatsapp"))
        self.assertIsNone(movement.posted_at)
        self.assertIsNone(receipt.reviewed_at)
        self.assertIsNone(receipt.reviewed_by_id)
        self.assertEqual(receipt.processing_state, "drafted")
        self.assertEqual(receipt.original_sha256, hashlib.sha256(self.raw).hexdigest())
        self.assertTrue(receipt.original_file.name.startswith("finance/whatsapp/"))
        self.assertEqual(Attachment.objects.get().sha256, receipt.original_sha256)
        self.assertTrue(Audit.objects.filter(action="whatsapp_auto_draft").exists())
        self.assertFalse(process_next())
        self.assertEqual(Movement.objects.count(), 1)

    def test_historical_manual_rows_and_disabled_jobs_are_not_picked_up(self):
        self.receipt(processing_state="manual", receiver_phone_number_id="")
        self.assertIsNone(claim_next())
        queued = self.receipt()
        with override_settings(FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED=False):
            self.assertIsNone(claim_next())
        queued.refresh_from_db()
        self.assertEqual(queued.processing_attempts, 0)
        self.download.assert_not_called()

    def test_missing_company_preserves_photo_and_suggestions_without_movement(self):
        receipt = self.receipt(text="Tipo: egreso")
        self.assertEqual(self.process(receipt), "review")
        self.assertEqual(receipt.processing_error_code, "company_required")
        self.assertEqual(receipt.ocr_fields["amount"], "118.00")
        self.assertTrue(any("Selecciona la empresa" in warning for warning in receipt.ocr_warnings))
        self.assertTrue(receipt.original_file)
        self.assertEqual(Movement.objects.count(), 0)

    def test_company_type_and_financial_conflicts_never_guess_a_draft(self):
        for caption, text, confidence in [
            ("Código empresa: INOX304; Empresa: Shamo; Tipo: egreso", OCR["text"], 0.95),
            ("Código empresa: INOX304", OCR["text"], 0.95),
            (CAPTION, "FECHA: 01/01/2026\nTOTAL S/ 118.00\nTOTAL S/ 90.00", 0.95),
            (CAPTION, OCR["text"], 0.4),
        ]:
            with self.subTest(caption=caption, text=text, confidence=confidence):
                receipt = self.receipt(text=caption)
                self.ocr.return_value = {**OCR, "text": text, "confidence": confidence}
                self.assertEqual(self.process(receipt), "review")
                self.assertEqual(Movement.objects.count(), 0)

    def test_inactive_company_closed_period_and_ambiguous_accounts_require_review(self):
        self.company.active = False
        self.company.save()
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "review")
        self.assertEqual(receipt.processing_error_code, "company_inactive")
        self.company.active = True
        self.company.save()
        ClosedPeriod.objects.create(company=self.company, year=2026, month=1, closed_by=self.owner)
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "review")
        self.assertEqual(Movement.objects.count(), 0)
        ClosedPeriod.objects.all().delete()
        Account.objects.create(company=self.company, code="SECOND", name="Otra caja", method="cash", currency="PEN")
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "review")
        self.assertEqual(receipt.processing_error_code, "account_required")

    def test_explicit_account_selects_only_active_matching_company_method_and_currency(self):
        Account.objects.create(company=self.company, code="SECOND", name="Otra caja", method="cash", currency="PEN")
        receipt = self.receipt(text=CAPTION + "; Cuenta: CASH")
        self.assertEqual(self.process(receipt), "drafted")
        self.assertEqual(receipt.movement.account_id, self.account.pk)

    def test_same_photo_same_company_does_not_duplicate_an_existing_draft(self):
        first = self.receipt()
        self.assertEqual(self.process(first), "drafted")
        second = self.receipt()
        self.assertEqual(self.process(second), "review")
        self.assertEqual(second.processing_error_code, "duplicate_photo")
        self.assertEqual(Movement.objects.count(), 1)

    def test_same_photo_may_belong_to_different_explicit_companies(self):
        first = self.receipt()
        self.assertEqual(self.process(first), "drafted")
        second = self.receipt(text=CAPTION.replace("INOX304", "SHAMO"))
        self.assertEqual(self.process(second), "drafted")
        self.assertEqual(Movement.objects.count(), 2)

    def test_retry_uses_saved_original_and_bounded_backoff(self):
        receipt = self.receipt()
        self.ocr.side_effect = OCRReadError("ocr_timeout", "Synthetic OCR timeout")
        for attempt in range(1, 4):
            self.assertEqual(self.process(receipt), "retry" if attempt < 3 else "review")
            self.assertEqual(receipt.processing_attempts, attempt)
            if attempt < 3:
                self.assertGreater(receipt.processing_available_at, timezone.now())
                self.assertIsNone(claim_next())
                IntakeMessage.objects.filter(pk=receipt.pk).update(processing_available_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.download.call_count, 1)
        self.assertEqual(Movement.objects.count(), 0)

    def test_permanent_download_failure_never_retries_or_persists_provider_details(self):
        receipt = self.receipt()
        self.download.side_effect = MediaDownloadError("media_not_found")
        self.assertEqual(self.process(receipt), "review")
        self.assertFalse(receipt.original_file)
        self.assertEqual(receipt.processing_error_code, "media_not_found")
        self.assertIsNone(claim_next())

    def test_operational_failures_give_safe_actionable_pending_warnings(self):
        receipt = self.receipt()
        self.download.side_effect = MediaDownloadError("media_not_configured")
        self.assertEqual(self.process(receipt), "review")
        self.assertTrue(any("configurar el acceso privado" in warning for warning in receipt.ocr_warnings))
        receipt = self.receipt()
        self.download.side_effect = None
        self.ocr.side_effect = OCRReadError("ocr_unavailable", "private-command-path-must-not-be-shown")
        self.assertEqual(self.process(receipt), "retry")
        self.assertTrue(any("Revisa su instalación" in warning for warning in receipt.ocr_warnings))
        self.assertNotIn("private-command-path", " ".join(receipt.ocr_warnings))

    def test_manual_retry_of_truncated_caption_can_fetch_photo_but_never_auto_draft(self):
        receipt = self.receipt(processing_state="review", processing_error_code="caption_too_long",
            media={"id": "789012", "mime_type": "image/png", "caption_truncated": True})
        request_processing(receipt.pk, self.owner, receipt.processing_version)
        self.assertEqual(self.process(receipt), "review")
        self.assertEqual(receipt.processing_error_code, "conflicting_fields")
        self.assertTrue(receipt.original_file)
        self.assertTrue(any("recortado" in warning for warning in receipt.ocr_warnings))
        self.assertEqual(Movement.objects.count(), 0)

    def test_stale_lease_cannot_finish_after_a_replacement_claim(self):
        receipt = self.receipt()
        old = claim_next()
        self.assertIsNone(claim_next())
        IntakeMessage.objects.filter(pk=receipt.pk).update(processing_lease_until=timezone.now() - timedelta(seconds=1))
        replacement = claim_next()
        self.assertNotEqual(old.lease_token, replacement.lease_token)
        self.assertEqual(process_job(old), "stale")
        self.download.assert_not_called()
        self.assertEqual(process_job(replacement), "drafted")
        self.assertEqual(process_job(replacement), "stale")
        self.assertEqual(Movement.objects.count(), 1)

    def test_expired_third_attempt_stops_instead_of_looping_forever(self):
        receipt = self.receipt(processing_state="processing", processing_attempts=3,
            processing_lease_token=uuid.uuid4(), processing_lease_until=timezone.now() - timedelta(seconds=1))
        self.assertIsNone(claim_next())
        receipt.refresh_from_db()
        self.assertEqual(receipt.processing_error_code, "attempts_exhausted")

    def test_ignore_during_ocr_wins_and_prevents_new_draft(self):
        receipt = self.receipt()
        def reading(*args):
            ignore_receipt(receipt.pk, "Comprobante descartado por la persona", actor=self.owner)
            return OCR
        self.ocr.side_effect = reading
        self.assertEqual(self.process(receipt), "stale")
        self.assertEqual(receipt.status, "ignored")
        self.assertEqual(Movement.objects.count(), 0)
        self.assertTrue(receipt.original_file)

    def test_manual_link_during_ocr_wins_without_overwriting_human_actor(self):
        receipt = self.receipt()
        manual = create_draft(self.values(), self.owner)
        def reading(*args):
            link_receipt(receipt.pk, manual, actor=self.owner)
            return OCR
        self.ocr.side_effect = reading
        self.assertEqual(self.process(receipt), "stale")
        self.assertEqual(receipt.movement_id, manual.pk)
        self.assertEqual(receipt.reviewed_by_id, self.owner.pk)
        self.assertEqual(Movement.objects.count(), 1)
        self.assertEqual(manual.attachments.get().sha256, receipt.original_sha256)

    def test_allowlist_or_owner_revocation_after_ocr_prevents_writes(self):
        receipt = self.receipt()
        def reading(*args):
            get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
            return OCR
        self.ocr.side_effect = reading
        self.assertIn(self.process(receipt), ("review", "cancelled"))
        self.assertEqual(Movement.objects.count(), 0)

    def test_source_revocation_before_work_prevents_even_media_download(self):
        receipt = self.receipt()
        job = claim_next()
        with override_settings(FINANCE_WHATSAPP_OPERATOR_ID="changed-operator"):
            self.assertEqual(process_job(job), "cancelled")
        self.download.assert_not_called()

    def test_human_corrections_create_only_draft_and_require_fresh_version_owner_and_original(self):
        receipt = self.receipt(text="Tipo: egreso")
        self.assertEqual(self.process(receipt), "review")
        version = receipt.processing_version
        with self.assertRaises(PermissionDenied):
            create_reviewed_draft(receipt.pk, self.values(), self.other_user, version)
        with self.assertRaises(ValidationError):
            create_reviewed_draft(receipt.pk, self.values(), self.owner, version - 1)
        movement = create_reviewed_draft(receipt.pk, self.values(), self.owner, version)
        receipt.refresh_from_db()
        self.assertEqual(movement.status, "draft")
        self.assertEqual(receipt.reviewed_by_id, self.owner.pk)
        with self.assertRaises(ValidationError):
            create_reviewed_draft(receipt.pk, self.values(), self.owner, version)
        self.assertEqual(Movement.objects.count(), 1)

    def test_human_retries_are_explicit_and_cannot_requeue_linked_or_stale_state(self):
        receipt = self.receipt()
        self.download.side_effect = MediaDownloadError("temporary_error", retryable=True)
        self.assertEqual(self.process(receipt), "retry")
        with self.assertRaises(PermissionDenied):
            request_processing(receipt.pk, self.other_user, receipt.processing_version)
        with self.assertRaises(ValidationError):
            request_processing(receipt.pk, self.owner, receipt.processing_version - 1)
        request_processing(receipt.pk, self.owner, receipt.processing_version)
        receipt.refresh_from_db()
        self.assertEqual(receipt.processing_attempts, 0)
        self.download.side_effect = None
        self.assertEqual(self.process(receipt), "drafted")
        with self.assertRaises(ValidationError):
            request_processing(receipt.pk, self.owner, receipt.processing_version)

    def test_storage_save_failure_does_not_create_a_movement(self):
        receipt = self.receipt()
        with patch.object(IntakeMessage._meta.get_field("original_file").storage, "save", side_effect=OSError("synthetic storage failure")):
            self.assertEqual(self.process(receipt), "retry")
        self.assertFalse(receipt.original_file)
        self.assertEqual(Movement.objects.count(), 0)

    def test_failed_orphan_cleanup_raises_only_a_safe_operational_alert(self):
        receipt = self.receipt()
        actual_save = IntakeMessage.save
        def fail_checkpoint(row, *args, **kwargs):
            if "original_file" in (kwargs.get("update_fields") or []):
                raise OSError("private-provider-diagnostic")
            return actual_save(row, *args, **kwargs)
        storage = IntakeMessage._meta.get_field("original_file").storage
        with patch.object(IntakeMessage, "save", fail_checkpoint), patch.object(storage, "delete", side_effect=OSError("private-delete-diagnostic")):
            with self.assertLogs("finance_intake.processing", level="WARNING") as logs:
                self.assertEqual(self.process(receipt), "retry")
        self.assertIn("private_cleanup_failed", " ".join(logs.output))
        self.assertNotIn("private-provider-diagnostic", " ".join(logs.output))
        self.assertNotIn("private-delete-diagnostic", " ".join(logs.output))
        self.assertFalse(receipt.original_file)
        self.assertEqual(Movement.objects.count(), 0)

    def test_attachment_failure_rolls_back_draft_and_preserves_private_original(self):
        receipt = self.receipt()
        with patch("finance_intake.processing.finance_services.attach_document", side_effect=OSError("synthetic storage failure")):
            self.assertEqual(self.process(receipt), "retry")
        self.assertEqual(Movement.objects.count(), 0)
        self.assertTrue(receipt.original_file)
        self.assertEqual(Attachment.objects.count(), 0)

    def test_failure_after_attachment_removes_new_file_and_rolls_back_draft(self):
        from pathlib import Path
        receipt = self.receipt()
        original_save = IntakeAudit.save
        def fail_audit(event, *args, **kwargs):
            if event.action == "auto_draft":
                raise OSError("Synthetic finalization failure")
            return original_save(event, *args, **kwargs)
        with patch.object(IntakeAudit, "save", fail_audit):
            self.assertEqual(self.process(receipt), "retry")
        self.assertEqual(Movement.objects.count(), 0)
        self.assertEqual(Attachment.objects.count(), 0)
        self.assertEqual(len(list(Path(self.directory.name).rglob("*.png"))), 1)

    def test_tampered_original_is_not_used_for_manual_financial_write(self):
        receipt = self.receipt(text="Tipo: egreso")
        self.assertEqual(self.process(receipt), "review")
        with receipt.original_file.storage.open(receipt.original_file.name, "wb") as target:
            target.write(b"changed synthetic original")
        with self.assertRaises(ValidationError):
            create_reviewed_draft(receipt.pk, self.values(), self.owner, receipt.processing_version)
        self.assertEqual(Movement.objects.count(), 0)

    def test_company_correction_voids_only_unreviewed_draft_and_preserves_history(self):
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "drafted")
        old = receipt.movement
        reject_automatic_draft(receipt.pk, self.owner, receipt.processing_version, "La empresa correcta es Shamo")
        receipt.refresh_from_db()
        old.refresh_from_db()
        self.assertEqual(old.status, "void")
        self.assertEqual(old.company_id, self.company.pk)
        self.assertIsNone(receipt.movement_id)
        replacement = create_reviewed_draft(receipt.pk, self.values(company=self.other_company, account=self.other_account), self.owner, receipt.processing_version)
        self.assertEqual(replacement.company_id, self.other_company.pk)
        self.assertNotEqual(replacement.idempotency_key, old.idempotency_key)
        self.assertEqual(Attachment.objects.count(), 2)
        self.assertEqual(Movement.objects.filter(status="posted").count(), 0)

    def test_reclassification_rejects_confirmed_movements(self):
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "drafted")
        post_movement(receipt.movement_id, self.owner, receipt.movement.version)
        with self.assertRaises(ValidationError):
            reject_automatic_draft(receipt.pk, self.owner, receipt.processing_version, "Una corrección que requiere revisión")
        receipt.movement.refresh_from_db()
        self.assertEqual(receipt.movement.status, "posted")

    def test_reclassification_does_not_discard_later_manual_edits(self):
        from finance.services import update_draft
        receipt = self.receipt()
        self.assertEqual(self.process(receipt), "drafted")
        update_draft(receipt.movement_id, {"description": "Corrección humana posterior"}, self.owner, 1)
        with self.assertRaises(ValidationError):
            reject_automatic_draft(receipt.pk, self.owner, receipt.processing_version, "La empresa requiere corregirse")
        receipt.movement.refresh_from_db()
        self.assertEqual(receipt.movement.status, "draft")
        self.assertEqual(receipt.movement.description, "Corrección humana posterior")


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row locking required")
@override_settings(**CONFIG)
class PhotoConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        media = override_settings(MEDIA_ROOT=self.directory.name)
        media.enable()
        self.addCleanup(media.disable)
        get_user_model().objects.create_user("owner@example.test", is_staff=True)
        self.company = Company.objects.create(code="INOX304", name="INOX 304")
        Account.objects.create(company=self.company, code="CASH", name="Caja sintética", method="cash", currency="PEN")
        image = io.BytesIO()
        Image.new("RGB", (3, 3), "white").save(image, "PNG")
        self.raw = image.getvalue()

    def receipt(self):
        return IntakeMessage.objects.create(provider_message_id=str(uuid.uuid4()), fingerprint="a" * 64,
            group_id="cash-group", method="cash", sender_id="synthetic-operator", sender_id_kind="bsuid",
            message_type="image", media={"id": "789012", "mime_type": "image/png"}, text=CAPTION,
            receiver_phone_number_id="123456", processing_state="queued", processing_available_at=timezone.now())

    def test_parallel_claims_get_distinct_receipts(self):
        self.receipt()
        self.receipt()
        barrier = Barrier(2)
        def claim():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return claim_next()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(claim) for _ in range(2)]
            jobs = [future.result(timeout=15) for future in futures]
        self.assertEqual(len({job.receipt_id for job in jobs}), 2)
        self.assertEqual(len({job.lease_token for job in jobs}), 2)

    def test_parallel_same_photo_same_company_creates_only_one_draft(self):
        self.receipt()
        self.receipt()
        jobs = [claim_next(), claim_next()]
        barrier = Barrier(2)
        downloaded = DownloadedImage(self.raw, "image/png", hashlib.sha256(self.raw).hexdigest())
        def read_image(*args):
            barrier.wait(timeout=10)
            return OCR.copy()
        def process(job):
            close_old_connections()
            try:
                return process_job(job)
            finally:
                connections.close_all()
        with patch("finance_intake.meta_media.download_image", return_value=downloaded), patch("finance_intake.ocr.read_image", side_effect=read_image):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(process, job) for job in jobs]
                outcomes = [future.result(timeout=20) for future in futures]
        self.assertEqual(sorted(outcomes), ["drafted", "review"])
        self.assertEqual(Movement.objects.count(), 1)
        self.assertEqual(Attachment.objects.count(), 1)
        self.assertEqual(IntakeMessage.objects.filter(processing_error_code="duplicate_photo").count(), 1)
