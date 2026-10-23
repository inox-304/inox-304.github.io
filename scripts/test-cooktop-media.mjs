import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { cooktopAssetFor } from '../src/lib/cooktop-assets.ts';

const config = JSON.parse(readFileSync(new URL('./fixtures/cooktop.json', import.meta.url), 'utf8'));
const initial = () => ({ config: structuredClone(config), selection: { layoutId: 'six', energy: 'gas', placements: [] } });
const models = { P04: '/models/inox/cocina-industrial-4-hornillas-tipo-isla-plancha-ho-v2.glb', P05: '/models/inox/cocina-industrial-tipo-isla-4-parrillas-plancha-ho-v2.glb' };
const product = id => ({ id, name: id, supplyType: 'manufactured', image: '/images/products/example.jpg', model3d: models[id], variants: [] });
const source = ts.transpileModule(readFileSync(new URL('../src/scripts/product-media.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace("import('./cooktop-scene')", 'loadSceneModule()').replace("import('@google/model-viewer')", 'loadNativeModule()');

function fixture(base = product('P04'), deferNative = false) {
  const calls = [], timers = new Map(), documents = new Map(), windowEvents = new Map(), picks = [];
  let currentState = initial(), stateProduct = base.id, timerId = 0;
  let finishNativeLoad;
  const nativeModule = new Promise(resolve => {
    finishNativeLoad = () => resolve({ ModelViewerElement: class {} });
    if (!deferNative) finishNativeLoad();
  });
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.dataset = {}; this.attributes = {}; this.children = []; this.events = new Map(); this.style = {}; this.hidden = false; this.firstChild = { textContent: '' }; this.availableAnimations = []; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    append(child) { this.children.push(child); child.parent = this; }
    replaceChildren(...children) { this.children.forEach(child => child.parent = null); this.children = []; children.forEach(child => this.append(child)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback); }
    emit(type, data = {}) { this.events.get(type)?.forEach(callback => callback({ type, ...data })); }
    click() { this.emit('click'); }
    focus() { this.focused = true; }
    pause() {}
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tagName === selector ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    set src(value) { this.source = value; if (this.tagName === 'model-viewer') queueMicrotask(() => this.emit('load')); }
  }
  const root = new Element(), cooktopRoot = new Element(), variant = new Element('select');
  const names = ['media-toolbar', 'photo-options', 'gallery-photo', 'gallery-image', 'model-host', 'show-model', 'model-help', 'media-status'];
  const nodes = Object.fromEntries(names.map(name => [name, new Element(name === 'show-model' ? 'button' : 'div')]));
  root.querySelector = selector => nodes[selector.slice(6, -1)];
  root.dataset.initialProduct = JSON.stringify(base);
  const document = {
    querySelector: selector => selector === '[data-cooktop-root]' ? cooktopRoot : selector === '[data-product-variant]' ? variant : null,
    querySelectorAll: selector => selector === '[data-product-media]' ? [root] : [], createElement: tag => new Element(tag),
    addEventListener(type, callback) { if (!documents.has(type)) documents.set(type, []); documents.get(type).push(callback); },
  };
  const dispatch = (type, detail) => documents.get(type)?.forEach(callback => callback({ type, detail }));
  const window = { setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); }, addEventListener(type, callback) { windowEvents.set(type, callback); } };
  const loadSceneModule = async () => ({ createCooktopScene(host, url, options) {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const call = { url, options, updates: [], disposed: 0, doorStates: [], complete() {
      this.canvas = new Element('canvas'); host.append(this.canvas);
      const self = this;
      resolve({ hasDoors: true, update(c, s) { self.updates.push({ config: structuredClone(c), selection: structuredClone(s) }); }, setDoors(open) { self.doorStates.push(open); }, dispose() { self.disposed++; self.canvas.remove(); } });
    } };
    calls.push(call); return promise;
  } });
  runInNewContext(source, { document, window, URL, location: new URL('https://inox.example/'), CustomEvent,
    safeImage: value => value, safeModel: value => value, safePreviewAsset: (value, safe) => safe(value), withBase: value => value,
    cooktopAssetFor, readCooktop: (_root, id) => id === stateProduct ? currentState : null,
    pickCooktopAnchor: (_root, id, anchor) => picks.push({ id, anchor }), loadSceneModule,
    loadNativeModule: () => nativeModule, cancelAnimationFrame() {}, requestAnimationFrame: () => 1,
    performance: { now: () => 0 }, matchMedia: () => ({ matches: true }), console,
  });
  const changed = (interactive = true, id = stateProduct) => dispatch('inox:cooktop-updated', { productId: id, interactive });
  return { nodes, calls, timers, picks, changed, dispatch, finishNativeLoad,
    setState(state, id = stateProduct) { currentState = state; stateProduct = id; },
    pagehide() { windowEvents.get('pagehide')(); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
  };
}

test('only the exact approved source or opaque media ID may choose a modular chassis', () => {
  assert.equal(cooktopAssetFor('P04', models.P04), '/models/inox/cooktop-p04-v1.glb');
  assert.equal(cooktopAssetFor('P04', '/media/a5c077e3-be87-5d5a-9aaf-1ebcced04330/'), '/models/inox/cooktop-p04-v1.glb');
  assert.equal(cooktopAssetFor('P04', '/admin/catalog/mediaasset/a5c077e3-be87-5d5a-9aaf-1ebcced04330/file/'), '/models/inox/cooktop-p04-v1.glb');
  for (const [id, url] of [['P04', '/models/new-sketchup.glb'], ['P04', models.P05], ['P04', '/media/a5c077e3-be87-5d5a-9aaf-1ebcced04330-extra/'], ['ILUMI-DJ-181', models.P04], ['__proto__', models.P04]]) assert.equal(cooktopAssetFor(id, url), '');
});

test('an interactive selection opens 3D and pending creation applies the latest selection without reloading', async () => {
  const f = fixture(); f.changed(false); await f.flush(); assert.equal(f.calls.length, 0);
  f.changed(); await f.flush(); assert.equal(f.calls.length, 1);
  const latest = initial(); latest.selection.placements = [{ moduleId: 'plate', anchor: 0 }, { moduleId: 'wok', anchor: 2 }];
  f.setState(latest); f.changed(); await f.flush(); assert.equal(f.calls.length, 1);
  f.calls[0].complete(); await f.flush();
  assert.deepEqual(f.calls[0].updates.at(-1).selection, latest.selection);
  assert.equal(f.calls[0].canvas.focused, undefined); assert.equal(f.timers.size, 0);
  f.setState(initial()); f.changed();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].updates.length, 2);
  f.calls[0].options.onPick(4); assert.deepEqual(f.picks, [{ id: 'P04', anchor: 4 }]);
  f.pagehide(); assert.equal(f.calls[0].disposed, 1); assert.equal(f.nodes['model-host'].children.length, 0);
});

test('late rules replace a pending ordinary viewer without allowing its import to overwrite the modular scene', async () => {
  const f = fixture(product('P04'), true);
  f.setState(null); f.nodes['show-model'].click(); await f.flush();
  assert.equal(f.nodes['show-model'].getAttribute('aria-pressed'), 'true');
  assert.equal(f.nodes['model-host'].querySelector('model-viewer'), null);
  f.setState(initial()); f.changed(false); await f.flush();
  assert.equal(f.calls.length, 1);
  f.calls[0].complete(); await f.flush();
  f.finishNativeLoad(); await f.flush();
  assert.equal(f.calls[0].updates.length, 1);
  assert.equal(f.calls[0].disposed, 0);
  assert.equal(f.nodes['model-host'].querySelector('model-viewer'), null);
  assert.deepEqual(f.nodes['model-host'].children, [f.calls[0].canvas]);
  f.pagehide();
});

test('late rules do not reopen an ordinary viewer closed while its module was loading', async () => {
  const f = fixture(product('P04'), true);
  f.setState(null); f.nodes['show-model'].click(); await f.flush();
  f.nodes['show-model'].click();
  f.setState(initial()); f.changed(false); await f.flush();
  f.finishNativeLoad(); await f.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.nodes['model-host'].children.length, 0);
  assert.equal(f.nodes['model-host'].hidden, true);
  assert.equal(f.nodes['show-model'].getAttribute('aria-pressed'), 'false');
  assert.equal(f.timers.size, 0);
});

test('closing during load disposes the late scene and keeps the photo selected', async () => {
  const f = fixture(); f.changed(); await f.flush(); f.nodes['show-model'].click();
  f.calls[0].complete(); await f.flush();
  assert.equal(f.calls[0].disposed, 1); assert.equal(f.calls[0].updates.length, 0);
  assert.equal(f.nodes['model-host'].hidden, true); assert.equal(f.nodes['model-host'].children.length, 0);
  assert.equal(f.nodes['show-model'].getAttribute('aria-pressed'), 'false'); assert.equal(f.timers.size, 0);
  f.calls[0].options.onPick(0); assert.equal(f.picks.length, 0);
});

test('changing SKU during load cannot overwrite or remove the newer product scene', async () => {
  const f = fixture(); f.changed(); await f.flush();
  f.setState(initial(), 'P05'); f.dispatch('inox:product-updated', { product: product('P05') }); await f.flush();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].url, '/models/inox/cooktop-p05-v1.glb');
  f.calls[1].complete(); await f.flush(); f.calls[0].complete(); await f.flush();
  assert.equal(f.calls[0].disposed, 1); assert.equal(f.calls[1].disposed, 0);
  assert.equal(f.calls[0].updates.length, 0); assert.equal(f.calls[1].updates.length, 1);
  assert.deepEqual(f.nodes['model-host'].children, [f.calls[1].canvas]);
  f.calls[0].options.onPick(2); f.calls[1].options.onPick(3); assert.deepEqual(f.picks, [{ id: 'P05', anchor: 3 }]);
  f.pagehide();
});

test('an independent variant clears a pending configuration and ignores later cooktop events', async () => {
  const f = fixture(); f.changed(); await f.flush(); f.setState(null); f.changed(false);
  f.dispatch('inox:configuration-updated', { productId: 'P04', variant: { id: 'independent', model3d: '/models/independent.glb' } });
  f.calls[0].complete(); await f.flush();
  assert.equal(f.calls[0].disposed, 1); assert.equal(f.calls[0].updates.length, 0);
  f.setState(initial()); f.changed(); await f.flush(); assert.equal(f.calls.length, 1);
  assert.equal(f.nodes['model-host'].querySelector('canvas'), null);
});

test('a new SketchUp model never auto-opens the old modular chassis', async () => {
  const f = fixture({ ...product('P04'), model3d: '/models/new-sketchup.glb' });
  f.changed(); await f.flush(); assert.equal(f.calls.length, 0);
  f.nodes['show-model'].click(); await f.flush();
  assert.equal(f.calls.length, 0); assert.ok(f.nodes['model-host'].querySelector('model-viewer'));
  f.pagehide();
});
