import copy
import json
import os
import tempfile
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, SimpleTestCase, override_settings
from django.urls import reverse

from .inventory import InventoryError, dashboard, project, save_snapshot, load_snapshot, manufacturing_plan
from .inventory_sync import refresh_inventory, sync_status, _refresh_lock


def sample():
    return {"schemaVersion": 1, "spreadsheetId": "test-inventory-sheet-123456789", "fetchedAt": "2026-10-22T10:00:00+00:00",
            "inventory": [["MP-1", "Plancha", "Materia prima", "plancha", "PEN", 10, 3, 3, 5, 0],
                          ["AC-1", "Perilla", "Accesorio", "unidad", "PEN", 2, 3, 3, "", 10],
                          ["EQ-1", "Cocina", "Producto terminado", "unidad", "PEN", "", 3, 3, "", ""]],
            "movements": [["2026-10-22", "M-001", "MP-1", "Traslado", 2, "Tienda", "Taller"]],
            "recipes": [["EQ-1", "MP-1", 2], ["EQ-1", "AC-1", 5]],
            "costs": [["EQ-1", "Cocina", "", 20, 100]]}


class InventoryProjectionTests(SimpleTestCase):
    def test_transfer_preserves_total_and_separates_units_and_locations(self):
        result = project(sample())
        plancha = result["items"][0]
        self.assertEqual(plancha["stock"], {"Tienda": Decimal(3), "Taller": Decimal(2)})
        self.assertEqual(sum(plancha["stock"].values()), 5)
        self.assertIsNone(result["items"][1]["stock"]["Tienda"])
        self.assertEqual(result["pending"], 3)
        filtered = dashboard(sample(), "Tienda", "plancha")
        self.assertEqual(len(filtered["rows"]), 1)
        self.assertEqual(filtered["low"], 1)
        self.assertEqual(filtered["monthly"][0]["Traslado"], 1)

    def test_costing_material_labor_profit_and_margin(self):
        cost = project(sample())["costs"][0]
        self.assertEqual(cost["materials"], 30)
        self.assertEqual(cost["total"], 50)
        self.assertEqual(cost["profit"], 50)
        self.assertEqual(cost["margin"], 50)
        self.assertEqual(cost["state"], "Completo")

    def test_missing_inputs_never_become_zero_cost_or_known_stock(self):
        data = sample()
        data["inventory"][0][5] = ""
        cost = project(data)["costs"][0]
        self.assertIsNone(cost["materials"])
        self.assertIsNone(cost["total"])
        self.assertIsNone(cost["margin"])
        data["inventory"][0][5] = 0
        self.assertEqual(project(data)["costs"][0]["materials"], 10)
        data["costs"][0][4] = 0
        self.assertIsNone(project(data)["costs"][0]["margin"])

    def test_different_currencies_are_not_added_to_fabrication_cost(self):
        data = sample()
        data["inventory"][0][4] = "USD"
        self.assertIsNone(project(data)["costs"][0]["materials"])

    def test_invalid_movements_and_duplicate_codes_reject_refresh(self):
        changes = [lambda d: d["movements"].append(copy.deepcopy(d["movements"][0])),
                   lambda d: d["movements"][0].__setitem__(4, -1),
                   lambda d: d["movements"][0].__setitem__(6, "Tienda"),
                   lambda d: d["movements"][0].__setitem__(2, "UNKNOWN"),
                   lambda d: d["inventory"].append(copy.deepcopy(d["inventory"][0])),
                   lambda d: d["inventory"][0].__setitem__(5, "NaN")]
        for change in changes:
            with self.subTest(change=change):
                data = sample()
                change(data)
                with self.assertRaises(InventoryError):
                    project(data)

    def test_failed_refresh_keeps_last_valid_snapshot(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(DATA_DIR=Path(directory)):
            save_snapshot(sample())
            original = load_snapshot()
            invalid = sample()
            invalid["inventory"][0][0] = ""
            with self.assertRaises(InventoryError):
                save_snapshot(invalid)
            self.assertEqual(load_snapshot(), original)

    def test_plan_combines_shared_materials_merma_and_labor_without_deducting(self):
        data = sample()
        data["inventory"][0][9] = 20
        data["inventory"].append(["EX-1", "Plancha adicional", "Producto terminado", "unidad", "PEN", "", 3, 3, "", ""])
        data["recipes"].append(["EX-1", "MP-1", 1, "", "", "", "", "", 10])
        data["costs"].append(["EX-1", "Plancha adicional", "", 5, 30])
        before = copy.deepcopy(data)
        plan = manufacturing_plan(data, "EQ-1", 2, "Taller", ("EX-1",))
        part = next(row for row in plan["rows"] if row["code"] == "MP-1")
        self.assertEqual(part["per_unit"], Decimal("3.1"))
        self.assertEqual(part["needed"], Decimal("6.2"))
        self.assertEqual(plan["capacity"], 2)  # Ten knobs, five per kitchen.
        self.assertTrue(plan["ready"])
        self.assertEqual(plan["total"], 132)
        self.assertEqual(data, before)

    def test_unknown_stock_missing_recipe_and_invalid_selections_never_claim_ready(self):
        data = sample()
        self.assertIsNone(manufacturing_plan(data, "EQ-1", location="Tienda")["capacity"])
        data["recipes"] = []
        plan = manufacturing_plan(data, "EQ-1")
        self.assertEqual(plan["missing"], ["EQ-1"])
        self.assertFalse(plan["ready"])
        for quantity, extras in (("NaN", ()), ("1.5", ()), (0, ()), (1, ("EQ-1",))):
            with self.assertRaises(InventoryError):
                manufacturing_plan(sample(), "EQ-1", quantity, additionals=extras)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class InventoryAccessTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("inventory@example.invalid", "inventory@example.invalid", "Synthetic-only-password")

    def test_anonymous_and_password_only_sessions_cannot_read_costs_or_refresh(self):
        for logged_in in (False, True):
            if logged_in:
                self.client.force_login(self.user)
            with patch("catalog.inventory_views.load_snapshot") as read, patch("catalog.inventory_sync.fetch_sheet") as fetch:
                self.assertEqual(self.client.get(reverse("inventory-dashboard")).status_code, 302)
                self.assertEqual(self.client.post(reverse("inventory-refresh"), HTTP_ACCEPT="application/json").status_code, 401)
                self.assertEqual(self.client.get(reverse("inventory-status"), HTTP_ACCEPT="application/json").status_code, 401)
                read.assert_not_called()
                fetch.assert_not_called()

    def test_verified_dashboard_has_private_charts_and_costs(self):
        from django.test import RequestFactory
        from .inventory_views import inventory_dashboard
        # Exercise the protected view with an already verified admin context.
        request = RequestFactory().get("/admin/inventario/")
        request.user = self.user
        request.session = {}
        with patch("catalog.inventory_views.load_snapshot", return_value=sample()), patch("security.admin_site.is_admin_authenticated", return_value=True):
            response = inventory_dashboard(request)
            response.render()
        self.assertContains(response, "Existencias por ubicación")
        self.assertContains(response, "Cuánto cuesta fabricar")
        self.assertContains(response, "inv-chart-data")
        self.assertNotContains(response, "cdn.jsdelivr")

    def test_refresh_requires_csrf_and_status_never_reads_google(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        with tempfile.TemporaryDirectory() as directory, override_settings(DATA_DIR=Path(directory)), \
                patch("security.middleware.is_admin_authenticated", return_value=True), \
                patch("security.admin_site.is_admin_authenticated", return_value=True), \
                patch("catalog.inventory_sync.fetch_sheet") as fetch, \
                patch.dict(os.environ, {"INOX_INVENTORY_REFRESH_ENABLED": "1"}):
            save_snapshot(sample())
            response = client.get(reverse("inventory-dashboard"))
            self.assertContains(response, "inv-sync-data")
            self.assertContains(response, "Catálogo")
            self.assertEqual(client.get(reverse("inventory-status"), HTTP_ACCEPT="application/json").status_code, 200)
            self.assertEqual(client.get(reverse("inventory-refresh"), HTTP_ACCEPT="application/json").status_code, 405)
            self.assertEqual(client.post(reverse("inventory-refresh"), HTTP_ACCEPT="application/json").status_code, 403)
            fetch.assert_not_called()
            fetch.return_value = sample()
            response = client.post(reverse("inventory-refresh"), HTTP_ACCEPT="application/json",
                                   HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["state"], "connected")
            self.assertIn("no-store", response["Cache-Control"])
            fetch.assert_called_once()

    def test_staff_without_inventory_permission_cannot_read_or_refresh(self):
        from django.test import RequestFactory
        from django.core.exceptions import PermissionDenied
        from .inventory_views import inventory_dashboard, inventory_refresh, inventory_status
        self.user.is_superuser = False
        self.user.save(update_fields=["is_superuser"])
        for view, method in ((inventory_dashboard, "get"), (inventory_status, "get"), (inventory_refresh, "post")):
            request = getattr(RequestFactory(), method)("/admin/inventario/")
            request.user = self.user
            with self.assertRaises(PermissionDenied), patch("catalog.inventory_sync.fetch_sheet") as fetch:
                view(request)
            fetch.assert_not_called()


class InventorySyncTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings_override = override_settings(DATA_DIR=Path(self.directory.name))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.environment = patch.dict(os.environ, {"INOX_INVENTORY_REFRESH_ENABLED": "1", "INOX_INVENTORY_SHEET_ID": sample()["spreadsheetId"]})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_valid_sync_throttles_tabs_and_keeps_the_last_copy_through_errors(self):
        original = sample()
        save_snapshot(original)
        updated = copy.deepcopy(original)
        updated["inventory"][0][8] = 9
        with patch("catalog.inventory_sync.time.time", return_value=1000), patch("catalog.inventory_sync.fetch_sheet", return_value=updated) as fetch:
            first = refresh_inventory()
            self.assertEqual(first["state"], "connected")
            self.assertTrue(first["changed"])
            self.assertEqual(load_snapshot()["inventory"][0][8], 9)
            second = refresh_inventory()
            self.assertFalse(second["refreshed"])
            self.assertEqual(second["revision"], first["revision"])
            fetch.assert_called_once()
        with patch("catalog.inventory_sync.time.time", return_value=1061), patch("catalog.inventory_sync.fetch_sheet", side_effect=InventoryError("Conexión interrumpida.")) as fetch:
            result = refresh_inventory()
            self.assertEqual(result["state"], "error")
            self.assertEqual(load_snapshot(), updated)
            self.assertFalse(refresh_inventory()["refreshed"])
            fetch.assert_called_once()
        with patch("catalog.inventory_sync.time.time", return_value=1122), patch("catalog.inventory_sync.fetch_sheet", return_value=updated):
            recovered = refresh_inventory()
            self.assertEqual(recovered["state"], "connected")
            self.assertTrue(recovered["refreshed"])
            self.assertFalse(recovered["changed"])

    def test_invalid_sheet_data_is_rejected_without_replacing_snapshot(self):
        original = sample()
        save_snapshot(original)
        invalid = copy.deepcopy(original)
        invalid["inventory"][0][0] = ""
        with patch("catalog.inventory_sync.fetch_sheet", return_value=invalid):
            self.assertEqual(refresh_inventory()["state"], "error")
        self.assertEqual(load_snapshot(), original)

    def test_lock_blocks_competing_worker_and_is_released_afterward(self):
        save_snapshot(sample())
        with patch("catalog.inventory_sync.fetch_sheet", return_value=sample()) as fetch:
            with _refresh_lock() as acquired:
                self.assertTrue(acquired)
                result = refresh_inventory()
                self.assertTrue(result["busy"])
                fetch.assert_not_called()
            self.assertTrue(refresh_inventory()["refreshed"])
            fetch.assert_called_once()

    def test_disabled_sync_and_status_are_read_only_and_not_reported_as_connected(self):
        save_snapshot(sample())
        with patch.dict(os.environ, {"INOX_INVENTORY_REFRESH_ENABLED": "0"}), patch("catalog.inventory_sync.fetch_sheet") as fetch:
            self.assertEqual(sync_status()["state"], "pending")
            self.assertFalse(refresh_inventory()["refreshed"])
            fetch.assert_not_called()
        self.assertEqual(sync_status()["state"], "waiting")
        self.assertFalse((Path(self.directory.name) / "inventory" / "sync-status.json").exists())

    def test_success_becomes_stale_without_more_verified_reads(self):
        with patch("catalog.inventory_sync.time.time", return_value=1000), patch("catalog.inventory_sync.fetch_sheet", return_value=sample()):
            self.assertEqual(refresh_inventory()["state"], "connected")
        with patch("catalog.inventory_sync.time.time", return_value=1181):
            self.assertEqual(sync_status()["state"], "stale")
