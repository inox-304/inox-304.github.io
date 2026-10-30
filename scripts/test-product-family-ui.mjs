import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cms from '../src/lib/cms.ts';
import * as api from '../src/lib/cms-api.ts';
import * as additionals from '../src/lib/product-additionals.ts';
import * as families from '../src/lib/product-families.ts';
import * as catalogSync from '../src/lib/catalog-sync.ts';
import * as listings from '../src/lib/catalog-listings.ts';
import { getCatalogType } from '../src/lib/catalog-taxonomy.ts';
import { syncCustomization } from '../src/scripts/product-customization.ts';
import { catalogSearchText } from '../src/lib/catalog-controls.ts';
import { getProductStage } from '../src/lib/product-stage.ts';
import { withBase } from '../src/lib/paths.ts';
import { products } from '../src/data/products.ts';
import { parseCooktopConfig } from '../src/lib/cooktop-config.ts';
import { renderVariantOptions } from '../src/scripts/variant-options-ui.ts';
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(productIds = ['P25', 'P26'], variants = [], cooktopConfigs, query = '') {
  function element() {
    return { dataset: {}, hidden: false, textContent: '', value: '', attributes: {}, children: [],
      classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      replaceChildren(...children) { this.children = children; },
      cloneNode() { return element(); }, closest() { return element(); },
    };
  }
  const data = {
    products: productIds.map((id, index) => ({
      ...products.find(product => product.id === id), visible: true, order: index,
      ...(cooktopConfigs ? { supplyType: 'manufactured', equipmentFamily: 'cocinas', cooktopConfig: cooktopConfigs[id] } : {}),
      contactId: 'ventas', currency: 'PEN', price: index ? 950 : 1250, showPrice: index === 0,
      availability: index ? 'made_to_order' : 'available', variants: typeof variants === 'function' ? variants(id) : variants, additionals: [], additionalCharges: [],
      technicalSheet: `/documents/${id}.pdf`,
    })),
    contacts: [{ id: 'ventas', name: 'Ventas', whatsapp: '51964270406', active: true }],
    settings: { empresa: 'INOX 304', contacto_principal: 'ventas' },
  };
  const routes = Object.fromEntries(data.products.map(product => [product.id, `/catalogo/${product.slug}/`]));
  const selectors = ['[data-product-unavailable]', '.product-detail-grid', '[data-product-family]', '[data-product-family-select]',
    '[data-product-family-heading]', '[data-product-family-label]', '[data-product-family-selection]', '[data-product-name]',
    '[data-product-summary]', '[data-product-origin]', '[data-product-category]', '[data-product-id-label]', '[data-product-caption]',
    '.product-detail-photo', '.equipment-image', '[data-product-features]', '[data-product-category-link]', '[data-product-quote]',
    '[data-product-quote-note]', '[data-product-price]', '[data-product-unit]', '[data-product-availability]', '[data-product-variant]',
    '[data-product-variant-label]', '[data-product-commerce]', '[data-product-technical-sheet]', '[data-product-media]'];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, element()]));
  if (cooktopConfigs) nodes['[data-cooktop-root]'] = element();
  const detail = element(); detail.dataset.productDetail = productIds[0];
  detail.querySelector = selector => nodes[selector] || null;
  detail.querySelectorAll = selector => nodes[selector] ? [nodes[selector]] : [];
  const bootstrap = element(); bootstrap.textContent = JSON.stringify({ mode: 'static', routes, data });
  const events = [];
  const cooktopCalls = [];
  const document = {
    documentElement: element(), title: '',
    querySelector: selector => selector === '#inox-cms-bootstrap' ? bootstrap : selector === '[data-product-detail]' ? detail : null,
    querySelectorAll: () => [], createElement: element,
    dispatchEvent: event => events.push(event),
  };
  const location = new URL(`https://example.test${routes[productIds[0]]}${query}`);
  const window = { events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  const history = { pushState(_state, _unused, url) { location.href = new URL(url, location).href; }, replaceState(_state, _unused, url) { location.href = new URL(url, location).href; } };
  const source = readFileSync(new URL('../src/scripts/cms.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('import.meta.env?.PUBLIC_CMS_MODE', 'undefined');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ...cms, ...api, ...additionals, ...families, ...catalogSync, ...listings, getCatalogType, syncCustomization, catalogSearchText, getProductStage, withBase,
    parseCooktopConfig, renderVariantOptions,
    renderCooktop(_root, config, productId, onChange) { cooktopCalls.push({ productId, config }); onChange(''); },
    document, location, window, history, URL, URLSearchParams, CustomEvent,
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
  });
  const select = id => { nodes['[data-product-family-select]'].value = id; nodes['[data-product-family-select]'].onchange(); };
  return { data, routes, detail, nodes, events, location, window, select, cooktopCalls };
}

test('a capacity variant changes its own photograph and restores the main photo without retaining a stale load', () => {
  const variant = { id: 'large', name: 'Capacidad confirmada', image: '/images/products/confirmed-large.webp', model3d: '/models/confirmed-large.glb', availability: 'available', price: 1400 };
  const f = fixture(['P30'], [variant]);
  const select = f.nodes['[data-product-variant]'];
  const image = f.nodes['.equipment-image'];
  const initialLoad = image.onload;
  select.value = 'large'; select.onchange();
  assert.equal(image.src, variant.image);
  assert.match(image.alt, /Capacidad confirmada/);
  image.currentSrc = new URL(withBase(f.data.products[0].image), f.location).href;
  image.naturalWidth = 500; image.naturalHeight = 600;
  const currentStyle = image.attributes.style;
  initialLoad();
  assert.equal(image.attributes.style, currentStyle);
  assert.equal(f.events.filter(event => event.type === 'inox:configuration-updated').at(-1).detail.variant.model3d, variant.model3d);
  assert.match(new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text'), /Capacidad confirmada/);
  select.value = ''; select.onchange();
  assert.equal(image.src, withBase(f.data.products[0].image));
  assert.equal(image.alt, f.data.products[0].name);
});

test('a catalog variant deep link selects its exact photo, GLB, technical sheet and quotation on entry', () => {
  const variant = { id: 'large', name: '25 L confirmados', image: '/images/products/large.webp', model3d: '/models/large.glb', technicalSheet: '/documents/large.pdf', availability: 'made_to_order', price: 1700 };
  const f = fixture(['P30'], [variant], undefined, '?variant=large');
  assert.equal(f.nodes['[data-product-variant]'].value, 'large');
  assert.equal(f.nodes['.equipment-image'].src, variant.image);
  assert.equal(f.nodes['[data-product-technical-sheet]'].href, variant.technicalSheet);
  assert.equal(f.events.filter(event => event.type === 'inox:configuration-updated').at(-1).detail.variant.model3d, variant.model3d);
  assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]700/);
  const quote = new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text');
  assert.match(quote, /25 L confirmados/);
  assert.match(quote, /\?variant=large/);
});

test('manual variant changes update the shareable URL and selecting the principal configuration removes the query', () => {
  const f = fixture(['P30'], [{ id: 'large', name: 'Mayor capacidad', availability: 'available' }]);
  const select = f.nodes['[data-product-variant]'];
  select.value = 'large'; select.onchange();
  assert.equal(f.location.searchParams.get('variant'), 'large');
  assert.equal(f.detail.dataset.variantRequest, 'large');
  select.value = ''; select.onchange();
  assert.equal(f.location.searchParams.has('variant'), false);
  assert.equal(f.detail.dataset.variantRequest, '');
  assert.doesNotMatch(new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text'), /variant=large|variación Mayor capacidad/);
});

test('back and forward within one product restore the requested variant instead of preserving a stale selection', () => {
  const variants = [
    { id: 'small', name: '10 L', image: '/images/products/small.webp', model3d: '/models/small.glb', availability: 'available' },
    { id: 'large', name: '25 L', image: '/images/products/large.webp', model3d: '/models/large.glb', availability: 'made_to_order' },
  ];
  const f = fixture(['P30'], variants, undefined, '?variant=large');
  for (const variant of [variants[0], variants[1]]) {
    f.location.href = `https://example.test${f.routes.P30}?variant=${variant.id}`; f.window.events.popstate();
    assert.equal(f.nodes['[data-product-variant]'].value, variant.id);
    assert.equal(f.nodes['.equipment-image'].src, variant.image);
    assert.equal(f.events.filter(event => event.type === 'inox:configuration-updated').at(-1).detail.variant.model3d, variant.model3d);
    assert.ok(new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text').includes(`variación ${variant.name}`));
  }
  f.location.href = `https://example.test${f.routes.P30}`; f.window.events.popstate();
  assert.equal(f.nodes['[data-product-variant]'].value, '');
  assert.equal(f.nodes['.equipment-image'].src, withBase(f.data.products[0].image));
});

test('unknown or other-SKU variant IDs fall back to the current base and cannot borrow the previous model', () => {
  const variant = { id: 'large', name: 'Mayor capacidad', image: '/images/products/large.webp', model3d: '/models/large.glb', availability: 'available' };
  const f = fixture(['P30', 'P31'], id => id === 'P30' ? [variant] : [], undefined, '?variant=unknown');
  assert.equal(f.nodes['[data-product-variant]'].value, '');
  assert.equal(f.nodes['.equipment-image'].src, withBase(f.data.products[0].image));
  f.nodes['[data-product-variant]'].value = 'large'; f.nodes['[data-product-variant]'].onchange();
  f.select('P31');
  assert.equal(f.location.searchParams.has('variant'), false);
  f.location.href = `https://example.test${f.routes.P31}?variant=large`; f.window.events.popstate();
  assert.equal(f.nodes['[data-product-variant]'].value, '');
  assert.equal(f.nodes['.equipment-image'].src, withBase(f.data.products[1].image));
  assert.equal(f.events.filter(event => event.type === 'inox:configuration-updated').at(-1).detail.variant, undefined);
  assert.equal(f.events.filter(event => event.type === 'inox:product-updated').at(-1).detail.product.model3d, f.data.products[1].model3d);
  assert.doesNotMatch(new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text'), /Mayor capacidad|variant=large|código P30/);
});

test('escurridor selection switches the complete SKU, photograph, PDF, quote and media event without combining prices', () => {
  const f = fixture();
  assert.equal(f.nodes['[data-product-family-heading]'].textContent, 'Adicional de escurridor');
  assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]250/);
  assert.equal(f.nodes['[data-product-availability]'].textContent, 'Disponible');
  f.select('P26');
  const product = f.data.products.find(product => product.id === 'P26');
  assert.equal(f.detail.dataset.productDetail, 'P26');
  assert.equal(f.nodes['[data-product-name]'].textContent, product.name);
  assert.equal(f.nodes['.equipment-image'].src, withBase(product.image));
  assert.equal(f.nodes['[data-product-technical-sheet]'].href, '/documents/P26.pdf');
  assert.equal(f.nodes['[data-product-price]'].hidden, true);
  assert.equal(f.nodes['[data-product-price]'].textContent, '');
  assert.equal(f.nodes['[data-product-availability]'].textContent, 'A pedido');
  const quote = new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text');
  assert.ok(quote.includes(product.name));
  assert.match(quote, /código P26/);
  assert.match(quote, /Adicional de escurridor: Sin escurridor/);
  assert.ok(!quote.includes('código P25'));
  assert.equal(f.location.pathname, f.routes.P26);
  const media = f.events.filter(event => event.type === 'inox:product-updated').at(-1).detail.product;
  assert.equal(media.id, 'P26');
  assert.equal(media.model3d, product.model3d);
  assert.equal(media.image, product.image);
});

test('back and forward restore the selected sink configuration, including its public price and quotation', () => {
  const f = fixture();
  f.select('P26');
  f.location.href = `https://example.test${f.routes.P25}`; f.window.events.popstate();
  assert.equal(f.nodes['[data-product-family-select]'].value, 'P25');
  assert.equal(f.nodes['[data-product-price]'].hidden, false);
  assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]250/);
  assert.match(f.nodes['[data-product-family-selection]'].textContent, /Con escurridor.*Código P25/);
  assert.match(new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text'), /Adicional de escurridor: Con escurridor/);
  f.location.href = `https://example.test${f.routes.P26}`; f.window.events.popstate();
  assert.equal(f.nodes['[data-product-family-select]'].value, 'P26');
  assert.equal(f.nodes['[data-product-price]'].hidden, true);
  assert.match(f.nodes['[data-product-family-selection]'].textContent, /Sin escurridor.*Código P26/);
});

test('blender variation changes the full SKU, image, GLB, features, quote and route, and back restores it', () => {
  const f = fixture(['P30', 'P31']);
  assert.equal(f.nodes['[data-product-family-heading]'].textContent, 'Variación');
  f.select('P31');
  const product = f.data.products.find(product => product.id === 'P31');
  assert.equal(f.detail.dataset.productDetail, 'P31');
  assert.equal(f.nodes['[data-product-name]'].textContent, product.name);
  assert.equal(f.nodes['[data-product-summary]'].textContent, product.summary);
  assert.equal(f.nodes['.equipment-image'].src, withBase(product.image));
  assert.equal(f.nodes['[data-product-technical-sheet]'].href, '/documents/P31.pdf');
  assert.equal(f.nodes['[data-product-price]'].hidden, true);
  assert.equal(f.nodes['[data-product-availability]'].textContent, 'A pedido');
  assert.deepEqual(Array.from(f.nodes['[data-product-features]'].children, item => item.textContent), product.features);
  assert.equal(f.location.pathname, f.routes.P31);
  const quote = new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text');
  assert.match(quote, /código P31/);
  assert.match(quote, /Variación: Modelo con base/);
  assert.ok(!quote.includes('código P30'));
  const media = f.events.filter(event => event.type === 'inox:product-updated').at(-1).detail.product;
  assert.equal(media.model3d, product.model3d);
  assert.equal(media.image, product.image);
  f.location.href = `https://example.test${f.routes.P30}`; f.window.events.popstate();
  assert.equal(f.nodes['[data-product-family-select]'].value, 'P30');
  assert.equal(f.nodes['.equipment-image'].src, withBase(f.data.products[0].image));
  assert.equal(f.events.filter(event => event.type === 'inox:product-updated').at(-1).detail.product.model3d, f.data.products[0].model3d);
  assert.match(f.nodes['[data-product-family-selection]'].textContent, /Modelo industrial.*Código P30/);
});

test('central-kitchen version switches its image, GLB, route and separately validated cooktop rules', () => {
  const first = JSON.parse(readFileSync(new URL('./fixtures/cooktop.json', import.meta.url), 'utf8'));
  const second = { ...structuredClone(first), modules: [structuredClone(first.modules[0])] };
  const f = fixture(['P04', 'P05'], [], { P04: first, P05: second });
  assert.equal(f.nodes['[data-product-family-heading]'].textContent, 'Versión');
  assert.deepEqual(plain(f.cooktopCalls.at(-1)), plain({ productId: 'P04', config: parseCooktopConfig(first) }));
  f.select('P05');
  const product = f.data.products[1];
  assert.equal(f.detail.dataset.productDetail, 'P05');
  assert.equal(f.nodes['.equipment-image'].src, withBase(product.image));
  assert.equal(f.nodes['[data-product-name]'].textContent, product.name);
  assert.equal(f.location.pathname, f.routes.P05);
  const media = f.events.filter(event => event.type === 'inox:product-updated').at(-1).detail.product;
  assert.equal(media.model3d, product.model3d);
  assert.deepEqual(plain(media.cooktopConfig), second);
  assert.deepEqual(plain(f.cooktopCalls.at(-1)), plain({ productId: 'P05', config: parseCooktopConfig(second) }));
  assert.equal(f.cooktopCalls.at(-1).config.modules.length, 1, 'P04 options must not be inherited');
  assert.match(new URL(f.nodes['[data-product-quote]'].href).searchParams.get('text'), /código P05.*Versión: CÓD-CHI-04/);
  f.location.href = `https://example.test${f.routes.P04}`; f.window.events.popstate();
  assert.equal(f.nodes['[data-product-family-select]'].value, 'P04');
  assert.deepEqual(plain(f.cooktopCalls.at(-1)), plain({ productId: 'P04', config: parseCooktopConfig(first) }));
  assert.equal(f.events.filter(event => event.type === 'inox:product-updated').at(-1).detail.product.model3d, f.data.products[0].model3d);
});

test('invalid rules for the second central version cannot inherit approved rules from the first', () => {
  const first = JSON.parse(readFileSync(new URL('./fixtures/cooktop.json', import.meta.url), 'utf8'));
  const f = fixture(['P04', 'P05'], [], { P04: first, P05: { version: 999 } });
  assert.ok(f.cooktopCalls.at(-1).config);
  f.select('P05');
  assert.deepEqual(f.cooktopCalls.at(-1), { productId: 'P05', config: null });
});
