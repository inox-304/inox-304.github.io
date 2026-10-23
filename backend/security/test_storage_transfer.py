from io import StringIO
import json
from unittest.mock import patch
import zipfile

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TransactionTestCase, override_settings

from catalog.test_storage import OBJECT_STORAGES
from catalog.test_inventory import sample
from security.installation_transfer import state_payload, sequence_highwaters, TransferError
from security import test_installation_transfer as installation_tests


@override_settings(SECRET_KEY="synthetic-transfer-key-keep-stable-1234567890",
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ObjectInstallationTransferTests(TransactionTestCase):
    # Reuse the synthetic account/MFA/permissions fixture, not its filesystem
    # assertions. No test connects to real media, Google, mail or production DB.
    setUp = installation_tests.InstallationTransferTests.setUp
    export = installation_tests.InstallationTransferTests.export
    empty = installation_tests.InstallationTransferTests.empty
    restore = installation_tests.InstallationTransferTests.restore

    def test_local_to_remote_preserves_accounts_factors_ids_and_media_hashes(self):
        expected, sequences = state_payload(), sequence_highwaters()
        payload = (self.data / "media" / self.asset_name).read_bytes()
        self.export()
        self.empty()
        with override_settings(STORAGES=OBJECT_STORAGES):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(state_payload(), expected)
            self.assertEqual(sequence_highwaters(), sequences)
            self.assertEqual(default_storage.objects[self.asset_name], payload)
            self.assertFalse((self.data / "media").exists())
            second = self.root / "remote-export.zip"
            call_command("export_installation", str(second), stdout=StringIO())
            with zipfile.ZipFile(self.bundle) as first, zipfile.ZipFile(second) as after:
                before_manifest = json.loads(first.read("manifest.json"))
                after_manifest = json.loads(after.read("manifest.json"))
                self.assertEqual(before_manifest["files"], after_manifest["files"])
                self.assertEqual(first.read("database.json"), after.read("database.json"))

    def test_remote_upload_failure_rolls_back_database_and_partial_object(self):
        self.export()
        self.empty()
        expected = state_payload()
        with override_settings(STORAGES=OBJECT_STORAGES):
            default_storage.fail_after_write = True
            with self.assertRaisesMessage(CommandError, "interrupted upload"):
                self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(state_payload(), expected)
            self.assertEqual(default_storage.objects, {})

    def test_nonempty_remote_storage_refuses_import_without_deleting_anything(self):
        self.export()
        self.empty()
        expected = state_payload()
        with override_settings(STORAGES=OBJECT_STORAGES):
            default_storage.save("existing/private.txt", ContentFile(b"preserve"))
            with self.assertRaisesMessage(CommandError, "deben estar vacíos"):
                self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(default_storage.objects, {"existing/private.txt": b"preserve"})
            self.assertEqual(state_payload(), expected)

    def test_private_unreferenced_objects_are_kept_in_export(self):
        content = (self.data / "media" / self.asset_name).read_bytes()
        with override_settings(STORAGES=OBJECT_STORAGES):
            default_storage.save(self.asset_name, ContentFile(content))
            default_storage.save("private/orphan.bin", ContentFile(b"private orphan"))
            self.export()
            with zipfile.ZipFile(self.bundle) as archive:
                self.assertEqual(archive.read("media/private/orphan.bin"), b"private orphan")

    def test_local_inventory_is_imported_into_database_after_exact_account_check(self):
        from catalog.inventory import load_snapshot
        from catalog.models import InventorySyncState
        snapshot = sample()
        (self.data / "inventory/snapshot.json").write_text(json.dumps(snapshot), encoding="utf-8")
        expected_payloads, _ = state_payload()
        expected_records = json.loads(expected_payloads["database.json"])
        self.export()
        self.empty()
        with override_settings(STORAGES=OBJECT_STORAGES, INOX_INVENTORY_PERSISTENCE="database"):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(load_snapshot(), snapshot)
            self.assertEqual(InventorySyncState.objects.count(), 1)
            self.assertEqual(InventorySyncState.objects.get().lease_token, "")
            restored, _ = state_payload()
            without_inventory = [row for row in json.loads(restored["database.json"]) if row["model"] != "catalog.inventorysyncstate"]
            self.assertEqual(without_inventory, expected_records)

    def test_serialized_database_inventory_is_preserved_without_reimport(self):
        from catalog.inventory import save_snapshot
        with override_settings(INOX_INVENTORY_PERSISTENCE="database"):
            save_snapshot(sample())
            before = state_payload()
            self.export()
            with zipfile.ZipFile(self.bundle) as archive:
                self.assertNotIn("inventory/snapshot.json", archive.namelist())
            self.empty()
            with override_settings(STORAGES=OBJECT_STORAGES):
                with patch("catalog.inventory.import_inventory_state", side_effect=AssertionError("Already serialized")):
                    self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
                self.assertEqual(state_payload(), before)

    def test_cloud_to_local_materializes_inventory_without_changing_serialized_row(self):
        from catalog.inventory import export_inventory_state, import_inventory_state, load_snapshot
        snapshot = sample()
        status = {"spreadsheetId": snapshot["spreadsheetId"], "verified": 1000, "attempted": 1000}
        payload = (self.data / "media" / self.asset_name).read_bytes()
        with override_settings(INOX_INVENTORY_PERSISTENCE="database", STORAGES=OBJECT_STORAGES):
            default_storage.save(self.asset_name, ContentFile(payload))
            import_inventory_state({"snapshot": snapshot, "status": status})
            before = state_payload()
            self.export()
            self.empty()
        with override_settings(INOX_INVENTORY_PERSISTENCE="file"):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(state_payload(), before)
            self.assertEqual(load_snapshot(), snapshot)
            self.assertEqual(export_inventory_state(), {"snapshot": snapshot, "status": status})
            self.assertEqual((self.data / "media" / self.asset_name).read_bytes(), payload)

    def test_failed_cloud_to_local_cache_materialization_cleans_up_files_and_records(self):
        from catalog.inventory import save_snapshot
        from security import installation_transfer as transfer
        with override_settings(INOX_INVENTORY_PERSISTENCE="database"):
            save_snapshot(sample())
            self.export()
            self.empty()
        before = state_payload()
        original = transfer.install_local_file

        def fail_after_snapshot(name, *args):
            original(name, *args)
            if name == "inventory/snapshot.json":
                raise TransferError("synthetic cache materialization failure")

        with override_settings(INOX_INVENTORY_PERSISTENCE="file"), \
                patch.object(transfer, "install_local_file", side_effect=fail_after_snapshot):
            with self.assertRaisesMessage(CommandError, "cache materialization failure"):
                self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
        self.assertEqual(state_payload(), before)
        self.assertFalse((self.data / "inventory").exists())
        self.assertFalse((self.data / "media").exists())

    def test_second_transfer_uses_edited_local_cache_not_dormant_database_row(self):
        from catalog.inventory import load_snapshot, save_snapshot
        from catalog.models import InventorySyncState
        original = sample()
        updated = sample()
        updated["inventory"][0][8] = 47
        with override_settings(INOX_INVENTORY_PERSISTENCE="database"):
            save_snapshot(original)
            self.export()
            self.empty()
        with override_settings(INOX_INVENTORY_PERSISTENCE="file"):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(InventorySyncState.objects.get().snapshot, original)
            save_snapshot(updated)
            self.bundle = self.root / "second-installation.zip"
            self.export()
            with zipfile.ZipFile(self.bundle) as archive:
                self.assertEqual(json.loads(archive.read("manifest.json"))["inventory_persistence"], "file")
            self.empty()
        with override_settings(INOX_INVENTORY_PERSISTENCE="database", STORAGES=OBJECT_STORAGES):
            self.restore(confirm="RESTORE_EMPTY_INSTALLATION")
            self.assertEqual(load_snapshot(), updated)
