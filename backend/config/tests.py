import json
import tempfile
from decimal import Decimal
from pathlib import Path

from django.test import TestCase, override_settings
from catalog.models import Product


@override_settings(ALLOWED_HOSTS=['testserver'], PUBLIC_ORIGIN='https://inox.example')
class PublicRuntimeTests(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shell = '<html><head><title>Plantilla</title><meta name="description" content="Plantilla"><link rel="canonical" href="https://old.example/"><meta name="robots" content="noindex"></head><body><script id="inox-cms-bootstrap" type="application/json">{"mode":"api","data":{}}</script></body></html>'
        for route in ('index.html', 'catalogo/index.html', 'equipo/index.html', 'contacto/index.html'):
            target = self.root / route
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(shell, encoding='utf-8')
        self.settings_override = override_settings(FRONTEND_DIST=self.root)
        self.settings_override.enable()
        self.product = Product.objects.create(code='RUNTIME', slug='runtime-equipo', name='Equipo en vivo', category='linea-caliente', description='Descripción actual', price=Decimal('100.00'), cost=Decimal('37.91'), internal_notes='TALLER-PRIVADO-SECRET', show_price=True, is_published=True, is_active=True)

    def tearDown(self):
        self.settings_override.disable()
        self.temporary.cleanup()

    def test_edit_is_visible_without_rebuilding_and_private_fields_are_absent(self):
        template_before = (self.root / 'index.html').read_bytes()
        initial = self.client.get('/api/catalog/').json()
        self.assertEqual(initial['products'][0]['name'], 'Equipo en vivo')
        self.product.name = 'Equipo modificado sin publicar código'
        self.product.price = Decimal('145.50')
        self.product.save()
        updated = self.client.get('/api/catalog/').json()
        self.assertEqual(updated['products'][0]['name'], self.product.name)
        self.assertEqual(Decimal(str(updated['products'][0]['price'])), Decimal('145.50'))
        response = self.client.get('/catalogo/runtime-equipo/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.product.name)
        self.assertContains(response, 'https://inox.example/catalogo/runtime-equipo/')
        for result in (json.dumps(updated), response.content.decode()):
            self.assertNotIn('TALLER-PRIVADO-SECRET', result)
            self.assertNotIn('37.91', result)
            self.assertNotIn('"cost"', result)
            self.assertNotIn('internal_notes', result)
        self.assertEqual((self.root / 'index.html').read_bytes(), template_before)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, 'Equipo modificado sin publicar código')

    def test_hidden_products_are_not_exposed_by_public_routes_or_sitemap(self):
        self.product.is_published = False
        self.product.save()
        self.assertEqual(self.client.get('/catalogo/runtime-equipo/').status_code, 404)
        self.assertEqual(self.client.get('/api/catalog/').json()['products'], [])
        for path in ('/', '/catalogo/', '/sitemap.xml'):
            self.assertNotIn('runtime-equipo', self.client.get(path).content.decode())
        self.assertTrue(Product.objects.filter(pk=self.product.pk).exists())

    def test_bootstrap_content_cannot_break_out_into_script_and_html_is_uncached(self):
        self.product.description = '</script><img src=x onerror=alert(1)>'
        self.product.save()
        response = self.client.get('/catalogo/runtime-equipo/')
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertNotIn('</script><img', response.content.decode())
        self.assertContains(response, '\\u003c/script\\u003e')

    def test_legacy_static_build_is_never_used_as_a_database_page(self):
        (self.root / 'index.html').write_text('<script id="inox-cms-bootstrap">{"data":{"products":["OLD"]}}</script>', encoding='utf-8')
        response = self.client.get('/')
        self.assertEqual(response.status_code, 503)
        self.assertNotContains(response, 'OLD', status_code=503)

    def test_only_allowed_public_asset_paths_are_served(self):
        self.assertEqual(self.client.get('/backend/data/inox.sqlite3').status_code, 404)
        self.assertEqual(self.client.get('/images/../../backend/.env').status_code, 404)
        self.assertEqual(self.client.get('/images/private.sqlite3').status_code, 404)
        response = self.client.post('/api/catalog/', data='{}', content_type='application/json')
        self.assertEqual(response.status_code, 405)
