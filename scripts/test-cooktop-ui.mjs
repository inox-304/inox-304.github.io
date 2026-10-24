import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cms from '../src/lib/cms.ts';
import * as api from '../src/lib/cms-api.ts';
import * as additionals from '../src/lib/product-additionals.ts';
import * as families from '../src/lib/product-families.ts';
import * as cooktop from '../src/lib/cooktop-config.ts';
import * as cooktopAssets from '../src/lib/cooktop-assets.ts';
import { catalogSearchText } from '../src/lib/catalog-controls.ts';
import { getProductStage } from '../src/lib/product-stage.ts';
import { withBase } from '../src/lib/paths.ts';
import { renderVariantOptions } from '../src/scripts/variant-options-ui.ts';

const rules = JSON.parse(readFileSync(new URL('./fixtures/cooktop.json', import.meta.url), 'utf8'));
const script = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '').replace('import.meta.env?.PUBLIC_CMS_MODE', 'undefined');
const browserSource = ts.transpileModule(`${script('../src/scripts/cooktop-ui.ts')}\n${script('../src/scripts/cms.ts')}\nwindow.cooktopTestApi = { pickCooktopAnchor, readCooktop };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function catalog() {
  const base = { id: 'COOK-A', slug: 'cocina-a', name: 'Cocina de prueba A', category: 'linea-caliente',
    supplyType: 'manufactured', equipmentFamily: 'cocinas', summary: 'Cocina de prueba', features: ['Acero inoxidable'],
    image: '/images/products/test-cooktop.webp', visible: true, featured: false, order: 1, contactId: 'ventas',
    price: 1400, showPrice: true, currency: 'PEN', availability: 'available', unitLabel: 'por equipo',
    technicalSheet: '/documents/test-cooktop.pdf', model3d: '/models/test-cooktop.glb', modelPoster: '', gallery: [],
    cooktopConfig: structuredClone(rules),
    variants: [{ id: 'independent', name: 'Versión independiente', price: 1800, availability: 'made_to_order' }],
    additionals: [], additionalCharges: [] };
  return { products: [base,
    { ...structuredClone(base), id: 'COOK-B', slug: 'cocina-b', name: 'Cocina de prueba B', order: 2, price: 2100, variants: [] },
    { ...structuredClone(base), id: 'ILUMI-DJ-181', slug: 'dispensador-prueba', name: 'Dispensador de prueba', order: 3,
      supplyType: 'distributed', category: 'linea-fria', equipmentFamily: 'dispensadores', cooktopConfig: null, price: 4200, variants: [] }],
    contacts: [{ id: 'ventas', name: 'Ventas', whatsapp: '51964270406', phone: '964270406', email: '', message: 'Hola INOX 304.', active: true }],
    settings: { empresa: 'INOX 304', contacto_principal: 'ventas' } };
}

function fixture({ data = catalog(), preview = false, remoteRules } = {}) {
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.style = {};
      this.value = ''; this.hidden = false; this._text = ''; this.events = {}; this.className = '';
      this.classList = { toggle: (name, enabled) => { const classes = new Set(this.className.split(' ').filter(Boolean)); enabled ? classes.add(name) : classes.delete(name); this.className = [...classes].join(' '); }, add: name => this.classList.toggle(name, true) };
    }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = value; this.children = []; }
    get firstElementChild() { return this.children[0] || null; }
    get childElementCount() { return this.children.length; }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
    cloneNode() { return new Element(this.tagName); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    closest() { return new Element(); }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) this.onclick?.(); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const matches = node => {
        if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
        const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attribute) {
          const name = attribute[1], key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          const value = name.startsWith('data-') ? node.dataset[key] : node.attributes[name];
          return attribute[2] === undefined ? value !== undefined : value === attribute[2];
        }
        return node.tagName.toLowerCase() === selector;
      };
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
  }
  const selectors = ['[data-product-unavailable]', '.product-detail-grid', '[data-product-family]', '[data-product-family-select]',
    '[data-product-family-heading]', '[data-product-family-label]', '[data-product-family-selection]', '[data-product-name]',
    '[data-product-summary]', '[data-product-origin]', '[data-product-category]', '[data-product-id-label]', '[data-product-caption]',
    '.product-detail-photo', '.equipment-image', '[data-product-features]', '[data-product-category-link]', '[data-product-quote]',
    '[data-product-quote-note]', '[data-product-price]', '[data-product-unit]', '[data-product-availability]', '[data-product-variant]',
    '[data-product-variant-label]', '[data-product-commerce]', '[data-product-technical-sheet]', '[data-product-media]', '[data-cooktop-root]'];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, new Element()]));
  const root = nodes['[data-cooktop-root]']; root.hidden = true;
  const detail = new Element(); detail.dataset.productDetail = data.products[0].id;
  detail.querySelector = selector => nodes[selector] || null;
  detail.querySelectorAll = selector => nodes[selector] ? [nodes[selector]] : [];
  const routes = Object.fromEntries(data.products.map(product => [product.id, `/catalogo/${product.slug}/`]));
  const bootstrap = new Element('script'); bootstrap.textContent = JSON.stringify({ mode: 'static', preview, routes, data, ...(remoteRules !== undefined ? { cooktopOrigin: 'https://panel.example.test' } : {}) });
  const events = [], requests = [];
  document = { activeElement: null, documentElement: new Element(), title: '',
    querySelector: selector => selector === '#inox-cms-bootstrap' ? bootstrap : selector === '[data-product-detail]' ? detail : null,
    querySelectorAll: () => [], createElement: tag => new Element(tag), dispatchEvent: event => events.push(event) };
  const location = new URL(`https://example.test${routes[data.products[0].id]}`);
  const window = { events: {}, addEventListener(name, action) { this.events[name] = action; }, setTimeout: () => 1, clearTimeout() {} };
  const history = { pushState(_state, _unused, url) { location.href = new URL(url, location).href; } };
  runInNewContext(browserSource, { ...cms, ...api, ...additionals, ...families, ...cooktop, ...cooktopAssets,
    catalogSearchText, getProductStage, withBase, renderVariantOptions, document, location, window, history, URL, URLSearchParams, CustomEvent, AbortController, Error,
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return { ok: true, json: async () => structuredClone(remoteRules) }; },
    Option: class extends Element { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } },
  });
  const select = (selector, value) => { const node = root.querySelector(selector); assert.ok(node, selector); node.value = value; node.onchange(); };
  const selectCell = anchor => { const cell = root.querySelector(`[data-anchor="${anchor}"]`); assert.ok(cell, `cell ${anchor}`); cell.click(); };
  const moduleButton = name => root.querySelectorAll('.cooktop-module-option').find(option => option.querySelector('strong')?.textContent === name);
  const armModule = name => { const option = moduleButton(name); assert.ok(option, name); assert.equal(option.disabled, false, `${name} must be eligible`); option.click(); };
  const chooseModule = name => { armModule(name); const apply = root.querySelector('.cooktop-apply'); assert.ok(apply); assert.equal(apply.disabled, false); apply.click(); };
  const pick3d = anchor => window.cooktopTestApi.pickCooktopAnchor(root, detail.dataset.productDetail, anchor);
  const selection = () => window.cooktopTestApi.readCooktop(root, detail.dataset.productDetail)?.selection;
  const variant = value => { nodes['[data-product-variant]'].value = value; nodes['[data-product-variant]'].onchange(); };
  const product = id => { location.href = `https://example.test${routes[id]}`; window.events.popstate(); };
  const quote = () => new URL(nodes['[data-product-quote]'].href).searchParams.get('text');
  return { data, root, nodes, detail, document, events, requests, select, selectCell, chooseModule, armModule, moduleButton, pick3d, selection, variant, product, quote,
    summary: () => root.querySelector('.cooktop-summary')?.textContent || '', flush: () => new Promise(resolve => setImmediate(resolve)) };
}

test('eligible kitchen renders six base positions and quotes the selected left plate and wok with three common burners', () => {
  const f = fixture();
  assert.equal(f.root.hidden, false); assert.equal(f.root.querySelectorAll('.cooktop-cell').length, 6);
  assert.equal(f.summary(), '6 hornillas comunes');
  assert.equal(f.nodes['[data-product-price]'].textContent, 'A cotizar');
  assert.equal(f.nodes['[data-product-unit]'].hidden, true);
  f.chooseModule('Plancha'); f.selectCell(2); f.chooseModule('Wok');
  assert.equal(f.summary(), '3 hornillas comunes · 1 Wok · 1 Plancha');
  assert.equal(f.root.querySelector('[data-anchor="0"]').style.gridRow, '1 / span 2');
  assert.match(f.quote(), /código COOK-A/);
  assert.match(f.quote(), /Plancha: posiciones 1, 4/); assert.match(f.quote(), /Wok: posiciones 3/);
  assert.match(f.quote(), /3 hornillas comunes/); assert.match(f.quote(), /Visualización ilustrativa/);
  assert.doesNotMatch(f.quote(), /3D mostrado corresponde al equipo base/);
  const event = f.events.filter(event => event.type === 'inox:cooktop-updated').at(-1);
  assert.equal(event.detail.productId, 'COOK-A'); assert.equal(event.detail.interactive, true);
  assert.equal(event.detail.state.selection.placements.length, 2);
});

test('energy and layout changes reset optional modules with an announcement and retain focus on the chosen control', () => {
  const f = fixture(); f.chooseModule('Plancha'); f.selectCell(2); f.chooseModule('Wok');
  f.select('[aria-label="Energía de la superficie"]', 'electric');
  assert.equal(f.summary(), '6 hornillas comunes');
  assert.match(f.root.querySelector('.cooktop-status').textContent, /Cambió la energía/);
  assert.equal(f.document.activeElement.getAttribute('aria-label'), 'Energía de la superficie');
  assert.equal(f.moduleButton('Wok').disabled, true);
  assert.doesNotMatch(f.quote(), /Wok:|Plancha:/); assert.match(f.quote(), /Eléctrica/);
  f.chooseModule('Plancha'); f.select('[aria-label="Base de la cocina"]', 'four');
  assert.equal(f.summary(), '4 hornillas comunes'); assert.doesNotMatch(f.quote(), /Plancha:/);
  assert.match(f.root.querySelector('.cooktop-status').textContent, /Cambió la base/);
});

test('five-column linear and central surfaces retain all selectable positions and minimum-size grid tracks', () => {
  const data = catalog(), config = data.products[0].cooktopConfig;
  config.layouts = [{ id: 'linear', name: 'Lineal de 5', rows: 1, columns: 5 }, { id: 'central', name: 'Central de 10', rows: 2, columns: 5 }];
  config.modules = config.modules.slice(0, 2);
  for (const module of config.modules) {
    module.allowedLayouts = ['linear', 'central'];
    module.anchors = { linear: [0, 1, 2, 3, 4], central: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  }
  config.modules[0].maxQuantity = 10;
  const f = fixture({ data });
  assert.equal(f.root.querySelectorAll('.cooktop-cell').length, 5);
  assert.equal(f.root.querySelector('.cooktop-grid').style.gridTemplateColumns, 'repeat(5, minmax(44px, 1fr))');
  f.selectCell(4); f.chooseModule('Wok'); assert.match(f.quote(), /Wok: posiciones 5/);
  assert.equal(f.document.activeElement.dataset.anchor, '4');
  f.select('[aria-label="Base de la cocina"]', 'central');
  assert.equal(f.root.querySelectorAll('.cooktop-cell').length, 10); assert.equal(f.summary(), '10 hornillas comunes');
  f.selectCell(9); f.chooseModule('Wok'); assert.match(f.quote(), /Wok: posiciones 10/);
  assert.equal(f.summary(), '9 hornillas comunes · 1 Wok');
});

test('an independent variant hides the base rules, clears the configured quote and restores its own price and availability', () => {
  const f = fixture(); f.chooseModule('Wok');
  f.variant('independent');
  assert.equal(f.root.hidden, true); assert.equal(f.root.childElementCount, 0);
  assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]800/);
  assert.equal(f.nodes['[data-product-unit]'].hidden, false);
  assert.equal(f.nodes['[data-product-availability]'].textContent, 'A pedido');
  assert.match(f.quote(), /variación Versión independiente/); assert.doesNotMatch(f.quote(), /Wok|Distribución solicitada/);
  f.variant('');
  assert.equal(f.root.hidden, false); assert.equal(f.summary(), '6 hornillas comunes');
  assert.equal(f.nodes['[data-product-price]'].textContent, 'A cotizar'); assert.doesNotMatch(f.quote(), /Wok:/);
});

test('moving to another kitchen resets its options; a dispenser hides the UI and cannot inherit wok text or quote-only pricing', () => {
  const f = fixture(); f.chooseModule('Wok'); f.product('COOK-B');
  assert.equal(f.summary(), '6 hornillas comunes'); assert.doesNotMatch(f.quote(), /Wok:/); assert.match(f.quote(), /código COOK-B/);
  f.chooseModule('Wok'); f.product('ILUMI-DJ-181');
  assert.equal(f.root.hidden, true); assert.equal(f.root.childElementCount, 0);
  assert.match(f.nodes['[data-product-price]'].textContent, /4[,.]200/);
  assert.match(f.quote(), /Dispensador de prueba/); assert.doesNotMatch(f.quote(), /Wok|hornillas|Distribución solicitada/);
  f.product('COOK-A'); assert.equal(f.summary(), '6 hornillas comunes');
});

test('malformed rules and noneligible identities fail closed in both the DOM and public catalog parser', () => {
  const changes = [
    product => { product.cooktopConfig.foreignProductId = 'OTHER'; },
    product => { product.cooktopConfig.modules[2].anchors.six = [3]; },
    product => { product.supplyType = 'distributed'; },
    product => { product.category = 'linea-fria'; },
    product => { product.equipmentFamily = 'mesas'; },
  ];
  for (const change of changes) {
    const data = catalog(); change(data.products[0]);
    assert.throws(() => api.parsePublicCatalog(data));
    const f = fixture({ data });
    assert.equal(f.root.hidden, true); assert.equal(f.root.childElementCount, 0);
    assert.doesNotMatch(f.quote(), /Distribución solicitada/);
    assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]400/);
  }
});

test('disabled drafts appear only in explicit private preview', () => {
  const data = catalog(); data.products[0].cooktopConfig.enabled = false;
  assert.equal(fixture({ data }).root.hidden, true);
  const privateView = fixture({ data, preview: true });
  assert.equal(privateView.root.hidden, false); assert.match(privateView.root.textContent, /Borrador privado/);
  assert.throws(() => api.parsePublicCatalog(data));
  assert.equal(api.parsePublicCatalog(data, { preview: true }).products[0].cooktopConfig.enabled, false);
});

test('static remote rules for another SKU are ignored and never send a session cookie', async () => {
  const data = catalog(); data.products[0].cooktopConfig = null;
  const f = fixture({ data, remoteRules: { productId: 'FOREIGN', cooktopConfig: rules } }); await f.flush();
  assert.equal(f.root.hidden, true); assert.doesNotMatch(f.quote(), /Distribución solicitada/);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.credentials, 'omit');
});

test('approved remote rules can configure a legacy hot kitchen whose static family was not yet assigned', async () => {
  const data = catalog(); data.products[0].equipmentFamily = ''; data.products[0].cooktopConfig = null;
  const f = fixture({ data, remoteRules: { productId: 'COOK-A', cooktopConfig: rules } });
  assert.equal(f.root.hidden, true); await f.flush();
  assert.equal(f.root.hidden, false); assert.equal(f.summary(), '6 hornillas comunes');
  assert.equal(f.nodes['[data-product-price]'].textContent, 'A cotizar');
  f.chooseModule('Wok'); assert.match(f.quote(), /Wok: posiciones 1/);
});

test('remote rules arriving after selecting an independent variant stay hidden until returning to the base', async () => {
  const data = catalog(); data.products[0].cooktopConfig = null;
  const f = fixture({ data, remoteRules: { productId: 'COOK-A', cooktopConfig: rules } });
  f.variant('independent'); await f.flush();
  assert.equal(f.root.hidden, true); assert.doesNotMatch(f.quote(), /Distribución solicitada/);
  assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]800/);
  f.variant(''); assert.equal(f.root.hidden, false); assert.equal(f.summary(), '6 hornillas comunes');
  assert.equal(f.nodes['[data-product-price]'].textContent, 'A cotizar');
});

test('static remote rules are not requested for a distributed product', async () => {
  const data = catalog(); data.products[0].supplyType = 'distributed'; data.products[0].cooktopConfig = null;
  const f = fixture({ data, remoteRules: { productId: 'COOK-A', cooktopConfig: rules } }); await f.flush();
  assert.equal(f.root.hidden, true); assert.doesNotMatch(f.quote(), /Distribución solicitada/);
  assert.equal(f.requests.length, 0);
  assert.match(f.nodes['[data-product-price]'].textContent, /1[,.]400/);
});

test('palette arms a part without changing the kitchen; tapping its lower half places its full approved footprint', () => {
  const f = fixture(), live = f.root.querySelector('.cooktop-status');
  f.armModule('Plancha');
  assert.equal(f.summary(), '6 hornillas comunes');
  let interaction = f.events.filter(event => event.type === 'inox:cooktop-interaction').at(-1).detail.interaction;
  assert.equal(interaction.moduleId, 'plate'); assert.deepEqual([...interaction.validCells], [0, 3]);
  const lower = f.root.querySelector('[data-anchor="3"]'); lower.onmouseenter();
  interaction = f.events.filter(event => event.type === 'inox:cooktop-interaction').at(-1).detail.interaction;
  assert.deepEqual([...interaction.previewCells], [0, 3]);
  assert.match(f.root.querySelector('[data-anchor="0"]').className, /is-preview-target/);
  assert.match(lower.className, /is-preview-target/);
  lower.onmouseleave(); assert.equal(f.events.at(-1).detail.interaction.previewCells.length, 0);
  f.selectCell(3);
  assert.equal(f.summary(), '4 hornillas comunes · 1 Plancha');
  assert.equal(f.document.activeElement.dataset.anchor, '0');
  assert.equal(f.root.querySelector('.cooktop-status'), live, 'live region remains mounted across redraws');
  assert.equal(f.root.querySelector('.cooktop-apply'), null);
});

test('3D picks place the armed module, normalize covered anchors and can remove it to recover both burners', () => {
  const f = fixture(); f.armModule('Plancha'); f.pick3d(3);
  assert.equal(f.summary(), '4 hornillas comunes · 1 Plancha');
  f.pick3d(3); assert.equal(f.document.activeElement.dataset.anchor, '0');
  assert.equal(f.events.filter(event => event.type === 'inox:cooktop-interaction').at(-1).detail.interaction.anchor, 0);
  f.root.querySelector('.cooktop-remove').click();
  assert.equal(f.summary(), '6 hornillas comunes'); assert.equal(f.root.querySelectorAll('.cooktop-cell').length, 6);
  assert.match(f.root.querySelector('.cooktop-status').textContent, /Recuperaste las hornillas/);
});

test('invalid placement preserves the existing neighbor and allows selecting another tool', () => {
  const data = catalog(); data.products[0].cooktopConfig.modules.find(module => module.id === 'plate').anchors.six = [0, 1];
  const f = fixture({ data }); f.selectCell(3); f.chooseModule('Wok'); f.armModule('Plancha');
  f.selectCell(0);
  assert.equal(f.summary(), '5 hornillas comunes · 1 Wok');
  assert.equal(f.selection().placements.length, 1); assert.equal(f.selection().placements[0].anchor, 3);
  assert.match(f.root.querySelector('.cooktop-status').textContent, /superponerse|Retira/);
  f.armModule('Parrilla'); f.selectCell(4);
  assert.equal(f.summary(), '3 hornillas comunes · 1 Wok · 1 Parrilla');
});

test('undo and redo restore surface, layout and energy together; a new edit clears redo', () => {
  const f = fixture(); f.chooseModule('Plancha');
  f.select('[aria-label="Base de la cocina"]', 'four');
  assert.equal(f.summary(), '4 hornillas comunes');
  f.root.querySelector('.cooktop-undo').click();
  assert.equal(f.summary(), '4 hornillas comunes · 1 Plancha'); assert.equal(f.selection().layoutId, 'six');
  f.root.querySelector('.cooktop-redo').click(); assert.equal(f.selection().layoutId, 'four');
  f.root.querySelector('.cooktop-undo').click();
  f.select('[aria-label="Energía de la superficie"]', 'electric');
  assert.equal(f.root.querySelector('.cooktop-redo').disabled, true);
  f.root.querySelector('.cooktop-undo').click(); assert.equal(f.selection().energy, 'gas'); assert.equal(f.selection().placements.length, 1);
});

function kitchenCatalog() {
  const data = catalog();
  data.products[0].cooktopConfig.kitchen = { family: 'central', ovens: ['none', 'gas', 'electric'], structures: ['open', 'cabinet'], supports: ['feet', 'wheels'],
    materials: [{ id: 'thin', name: '304 mate', steel: '304', thicknessMm: 1 }, { id: 'thick', name: '304 mate reforzada', steel: '304', thicknessMm: 2 }],
    dimensions: { widthMm: { min: 1200, max: 1800, step: 100 }, depthMm: { min: 700, max: 1000, step: 50 }, heightMm: { min: 850, max: 950, step: 50 } } };
  return data;
}

test('owner-approved oven, structure, dimensions and worktop choices update the scene state and quotation with undo', () => {
  const f = fixture({ data: kitchenCatalog() });
  assert.match(f.root.textContent, /Cocina central/); assert.match(f.root.textContent, /1 · Horno/); assert.match(f.root.textContent, /2 · Estructura/); assert.match(f.root.textContent, /3 · Medidas y cubierta/);
  f.select('[data-kitchen-field="oven"]', 'electric');
  f.select('[data-kitchen-field="structure"]', 'cabinet');
  f.select('[data-kitchen-field="support"]', 'wheels');
  f.select('[data-kitchen-field="materialId"]', 'thick');
  f.select('[data-kitchen-field="widthMm"]', '1500');
  const chosen = f.selection().kitchen;
  assert.equal(chosen.oven, 'electric'); assert.equal(chosen.structure, 'cabinet'); assert.equal(chosen.support, 'wheels'); assert.equal(chosen.materialId, 'thick'); assert.equal(chosen.widthMm, 1500);
  assert.equal(f.document.activeElement.dataset.kitchenField, 'widthMm');
  assert.match(f.quote(), /1500 × 700 × 850 mm/); assert.match(f.quote(), /Horno: eléctrico/);
  assert.match(f.quote(), /Estructura: con gabinete/); assert.match(f.quote(), /Apoyos: ruedas/); assert.match(f.quote(), /Cubierta: 304 mate reforzada, acero 304, 2 mm/);
  const updated = f.events.filter(event => event.type === 'inox:cooktop-updated').at(-1);
  assert.equal(updated.detail.interactive, true); assert.equal(updated.detail.state.selection.kitchen.widthMm, 1500);
  f.root.querySelector('.cooktop-undo').click(); assert.equal(f.selection().kitchen.widthMm, 1200); assert.equal(f.selection().kitchen.materialId, 'thick');
});

test('invalid or blank measurements and unapproved choices never reach selection or quotation', () => {
  const f = fixture({ data: kitchenCatalog() });
  for (const value of ['1250', '9000', '', 'Infinity']) {
    f.select('[data-kitchen-field="widthMm"]', value);
    assert.equal(f.selection().kitchen.widthMm, 1200); assert.equal(f.root.querySelector('[data-kitchen-field="widthMm"]').getAttribute('aria-invalid'), 'true');
  }
  f.select('[data-kitchen-field="oven"]', 'unapproved'); assert.equal(f.selection().kitchen.oven, 'none');
  f.select('[data-kitchen-field="widthMm"]', '1600'); assert.equal(f.selection().kitchen.widthMm, 1600);
  assert.equal(f.root.querySelector('[data-kitchen-field="widthMm"]').getAttribute('aria-invalid'), null);
});

test('unconfigured kitchen options stay absent instead of inventing owner permissions', () => {
  const data = kitchenCatalog(); Object.assign(data.products[0].cooktopConfig.kitchen, { ovens: [], structures: [], supports: [], materials: [], dimensions: null });
  const f = fixture({ data });
  assert.equal(f.root.querySelectorAll('[data-kitchen-field]').length, 0);
  assert.equal(f.selection().kitchen.oven, null); assert.equal(f.selection().kitchen.widthMm, null);
  assert.match(f.root.textContent, /no ofrece opciones de horno/);
});

test('an identical hosted rules refresh preserves the customer configuration and its full quotation', async () => {
  const data = kitchenCatalog();
  const f = fixture({ data, remoteRules: { productId: 'COOK-A', cooktopConfig: data.products[0].cooktopConfig } });
  f.select('[data-kitchen-field="oven"]', 'electric'); f.select('[data-kitchen-field="widthMm"]', '1500'); f.chooseModule('Plancha');
  const before = JSON.stringify(f.selection()), quote = f.quote(); await f.flush();
  assert.equal(JSON.stringify(f.selection()), before); assert.equal(f.quote(), quote);
});

test('switching SKU or independent variant cannot inherit an oven, dimensions or worktop configuration', () => {
  const f = fixture({ data: kitchenCatalog() });
  f.select('[data-kitchen-field="oven"]', 'electric'); f.select('[data-kitchen-field="widthMm"]', '1500');
  f.variant('independent'); assert.doesNotMatch(f.quote(), /Horno:|Cubierta:|Medidas solicitadas/);
  f.variant(''); assert.equal(f.selection().kitchen.oven, 'none'); assert.equal(f.selection().kitchen.widthMm, 1200);
  f.select('[data-kitchen-field="oven"]', 'gas'); f.product('COOK-B');
  assert.equal(f.selection().kitchen, undefined); assert.doesNotMatch(f.quote(), /Horno:|Cubierta:|Medidas solicitadas/);
  f.product('ILUMI-DJ-181'); assert.equal(f.root.hidden, true); assert.doesNotMatch(f.quote(), /Horno:|Cubierta:|Medidas solicitadas/);
});
