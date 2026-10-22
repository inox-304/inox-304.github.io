import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { categories } from '../src/data/categories.ts';
import * as helpers from '../src/lib/catalog-controls.ts';

test('catalog search finds public codes, features, accents and words in any order', () => {
  const product = { id: 'P01', name: 'Cocina de 4 hornillas', summary: 'Para tu negocio', features: ['Horno eléctrico con rostizador'] };
  const text = helpers.catalogSearchText(product, 'Línea caliente');
  for (const query of ['p01', 'hornillas cocina', '  ELECTRICO  cocina ', 'rostizador', '4 / hornillas', '   ']) assert.equal(helpers.matchesCatalogSearch(text, query), true, query);
  for (const query of ['P02', 'cocina refrigerada', '6 hornillas']) assert.equal(helpers.matchesCatalogSearch(text, query), false, query);
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

function browserFixture(api = false) {
  function element(dataset = {}) {
    return { dataset, hidden: false, focused: false, textContent: '', value: '', events: {}, attributes: {}, classList: { toggle() {} },
      addEventListener(name, fn) { this.events[name] = fn; }, setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; }, querySelector() { return null; }, querySelectorAll() { return []; } };
  }
  const a = element({ category: 'linea-caliente', name: 'P01 Cocina eléctrica', title: 'Cocina eléctrica', catalogOrder: '0' });
  const b = element({ category: 'linea-fria', name: 'P02 Armario refrigerado', title: 'Armario refrigerado', catalogOrder: '1' });
  const grid = element({ catalogMode: api ? 'api' : 'static' }); grid.cards = api ? [] : [a, b];
  grid.querySelectorAll = () => [...grid.cards]; grid.append = card => { grid.cards = grid.cards.filter(item => item !== card); grid.cards.push(card); };
  const ids = ['catalog-search', 'catalog-order', 'catalog-heading', 'result-count', 'catalog-empty', 'catalog-loading', 'catalog-unavailable', 'clear-catalog', 'reset-search', 'retry-catalog'];
  const nodes = Object.fromEntries(ids.map(id => [`#${id}`, element()])); nodes['#catalog-results'] = grid; nodes['.catalog-tools'] = element();
  const buttons = ['todos', ...categories.map(category => category.id)].map(filter => { const button = element({ filter }); button.counter = element(); button.querySelector = () => button.counter; return button; });
  const document = { documentElement: element(), events: {}, querySelector: selector => nodes[selector], querySelectorAll: selector => selector === '[data-filter]' ? buttons : [nodes['#clear-catalog'], nodes['#reset-search']], addEventListener(name, fn) { this.events[name] = fn; }, dispatchEvent(event) { this.events[event.type]?.(event); } };
  const location = { href: 'https://example.test/catalogo/', search: '' }; const window = { events: {}, addEventListener(name, fn) { this.events[name] = fn; } };
  let notifyState;
  const source = readFileSync(new URL('../src/scripts/catalog-controls.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ...helpers, categories, document, location, window, URLSearchParams, Event,
    history: { replaceState(_state, _unused, url) { location.href = url.href; location.search = url.search; } },
    MutationObserver: class { constructor(callback) { notifyState = callback; } observe() {} },
  });
  return { a, b, grid, nodes, buttons, document, window, location, notifyState: () => notifyState() };
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
