import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { categories } from '../src/data/categories.ts';
import { products } from '../src/data/products.ts';
import { catalogFamilyProducts, getProductFamily } from '../src/lib/product-families.ts';
import * as helpers from '../src/lib/catalog-controls.ts';

const familySearchCards = catalogFamilyProducts(products).map(product => {
  const category = categories.find(item => item.id === product.category)?.name || '';
  const family = getProductFamily(product.id, products);
  return { id: product.id, text: family
    ? [family.name, ...family.members.map(member => `${member.label} ${helpers.catalogSearchText(member.product, category)}`)].join(' ')
    : helpers.catalogSearchText(product, category) };
});
const realMatches = query => familySearchCards.filter(card => helpers.matchesCatalogSearch(card.text, query)).map(card => card.id);

test('catalog search finds public codes, features, accents and words in any order', () => {
  const product = { id: 'P01', name: 'Cocina de 4 hornillas', summary: 'Para tu negocio', features: ['Horno eléctrico con rostizador'] };
  const text = helpers.catalogSearchText(product, 'Línea caliente');
  for (const query of ['p01', 'hornillas cocina', '  ELECTRICO  cocina ', 'rostizador', '4 / hornillas', '   ']) assert.equal(helpers.matchesCatalogSearch(text, query), true, query);
  for (const query of ['P02', 'cocina refrigerada', '6 hornillas']) assert.equal(helpers.matchesCatalogSearch(text, query), false, query);
});

test('capacity units and model codes work with or without spaces while numbers stay exact', () => {
  const text = helpers.catalogSearchText({ id: 'ILUMI-B-20L', name: 'Batidora industrial', summary: 'Acero inoxidable 304', capacity: '20 litros' }, 'Línea neutra');
  for (const query of ['20L', '20 l', '20 litro', '20 litros', 'ilumi b20l', 'ILUMI-B-20L', '304']) assert.equal(helpers.matchesCatalogSearch(text, query), true, query);
  for (const query of ['30L', '2 litros', '130 litros', 'ILUMI-B-30L']) assert.equal(helpers.matchesCatalogSearch(text, query), false, query);
  assert.equal(helpers.matchesCatalogSearch('Acero inoxidable 304; 130 litros', '30 l'), false);
  assert.equal(helpers.sameCatalogQuery('20L', '20 litros'), true);
  assert.equal(helpers.sameCatalogQuery('eléctrico', 'ELECTRICO'), true);
});

test('real catalog family search binds SKU characters instead of mixing words with unrelated weights', () => {
  assert.deepEqual(realMatches('P31'), ['P30']);
  for (const query of ['ILUMI-DJ-181', 'ilumidj181', 'DJ-181', 'dj181']) {
    assert.deepEqual(realMatches(query), ['ILUMI-DJ-183'], query);
  }
  for (const card of familySearchCards.filter(item => item.id === 'ILUMI-CR-123')) {
    assert.equal(card.text.includes('31 kg'), true, 'regression fixture contains the competing weight');
    assert.equal(helpers.matchesCatalogSearch(card.text, 'P31'), false);
  }
});

test('real capacity search does not borrow liters from a different number or model code', () => {
  for (const query of ['20L', '20 litros']) {
    const matches = realMatches(query);
    assert.equal(matches.includes('P30'), true, 'secondary blender capacity is searchable');
    assert.equal(matches.includes('ILUMI-B-30L'), true, 'secondary mixer capacity is searchable');
    assert.equal(matches.includes('ILUMI-DJ-183'), false, '20 kg is not a 20 liter jug dispenser');
    assert.equal(matches.includes('ILUMI-CR-123'), false);
  }
  for (const query of ['10 litros', '15 litros', '20 litros', '25 litros']) assert.equal(realMatches(query).includes('P30'), true, query);
  assert.equal(helpers.matchesCatalogSearch('ILUMI-B-20L; capacidad pendiente', '20 litros'), false, 'a model suffix alone does not establish its capacity');
  assert.equal(helpers.matchesCatalogSearch('Capacidad 18 L; peso neto 20 kg', '20L'), false);
});

test('natural product plurals find the same real families as the singular without weakening model codes', () => {
  for (const [singular, plural] of [['cocina', 'cocinas'], ['horno', 'hornos'], ['carrito', 'carritos'], ['lavadero', 'lavaderos'], ['licuadora', 'licuadoras']]) {
    assert.ok(realMatches(singular).length > 0, singular);
    assert.deepEqual(realMatches(plural), realMatches(singular), plural);
  }
  assert.deepEqual(realMatches('P31'), ['P30']);
});

test('catalog links retain category aliases and accept only known sort options', () => {
  assert.deepEqual(helpers.readCatalogState(new URLSearchParams('categoria=refrigeracion&buscar=Armario&orden=nombre')), { category: 'linea-fria', query: 'Armario', order: 'nombre' });
  assert.deepEqual(helpers.readCatalogState(new URLSearchParams('categoria=desconocida&orden=precio')), { category: 'todos', query: '', order: 'catalogo' });
  assert.equal(helpers.readCatalogState(new URLSearchParams({ buscar: 'x'.repeat(300) })).query.length, 160);
});

test('shareable filter URLs preserve the site base and unrelated parameters without injecting markup', () => {
  const url = helpers.catalogStateUrl('https://example.test/inox/catalogo/?campaign=fixture#equipos', { category: 'linea-caliente', query: '  cocina <4>  ', order: 'nombre' });
  assert.equal(url.pathname, '/inox/catalogo/'); assert.equal(url.hash, '#equipos');
  assert.equal(url.searchParams.get('campaign'), 'fixture'); assert.equal(url.searchParams.get('buscar'), 'cocina <4>');
  const reset = helpers.catalogStateUrl(url.href, { category: 'todos', query: ' ', order: 'catalogo' });
  assert.equal(reset.search, '?campaign=fixture');
});

test('alphabetical order is natural and returning to catalog order restores the original sequence', () => {
  const items = [{ name: 'Mesa 10', order: 0 }, { name: 'Ármario', order: 1 }, { name: 'Mesa 2', order: 2 }];
  const sorted = [...items].sort((a, b) => helpers.compareCatalogItems(a, b, 'nombre'));
  assert.deepEqual(sorted.map(item => item.name), ['Ármario', 'Mesa 2', 'Mesa 10']);
  assert.deepEqual(sorted.sort((a, b) => helpers.compareCatalogItems(a, b, 'catalogo')), items);
});

test('an empty API response, initial loading and failed loading stay distinct', () => {
  assert.equal(helpers.catalogStatus(true, undefined, 0), 'loading');
  assert.equal(helpers.catalogStatus(true, 'loading', 0), 'loading');
  assert.equal(helpers.catalogStatus(true, 'unavailable', 0), 'unavailable');
  for (const status of ['live', 'stale', 'preview']) assert.equal(helpers.catalogStatus(true, status, 0), 'ready');
  assert.equal(helpers.catalogStatus(true, 'loading', 2), 'ready');
  assert.equal(helpers.catalogStatus(false, undefined, 0), 'ready');
});

function browserFixture(api = false, initialUrl = 'https://example.test/catalogo/') {
  function element(dataset = {}) {
    return { dataset, hidden: false, focused: false, textContent: '', value: '', events: {}, attributes: {}, classList: { toggle() {} },
      addEventListener(name, fn) { this.events[name] = (event = {}) => fn(event); }, setAttribute(name, value) { this.attributes[name] = value; }, focus(options) { this.focused = true; this.focusOptions = options; }, scrollIntoView(options) { this.scrolled = options; }, querySelector() { return null; }, querySelectorAll() { return []; } };
  }
  const a = element({ category: 'linea-caliente', name: 'P01 Cocina eléctrica', title: 'Cocina eléctrica', catalogOrder: '0' });
  const b = element({ category: 'linea-fria', name: 'P02 Armario refrigerado', title: 'Armario refrigerado', catalogOrder: '1' });
  const grid = element({ catalogMode: api ? 'api' : 'static' }); grid.cards = api ? [] : [a, b];
  grid.querySelectorAll = () => [...grid.cards]; grid.append = card => { grid.cards = grid.cards.filter(item => item !== card); grid.cards.push(card); };
  const ids = ['catalog-search', 'catalog-order', 'catalog-heading', 'result-count', 'catalog-empty', 'catalog-loading', 'catalog-unavailable', 'clear-catalog', 'reset-search', 'retry-catalog', 'clear-search-query', 'catalog-search-feedback'];
  const nodes = Object.fromEntries(ids.map(id => [`#${id}`, element()])); nodes['#catalog-results'] = grid; nodes['.catalog-tools'] = element();
  const buttons = ['todos', ...categories.map(category => category.id)].map(filter => { const button = element({ filter }); button.counter = element(); button.querySelector = () => button.counter; return button; });
  const quickSearches = ['cocina', 'armario'].map(searchQuery => element({ searchQuery }));
  const document = { documentElement: element(), events: {}, querySelector: selector => nodes[selector], querySelectorAll: selector => selector === '[data-filter]' ? buttons : selector === '[data-search-query]' ? quickSearches : selector === '[data-catalog-reset]' ? [nodes['#clear-catalog'], nodes['#reset-search']] : [], addEventListener(name, fn) { this.events[name] = fn; }, dispatchEvent(event) { this.events[event.type]?.(event); } };
  const location = new URL(initialUrl); const window = { events: {}, addEventListener(name, fn) { this.events[name] = fn; } };
  let notifyState;
  const source = readFileSync(new URL('../src/scripts/catalog-controls.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ...helpers, categories, document, location, window, URLSearchParams, Event,
    history: { replaceState(_state, _unused, url) { location.href = url.href; location.search = url.search; } },
    MutationObserver: class { constructor(callback) { notifyState = callback; } observe() {} },
  });
  return { a, b, grid, nodes, buttons, quickSearches, document, window, location, notifyState: () => notifyState() };
}

test('browser filters, counts and reset agree; sorting restores editorial order', () => {
  const f = browserFixture(); const search = f.nodes['#catalog-search']; const order = f.nodes['#catalog-order'];
  order.value = 'nombre'; order.events.change(); assert.equal(f.grid.cards[0], f.b);
  order.value = 'catalogo'; order.events.change(); assert.equal(f.grid.cards[0], f.a);
  search.value = 'eléctrica cocina'; search.events.input();
  assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, true); assert.equal(f.buttons[0].counter.textContent, '1');
  f.buttons.find(button => button.dataset.filter === 'linea-fria').events.click();
  assert.equal(f.nodes['#catalog-empty'].hidden, false);
  f.nodes['#clear-catalog'].events.click();
  assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, false); assert.equal(search.value, ''); assert.equal(search.focused, true);
});

test('an API outage offers retry instead of a false no-results message, then preserves filters on refresh', () => {
  const f = browserFixture(true);
  assert.equal(f.nodes['#catalog-loading'].hidden, false); assert.equal(f.nodes['#catalog-empty'].hidden, true);
  f.document.documentElement.dataset.cmsState = 'unavailable'; f.notifyState();
  assert.equal(f.nodes['#catalog-unavailable'].hidden, false); assert.equal(f.nodes['#catalog-empty'].hidden, true);
  let retries = 0; f.document.events['inox:catalog-refresh'] = () => retries++;
  f.nodes['#retry-catalog'].events.click(); assert.equal(retries, 1);
  f.nodes['#catalog-search'].value = 'p02'; f.nodes['#catalog-search'].events.input();
  f.grid.cards = [f.a, f.b]; f.document.documentElement.dataset.cmsState = 'live'; f.document.events['inox:catalog-updated']();
  assert.equal(f.a.hidden, true); assert.equal(f.b.hidden, false); assert.equal(f.nodes['#catalog-unavailable'].hidden, true);
  assert.equal(f.nodes['#result-count'].textContent, '1 equipo para «p02»');
});

test('clearing only the query preserves category and sort and returns keyboard focus', () => {
  const f = browserFixture(false, 'https://example.test/catalogo/?categoria=linea-fria&buscar=p02&orden=nombre');
  assert.equal(f.nodes['#catalog-search'].focused, false, 'normal visits never open the keyboard automatically');
  assert.equal(f.nodes['#clear-search-query'].hidden, false);
  f.nodes['#clear-search-query'].events.click();
  assert.equal(f.nodes['#catalog-search'].value, ''); assert.equal(f.nodes['#catalog-search'].focused, true);
  assert.equal(f.nodes['#clear-search-query'].hidden, true);
  const params = new URLSearchParams(f.location.search);
  assert.equal(params.get('categoria'), 'linea-fria'); assert.equal(params.get('orden'), 'nombre'); assert.equal(params.has('buscar'), false);
  assert.equal(f.a.hidden, true); assert.equal(f.b.hidden, false);
  assert.equal(f.nodes['#catalog-search-feedback'].textContent, '1 equipo');
});

test('quick searches explore all lines and stay selected across updates and history navigation', () => {
  const f = browserFixture(false, 'https://example.test/catalogo/?categoria=linea-fria&orden=nombre');
  f.quickSearches[0].events.click();
  assert.equal(f.nodes['#catalog-search'].value, 'cocina'); assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, true);
  assert.equal(f.quickSearches[0].attributes['aria-pressed'], 'true'); assert.equal(f.quickSearches[1].attributes['aria-pressed'], 'false');
  assert.equal(new URLSearchParams(f.location.search).has('categoria'), false); assert.equal(new URLSearchParams(f.location.search).get('orden'), 'nombre');
  f.document.events['inox:catalog-updated']();
  assert.equal(f.nodes['#catalog-search-feedback'].textContent, '1 equipo para «cocina»');
  f.location.search = '?buscar=armario'; f.window.events.popstate();
  assert.equal(f.nodes['#catalog-search'].value, 'armario'); assert.equal(f.a.hidden, true); assert.equal(f.b.hidden, false);
  assert.equal(f.quickSearches[0].attributes['aria-pressed'], 'false'); assert.equal(f.quickSearches[1].attributes['aria-pressed'], 'true');
});

test('search submit moves focus to results and Escape clears query without resetting filters', () => {
  const f = browserFixture(false, 'https://example.test/catalogo/?categoria=linea-caliente');
  f.nodes['#catalog-search'].value = 'p01'; let prevented = 0;
  f.nodes['.catalog-tools'].events.submit({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(f.nodes['#catalog-heading'].focused, true);
  assert.equal(f.nodes['#catalog-heading'].scrolled.block, 'start'); assert.equal(f.nodes['#result-count'].textContent, '1 equipo para «p01»');
  f.nodes['#catalog-search'].events.keydown({ key: 'Escape', preventDefault() { prevented++; } });
  assert.equal(prevented, 2); assert.equal(f.nodes['#catalog-search'].value, ''); assert.equal(f.b.hidden, true);
  assert.equal(new URLSearchParams(f.location.search).get('categoria'), 'linea-caliente');
});

test('search shortcut respects typing, modifiers, composition and open dialogs', () => {
  const f = browserFixture(); const search = f.nodes['#catalog-search']; let prevented = 0;
  const press = extra => { search.focused = false; f.document.events.keydown({ key: '/', preventDefault() { prevented++; }, ...extra }); return search.focused; };
  assert.equal(press({}), true); assert.equal(prevented, 1);
  for (const extra of [{ key: 'a' }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }]) assert.equal(press(extra), false);
  f.nodes['dialog[open], [aria-modal="true"]'] = {};
  assert.equal(press({}), false); assert.equal(prevented, 1);
});

test('header search anchor focuses only explicit hash requests and composition updates only on completion', () => {
  const f = browserFixture(false, 'https://example.test/catalogo/#catalog-search'); const search = f.nodes['#catalog-search'];
  assert.equal(search.focused, true);
  search.focused = false; f.location.hash = ''; f.window.events.hashchange(); assert.equal(search.focused, false);
  f.location.hash = '#catalog-search'; f.window.events.hashchange(); assert.equal(search.focused, true);
  search.value = 'armario'; search.events.input({ isComposing: true });
  assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, false);
  search.events.compositionend(); assert.equal(f.a.hidden, true); assert.equal(f.b.hidden, false);
});

test('a family card remains one result when finding a secondary capacity or SKU', () => {
  const f = browserFixture();
  f.a.dataset.name = 'Batidora industrial ILUMI B-30L 30 litros B-20L 20 litros B-10L 10 litros';
  for (const query of ['10L', 'B20L', '20 litros', '30 l']) {
    f.nodes['#catalog-search'].value = query; f.nodes['#catalog-search'].events.input();
    assert.equal(f.a.hidden, false, query); assert.equal(f.b.hidden, true, query);
    assert.equal(f.grid.cards.length, 2); assert.equal(f.buttons[0].counter.textContent, '1');
  }
});
