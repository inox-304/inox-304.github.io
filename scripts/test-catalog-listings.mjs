import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from '../src/data/products.ts';
import { expandedCatalogListings, catalogListingHref, catalogListingSearchText } from '../src/lib/catalog-listings.ts';
import { matchesCatalogSearch } from '../src/lib/catalog-controls.ts';

const basic = (id, extra = {}) => ({ id, slug: id.toLowerCase(), name: `Equipo ${id}`, image: `/images/products/${id}.webp`, category: 'linea-neutra', visible: true, ...extra });

test('the full catalog exposes original family SKUs and every authored oven combination', () => {
  const before = JSON.stringify(products);
  const listings = expandedCatalogListings(products);
  assert.ok(listings.some(item => item.product.id === 'P30'));
  assert.ok(listings.some(item => item.product.id === 'P31'));
  assert.equal(listings.filter(item => item.product.id.startsWith('ILUMI-DJ-')).length, 3);
  const multiuso = listings.filter(item => item.product.id === 'P06');
  assert.equal(multiuso.length, 8);
  assert.ok(multiuso.every(item => item.variant));
  assert.equal(listings.filter(item => item.product.id === 'INOX-TAVOLA').length, 16);
  assert.equal(new Set(listings.map(item => item.key)).size, listings.length);
  assert.ok(listings.every(item => products.includes(item.product)));
  assert.equal(JSON.stringify(products), before);
});

test('the selected image, model, price and route belong to the same explicit variation', () => {
  const variant = { id: 'two-bowls', name: '2 pozas', image: '/images/products/two.webp', model3d: '/models/two.glb', technicalSheet: '/documents/two.pdf', price: 50, availability: 'made_to_order' };
  const parent = basic('A', { price: 20, model3d: '/models/base.glb', variants: [variant] });
  const [base, choice] = expandedCatalogListings([parent]);
  assert.equal(base.price, 20);
  assert.strictEqual(choice.variant, variant);
  assert.strictEqual(choice.product, parent);
  assert.equal(choice.label, '2 pozas');
  assert.equal(choice.image, variant.image);
  assert.equal(choice.model3d, variant.model3d);
  assert.equal(choice.price, 50);
  assert.equal(choice.technicalSheet, variant.technicalSheet);
  assert.equal(choice.href, '/catalogo/a/?variant=two-bowls');
  assert.equal(catalogListingHref(choice, '/inox/equipo/?id=A#vista'), '/inox/equipo/?id=A&variant=two-bowls#vista');
});

test('unpriced variations do not inherit a base price; optional media use the same base fallback as detail', () => {
  const parent = basic('A', { price: 500, model3d: '/models/base.glb', variants: [{ id: 'option', name: 'Opción', availability: '' }] });
  const choice = expandedCatalogListings([parent])[1];
  assert.equal(choice.price, undefined);
  assert.equal(choice.image, parent.image);
  assert.equal(choice.model3d, parent.model3d);
});

test('hidden products/variations and duplicated records never create public cards', () => {
  const hidden = basic('SECRET', { visible: false });
  const product = basic('A', { variants: [{ id: 'public', name: 'Pública' }, { id: 'public', name: 'Repetida' }, { id: 'draft', name: 'Privada', visible: false }] });
  const listings = expandedCatalogListings([hidden, product, product]);
  assert.equal(listings.length, 2);
  assert.deepEqual(listings.map(item => item.variant?.id || 'base'), ['base', 'public']);
  const onlyDraft = basic('B', { variantAxes: [{ id: 'size' }], variants: [{ id: 'draft', name: 'Privada', visible: false }] });
  assert.deepEqual(expandedCatalogListings([onlyDraft]), []);
});

test('no permutations are invented from axis options or kitchen module rules', () => {
  const product = basic('A', { variantAxes: [{ id: 'size', options: [{ id: 'small' }, { id: 'large' }] }], variants: [{ id: 'small', name: 'Pequeño' }], cooktopConfig: { layouts: [2, 4, 6], modules: ['wok', 'grill'] } });
  assert.equal(expandedCatalogListings([product]).length, 1);
  assert.equal(expandedCatalogListings([product])[0].variant.id, 'small');
});

test('a variant search matches its selected capacity instead of all capacities in the parent summary', () => {
  const product = basic('A', { name: 'Dispensador', summary: 'Disponible en 10 o 20 litros', capacity: '10 o 20 L', features: ['10 o 20 L', 'A gas o eléctrico'], variantAxes: [{ id: 'capacity' }], variants: [{ id: 'small', name: '10 L · a gas' }, { id: 'large', name: '20 L · eléctrico' }] });
  const listings = expandedCatalogListings([product]);
  assert.equal(matchesCatalogSearch(catalogListingSearchText(listings[0], 'Línea fría'), '20 litros'), false);
  assert.equal(matchesCatalogSearch(catalogListingSearchText(listings[1], 'Línea fría'), '20 litros'), true);
  assert.equal(matchesCatalogSearch(catalogListingSearchText(listings[0], 'Línea fría'), 'eléctrico'), false);
});
