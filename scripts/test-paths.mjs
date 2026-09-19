import test from 'node:test';
import assert from 'node:assert/strict';
import { withBase } from '../src/lib/paths.ts';

test('project hosting prefixes local navigation and assets exactly once', () => {
  for (const path of ['/', '/catalogo/', '/contacto/', '/images/products/mesa.webp', '/media/hero-clean.mp4', '/#instalaciones']) {
    assert.equal(withBase(path, '/inox304/'), `/inox304${path}`);
    assert.equal(withBase(withBase(path, '/inox304/'), '/inox304/'), `/inox304${path}`);
    assert.equal(withBase(path, '/'), path);
  }
  assert.equal(withBase('/catalogo/?categoria=coccion#equipos', '/inox304/'), '/inox304/catalogo/?categoria=coccion#equipos');
});

test('external contacts and page-local references retain their destination', () => {
  for (const path of ['https://wa.me/51964270406', 'https://example.com/image.jpg', '//example.com/image.jpg', 'mailto:ventas@example.com', 'tel:+51964270406', '#main', '?categoria=coccion']) {
    assert.equal(withBase(path, '/inox304/'), path);
  }
});
