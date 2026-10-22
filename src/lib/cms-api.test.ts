import test from 'node:test';
import assert from 'node:assert/strict';
import { apiProductRoute, catalogSlug, emptyCmsData, parsePublicCatalog } from './cms-api.ts';
import { formatAvailability, safeImage, safeModel, safePreviewAsset, safeTechnicalSheet } from './cms.ts';
import { getProductStage } from './product-stage.ts';

function catalog() {
  return {
    products: [{ id: 'new-1', slug: 'mesa-a-medida', name: '<Mesa & acero>', category: 'linea-neutra', summary: 'Nueva fabricación', features: ['Medida especial'], image: '/media/12/', visible: true, featured: true, order: 0, contactId: 'ventas', price: 580.5, currency: 'PEN', showPrice: true, technicalSheet: '/media/13/', model3d: '/media/14/', modelPoster: '/media/12/', gallery: ['/media/15/'], chargeUnit: 'm', unitLabel: 'por metro lineal', availability: 'made_to_order', variants: [{ id: '2', name: '1,5 m', price: 740, availability: 'available' }], additionalCharges: [{ id: 'included', name: 'Adicional incluido', price: 30 }] }],
    contacts: [{ id: 'ventas', name: 'Ventas', whatsapp: '51987654321', phone: '987 654 321', email: 'ventas@example.com', message: 'Hola', active: true }],
    settings: { empresa: 'Taller nuevo', direccion: 'Nueva dirección', contacto_principal: 'ventas', facebook: 'https://www.facebook.com/example', hero_title: 'Hecho\npara tu proyecto' },
  };
}

test('accepts database media, final server prices, variants and live slug routes', () => {
  const data = parsePublicCatalog(catalog());
  assert.equal(data.products[0].price, 580.5);
  assert.equal(data.products[0].variants?.[0].price, 740);
  assert.equal(data.products[0].additionalCharges?.[0].price, 30);
  assert.equal(data.products[0].model3d, '/media/14/');
  assert.equal(data.products[0].name, '<Mesa & acero>');
  assert.equal(apiProductRoute(data.products[0]), '/catalogo/mesa-a-medida/');
  assert.equal(catalogSlug('/catalogo/mesa-a-medida/'), 'mesa-a-medida');
  assert.equal(catalogSlug('/catalogo/'), '');
});

test('allows an empty catalog without reviving contacts or products', () => {
  assert.deepEqual(parsePublicCatalog(emptyCmsData()), emptyCmsData());
});

test('validates variant models and PDFs while excluding manufacturing and private costs', () => {
  const input = catalog();
  Object.assign(input.products[0].variants[0], { model3d: '/models/cocina.glb', technicalSheet: '/documents/cocina.pdf', materialVariant: 'AISI 304', doorAnimation: 'Puertas', manufacturing_code: 'EQ-PRIVATE', cost: 900 });
  const variant = parsePublicCatalog(input).products[0].variants![0];
  assert.equal(variant.model3d, '/models/cocina.glb');
  assert.equal(variant.technicalSheet, '/documents/cocina.pdf');
  assert.equal(variant.doorAnimation, 'Puertas');
  assert.equal(Object.hasOwn(variant, 'cost'), false);
  assert.equal(Object.hasOwn(variant, 'manufacturing_code'), false);
  Object.assign(input.products[0].variants[0], { model3d: 'javascript:alert(1)' });
  assert.throws(() => parsePublicCatalog(input));
});

test('accepts opaque UUID media and preserves natural proportions without old crop bounds', () => {
  const asset = '/media/964ca472-b823-440e-8f09-7c32e08a0e5c/';
  const input = catalog();
  Object.assign(input.products[0], { image: asset, technicalSheet: asset, model3d: asset, modelPoster: asset, gallery: [asset] });
  const parsed = parsePublicCatalog(input).products[0];
  assert.equal(parsed.image, asset); assert.equal(parsed.technicalSheet, asset); assert.equal(parsed.model3d, asset);
  for (const dimensions of [{ width: 1600, height: 600 }, { width: 600, height: 1600 }, { width: 800, height: 800 }]) {
    const stage = getProductStage(asset, dimensions);
    const css = Object.fromEntries(stage.style.split(';').map(pair => { const [key, value] = pair.split(':'); return [key, Number.parseFloat(value)]; }));
    assert.equal(stage.width, dimensions.width); assert.equal(stage.height, dimensions.height);
    assert.ok(Math.abs(css['--equipment-width'] / css['--equipment-height'] - dimensions.width / dimensions.height) < .00001);
    assert.equal(css['--image-width'], 100); assert.equal(css['--image-height'], 100);
    assert.equal(css['--image-left'], 0); assert.equal(css['--image-top'], 0);
  }
  assert.equal(safeModel('/media/not-an-id/'), '');
  assert.equal(safeTechnicalSheet('/media/964ca472-b823-440e-8f09-7c32e08a0e5c/../admin/'), '');
});

test('shows all server availability states in Spanish for products and variants', () => {
  for (const [state, label] of [['available', 'Disponible'], ['made_to_order', 'A pedido'], ['unavailable', 'No disponible']]) {
    const input = catalog(); input.products[0].availability = state; input.products[0].variants[0].availability = state;
    const product = parsePublicCatalog(input).products[0];
    assert.equal(formatAvailability(product.availability), label);
    assert.equal(formatAvailability(product.variants?.[0].availability), label);
  }
});

test('allows protected preview media only with the explicit preview flag', () => {
  const asset = '/admin/catalog/mediaasset/964ca472-b823-440e-8f09-7c32e08a0e5c/file/';
  const input = catalog();
  Object.assign(input.products[0], { image: asset, technicalSheet: asset, model3d: asset, modelPoster: asset, gallery: [asset] });
  assert.throws(() => parsePublicCatalog(input));
  assert.throws(() => parsePublicCatalog(input, { preview: false }));
  assert.equal(parsePublicCatalog(input, { preview: true }).products[0].model3d, asset);
  for (const validate of [safeImage, safeModel, safeTechnicalSheet]) {
    assert.equal(safePreviewAsset(asset, validate, false), '');
    assert.equal(safePreviewAsset(asset, validate, true), asset);
    assert.equal(safePreviewAsset(asset.replace('/file/', '/delete/'), validate, true), '');
    assert.equal(safePreviewAsset(asset + '../', validate, true), '');
  }
});

test('rejects unsafe media and social links before returning any product', () => {
  for (const field of ['image', 'technicalSheet', 'model3d', 'modelPoster'] as const) {
    for (const url of ['javascript:alert(1)', '//evil.example/x', '/media/../admin/', 'https://user:password@evil.example/x']) {
      const input = catalog(); input.products[0][field] = url;
      assert.throws(() => parsePublicCatalog(input));
    }
  }
  const input = catalog(); input.settings.facebook = 'javascript:alert(1)';
  assert.throws(() => parsePublicCatalog(input));
});

test('rejects drafts, duplicate routes and invalid amounts without altering input', () => {
  const draft = catalog(); draft.products[0].visible = false; assert.throws(() => parsePublicCatalog(draft));
  const duplicate = catalog(); duplicate.products.push({ ...duplicate.products[0], id: 'new-2' }); assert.throws(() => parsePublicCatalog(duplicate));
  const amount = catalog(); amount.products[0].price = Number.NaN; assert.throws(() => parsePublicCatalog(amount));
  const input = catalog(); const before = JSON.stringify(input); parsePublicCatalog(input); assert.equal(JSON.stringify(input), before);
});

test('ignores private properties even if a server accidentally adds them', () => {
  const input = catalog();
  Object.assign(input.products[0], { cost: 100, internal_notes: 'private' });
  Object.assign(input.settings, { private_token: 'private' });
  const result = parsePublicCatalog(input);
  assert.equal(Object.hasOwn(result.products[0], 'cost'), false);
  assert.equal(Object.hasOwn(result.products[0], 'internal_notes'), false);
  assert.equal(Object.hasOwn(result.settings, 'private_token'), false);
});

test('accepts independent optional additional rates and quote-only options with their billing units', () => {
  const input = catalog();
  input.products[0].showPrice = false;
  Object.assign(input.products[0], { additionals: [
    { id: '1', name: 'Puerta <especial>', description: 'Marco & vidrio', price: null, chargeUnit: 'unit', unitLabel: 'por unidad', cost: 120 },
    { id: '2', name: 'Repisas', description: '', price: 0, chargeUnit: 'm', unitLabel: 'por metro lineal' },
    { id: '3', name: 'Protección', description: '', price: 45.5, chargeUnit: 'm2', unitLabel: '' },
    { id: '4', name: 'Instalación', description: '', price: 90, chargeUnit: 'custom', unitLabel: 'por visita' },
  ] });
  const parsed = parsePublicCatalog(input).products[0];
  assert.deepEqual(parsed.additionals?.map(item => item.price), [null, 0, 45.5, 90]);
  assert.equal(parsed.additionals?.[0].name, 'Puerta <especial>');
  assert.equal(parsed.additionals?.[3].unitLabel, 'por visita');
  assert.equal(Object.hasOwn(parsed.additionals![0], 'cost'), false);
  assert.equal(parsed.additionalCharges?.[0].price, 30);
  assert.deepEqual(parsePublicCatalog(catalog()).products[0].additionals, []);
});

test('rejects malformed optional additionals and duplicate IDs before exposing catalog data', () => {
  const valid = { id: 'extra-1', name: 'Puerta', description: '', price: 10, chargeUnit: 'unit', unitLabel: '' };
  for (const replacement of [
    { id: '<script>' }, { name: '' }, { description: 'x'.repeat(2001) },
    { chargeUnit: 'hours' }, { chargeUnit: 'custom', unitLabel: '  ' },
    { price: -1 }, { price: '10' }, { price: Infinity }, { price: Number.NaN },
  ]) {
    const input = catalog();
    Object.assign(input.products[0], { additionals: [{ ...valid, ...replacement }] });
    assert.throws(() => parsePublicCatalog(input));
  }
  for (const additionals of [[valid, valid], Array.from({ length: 101 }, (_, index) => ({ ...valid, id: String(index) })), 'not a list']) {
    const input = catalog(); Object.assign(input.products[0], { additionals });
    assert.throws(() => parsePublicCatalog(input));
  }
});
