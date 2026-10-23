"""Persistent cache, stale-worker fencing and real PostgreSQL contention."""
import copy
import os
import queue
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from django.db import DatabaseError, close_old_connections, connection
from django.test import TransactionTestCase, override_settings

from .inventory import (InventoryError, export_inventory_state, import_inventory_state,
                        load_snapshot, save_snapshot)
from .inventory_sync import LEASE_SECONDS, refresh_inventory, sync_status
from .models import InventorySyncState
from .test_inventory import sample


@override_settings(INOX_INVENTORY_PERSISTENCE="database")
class InventoryDatabaseTests(TransactionTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="inox-inventory-db-test-")
        self.addCleanup(self.directory.cleanup)
        self.settings_override = override_settings(DATA_DIR=Path(self.directory.name))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        env = patch.dict(os.environ, {"INOX_INVENTORY_REFRESH_ENABLED": "1",
                                     "INOX_INVENTORY_SHEET_ID": sample()["spreadsheetId"]})
        env.start()
        self.addCleanup(env.stop)

    def test_status_is_read_only_and_does_not_create_row_or_contact_google(self):
        with patch("catalog.inventory_sync.fetch_sheet") as fetch:
            self.assertEqual(sync_status()["state"], "waiting")
            self.assertIsNone(load_snapshot())
        self.assertFalse(InventorySyncState.objects.exists())
        fetch.assert_not_called()

    def test_cache_and_status_survive_replacing_ephemeral_data_directory(self):
        with patch("catalog.inventory_sync.fetch_sheet", return_value=sample()):
            result = refresh_inventory()
        with tempfile.TemporaryDirectory() as empty, override_settings(DATA_DIR=Path(empty)):
            self.assertEqual(load_snapshot(), sample())
            self.assertEqual(sync_status()["state"], "connected")
            self.assertEqual(sync_status()["revision"], result["revision"])
            self.assertEqual(list(Path(empty).iterdir()), [])
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    def test_valid_refresh_throttles_and_invalid_refresh_preserves_copy(self):
        save_snapshot(sample())
        updated = sample()
        updated["inventory"][0][8] = 9
        with patch("catalog.inventory_sync.time.time", return_value=1000), \
                patch("catalog.inventory_sync.fetch_sheet", return_value=updated) as fetch:
            self.assertTrue(refresh_inventory()["changed"])
            self.assertFalse(refresh_inventory()["refreshed"])
            fetch.assert_called_once()
        invalid = copy.deepcopy(updated)
        invalid["recipes"][0][0] = "NOT-A-PRODUCT"
        with patch("catalog.inventory_sync.time.time", return_value=1061), \
                patch("catalog.inventory_sync.fetch_sheet", return_value=invalid) as fetch:
            self.assertEqual(refresh_inventory()["state"], "error")
            self.assertFalse(refresh_inventory()["refreshed"])
            fetch.assert_called_once()
        self.assertEqual(load_snapshot(), updated)
        row = InventorySyncState.objects.get(pk=1)
        self.assertEqual(row.status["verified"], 1000)
        self.assertEqual(row.lease_token, "")
        self.assertIsNone(row.lease_expires_at)

    def test_active_lease_blocks_other_worker_and_crashed_lease_expires(self):
        started = datetime.fromtimestamp(1000, timezone.utc)
        InventorySyncState.objects.create(pk=1, snapshot=sample(), lease_token="crashed-worker",
            lease_expires_at=started + timedelta(seconds=LEASE_SECONDS),
            status={"spreadsheetId": sample()["spreadsheetId"], "attempted": 1000})
        with patch("catalog.inventory_sync.time.time", return_value=1001), \
                patch("catalog.inventory_sync.fetch_sheet") as fetch:
            self.assertTrue(refresh_inventory()["busy"])
            fetch.assert_not_called()
        with patch("catalog.inventory_sync.time.time", return_value=1121), \
                patch("catalog.inventory_sync.fetch_sheet", return_value=sample()) as fetch:
            self.assertTrue(refresh_inventory()["refreshed"])
            fetch.assert_called_once()

    def test_late_response_cannot_overwrite_new_worker_snapshot_or_status(self):
        self._late_response_rejected(fails=False)

    def test_late_failure_cannot_replace_new_worker_success_status(self):
        self._late_response_rejected(fails=True)

    def _late_response_rejected(self, *, fails):
        save_snapshot(sample())
        clock = [1000]
        newer = sample()
        newer["inventory"][0][8] = 17

        def old_worker_fetch(_source):
            self.assertFalse(connection.in_atomic_block)
            clock[0] = 1121
            with patch("catalog.inventory_sync.fetch_sheet", return_value=newer):
                self.assertTrue(refresh_inventory()["refreshed"])
            if fails:
                raise InventoryError("Old connection failed.")
            return sample()

        with patch("catalog.inventory_sync.time.time", side_effect=lambda: clock[0]), \
                patch("catalog.inventory_sync.fetch_sheet", side_effect=old_worker_fetch):
            result = refresh_inventory()
        self.assertFalse(result["refreshed"])
        self.assertEqual(load_snapshot(), newer)
        row = InventorySyncState.objects.get(pk=1)
        self.assertEqual(row.status["verified"], 1121)
        self.assertEqual(row.status["error"], "")

    def test_expired_response_is_rejected_even_without_a_new_worker(self):
        save_snapshot(sample())
        clock = [1000]

        def slow(_source):
            clock[0] += LEASE_SECONDS + 1
            changed = sample()
            changed["inventory"][0][8] = 99
            return changed

        with patch("catalog.inventory_sync.time.time", side_effect=lambda: clock[0]), \
                patch("catalog.inventory_sync.fetch_sheet", side_effect=slow):
            self.assertFalse(refresh_inventory()["refreshed"])
        self.assertEqual(load_snapshot(), sample())

    def test_manual_import_fences_out_in_flight_response(self):
        save_snapshot(sample())
        imported = sample()
        imported["inventory"][0][8] = 42

        def in_flight(_source):
            import_inventory_state({"snapshot": imported, "status": {}})
            return sample()

        with patch("catalog.inventory_sync.fetch_sheet", side_effect=in_flight):
            self.assertFalse(refresh_inventory()["refreshed"])
        self.assertEqual(load_snapshot(), imported)

    def test_import_validates_before_write_and_never_restores_live_lease(self):
        payload = {"snapshot": sample(), "status": {"attempted": 1000}}
        import_inventory_state(payload, only_if_empty=True)
        self.assertEqual(export_inventory_state(), payload)
        self.assertEqual(InventorySyncState.objects.get(pk=1).lease_token, "")
        with self.assertRaises(InventoryError):
            import_inventory_state(payload, only_if_empty=True)
        for invalid in ({"snapshot": []}, {"snapshot": {"inventory": "broken"}},
                        {"snapshot": sample(), "status": {"error": "x" * 10001}}):
            with self.subTest(invalid=list(invalid)), self.assertRaises(InventoryError):
                import_inventory_state(invalid)
        self.assertEqual(export_inventory_state(), payload)

    def test_save_rejects_oversize_or_nonfinite_data_without_replacing_cache(self):
        save_snapshot(sample())
        for value in ("x" * 5_000_001, float("nan")):
            invalid = sample()
            invalid["extra"] = value
            with self.assertRaises(InventoryError):
                save_snapshot(invalid)
        self.assertEqual(load_snapshot(), sample())

    def test_database_error_is_sanitized(self):
        with patch.object(InventorySyncState.objects, "get_or_create",
                          side_effect=DatabaseError("postgres://private-password@secret-host")):
            result = refresh_inventory()
        self.assertEqual(result["state"], "error")
        self.assertNotIn("private-password", str(result))
        self.assertNotIn("secret-host", str(result))

    def test_postgres_competing_worker_returns_busy_without_holding_http_transaction(self):
        if connection.vendor != "postgresql":
            self.skipTest("Real cross-connection lease concurrency requires PostgreSQL.")
        save_snapshot(sample())
        entered, finish = threading.Event(), threading.Event()
        results = queue.Queue()

        def delayed_fetch(_source):
            if connection.in_atomic_block:
                raise AssertionError("HTTP must not run within a transaction")
            entered.set()
            if not finish.wait(5):
                raise AssertionError("Bounded concurrency test timed out")
            return sample()

        def first_worker():
            close_old_connections()
            try:
                results.put(refresh_inventory())
            except BaseException as error:
                results.put(error)
            finally:
                close_old_connections()

        with patch("catalog.inventory_sync.fetch_sheet", side_effect=delayed_fetch) as fetch:
            worker = threading.Thread(target=first_worker, daemon=True)
            worker.start()
            try:
                self.assertTrue(entered.wait(5))
                competing = refresh_inventory()
                self.assertTrue(competing["busy"])
            finally:
                finish.set()
                worker.join(5)
            self.assertFalse(worker.is_alive())
            fetch.assert_called_once()
        first = results.get(timeout=1)
        if isinstance(first, BaseException):
            raise first
        self.assertTrue(first["refreshed"])
