import test from 'node:test';
import assert from 'node:assert/strict';
import { withBase } from '../src/lib/paths.ts';
import { productPhotoVersions } from '../src/lib/product-photo-versions.ts';

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

test('edited product photos bypass old cached bytes while retaining base, query and fragment', () => {
  const photo = '/images/products/estacion-bartender-profesional.jpg';
  const revision = productPhotoVersions[photo];
  const url = withBase(`${photo}?download=1&v=old#preview`, '/inox304/');
  assert.equal(url, `/inox304${photo}?download=1&v=${revision}#preview`);
  assert.equal(withBase(url, '/inox304/'), url);
  assert.equal(withBase(`https://supplier.example${photo}`), `https://supplier.example${photo}`);
  assert.equal(withBase('/media/private-photo-id/'), '/media/private-photo-id/');
});
