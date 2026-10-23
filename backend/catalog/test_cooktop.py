"""Synthetic cooktop definitions only; Django creates an isolated test database."""
import json
from pathlib import Path
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .admin import ProductAdmin
from .cooktop import CooktopValidationError, cooktop_selection_summary, validate_cooktop_config, validate_cooktop_selection
from .forms import ProductAdminForm
from .models import AuditLog, Product
from .serializers import public_cooktop_config, public_product
from .test_editor import product_data
from .views import check_cooktop_selection, public_cooktop


def cooktop_fixture(enabled=True):
    return {
        "version": 1, "kind": "cooktop", "enabled": enabled, "energies": ["gas", "electric"], "defaultModuleId": "burner",
        "layouts": [{"id": "six", "name": "6 posiciones", "rows": 2, "columns": 3}, {"id": "four", "name": "4 posiciones", "rows": 2, "columns": 2}],
        "modules": [
            {"id": "burner", "name": "Hornilla", "kind": "burner", "width": 1, "height": 1, "energies": ["gas", "electric"], "allowedLayouts": ["six", "four"], "maxQuantity": 6, "anchors": {"six": [0, 1, 2, 3, 4, 5], "four": [0, 1, 2, 3]}},
            {"id": "wok", "name": "Wok", "kind": "wok", "width": 1, "height": 1, "energies": ["gas"], "allowedLayouts": ["six"], "maxQuantity": 2, "anchors": {"six": [0, 1, 2, 3, 4, 5]}},
            {"id": "plate", "name": "Plancha", "kind": "griddle", "width": 1, "height": 2, "energies": ["gas", "electric"], "allowedLayouts": ["six"], "maxQuantity": 1, "anchors": {"six": [0]}},
        ],
    }


def selection(*placements, layout="six", energy="gas"):
    return {"layoutId": layout, "energy": energy, "placements": [{"moduleId": module, "anchor": anchor} for module, anchor in placements]}


class CooktopValidationTests(SimpleTestCase):
    def test_shared_frontend_fixture_has_the_same_valid_left_pair_and_burner_count(self):
        fixture = json.loads((Path(__file__).resolve().parents[2] / "scripts" / "fixtures" / "cooktop.json").read_text(encoding="utf-8"))
        self.assertEqual(validate_cooktop_config(fixture), fixture)
        chosen = selection(("plate", 0), ("wok", 2))
        self.assertEqual(cooktop_selection_summary(fixture, chosen)["remainingBurners"], 3)
        with self.assertRaises(CooktopValidationError):
            validate_cooktop_selection(fixture, selection(("plate", 0), ("wok", 3)))

    def test_whitelist_copies_the_schema_and_preserves_disabled_drafts(self):
        source = cooktop_fixture(False)
        result = validate_cooktop_config(source)
        self.assertEqual(result, source)
        result["modules"][0]["anchors"]["six"].clear()
        self.assertEqual(source["modules"][0]["anchors"]["six"], list(range(6)))
        self.assertEqual(validate_cooktop_config({}), {})

    def test_rejects_unknown_fields_invalid_types_limits_and_references(self):
        def update_at(data, path, value):
            current = data
            for key in path[:-1]:
                current = current[key]
            current[path[-1]] = value

        cases = [
            (("privatePrice",), 100), (("version",), True), (("enabled",), "yes"),
            (("energies",), ["gas", "gas"]), (("energies",), ["solar"]), (("energies",), []),
            (("layouts", 0, "rows"), True), (("layouts", 0, "rows"), 4), (("layouts", 0, "columns"), 13),
            (("layouts", 0, "name"), " "), (("layouts", 0, "name"), "x" * 121),
            (("layouts", 0, "name"), "\ud800"),
            (("layouts", 0, "id"), "bad/id"), (("layouts", 1, "id"), "six"),
            (("modules", 1, "id"), "burner"), (("modules", 1, "width"), 0), (("modules", 1, "width"), 13),
            (("modules", 1, "maxQuantity"), 13), (("modules", 1, "kind"), "oven"),
            (("modules", 1, "energies"), ["solar"]), (("modules", 1, "allowedLayouts"), ["missing"]),
            (("modules", 1, "anchors"), {"four": [0]}), (("modules", 1, "anchors", "six"), []),
            (("modules", 1, "anchors", "six"), [0, 0]), (("modules", 1, "anchors", "six"), [True]),
            (("modules", 1, "anchors", "six"), [6]), (("modules", 2, "anchors", "six"), [3]),
            (("modules", 2, "width"), 4), (("modules", 1, "cost"), 25),
        ]
        for path, value in cases:
            with self.subTest(path=path, value=value):
                candidate = cooktop_fixture()
                update_at(candidate, path, value)
                with self.assertRaises(CooktopValidationError):
                    validate_cooktop_config(candidate)
        for invalid in (None, False, [], "", {"enabled": False}):
            with self.subTest(invalid=invalid), self.assertRaises(CooktopValidationError):
                validate_cooktop_config(invalid)

    def test_base_must_fill_every_cell_for_every_energy_and_layout(self):
        for changes in (
            {"kind": "wok"}, {"width": 2}, {"height": 2}, {"energies": ["gas"]},
            {"allowedLayouts": ["six"], "anchors": {"six": list(range(6))}},
            {"maxQuantity": 5}, {"anchors": {"six": [0, 1, 2, 3, 4], "four": list(range(4))}},
        ):
            candidate = cooktop_fixture()
            candidate["modules"][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(CooktopValidationError):
                validate_cooktop_config(candidate)
        candidate = cooktop_fixture()
        candidate["defaultModuleId"] = "missing"
        with self.assertRaises(CooktopValidationError):
            validate_cooktop_config(candidate)

    def test_json_surrogate_pairs_are_valid_unicode_but_isolated_surrogates_are_rejected(self):
        candidate = cooktop_fixture()
        candidate["layouts"][0]["name"] = json.loads('"\\ud83d\\ude00"') * 120
        self.assertEqual(validate_cooktop_config(candidate)["layouts"][0]["name"], candidate["layouts"][0]["name"])
        for name in (json.loads('"\\ud800"'), json.loads('"\\udc00"'), candidate["layouts"][0]["name"] + "x"):
            candidate["layouts"][0]["name"] = name
            with self.assertRaises(CooktopValidationError):
                validate_cooktop_config(candidate)

    def test_invalid_unicode_in_memory_fails_closed_in_both_public_responses(self):
        # PostgreSQL JSONB rejects isolated surrogates before persistence. An
        # unsaved product exercises response safety without relying on SQLite's
        # more permissive JSON storage or breaking a PostgreSQL transaction.
        factory = RequestFactory()
        for raw_name in ('"\\ud800"', '"\\udfff"'):
            with self.subTest(raw_name=raw_name):
                config = cooktop_fixture()
                config["layouts"][0]["name"] = json.loads(raw_name)
                product = Product(code="COOK-UNICODE", category="linea-caliente", supply_type="manufactured", equipment_family="cocinas", cooktop_config=config)
                with patch("catalog.views._cooktop_product", return_value=product):
                    response = public_cooktop(factory.get("/", HTTP_ORIGIN="https://evil.example"), product.code)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), {"productId": product.code, "cooktopConfig": None})
                    self.assertNotIn("Access-Control-Allow-Origin", response)
                    response = check_cooktop_selection(factory.get("/", {"selection": json.dumps(selection())}, HTTP_ORIGIN="https://evil.example"), product.code)
                    self.assertEqual(response.status_code, 400)
                    self.assertFalse(json.loads(response.content)["valid"])
                    self.assertNotIn("Access-Control-Allow-Origin", response)
                    self.assertNotIn(raw_name, response.content.decode())

    def test_five_column_layouts_cover_lineal_five_and_central_ten_without_exceeding_twelve_cells(self):
        config = cooktop_fixture()
        config["layouts"] = [
            {"id": "lineal", "name": "5 posiciones lineales", "rows": 1, "columns": 5},
            {"id": "central", "name": "10 posiciones centrales", "rows": 2, "columns": 5},
        ]
        base = config["modules"][0]
        base.update(allowedLayouts=["lineal", "central"], anchors={"lineal": list(range(5)), "central": list(range(10))}, maxQuantity=10)
        config["modules"] = [base, {
            "id": "wide-plate", "name": "Plancha de cinco posiciones de prueba", "kind": "griddle",
            "width": 5, "height": 1, "energies": ["gas"], "allowedLayouts": ["lineal", "central"],
            "maxQuantity": 2, "anchors": {"lineal": [0], "central": [0, 5]},
        }]
        self.assertEqual(validate_cooktop_config(config), config)
        self.assertEqual(cooktop_selection_summary(config, selection(layout="lineal"))["remainingBurners"], 5)
        self.assertEqual(cooktop_selection_summary(config, selection(layout="central"))["remainingBurners"], 10)
        self.assertEqual(cooktop_selection_summary(config, selection(("wide-plate", 5), layout="central"))["remainingBurners"], 5)
        with self.assertRaises(CooktopValidationError):
            validate_cooktop_selection(config, selection(("wide-plate", 1), layout="central"))
        config["layouts"][1]["rows"] = 3
        with self.assertRaisesRegex(CooktopValidationError, "hasta 12 posiciones"):
            validate_cooktop_config(config)

    def test_linear_ten_and_twelve_fit_but_two_by_seven_and_three_by_five_exceed_capacity(self):
        for rows, columns in ((1, 10), (1, 12), (2, 7), (3, 5)):
            with self.subTest(rows=rows, columns=columns):
                config = cooktop_fixture()
                total = rows * columns
                config["layouts"] = [{"id": "linear", "name": "Distribución de prueba", "rows": rows, "columns": columns}]
                base, plate = config["modules"][0], config["modules"][2]
                base.update(allowedLayouts=["linear"], anchors={"linear": list(range(total))}, maxQuantity=min(total, 12))
                plate.update(width=columns, height=1, allowedLayouts=["linear"], anchors={"linear": [0]})
                config["modules"] = [base, plate]
                if total > 12:
                    with self.assertRaisesRegex(CooktopValidationError, "hasta 12 posiciones"):
                        validate_cooktop_config(config)
                    continue
                self.assertEqual(validate_cooktop_config(config), config)
                self.assertEqual(cooktop_selection_summary(config, selection(layout="linear"))["remainingBurners"], total)
                self.assertEqual(cooktop_selection_summary(config, selection(("plate", 0), layout="linear"))["remainingBurners"], 0)
                with self.assertRaises(CooktopValidationError):
                    validate_cooktop_selection(config, selection(("plate", 1), layout="linear"))

    def test_left_vertical_plancha_occupies_two_cells_and_uncovered_cells_are_burners(self):
        config = cooktop_fixture()
        chosen = selection(("plate", 0), ("wok", 1))
        self.assertEqual(validate_cooktop_selection(config, chosen), chosen)
        self.assertEqual(cooktop_selection_summary(config, chosen), {
            "layoutId": "six", "energy": "gas", "remainingBurners": 3,
            "moduleCounts": [{"moduleId": "wok", "name": "Wok", "count": 1, "anchors": [1]}, {"moduleId": "plate", "name": "Plancha", "count": 1, "anchors": [0]}],
        })
        self.assertEqual(cooktop_selection_summary(config, selection())["remainingBurners"], 6)
        self.assertEqual(cooktop_selection_summary(config, selection(layout="four", energy="electric"))["remainingBurners"], 4)

    def test_rejects_overlap_forbidden_anchor_energy_layout_quantity_and_explicit_base(self):
        invalid = [
            selection(("plate", 0), ("wok", 3)), selection(("plate", 1)), selection(("plate", 3)),
            selection(("wok", 0), energy="electric"), selection(("wok", 0), layout="four"),
            selection(("wok", 0), ("wok", 1), ("wok", 2)), selection(("unknown", 0)),
            selection(("burner", 0)), selection(("wok", True)), selection(("wok", -1)),
            selection(("wok", 6)), selection(layout="missing"), selection(energy="solar"),
            {**selection(), "price": 1}, {**selection(), "placements": [{"moduleId": "wok", "anchor": 0, "cost": 1}]},
        ]
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(CooktopValidationError):
                validate_cooktop_selection(cooktop_fixture(), candidate)

    def test_disabled_config_needs_explicit_private_preview_validation(self):
        with self.assertRaises(CooktopValidationError):
            validate_cooktop_selection(cooktop_fixture(False), selection())
        self.assertEqual(validate_cooktop_selection(cooktop_fixture(False), selection(), allow_disabled=True), selection())
        with self.assertRaises(CooktopValidationError):
            validate_cooktop_selection({}, selection(), allow_disabled=True)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], SECURITY_OWNER_USERNAME="cooktop-owner@example.test")
class CooktopProductTests(TestCase):
    def setUp(self):
        self.product = Product.objects.create(code="COOK-TEST", slug="cook-test", name="Cocina de prueba", category="linea-caliente", supply_type="manufactured", equipment_family="cocinas", cooktop_config=cooktop_fixture(), is_published=True, internal_notes="PRIVATE-NOTE", cost=999)
        self.owner = get_user_model().objects.create_user("cooktop-owner@example.test", is_staff=True, is_superuser=True)
        self.editor = get_user_model().objects.create_user("other-superuser@example.test", is_staff=True, is_superuser=True)
        self.model_admin = ProductAdmin(Product, admin.site)
        self.url = reverse("catalog-cooktop", args=[self.product.code])
        self.check_url = reverse("catalog-cooktop-check", args=[self.product.code])

    def request(self, user):
        request = RequestFactory().post("/admin/catalog/product/")
        request.user = user
        return request

    def test_only_explicit_manufactured_hot_cocinas_accept_nonempty_configuration(self):
        for field, value in (("supply_type", ""), ("supply_type", "distributed"), ("category", "linea-neutra"), ("equipment_family", ""), ("equipment_family", "batidoras")):
            self.product.refresh_from_db()
            setattr(self.product, field, value)
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                self.product.save()
        self.product.refresh_from_db()
        self.product.name = "Mesa con hornillas en el título"
        self.product.cooktop_config = {}
        self.product.supply_type = "distributed"
        self.product.equipment_family = ""
        self.product.save()
        self.assertIsNone(public_cooktop_config(self.product))

    def test_public_projection_omits_drafts_and_invalid_context_but_private_preview_can_read_valid_draft(self):
        self.product.cooktop_config = cooktop_fixture(False)
        self.product.save()
        self.assertIsNone(public_product(self.product)["cooktopConfig"])
        self.assertEqual(public_product(self.product, preview=True)["cooktopConfig"], self.product.cooktop_config)
        for candidate in ({**cooktop_fixture(), "privateSecret": "MUST-NOT-LEAK"}, None, []):
            self.product.cooktop_config = candidate
            self.assertIsNone(public_cooktop_config(self.product, preview=True))
        self.product.cooktop_config = cooktop_fixture()
        self.product.supply_type = "distributed"
        self.assertIsNone(public_cooktop_config(self.product, preview=True))

    def test_public_schema_is_read_only_whitelisted_and_cors_is_specific_to_pages(self):
        before = list(Product.objects.values())
        audit_count = AuditLog.objects.count()
        response = self.client.get(self.url, HTTP_ORIGIN="https://inox-304.github.io")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"productId": self.product.code, "cooktopConfig": cooktop_fixture()})
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://inox-304.github.io")
        self.assertNotIn("Access-Control-Allow-Credentials", response)
        self.assertIn("Origin", response["Vary"])
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotContains(response, "PRIVATE-NOTE")
        self.assertNotContains(response, "cost")
        for origin in ("https://evil.example", "http://127.0.0.1:4325", "https://inox-304.github.io.evil.example", "null", ""):
            self.assertNotIn("Access-Control-Allow-Origin", self.client.get(self.url, HTTP_ORIGIN=origin))
        self.assertEqual(self.client.post(self.url, {}).status_code, 405)
        self.assertEqual(list(Product.objects.values()), before)
        self.assertEqual(AuditLog.objects.count(), audit_count)

    def test_public_endpoints_do_not_expose_unpublished_inactive_disabled_or_invalid_config(self):
        self.product.cooktop_config = cooktop_fixture(False)
        self.product.save()
        self.assertIsNone(self.client.get(self.url).json()["cooktopConfig"])
        self.assertIsNone(self.client.get(self.url, {"preview": "true"}).json()["cooktopConfig"])
        self.assertEqual(self.client.get(self.check_url, {"selection": json.dumps(selection())}).status_code, 400)
        for field in ("is_published", "is_active"):
            with self.subTest(field=field):
                Product.objects.filter(pk=self.product.pk).update(**{field: False})
                self.assertEqual(self.client.get(self.url).status_code, 404)
                self.assertEqual(self.client.get(self.check_url).status_code, 404)
                Product.objects.filter(pk=self.product.pk).update(**{field: True})
        Product.objects.filter(pk=self.product.pk).update(cooktop_config={**cooktop_fixture(), "privateSecret": "MUST-NOT-LEAK"})
        response = self.client.get(self.url)
        self.assertIsNone(response.json()["cooktopConfig"])
        self.assertNotContains(response, "MUST-NOT-LEAK")

    def test_selection_check_returns_counts_without_prices_or_writes_and_rejects_bad_requests(self):
        before = list(Product.objects.values())
        audit_count = AuditLog.objects.count()
        valid = selection(("plate", 0), ("wok", 1))
        response = self.client.get(self.check_url, {"selection": json.dumps(valid)}, HTTP_ORIGIN="https://inox-304.github.io")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["valid"])
        self.assertEqual(response.json()["selection"], valid)
        self.assertEqual(response.json()["summary"]["remainingBurners"], 3)
        self.assertNotIn("price", response.content.decode())
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://inox-304.github.io")
        for raw in ("", "x" * 6001, "{", "null", json.dumps(selection(("plate", 0), ("wok", 3))), '{"layoutId":"six","layoutId":"four","energy":"gas","placements":[]}'):
            with self.subTest(raw=raw[:40]):
                response = self.client.get(self.check_url, {"selection": raw})
                self.assertEqual(response.status_code, 400)
                self.assertFalse(response.json()["valid"])
        self.assertEqual(self.client.post(self.check_url, {}).status_code, 405)
        self.assertEqual(list(Product.objects.values()), before)
        self.assertEqual(AuditLog.objects.count(), audit_count)

    def test_malformed_persisted_configs_fail_closed_for_both_endpoints_without_cors_for_other_origins(self):
        invalid_configs = [False, [], "PRIVATE-PROBE", {"enabled": True}, {**cooktop_fixture(), "privateSecret": "PRIVATE-PROBE"}]
        malformed_module = cooktop_fixture()
        malformed_module["modules"][1]["anchors"] = {"six": [True]}
        invalid_configs.append(malformed_module)
        for config in invalid_configs:
            with self.subTest(config_type=type(config).__name__):
                Product.objects.filter(pk=self.product.pk).update(cooktop_config=config)
                response = self.client.get(self.url, HTTP_ORIGIN="https://evil.example")
                self.assertEqual(response.status_code, 200)
                self.assertIsNone(response.json()["cooktopConfig"])
                self.assertNotIn("Access-Control-Allow-Origin", response)
                self.assertNotContains(response, "PRIVATE-PROBE")
                response = self.client.get(self.check_url, {"selection": json.dumps(selection())}, HTTP_ORIGIN="https://evil.example")
                self.assertEqual(response.status_code, 400)
                self.assertFalse(response.json()["valid"])
                self.assertNotIn("Access-Control-Allow-Origin", response)
                self.assertNotIn("PRIVATE-PROBE", response.content.decode())
        Product.objects.filter(pk=self.product.pk).update(cooktop_config=cooktop_fixture(), supply_type="distributed")
        self.assertIsNone(self.client.get(self.url).json()["cooktopConfig"])
        self.assertFalse(self.client.get(self.check_url, {"selection": json.dumps(selection())}).json()["valid"])

    def test_owner_form_can_edit_but_another_superuser_cannot_edit_or_forge_config(self):
        owner_request = self.request(self.owner)
        editor_request = self.request(self.editor)
        OwnerForm = self.model_admin.get_form(owner_request, self.product)
        EditorForm = self.model_admin.get_form(editor_request, self.product)
        self.assertIn("cooktop_config", OwnerForm(instance=self.product).fields)
        self.assertNotIn("cooktop_config", EditorForm(instance=self.product).fields)
        data = product_data(category="linea-caliente", supply_type="manufactured", equipment_family="cocinas", cooktop_config=json.dumps(cooktop_fixture(False)))
        owner_form = OwnerForm(instance=self.product, data=data)
        self.assertTrue(owner_form.is_valid(), owner_form.errors)
        self.model_admin.save_model(owner_request, owner_form.save(commit=False), owner_form, True)
        self.product.refresh_from_db()
        self.assertFalse(self.product.cooktop_config["enabled"])
        editor_form = EditorForm(instance=self.product, data=data)
        self.assertFalse(editor_form.is_valid())
        self.assertIn("Solo el propietario", str(editor_form.errors))
        self.product.cooktop_config = cooktop_fixture()
        with self.assertRaises(PermissionDenied):
            self.model_admin.save_model(editor_request, self.product, None, True)
        self.product.refresh_from_db()
        self.assertFalse(self.product.cooktop_config["enabled"])

    def test_nonowner_regular_edits_preserve_config_and_cannot_reclassify_it(self):
        request = self.request(self.editor)
        Form = self.model_admin.get_form(request, self.product)
        data = product_data(name="Cocina actualizada", category="linea-caliente", supply_type="manufactured", equipment_family="cocinas")
        form = Form(instance=self.product, data=data)
        self.assertTrue(form.is_valid(), form.errors)
        self.model_admin.save_model(request, form.save(commit=False), form, True)
        self.product.refresh_from_db()
        self.assertEqual(self.product.cooktop_config, cooktop_fixture())
        data["supply_type"] = "distributed"
        form = Form(instance=self.product, data=data)
        self.assertFalse(form.is_valid())
        self.assertIn("fabricación propia", str(form.errors))

    def test_widget_hides_json_before_javascript_and_nonowners_have_no_config_fieldset(self):
        Form = self.model_admin.get_form(self.request(self.owner), self.product)
        rendered = str(Form(instance=self.product)["cooktop_config"])
        self.assertRegex(rendered, r"<textarea\b[^>]*\bhidden(?:\s|>)")
        self.assertIn("data-cooktop-editor", rendered)
        self.assertIn("readonly", rendered)
        fields = [field for _, options in self.model_admin.get_fieldsets(self.request(self.editor), self.product) for field in options["fields"]]
        self.assertNotIn("cooktop_config", fields)

    def test_new_products_are_not_configured_automatically_and_invalid_json_types_are_rejected(self):
        form = ProductAdminForm(data=product_data(category="linea-caliente", supply_type="manufactured", equipment_family="cocinas"), can_edit_cooktop=True)
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.save().cooktop_config, {})
        for raw in ("[]", "false", "null", "0"):
            form = ProductAdminForm(data=product_data(category="linea-caliente", supply_type="manufactured", equipment_family="cocinas", cooktop_config=raw), can_edit_cooktop=True)
            self.assertFalse(form.is_valid(), raw)

    def test_duplicate_retains_options_but_disables_config_without_modifying_source(self):
        with patch.object(self.model_admin, "message_user"):
            self.model_admin.duplicate_products(self.request(self.editor), Product.objects.filter(pk=self.product.pk))
        duplicate = Product.objects.exclude(pk=self.product.pk).get()
        self.assertFalse(duplicate.is_published)
        self.assertEqual(duplicate.cooktop_config, cooktop_fixture(False))
        self.product.refresh_from_db()
        self.assertTrue(self.product.cooktop_config["enabled"])

    def test_private_preview_uses_explicit_preview_flag_after_product_permission_check(self):
        self.product.cooktop_config = cooktop_fixture(False)
        self.product.save()
        with patch("config.views._render_shell", return_value=HttpResponse("private")) as render:
            self.model_admin.preview_view(self.request(self.owner), self.product.pk)
        self.assertTrue(render.call_args.kwargs["preview"])
        item = next(item for item in render.call_args.args[1]["products"] if item["id"] == self.product.code)
        self.assertEqual(item["cooktopConfig"], cooktop_fixture(False))
        self.assertIsNone(self.client.get(self.url).json()["cooktopConfig"])
        unprivileged = get_user_model().objects.create_user("cooktop-no-permission@example.test", is_staff=True)
        with self.assertRaises(PermissionDenied):
            self.model_admin.preview_view(self.request(unprivileged), self.product.pk)
