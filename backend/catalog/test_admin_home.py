from types import SimpleNamespace

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase

from .models import Product
from .templatetags.admin_overview import catalog_overview


class AdminHomeOverviewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for code, published, active in (
            ("HOME-PUBLIC", True, True),
            ("HOME-HIDDEN", True, False),
            ("HOME-DRAFT", False, True),
        ):
            Product.objects.create(
                code=code,
                slug=code.lower(),
                name=code,
                category=Product.Category.HOT,
                is_published=published,
                is_active=active,
            )

    def test_catalog_counts_require_product_permission(self):
        for user in (AnonymousUser(), SimpleNamespace(has_perm=lambda permission: False)):
            with self.subTest(user=user), self.assertNumQueries(0):
                result = catalog_overview({"request": SimpleNamespace(user=user)})
            self.assertIsNone(result)

    def test_count_visible_products_separately_from_drafts_and_hidden(self):
        for permission in ("catalog.view_product", "catalog.change_product"):
            user = SimpleNamespace(has_perm=lambda value: value == permission)
            with self.subTest(permission=permission), self.assertNumQueries(1):
                result = catalog_overview({"request": SimpleNamespace(user=user)})
            self.assertEqual(result, {"total": 3, "published": 1, "drafts": 1})

    def test_missing_request_does_not_query_catalog(self):
        with self.assertNumQueries(0):
            self.assertIsNone(catalog_overview({}))
