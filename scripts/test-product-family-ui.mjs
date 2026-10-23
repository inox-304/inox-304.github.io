import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cms from '../src/lib/cms.ts';
import * as api from '../src/lib/cms-api.ts';
import * as additionals from '../src/lib/product-additionals.ts';
import * as families from '../src/lib/product-families.ts';
import { catalogSearchText } from '../src/lib/catalog-controls.ts';
import { getProductStage } from '../src/lib/product-stage.ts';
import { withBase } from '../src/lib/paths.ts';
import { products } from '../src/data/products.ts';

function fixture() {
  function element() {
    return { dataset: {}, hidden: false, textContent: '', value: '', attributes: {}, children: [],
      classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      replaceChildren(...children) { this.children = children; },
      cloneNode() { return element(); }, closest() { return element(); },
    };
  }
  const data = {
    products: ['P25', 'P26'].map((id, index) => ({
      ...products.find(product => product.id === id), visible: true, order: index,
      contactId: 'ventas', currency: 'PEN', price: index ? 950 : 1250, showPrice: index === 0,
      availability: index ? 'made_to_order' : 'available', variants: [], additionals: [], additionalCharges: [],
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
  const detail = element(); detail.dataset.productDetail = 'P25';
  detail.querySelector = selector => nodes[selector] || null;
  detail.querySelectorAll = selector => nodes[selector] ? [nodes[selector]] : [];
  const bootstrap = element(); bootstrap.textContent = JSON.stringify({ mode: 'static', routes, data });
  const events = [];
  const document = {
    documentElement: element(), title: '',
    querySelector: selector => selector === '#inox-cms-bootstrap' ? bootstrap : selector === '[data-product-detail]' ? detail : null,
    querySelectorAll: () => [], createElement: element,
    dispatchEvent: event => events.push(event),
  };
  const location = new URL(`https://example.test${routes.P25}`);
  const window = { events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  const history = { pushState(_state, _unused, url) { location.href = new URL(url, location).href; } };
  const source = readFileSync(new URL('../src/scripts/cms.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('import.meta.env?.PUBLIC_CMS_MODE', 'undefined');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ...cms, ...api, ...additionals, ...families, catalogSearchText, getProductStage, withBase,
    document, location, window, history, URL, URLSearchParams, CustomEvent,
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
  });
  const select = id => { nodes['[data-product-family-select]'].value = id; nodes['[data-product-family-select]'].onchange(); };
  return { data, routes, detail, nodes, events, location, window, select };
}

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
