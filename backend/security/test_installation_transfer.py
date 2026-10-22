from datetime import timedelta
from io import StringIO
import json
from pathlib import Path
import shutil
import tempfile
from unittest.mock import patch
import zipfile

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.core.management.base import CommandError
from django.contrib.sessions.models import Session
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from catalog.models import AuditLog, MediaAsset, Product
from security.installation_transfer import canonical, signature, state_payload, sequence_highwaters, TransferError
from security.models import (EmailDevice, EnrollmentPermission, PasskeyDevice, PasskeyIdentity,
                             RecoveryCode, RecoveryDevice, SecurityEvent, SecurityState)


@override_settings(SECRET_KEY="synthetic-transfer-key-keep-stable-1234567890",
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class InstallationTransferTests(TransactionTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="inox-transfer-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.overrides = override_settings(DATA_DIR=self.data, MEDIA_ROOT=self.data / "media",
                                          STATIC_ROOT=self.data / "admin-static", FRONTEND_DIST=self.root / "public")
        self.overrides.enable()
        self.addCleanup(self.overrides.disable)
        self.bundle = self.root / "private-installation.zip"
        self.user = get_user_model().objects.create_user("owner@example.com", "owner@example.com", "Synthetic password!", is_staff=True, is_superuser=True)
        state = SecurityState.objects.create(user=self.user, session_version=9, mfa_method="email")
        EmailDevice.objects.create(user=self.user, email=self.user.email, confirmed=True)
        TOTPDevice.objects.create(user=self.user, confirmed=True, key="ab" * 20)
        device = RecoveryDevice.objects.create(user=self.user, confirmed=True)
        RecoveryCode.objects.create(device=device, selector="12345678", token_hash="synthetic-recovery-hash")
        PasskeyIdentity.objects.create(user=self.user)
        PasskeyDevice.objects.create(user=self.user, name="Synthetic passkey", credential_id="synthetic-credential", public_key=b"\x00\xfftest", sign_count=12, rp_id="panel.example.com", origin="https://panel.example.com", confirmed=True)
        EnrollmentPermission.objects.create(user=self.user, expires_at=timezone.now(), used_at=timezone.now())
        SecurityEvent.objects.create(user=self.user, event="synthetic_existing_event")
        Session.objects.create(session_key="synthetic-transfer-session", session_data="synthetic-signed-session", expire_date=timezone.now() + timedelta(days=1))
        group = Group.objects.create(name="Synthetic managers")
        permission = Permission.objects.get(content_type__app_label="catalog", codename="view_product")
        group.permissions.add(permission)
        self.user.groups.add(group)
        self.user.user_permissions.add(permission)
        deleted = get_user_model().objects.create_user("deleted@example.com")
        self.deleted_user_id = deleted.pk
        deleted.delete()
        # Deliberate identity gaps catch lost PKs in automatic M2M relations.
        through = get_user_model().groups.through
        row = through.objects.get()
        through.objects.filter(pk=row.pk).update(id=row.pk + 30)
        self.asset_name = "catalog/11111111-1111-4111-8111-111111111111.pdf"
        asset = MediaAsset.objects.create(name="Synthetic document", kind="pdf", file=self.asset_name, content_type="application/pdf")
        Product.objects.create(code="TEST-01", slug="synthetic-product", name="Synthetic product", category="linea-caliente", technical_asset=asset)
        target = self.data / "media" / self.asset_name
        target.parent.mkdir(parents=True)
        target.write_bytes(b"%PDF-1.4 synthetic transfer fixture")
        (self.data / "inventory").mkdir()
        (self.data / "inventory" / "snapshot.json").write_text('{"synthetic":true}', encoding="utf-8")
        (self.data / ".development-secret").write_text("must-not-export-runtime-secret", encoding="utf-8")
        (self.data / "credentials").mkdir()
        (self.data / "credentials" / "google.json").write_text("must-not-export-google-key", encoding="utf-8")

    def export(self):
        output = StringIO()
        call_command("export_installation", str(self.bundle), stdout=output)
        self.assertNotIn(self.user.password, output.getvalue())
        return output.getvalue()

    def empty(self):
        call_command("flush", interactive=False, verbosity=0)
        for name in ("media", "inventory"):
            target = (self.data / name).resolve()
            self.assertTrue(target.is_relative_to(self.root.resolve()))
            if target.exists():
                shutil.rmtree(target)

    def restore(self, **kwargs):
        output = StringIO()
        call_command("import_installation", str(self.bundle), stdout=output, **kwargs)
        return output.getvalue()

    def rewrite(self, change):
        with zipfile.ZipFile(self.bundle) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        manifest = json.loads(entries["manifest.json"])
        manifest.pop("signature")
        change(entries, manifest)
        manifest["signature"] = signature(manifest)
        entries["manifest.json"] = canonical(manifest)
        with zipfile.ZipFile(self.bundle, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, payload in entries.items():
                archive.writestr(name, payload)

    def test_complete_roundtrip_keeps_rows_relation_ids_mfa_audit_sessions_and_files(self):
        before, counts = state_payload()
        sequences = sequence_highwaters()
        expected_media = (self.data / "media" / self.asset_name).read_bytes()
        self.export()
        with zipfile.ZipFile(self.bundle) as archive:
            self.assertEqual(set(archive.namelist()), {"manifest.json", "database.json", "relations.json", "media/" + self.asset_name, "inventory/snapshot.json"})
            self.assertNotIn(settings.SECRET_KEY.encode(), archive.read("manifest.json"))
        self.empty()
        empty_state = state_payload()
        self.assertIn("no se restauró", self.restore(check=True))
        self.assertEqual(state_payload(), empty_state)
        self.assertFalse((self.data / "media").exists())
        self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), (before, counts))
        self.assertEqual(sequence_highwaters(), sequences)
        self.assertEqual((self.data / "media" / self.asset_name).read_bytes(), expected_media)
        self.assertEqual((self.data / "inventory/snapshot.json").read_text(), '{"synthetic":true}')
        user = get_user_model().objects.get(pk=self.user.pk)
        self.assertTrue(user.check_password("Synthetic password!"))
        self.assertEqual(SecurityState.objects.get().session_version, 9)
        self.assertGreater(get_user_model().objects.create_user("next@example.com").pk, self.deleted_user_id)

    def test_timestamps_preserve_full_microseconds_and_stable_digests(self):
        # 123 previously exported as .000 then became an integer second after
        # import, intermittently breaking the strict digest. Both cases must
        # preserve the actual database value, not merely normalize the hash.
        joined = timezone.now().replace(microsecond=123)
        seen = joined.replace(microsecond=123456)
        get_user_model().objects.filter(pk=self.user.pk).update(date_joined=joined, last_login=seen)
        before = state_payload()
        self.export()
        self.empty()
        self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        user = get_user_model().objects.get(pk=self.user.pk)
        self.assertEqual(user.date_joined, joined)
        self.assertEqual(user.last_login, seen)
        self.assertEqual(state_payload(), before)

    def test_postcommit_temporary_cleanup_failure_preserves_restored_media_and_records(self):
        from security import installation_transfer as transfer
        self.export()
        expected = state_payload()
        expected_media = (self.data / "media" / self.asset_name).read_bytes()
        self.empty()
        original_cleanup = transfer.tempfile.TemporaryDirectory.cleanup

        def cleanup_failure(temporary):
            original_cleanup(temporary)
            raise PermissionError("synthetic postcommit cleanup failure")

        with patch.object(transfer.tempfile.TemporaryDirectory, "cleanup", cleanup_failure):
            with self.assertRaisesMessage(CommandError, "La instalación se restauró"):
                self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), expected)
        self.assertEqual((self.data / "media" / self.asset_name).read_bytes(), expected_media)
        self.assertEqual((self.data / "inventory/snapshot.json").read_text(), '{"synthetic":true}')

    def test_nonempty_destination_aborts_without_touching_records_or_files(self):
        self.export()
        before = state_payload()
        with self.assertRaisesMessage(CommandError, "destino contiene cuentas o datos"):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), before)
        self.empty()
        (self.data / "media").mkdir()
        (self.data / "media/keep.txt").write_text("existing")
        with self.assertRaisesMessage(CommandError, "deben estar vacíos"):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual((self.data / "media/keep.txt").read_text(), "existing")

    def test_wrong_effective_key_and_damaged_payload_fail_before_import(self):
        self.export()
        self.empty()
        with override_settings(SECRET_KEY="different-private-key-long-enough-123456789"):
            with self.assertRaisesMessage(CommandError, "clave Django efectiva no coincide"):
                self.restore(check=True)
        self.rewrite(lambda entries, manifest: entries.__setitem__("database.json", b"[]"))
        with self.assertRaisesMessage(CommandError, "no permitido"):
            self.restore(check=True)
        self.assertFalse(get_user_model().objects.exists())

    def test_same_size_corruption_and_duplicate_members_are_rejected(self):
        self.export()
        original = self.bundle.read_bytes()
        self.empty()
        def corrupt(entries, manifest):
            data = entries["database.json"]
            entries["database.json"] = bytes([data[0] ^ 1]) + data[1:]
        self.rewrite(corrupt)
        with self.assertRaisesMessage(CommandError, "suma de verificación"):
            self.restore(check=True)
        self.bundle.write_bytes(original)
        import warnings
        with warnings.catch_warnings(), zipfile.ZipFile(self.bundle, "a") as archive:
            warnings.simplefilter("ignore", UserWarning)
            archive.writestr("database.json", b"[]")
        with self.assertRaisesMessage(CommandError, "duplicados"):
            self.restore(check=True)

    def test_traversal_and_unlisted_secret_paths_are_rejected_even_with_valid_signature(self):
        self.export()
        original = self.bundle.read_bytes()
        self.empty()
        for name in ("media/../escape", "media/../../escape", "credentials/google.json", "/absolute", "media\\escape", "media/CON", "media/trailing."):
            with self.subTest(name=name):
                self.bundle.write_bytes(original)
                def alter(entries, manifest):
                    import hashlib
                    entries[name] = b"attack"
                    manifest["files"][name] = {"size": 6, "sha256": hashlib.sha256(b"attack").hexdigest()}
                self.rewrite(alter)
                with self.assertRaises(CommandError):
                    self.restore(check=True)
                self.assertFalse(get_user_model().objects.exists())

    def test_invalid_foreign_key_rolls_back_generated_metadata_too(self):
        self.export()
        self.empty()
        before = state_payload()
        def alter(entries, manifest):
            import hashlib
            data = json.loads(entries["database.json"])
            row = next(item for item in data if item["model"] == "security.securitystate")
            row["fields"]["user"] = 999999
            payload = canonical(data)
            entries["database.json"] = payload
            manifest["files"]["database.json"] = {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        self.rewrite(alter)
        with self.assertRaises(CommandError):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), before)
        self.assertFalse((self.data / "media").exists())

    def test_schema_or_migration_difference_is_rejected(self):
        self.export()
        self.empty()
        self.rewrite(lambda entries, manifest: manifest["migrations"].append(["unknown", "9999_unknown"]))
        with self.assertRaisesMessage(CommandError, "migraciones, tablas o modelos no coinciden"):
            self.restore(check=True)

    def test_file_failure_rolls_back_database_and_removes_only_imported_files(self):
        from security import installation_transfer as transfer
        self.export()
        self.empty()
        before = state_payload()
        real_install = transfer.install_files
        def fail_after_install(*args):
            real_install(*args)
            raise TransferError("synthetic installation failure")
        with patch.object(transfer, "install_files", side_effect=fail_after_install):
            with self.assertRaisesMessage(CommandError, "synthetic installation failure"):
                self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), before)
        self.assertFalse((self.data / "media").exists())
        self.assertFalse((self.data / "inventory").exists())
        self.assertEqual((self.data / ".development-secret").read_text(), "must-not-export-runtime-secret")
        self.assertFalse(list(self.data.glob(".installation-import-*")))

    def test_sequence_failure_preserves_records_and_safe_non_decreasing_counters(self):
        from security import installation_transfer as transfer
        self.export()
        self.empty()
        before, counters = state_payload(), sequence_highwaters()
        real_restore, calls = transfer.restore_sequences, []
        def fail_once(values):
            real_restore(values)
            calls.append(True)
            if len(calls) == 1:
                raise TransferError("synthetic sequence failure")
        with patch.object(transfer, "restore_sequences", side_effect=fail_once):
            with self.assertRaisesMessage(CommandError, "synthetic sequence failure"):
                self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), before)
        self.assertTrue(all(sequence_highwaters()[name] >= value for name, value in counters.items()))
        self.assertFalse((self.data / "media").exists())
        self.assertFalse((self.data / "inventory").exists())

    def test_missing_media_existing_output_and_public_output_are_refused(self):
        self.export()
        original = self.bundle.read_bytes()
        with self.assertRaisesMessage(CommandError, "ya existe"):
            self.export()
        self.assertEqual(self.bundle.read_bytes(), original)
        with self.assertRaisesMessage(CommandError, "carpeta privada"):
            call_command("export_installation", str(settings.FRONTEND_DIST / "installation.zip"), stdout=StringIO())
        (self.data / "media" / self.asset_name).unlink()
        with self.assertRaisesMessage(CommandError, "Faltan archivos"):
            call_command("export_installation", str(self.root / "second.zip"), stdout=StringIO())
        self.assertFalse((self.root / "second.zip").exists())

    def test_size_limits_and_explicit_confirmation_are_enforced(self):
        self.export()
        self.empty()
        with patch("security.installation_transfer.MAX_ARCHIVE", 1):
            with self.assertRaisesMessage(CommandError, "límite de tamaño"):
                self.restore(check=True)
        with self.assertRaises(CommandError):
            self.restore()
