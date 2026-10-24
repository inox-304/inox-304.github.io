import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as rules from '../src/lib/cart-config.ts';
import { cartAssetFor, CART_ASSET } from '../src/lib/cart-assets.ts';

const config = JSON.parse(readFileSync(new URL('../src/data/cart-published.json', import.meta.url))).cartConfig;
const moduleIds = config.modules.map(item => item.id);
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const script = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const source = ts.transpileModule(`${script('../src/scripts/cart-ui.ts')}\n${script('../src/lib/cart-sync.ts')}\nglobalThis.api = { renderCart, readCart, startCartSync, pickCartPosition, dropCartModule };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(initial = config) {
  let document, currentId = 'P15', currentModel = CART_ASSET, quote = '', now = 0, timerId = 0;
  const events = [], quotes = [], requests = [], statuses = [], timers = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
      this._text = ''; this.hidden = false; this.disabled = false; this.checked = false; this.className = ''; this.value = '';
      this.style = {}; this.events = new Map();
      this.classList = { toggle: (name, enabled) => { const names = new Set(this.className.split(' ').filter(Boolean)); enabled ? names.add(name) : names.delete(name); this.className = [...names].join(' '); } };
    }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    replaceChildren(...children) {
      if (document.activeElement && this.contains(document.activeElement)) document.activeElement = null;
      for (const child of this.children) child.parentElement = null;
      this.children = []; this._text = ''; this.append(...children);
    }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, action) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(action); }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) { this.onclick?.(); this.events.get('click')?.forEach(action => action({target:this})); } }
    querySelectorAll(selector) {
      const matches = node => {
        const attr = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
        if (attr) { const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return attr[2] === undefined ? key in node.dataset : node.dataset[key] === attr[2]; }
        return selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName.toLowerCase() === selector;
      };
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document = { activeElement: null, createElement: tag => new Element(tag), dispatchEvent: event => events.push(event) };
  const root = new Element();
  const context = { ...rules, cartAssetFor, document, CustomEvent, URL, AbortController,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url: String(url), options, resolve, reject })); },
  };
  runInNewContext(source, context);
  const onChange = value => { quote = value; quotes.push(value); };
  const render = (next = initial, productId = currentId, model = currentModel, preview = false, changed = onChange) => {
    currentId = productId; currentModel = model; context.api.renderCart(root, next, productId, changed, model, preview);
  };
  const input = id => root.querySelectorAll('input').find(node => node.dataset.cartModule === id);
  const toggle = (id, included) => {
    const node = input(id); assert.ok(node, `missing station ${id}`); node.checked = included; node.focus(); node.onchange(); return node;
  };
  const button = label => root.querySelectorAll('button').find(node => node.textContent === label);
  const click = label => { const node = button(label); assert.ok(node, label); assert.equal(node.disabled, false, `${label} enabled`); node.click(); };
  const selection = () => { const view = context.api.readCart(root, currentId); return view ? plain(view.selection) : null; };
  const arm = id => { const node = root.querySelector(`[data-cart-arm="${id}"]`); assert.ok(node, `arm ${id}`); node.click(); };
  const position = index => { const node = root.querySelector(`[data-cart-position="${index}"]`); assert.ok(node, `position ${index}`); node.click(); };
  const positionSelect = id => root.querySelector(`[data-cart-position-select="${id}"]`);
  const move = (id, index) => { const node = positionSelect(id); assert.ok(node, `select position ${id}`); node.value = String(index); node.focus(); node.onchange(); return node; };
  const connect = () => {
    const productId = currentId, model = currentModel;
    return context.api.startCartSync({ origin: 'https://panel.example.test', productId,
      onStatus: value => statuses.push(value), onConfig: next => render(next, productId, model) });
  };
  const respond = async (index, body = { productId: 'P15', cartConfig: config }, status = 200) => {
    requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) }); await flush();
  };
  const tick = async milliseconds => {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, item] = next; now = item.at; timers.delete(id); item.callback(); await flush();
    }
    now = target; await flush();
  };
  render(initial);
  return { root, document, events, quotes, requests, statuses, timers, render, input, toggle, button, click, selection, connect, respond, tick, arm, position, positionSelect, move,
    pick: (index, id = currentId) => context.api.pickCartPosition(root, id, index),
    drop: (moduleId, index, id = currentId) => context.api.dropCartModule(root, id, moduleId, index),
    quote: () => quote, read: id => context.api.readCart(root, id) };
}

test('a 3D drop uses the grabbed module and creates one reversible selection and quote', () => {
  const f = fixture(); f.arm('plancha');
  const before = f.selection();
  f.drop('freidora', 0);
  assert.deepEqual(f.selection().order, ['freidora', 'broastera', 'conservadora', 'plancha']);
  assert.match(f.quote(), /Posición 1: Freidora de papas/);
  assert.match(f.quote(), /Posición 2: Broastera de pollo/);
  f.click('Deshacer'); assert.deepEqual(f.selection(), before);
  assert.equal(f.button('Deshacer').disabled, true, 'drag adds one history step');
  f.click('Rehacer'); assert.equal(f.selection().order[0], 'freidora');
  const events = f.events.length; f.drop('freidora', 0);
  assert.equal(f.events.length, events + 1, 'same-position drop changes focus only');
});

test('3D drops cannot revive omitted equipment or alter another product', () => {
  const f = fixture(); f.toggle('freidora', false); const before = f.selection();
  for (const [id, position, productId] of [['freidora', 0, 'P15'], ['plancha', 1, 'P16'], ['plancha', -1, 'P15'], ['plancha', 4, 'P15'], ['plancha', .5, 'P15'], ['not-approved', 0, 'P15']]) f.drop(id, position, productId);
  assert.deepEqual(f.selection(), before);
  f.drop('plancha', 1); assert.equal(f.selection().order[1], 'plancha');
  assert.deepEqual(f.selection().included, before.included);
  assert.match(f.quote(), /Posición 4: Superficie de trabajo/);
});

test('four published stations render immediately and all sixteen choices emit the exact 3D selection', () => {
  for (let mask = 0; mask < 16; mask++) {
    const f = fixture();
    assert.equal(f.root.hidden, false); assert.equal(f.root.querySelectorAll('input').length, 4);
    for (let index = 0; index < moduleIds.length; index++) if (!(mask & (1 << index))) f.toggle(moduleIds[index], false);
    const expected = moduleIds.filter((_, index) => mask & (1 << index));
    assert.deepEqual(f.selection(), { included: expected, order: moduleIds });
    assert.equal(f.root.dataset.cartIncluded, expected.join(','));
    for (const id of moduleIds) assert.equal(f.input(id).checked, expected.includes(id));
    const last = f.events.at(-1); assert.equal(last.type, 'inox:cart-updated'); assert.equal(last.detail.productId, 'P15');
    assert.equal(last.detail.interactive, mask !== 15);
    if (mask !== 15) assert.match(f.root.querySelector('.cart-status').textContent, /superficie de trabajo/);
  }
});

test('undo, redo and reset restore visual choices and quote without losing focus during selection', () => {
  const f = fixture();
  assert.equal(f.button('Deshacer').disabled, true); assert.equal(f.button('Rehacer').disabled, true);
  const focused = f.toggle('freidora', false); assert.equal(f.document.activeElement, focused);
  f.toggle('plancha', false); assert.deepEqual(f.selection().included, ['broastera', 'conservadora']);
  f.click('Deshacer'); assert.deepEqual(f.selection().included, ['broastera', 'conservadora', 'plancha']);
  f.click('Rehacer'); assert.deepEqual(f.selection().included, ['broastera', 'conservadora']);
  f.click('Restablecer'); assert.deepEqual(f.selection().included, moduleIds);
  f.click('Deshacer'); assert.deepEqual(f.selection().included, ['broastera', 'conservadora']);
  f.click('Rehacer'); assert.deepEqual(f.selection().included, moduleIds);
  assert.doesNotMatch(f.quote(), /Superficie de trabajo en lugar de/);
  f.click('Deshacer'); f.toggle('broastera', false);
  assert.equal(f.button('Rehacer').disabled, true, 'new choice invalidates the abandoned redo branch');
});

test('same server confirmation keeps input identity, focus, selected modules and history', async () => {
  const f = fixture(), sync = f.connect();
  const input = f.toggle('freidora', false); const count = f.events.length;
  await f.respond(0);
  assert.equal(f.input('freidora'), input); assert.equal(f.document.activeElement, input);
  assert.deepEqual(f.selection().included, ['broastera', 'conservadora', 'plancha']);
  assert.equal(f.events.length, count, 'background confirmation does not request a renderer restart');
  assert.equal(f.button('Deshacer').disabled, false); assert.equal(f.statuses.at(-1), 'ready');
  f.click('Deshacer'); assert.deepEqual(f.selection().included, moduleIds);
  sync.dispose();
});

test('a refreshed callback receives the current quote without reconstructing the form', () => {
  const f = fixture(); f.toggle('broastera', false); const input = f.input('broastera'), freshQuotes = [];
  f.render(structuredClone(config), 'P15', CART_ASSET, false, quote => freshQuotes.push(quote));
  assert.equal(f.input('broastera'), input); assert.match(freshQuotes[0], /Superficie de trabajo en lugar de: Broastera de pollo/);
  f.toggle('plancha', false); assert.match(freshQuotes.at(-1), /Broastera de pollo, Plancha para hamburguesas/);
});

test('owner removal clamps revoked equipment while preserving compatible choices and prevents undo from restoring it', () => {
  const f = fixture(); f.toggle('freidora', false);
  const changed = structuredClone(config); changed.modules = changed.modules.filter(item => item.id !== 'broastera');
  changed.modules.find(item => item.id === 'freidora').defaultIncluded = true;
  f.render(changed);
  assert.equal(f.input('broastera'), undefined);
  assert.deepEqual(f.selection().included, ['conservadora', 'plancha']);
  assert.equal(f.input('freidora').checked, false, 'changed default does not override an existing choice');
  assert.doesNotMatch(f.quote(), /Broastera/);
  assert.match(f.root.querySelector('.cart-status').textContent, /Conservamos tus elecciones compatibles/);
  if (!f.button('Deshacer').disabled) f.click('Deshacer');
  assert.equal(f.selection().included.includes('broastera'), false);
});

test('newly approved modules follow their default without replacing existing exclusions', () => {
  const limited = structuredClone(config); limited.modules = limited.modules.slice(0, 2);
  const f = fixture(limited); f.toggle('broastera', false);
  const expanded = structuredClone(config); expanded.modules.find(item => item.id === 'conservadora').defaultIncluded = false;
  f.render(expanded);
  assert.deepEqual(f.selection().included, ['freidora', 'plancha']);
});

test('foreign SKU, unknown model, explicit removal and disabled public config clear UI and quote', () => {
  for (const [next, id, model] of [[config, 'P16', CART_ASSET], [config, 'P15', '/models/unreviewed.glb'], [null, 'P15', CART_ASSET], [{ ...config, enabled: false }, 'P15', CART_ASSET]]) {
    const f = fixture(); f.toggle('freidora', false); f.render(next, id, model);
    assert.equal(f.root.hidden, true); assert.equal(f.root.children.length, 0); assert.equal(f.quote(), '');
    assert.equal(f.read('P15'), null); assert.equal(f.selection(), null); assert.equal(f.events.at(-1).detail.interactive, false);
  }
  const f = fixture(); f.render(config, 'P16', CART_ASSET); f.render(config, 'P15', CART_ASSET);
  assert.deepEqual(f.selection().included, moduleIds, 'another product cannot carry old cart selection into a new view');
});

test('quote distinguishes selected equipment from worktop replacements and never invents a price or capacity', () => {
  const f = fixture(); f.toggle('broastera', false); f.toggle('conservadora', false);
  assert.match(f.quote(), /Equipamiento: Freidora de papas, Plancha para hamburguesas\./);
  assert.match(f.quote(), /Superficie de trabajo en lugar de: Broastera de pollo, Conservadora de alimentos\./);
  assert.match(f.quote(), /medidas, conexiones y precio por confirmar/);
  assert.doesNotMatch(f.quote(), /\d+\s*(L|litros|kW)|S\/|USD|PEN/);
  f.toggle('freidora', false); f.toggle('plancha', false);
  assert.match(f.quote(), /Equipamiento: sin módulos de cocción \/ conservación/);
  assert.equal(f.quote().includes('undefined'), false);
});

test('preview action opens the current 3D selection without changing history and read selection is detached', () => {
  const f = fixture(); f.toggle('freidora', false);
  const selection = f.read('P15').selection; selection.included.push('freidora');
  assert.equal(f.selection().included.includes('freidora'), false);
  f.click('Ver mi carrito en 3D');
  assert.equal(f.events.at(-1).detail.interactive, true);
  f.click('Deshacer'); assert.deepEqual(f.selection().included, moduleIds); assert.equal(f.button('Deshacer').disabled, true);
});

test('slow, failed and retried synchronization keeps choices, quote, focus and undo while public requests omit credentials', async () => {
  const f = fixture(), sync = f.connect(); const input = f.toggle('freidora', false), quote = f.quote();
  await f.tick(5000); assert.equal(f.statuses.at(-1), 'slow');
  await f.respond(0, null, 503); assert.equal(f.statuses.at(-1), 'error');
  assert.equal(f.root.hidden, false); assert.equal(f.quote(), quote); assert.equal(f.document.activeElement, input);
  sync.retry(); sync.retry(); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].url, 'https://panel.example.test/api/catalog/P15/cart/');
  assert.equal(f.requests[0].options.credentials, 'omit'); assert.equal(f.requests[0].options.cache, 'no-store');
  await f.respond(1); assert.equal(f.quote(), quote); assert.equal(f.input('freidora'), input);
  f.click('Deshacer'); assert.deepEqual(f.selection().included, moduleIds);
  sync.dispose(); assert.equal(f.timers.size, 0);
});

test('late request cannot revive cart controls after switching products and disposing its synchronization', async () => {
  const f = fixture(), sync = f.connect(); f.toggle('freidora', false);
  sync.dispose(); f.render(null, 'ILUMI-DJ-181', '/models/ilumi/juice.glb');
  const eventCount = f.events.length;
  await f.respond(0); await f.tick(70000);
  assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.timers.size, 0);
  assert.equal(f.root.hidden, true); assert.equal(f.selection(), null); assert.equal(f.quote(), '');
  assert.equal(f.events.length, eventCount); assert.deepEqual(f.statuses, ['loading']);
});

test('foreign and incomplete remote rules never replace the published cart choices', async () => {
  for (const body of [{ productId: 'P16', cartConfig: config }, { productId: 'P15' }, { productId: 'P15', cartConfig: {} }, { productId: 'P15', cartConfig: { ...config, modules: [] } }]) {
    const f = fixture(), sync = f.connect(); f.toggle('freidora', false); const quote = f.quote();
    await f.respond(0, body);
    assert.equal(f.statuses.at(-1), 'error'); assert.equal(f.root.hidden, false); assert.equal(f.quote(), quote);
    assert.deepEqual(f.selection().included, ['broastera', 'conservadora', 'plancha']); sync.dispose();
  }
});

test('explicit owner disabling clears personalization but a timed-out older response cannot overwrite a newer approval', async () => {
  const f = fixture(), sync = f.connect(); f.toggle('freidora', false);
  await f.tick(65000); sync.retry(); await f.respond(1);
  const quote = f.quote(); await f.respond(0, { productId: 'P15', cartConfig: null });
  assert.equal(f.quote(), quote); assert.equal(f.root.hidden, false); assert.equal(f.statuses.at(-1), 'ready');
  sync.retry(); await f.respond(2, { productId: 'P15', cartConfig: null });
  assert.equal(f.root.hidden, true); assert.equal(f.selection(), null); assert.equal(f.quote(), '');
  assert.equal(f.statuses.at(-1), 'disabled'); sync.dispose();
});

test('selection validation rejects foreign extras, duplicates and unapproved module identifiers', () => {
  for (const value of [null, {}, { included: ['wok'] }, { included: ['freidora', 'freidora'] }, { included: moduleIds, productId: 'P16' }, { included: 'plancha' }]) assert.throws(() => rules.validateCartSelection(config, value));
  const limited = { ...config, modules: config.modules.slice(0, 1) };
  assert.throws(() => rules.validateCartSelection(limited, { included: ['freidora'] }));
  assert.deepEqual(rules.validateCartSelection(config, { included: ['plancha', 'broastera'] }), { included: ['broastera', 'plancha'], order: moduleIds });
});

function permutations(ids) {
  if (!ids.length) return [[]];
  return ids.flatMap((id, index) => permutations(ids.filter((_, n) => n !== index)).map(tail => [id, ...tail]));
}

test('all 24 physical orders can be selected without duplicates and retain all 16 equipment combinations', () => {
  for (const order of permutations(moduleIds)) {
    const f = fixture();
    order.forEach((id, index) => f.move(id, index));
    assert.deepEqual(f.selection().order, order);
    for (let mask = 0; mask < 16; mask++) {
      moduleIds.forEach((id, index) => f.toggle(id, Boolean(mask & (1 << index))));
      assert.deepEqual(f.selection().order, order, 'including or removing equipment never silently reorders the counter');
      assert.deepEqual(f.selection().included, moduleIds.filter((_, index) => mask & (1 << index)));
      assert.equal(new Set(f.selection().order).size, 4);
      order.forEach((id, index) => {
        const module = config.modules.find(item => item.id === id), included = f.selection().included.includes(id);
        const station = f.root.querySelector(`[data-cart-position="${index}"]`);
        assert.equal(station.getAttribute('aria-label'), `Posición ${index + 1}: ${included ? module.label : 'Superficie de trabajo'}`);
        assert.equal(f.positionSelect(id).value, String(index));
        assert.equal(f.positionSelect(id).disabled, !included);
      });
    }
  }
});

test('moving into an occupied position swaps whole modules and moving into a blank area preserves exclusions', () => {
  const f = fixture();
  f.arm('plancha'); f.position(0);
  assert.deepEqual(f.selection().order, ['plancha', 'freidora', 'conservadora', 'broastera']);
  assert.deepEqual(f.selection().included, moduleIds);
  f.toggle('freidora', false); f.arm('plancha'); f.position(1);
  assert.deepEqual(f.selection().order, ['freidora', 'plancha', 'conservadora', 'broastera']);
  assert.equal(f.selection().included.includes('freidora'), false, 'the blank station is not accidentally re-enabled by swapping');
  f.toggle('freidora', true);
  assert.deepEqual(f.selection().order, ['freidora', 'plancha', 'conservadora', 'broastera']);
});

test('the board can arm a visible station without changing history and omitted equipment cannot be armed', () => {
  const f = fixture(), original = f.selection();
  f.position(3); assert.deepEqual(f.selection(), original); assert.equal(f.read('P15').activePosition, 3);
  assert.equal(f.button('Deshacer').disabled, true, 'selecting which equipment to move is not an edit');
  f.position(3); assert.deepEqual(f.selection(), original); assert.equal(f.button('Deshacer').disabled, true);
  f.position(1); assert.deepEqual(f.selection().order, ['broastera', 'plancha', 'conservadora', 'freidora']);
  f.toggle('plancha', false); assert.equal(f.read('P15').activePosition, null);
  assert.equal(f.root.querySelector('[data-cart-arm="plancha"]').disabled, true);
  f.position(1); assert.equal(f.read('P15').activePosition, null);
  assert.match(f.root.querySelector('.cart-status').textContent, /Primero pulsa Mover/);
  f.arm('plancha'); assert.equal(f.read('P15').activePosition, null);
  f.pick(0); assert.equal(f.read('P15').activePosition, 0);
  f.pick(1); assert.deepEqual(f.selection().order, ['plancha', 'broastera', 'conservadora', 'freidora']);
  assert.equal(f.selection().included.includes('plancha'), false);
});

test('undo, redo and reset include the position order, equipment state and branching history', () => {
  const f = fixture(), original = f.selection();
  f.move('plancha', 0); const moved = f.selection();
  f.toggle('freidora', false); const omitted = f.selection();
  f.move('conservadora', 1); const secondMove = f.selection();
  f.click('Deshacer'); assert.deepEqual(f.selection(), omitted);
  f.click('Deshacer'); assert.deepEqual(f.selection(), moved);
  f.click('Rehacer'); assert.deepEqual(f.selection(), omitted);
  f.click('Rehacer'); assert.deepEqual(f.selection(), secondMove);
  f.click('Restablecer'); assert.deepEqual(f.selection(), original);
  f.click('Deshacer'); assert.deepEqual(f.selection(), secondMove);
  f.move('broastera', 0); assert.equal(f.button('Rehacer').disabled, true);
});

test('3D position picks use the armed module while foreign or invalid picks cannot rearrange this product', () => {
  const f = fixture(); f.arm('plancha');
  const original = f.selection();
  f.pick(1, 'P04'); assert.deepEqual(f.selection(), original);
  for (const invalid of [-1, 4, 1.5, NaN]) { f.pick(invalid); assert.deepEqual(f.selection(), original); }
  f.pick(1); assert.deepEqual(f.selection().order, ['broastera', 'plancha', 'conservadora', 'freidora']);
  assert.equal(f.read('P15').activePosition, 1);
  assert.ok(f.events.some(event => event.type === 'inox:cart-focus' && event.detail.productId === 'P15'));
});

test('moving updates positional quote, retains focused selectors and exposes a detached order array', () => {
  const f = fixture(), focused = f.move('plancha', 0);
  assert.equal(f.document.activeElement, focused);
  const quote = f.quote();
  assert.match(quote, /izquierda a derecha/i);
  assert.match(quote, /1[^\n]*Plancha para hamburguesas/);
  assert.match(quote, /4[^\n]*Broastera de pollo/);
  const external = f.read('P15').selection; external.order.reverse();
  assert.deepEqual(f.selection().order, ['plancha', 'freidora', 'conservadora', 'broastera']);
  f.toggle('freidora', false);
  assert.match(f.quote(), /2[^\n]*[Ss]uperficie de trabajo/);
});

test('confirmation, timeout and retry preserve rearranged positions, focus, quote and undo', async () => {
  const f = fixture(), sync = f.connect();
  const focused = f.move('plancha', 0); f.toggle('conservadora', false); focused.focus();
  const selected = f.selection(), quote = f.quote();
  await f.tick(65000); assert.equal(f.statuses.at(-1), 'error');
  assert.deepEqual(f.selection(), selected); assert.equal(f.quote(), quote);
  sync.retry(); await f.respond(1); assert.deepEqual(f.selection(), selected);
  assert.equal(f.positionSelect('plancha'), focused); assert.equal(f.document.activeElement, focused); assert.equal(f.quote(), quote);
  await f.respond(0, { productId:'P15', cartConfig:null }); assert.deepEqual(f.selection(), selected);
  f.click('Deshacer'); assert.deepEqual(f.selection().order, selected.order); assert.deepEqual(f.selection().included, moduleIds);
  f.click('Deshacer'); assert.deepEqual(f.selection().order, moduleIds); sync.dispose();
});

test('removing an owner-approved module preserves compatible order while its position becomes an unconfigured surface', () => {
  const f = fixture(); f.move('plancha', 0);
  const changed = structuredClone(config); changed.modules = changed.modules.filter(item => item.id !== 'freidora');
  f.render(changed);
  assert.deepEqual(f.selection().order, ['plancha', 'freidora', 'conservadora', 'broastera']);
  assert.equal(f.selection().included.includes('freidora'), false); assert.equal(f.input('freidora'), undefined);
  assert.match(f.quote(), /2[^\n]*[Ss]uperficie de trabajo/);
});
