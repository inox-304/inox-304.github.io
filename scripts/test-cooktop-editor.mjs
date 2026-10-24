import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseCooktopConfig, placeCooktopModule, validateCooktopSelection } from '../src/lib/cooktop-config.ts';

const source = readFileSync(new URL('../backend/static/inox/cooktop-editor.js', import.meta.url), 'utf8');
const helpers = { exports: {} };
runInNewContext(source, { module: helpers });
const { starterConfig, familyConfig, validAnchors, positionName, synchronizeBase, trimAnchors, problems, previewPlacement, modulePreset } = helpers.exports;

function browserFixture(initial = '{}') {
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.events = {}; this.attributes = {}; this.hidden = false; this.value = ''; this._text = ''; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = value; this.children = []; }
    get lastElementChild() { return this.children.at(-1); }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(name, action) { (this.events[name] ||= []).push(action); }
    dispatchEvent(event) { (this.events[event.type] || []).forEach(action => action(event)); return !event.defaultPrevented; }
    click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() { document.activeElement = this; }
    closest() { return null; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const matches = node => selector === '[data-focus]' ? Object.hasOwn(node.dataset, 'focus') : selector.startsWith('[data-') ? node.attributes[selector.slice(1, -1)] !== undefined : selector.startsWith('.') ? node.className?.split(' ').includes(selector.slice(1)) : node.tagName.toLowerCase() === selector;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
  }
  const root = new Element('div'); root.attributes['data-cooktop-editor'] = '';
  const textarea = new Element('textarea'); textarea.value = initial;
  const form = new Element('form'); textarea.form = form;
  const controls = new Element('div'); controls.attributes['data-cooktop-controls'] = ''; controls.hidden = true;
  const fallback = new Element('p'); fallback.attributes['data-cooktop-fallback'] = '';
  const status = new Element('p'); status.attributes['data-cooktop-status'] = '';
  root.append(fallback, textarea, controls, status);
  document = { readyState: 'complete', activeElement: null, createElement: tag => new Element(tag), querySelectorAll: selector => selector === '[data-cooktop-editor]' ? [root] : root.querySelectorAll(selector), querySelector: selector => root.querySelector(selector) };
  runInNewContext(source, { document, Event, module: { exports: {} } });
  const button = label => controls.querySelectorAll('button').find(node => node.textContent === label);
  const input = key => controls.querySelectorAll('[data-focus]').find(node => node.dataset.focus === key);
  function change(key, value) { const node = input(key); assert.ok(node, key); node.focus(); if (node.type === 'checkbox') node.checked = value; else node.value = String(value); node.dispatchEvent({ type: 'change' }); }
  return { root, textarea, form, controls, fallback, status, document, button, input, change, data: () => JSON.parse(textarea.value) };
}

test('starter draft is explicit, disabled, gas-only and limits long modules to the left pair', () => {
  const draft = starterConfig();
  assert.equal(draft.enabled, false); assert.deepEqual([...draft.energies], ['gas']);
  assert.equal(draft.modules.length, 4); assert.deepEqual([...draft.modules[2].anchors.six], [0]);
  assert.equal(draft.modules[2].width, 1); assert.equal(draft.modules[2].height, 2);
  assert.deepEqual([...validAnchors(draft.layouts[0], draft.modules[2])], [0, 1, 2]);
  assert.equal(positionName(draft.layouts[0], 0), 'Fondo · Izquierda');
  assert.equal(positionName(draft.layouts[0], 5), 'Frente · Derecha');
  assert.equal(problems(draft).length, 0);
});

test('family drafts preserve confirmed capacities and do not invent dimensions, materials or chassis options', () => {
  const expected = { linear: [[1, 2, 3, 4, 5], ['burner', 'wok']], central: [[4, 6, 8, 10], ['burner', 'wok', 'griddle', 'grill', 'fryer']], builtin: [[2, 4, 6], ['burner', 'wok']], home: [[4], ['burner']] };
  for (const [family, [counts, kinds]] of Object.entries(expected)) {
    const draft = JSON.parse(JSON.stringify(familyConfig(family)));
    assert.equal(draft.enabled, false); assert.deepEqual(draft.energies, ['gas']);
    assert.deepEqual(draft.layouts.map(layout => layout.rows * layout.columns), counts);
    assert.deepEqual(draft.modules.map(module => module.kind), kinds);
    assert.deepEqual(draft.kitchen, { family, ovens: family === 'home' ? ['none', 'gas', 'electric'] : [], structures: [], supports: [], materials: [], dimensions: null });
    assert.equal(problems(draft).length, 0);
    draft.layouts.forEach(layout => assert.deepEqual(draft.modules[0].anchors[layout.id], Array.from({ length: layout.rows * layout.columns }, (_, i) => i)));
    if (family === 'linear') assert.ok(draft.layouts.every(layout => layout.rows === 1));
    if (family === 'central') assert.ok(draft.layouts.every(layout => layout.rows === 2));
  }
  const f = browserFixture(); f.button('Preparar cocina casa / semiindustrial').click();
  assert.deepEqual(f.data().modules.map(module => module.kind), ['burner']);
  assert.equal(f.data().kitchen.family, 'home'); assert.equal(f.data().enabled, false);
  assert.equal(familyConfig('dispenser'), null);
});

test('owner controls kitchen permissions independently and removing them preserves the surface', () => {
  const f = browserFixture(JSON.stringify(starterConfig()));
  const surface = f.data(); f.button('Definir opciones de cocina').click();
  f.change('kitchen-ovens-electric', true); f.change('kitchen-structures-cabinet', true); f.change('kitchen-supports-wheels', true);
  assert.deepEqual(f.data().kitchen.ovens, ['electric']); assert.deepEqual(f.data().kitchen.structures, ['cabinet']); assert.deepEqual(f.data().kitchen.supports, ['wheels']);
  f.change('kitchen-family', 'home');
  assert.deepEqual(f.data().layouts, surface.layouts); assert.deepEqual(f.data().modules, surface.modules);
  f.change('kitchen-ovens-electric', false); assert.deepEqual(f.data().kitchen.ovens, []);
  f.button('Quitar opciones de cocina').click(); assert.deepEqual(f.data(), surface);
});

test('new materials and dimensional bounds start blank and block saving until the owner supplies real values', () => {
  const f = browserFixture(JSON.stringify(familyConfig('home')));
  f.button('Añadir material de cubierta').click();
  assert.deepEqual(f.data().kitchen.materials, [{ id: 'material1', name: '', steel: '', thicknessMm: null }]);
  f.change('kitchen-dimensions', true);
  assert.deepEqual(f.data().kitchen.dimensions.widthMm, { min: null, max: null, step: null });
  const event = () => ({ type: 'submit', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  let submit = event(); f.form.dispatchEvent(submit); assert.equal(submit.defaultPrevented, true);
  f.change('material-material1-name', 'Cubierta de prueba'); f.change('material-material1-steel', '304 MATE'); f.change('material-material1-thickness', '0,8');
  assert.equal(f.data().kitchen.materials[0].thicknessMm, 0.8);
  for (const [axis, bounds] of Object.entries({ widthMm: [1000, 1400, 100], depthMm: [600, 800, 50], heightMm: [900, 900, 1] })) {
    ['min', 'max', 'step'].forEach((key, index) => f.change(`dimension-${axis}-${key}`, bounds[index]));
  }
  submit = event(); f.form.dispatchEvent(submit); assert.equal(submit.defaultPrevented, false);
  f.change('dimension-heightMm-step', 2); submit = event(); f.form.dispatchEvent(submit); assert.equal(submit.defaultPrevented, true);
  f.change('dimension-heightMm-step', 1); f.change('dimension-widthMm-max', 900); assert.ok(problems(f.data()).length);
  f.change('kitchen-dimensions', false); assert.equal(f.data().kitchen.dimensions, null);
  f.button('Quitar material').click(); assert.deepEqual(f.data().kitchen.materials, []);
  assert.equal(problems(f.data()).length, 0); assert.equal(f.data().enabled, false);
});

test('malformed kitchen content stays untouched instead of silently discarding unsupported fields', () => {
  for (const update of [ { privateCost: 123 }, { family: 'dispenser' }, { dimensions: { widthMm: { min: 1, max: 2, step: 1 } } }, { ovens: ['wood'] } ]) {
    const draft = JSON.parse(JSON.stringify(familyConfig('central'))); Object.assign(draft.kitchen, update);
    const original = JSON.stringify(draft), f = browserFixture(original);
    assert.equal(f.textarea.value, original); assert.match(f.status.textContent, /contenido original se conserva/);
    assert.equal(f.input('enabled'), undefined);
  }
});

test('opening the editor preserves the original field until the owner prepares the draft', () => {
  const f = browserFixture();
  assert.equal(f.textarea.value, '{}'); assert.equal(f.textarea.hidden, true); assert.equal(f.controls.hidden, false);
  assert.equal(f.input('enabled'), undefined);
  f.button('Preparar ejemplo de 6 posiciones').click();
  assert.equal(f.data().enabled, false); assert.equal(f.data().layouts[0].rows, 2);
  assert.match(f.status.textContent, /deshabilitado/);
  assert.equal(f.form.events.submit.length, 1);
});

test('visual anchor controls retain allowed positions, disable footprints that do not fit and preserve focus', () => {
  const f = browserFixture(JSON.stringify(starterConfig()));
  assert.equal(f.input('griddle-six-3').disabled, true);
  assert.equal(f.input('griddle-six-1').disabled, false);
  f.change('griddle-six-1', true);
  assert.deepEqual(f.data().modules.find(module => module.id === 'griddle').anchors.six, [0, 1]);
  assert.equal(f.document.activeElement.dataset.focus, 'griddle-six-1');
  f.change('module-griddle-width', 2);
  assert.deepEqual(f.data().modules.find(module => module.id === 'griddle').anchors.six, [0, 1]);
  assert.equal(f.input('griddle-six-2').disabled, true);
});

test('layout and energy changes keep the base complete and require reviewing incompatible optional modules', () => {
  const f = browserFixture(JSON.stringify(starterConfig()));
  f.change('layout-six-columns', 4);
  assert.equal(f.data().modules[0].maxQuantity, 8);
  assert.deepEqual(f.data().modules[0].anchors.six, [0, 1, 2, 3, 4, 5, 6, 7]);
  f.change('energy-electric', true); f.change('energy-gas', false);
  assert.deepEqual(f.data().modules[0].energies, ['electric']);
  assert.deepEqual(f.data().modules[1].energies, []);
  const event = { type: 'submit', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  f.form.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.match(f.controls.querySelector('.cooktop-errors').textContent, /elige al menos un tipo de energía/);
  f.change('energy-electric', false);
  assert.deepEqual(f.data().energies, ['electric']);
});

test('preview changes are illustrative and do not enable or rewrite the stored draft', () => {
  const initial = JSON.stringify(starterConfig(), null, 2);
  const f = browserFixture(initial);
  assert.equal(f.textarea.value, initial);
  f.change('preview-module', 'griddle');
  assert.equal(f.textarea.value, initial);
  assert.equal(f.data().enabled, false);
  f.change('enabled', true); assert.equal(f.data().enabled, true);
  f.button('Quitar configuración de este equipo').click(); assert.deepEqual(f.data(), {});
});

test('malformed saved input remains untouched and is never displayed as editable JSON', () => {
  for (const initial of ['{malformed', '{"version":1,"kind":"cooktop","modules":[]}', 'null']) {
    const f = browserFixture(initial);
    assert.equal(f.textarea.value, initial); assert.equal(f.textarea.hidden, true);
    assert.match(f.status.textContent, /contenido original se conserva/);
    assert.equal(f.button('Preparar ejemplo de 6 posiciones'), undefined);
  }
});

test('module and layout controls enforce the editor limits without removing existing entries', () => {
  const f = browserFixture(JSON.stringify(starterConfig()));
  for (let index = 0; index < 10; index++) f.button('Añadir módulo').click();
  assert.equal(f.data().modules.length, 12); assert.equal(f.button('Añadir módulo').disabled, true);
  for (let index = 0; index < 8; index++) f.button('Añadir distribución').click();
  assert.equal(f.data().layouts.length, 6); assert.equal(f.button('Añadir distribución').disabled, true);
  assert.deepEqual(f.data().modules[0].allowedLayouts, f.data().layouts.map(layout => layout.id));
});

test('pruning a layout never grants new anchors or optional energy compatibility', () => {
  const config = starterConfig(); config.layouts[0].columns = 1;
  trimAnchors(config); synchronizeBase(config);
  assert.deepEqual([...config.modules[2].anchors.six], [0]);
  assert.deepEqual([...config.modules[0].anchors.six], [0, 1]);
  assert.deepEqual([...config.modules[2].energies], ['gas']);
});

test('the visual editor supports linear five and central ten with readable positions and five-column modules', () => {
  for (const rows of [1, 2]) {
    const draft = starterConfig(); draft.modules = [draft.modules[0], draft.modules[2]]; draft.modules[1].height = 1;
    const f = browserFixture(JSON.stringify(draft));
    assert.equal(f.input('layout-six-columns').children.length, 12);
    assert.equal(f.input('module-griddle-width').children.length, 12);
    f.change('layout-six-columns', 5); f.change('layout-six-rows', rows); f.change('module-griddle-width', 5);
    const data = f.data();
    assert.equal(data.enabled, false); assert.equal(data.modules[0].maxQuantity, rows * 5);
    assert.deepEqual(data.modules[0].anchors.six, Array.from({ length: rows * 5 }, (_, i) => i));
    assert.equal(data.modules[1].width, 5); assert.equal(problems(data).length, 0);
    assert.equal(f.input('griddle-six-0').disabled, false); assert.equal(f.input('griddle-six-1').disabled, true);
    assert.deepEqual(Array.from({ length: 5 }, (_, i) => positionName(data.layouts[0], i)),
      ['Izquierda', 'Centro izquierdo', 'Centro', 'Centro derecho', 'Derecha'].map(name => `${rows === 1 ? 'Fila única' : 'Fondo'} · ${name}`));
    assert.equal(f.controls.querySelector('.cooktop-grid').style.gridTemplateColumns, 'repeat(5, minmax(44px, 1fr))');
    const saved = JSON.stringify(data), reopened = browserFixture(saved);
    assert.equal(reopened.controls.hidden, false); assert.equal(reopened.textarea.value, saved);
    const event = { type: 'submit', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    f.form.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  }
});

test('linear ten and twelve remain editable with numbered columns and full-width modules', () => {
  for (const columns of [10, 12]) {
    const draft = starterConfig(); draft.modules = [draft.modules[0], draft.modules[2]]; draft.modules[1].height = 1;
    const f = browserFixture(JSON.stringify(draft));
    f.change('layout-six-rows', 1); f.change('layout-six-columns', columns); f.change('module-griddle-width', columns);
    const data = f.data();
    assert.equal(data.enabled, false); assert.equal(data.modules[0].maxQuantity, columns);
    assert.deepEqual(data.modules[0].anchors.six, Array.from({ length: columns }, (_, i) => i));
    assert.equal(problems(data).length, 0);
    assert.equal(f.input('griddle-six-0').disabled, false); assert.equal(f.input('griddle-six-1').disabled, true);
    assert.deepEqual(Array.from({ length: columns }, (_, i) => positionName(data.layouts[0], i)),
      Array.from({ length: columns }, (_, i) => `Fila única · Columna ${i + 1}`));
    const saved = JSON.stringify(data), reopened = browserFixture(saved);
    assert.equal(reopened.controls.hidden, false); assert.equal(reopened.textarea.value, saved);
    const event = { type: 'submit', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    f.form.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  }
});

test('two by seven and three by five block saving until the distribution fits twelve positions', () => {
 for (const [rows, columns] of [[2, 7], [3, 5]]) {
  const f = browserFixture(JSON.stringify(starterConfig()));
  f.change('layout-six-columns', columns); f.change('layout-six-rows', rows);
  assert.match(f.controls.querySelector('.cooktop-errors').textContent, /máximo es de 12 posiciones/);
  const event = { type: 'submit', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  f.form.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  const invalid = f.textarea.value, reopened = browserFixture(invalid);
  assert.equal(reopened.textarea.value, invalid); assert.equal(reopened.textarea.hidden, true);
  assert.match(reopened.status.textContent, /contenido original se conserva/);
  f.change('layout-six-columns', 3); f.change('layout-six-rows', 2);
  assert.equal(f.controls.querySelector('.cooktop-errors'), null);
  event.defaultPrevented = false; f.form.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  assert.equal(f.data().enabled, false);
 }
});

test('saved columns or module widths above twelve remain untouched and cannot open as editable rules', () => {
  for (const property of ['columns', 'width']) {
    const draft = starterConfig();
    if (property === 'columns') { draft.layouts[0].rows = 1; draft.layouts[0].columns = 13; }
    else draft.modules[2].width = 13;
    const saved = JSON.stringify(draft), f = browserFixture(saved);
    assert.equal(f.textarea.value, saved);
    assert.match(f.status.textContent, /contenido original se conserva/);
  }
});

test('owner can try a plancha plus wok, undo, and restore occupied pairs without changing saved rules', () => {
  const original = JSON.stringify(starterConfig(), null, 2), f = browserFixture(original);
  const summary = () => f.controls.querySelector('.cooktop-trial-summary').textContent;
  assert.equal(summary(), '6 hornillas comunes');
  f.change('preview-module', 'griddle'); f.input('preview-0').click();
  assert.equal(summary(), '4 hornillas comunes · 1 Plancha');
  assert.equal(f.input('preview-0').dataset.kind, 'griddle');
  assert.equal(f.input('preview-3').dataset.kind, 'griddle');
  f.change('preview-module', 'wok'); f.input('preview-2').click();
  assert.equal(summary(), '3 hornillas comunes · 1 Quemador wok · 1 Plancha');
  f.button('Deshacer prueba').click(); assert.equal(summary(), '4 hornillas comunes · 1 Plancha');
  f.change('preview-module', 'burner'); f.input('preview-3').click();
  assert.equal(summary(), '6 hornillas comunes');
  f.button('Deshacer prueba').click(); assert.equal(summary(), '4 hornillas comunes · 1 Plancha');
  f.button('Restaurar todas las hornillas').click(); assert.equal(summary(), '6 hornillas comunes');
  assert.equal(f.button('Deshacer prueba').disabled, true);
  assert.equal(f.textarea.value, original);
  assert.equal(f.data().enabled, false);
});

test('trial blocks overlap, forbidden positions and maximum quantity without silently removing other pieces', () => {
  const f = browserFixture(JSON.stringify(starterConfig()));
  f.change('preview-module', 'wok'); f.input('preview-3').click();
  f.change('preview-module', 'griddle');
  assert.equal(f.input('preview-0').disabled, true);
  assert.match(f.input('preview-0').title, /posiciones vecinas/);
  assert.equal(f.input('preview-1').disabled, true);
  assert.match(f.input('preview-1').title, /No permitiste/);
  f.input('preview-0').click();
  assert.equal(f.controls.querySelector('.cooktop-trial-summary').textContent, '5 hornillas comunes · 1 Quemador wok');
  f.change('preview-module', 'wok'); f.input('preview-2').click();
  assert.equal(f.input('preview-1').disabled, true);
  assert.match(f.input('preview-1').title, /Solo permites 2/);
  assert.equal(f.controls.querySelector('.cooktop-trial-summary').textContent, '4 hornillas comunes · 2 Quemador wok');
});

test('changing trial energy or layout clears incompatible placements while rule edits reset the trial only', () => {
  const draft = starterConfig(); draft.energies.push('electric');
  draft.layouts.push({ id: 'four', name: '4 posiciones', rows: 2, columns: 2 }); synchronizeBase(draft);
  const original = JSON.stringify(draft), f = browserFixture(original);
  f.change('preview-module', 'wok'); f.input('preview-2').click();
  f.change('preview-energy', 'electric');
  assert.equal(f.controls.querySelector('.cooktop-trial-summary').textContent, '6 hornillas comunes');
  assert.equal(f.input('preview-module').children.some(option => option.value === 'wok'), false);
  f.change('preview-layout', 'four');
  assert.equal(f.controls.querySelector('.cooktop-trial-summary').textContent, '4 hornillas comunes');
  assert.equal(f.textarea.value, original);
  f.change('module-wok-max', 1);
  assert.equal(f.data().modules.find(item => item.id === 'wok').maxQuantity, 1);
  assert.equal(Object.hasOwn(f.data(), 'placements'), false);
  assert.equal(f.controls.querySelector('.cooktop-trial-summary').textContent, '6 hornillas comunes');
});

test('quick modules create editable two-position footprints and retain the custom module path', () => {
  for (const rows of [1, 2]) {
    const draft = starterConfig(); draft.layouts[0].rows = rows; draft.modules = [draft.modules[0]]; synchronizeBase(draft);
    const f = browserFixture(JSON.stringify(draft));
    f.button('Añadir plancha de 2 posiciones').click();
    const piece = f.data().modules[1];
    assert.equal(piece.kind, 'griddle'); assert.equal(piece.width * piece.height, 2);
    assert.equal(piece.width, rows === 1 ? 2 : 1); assert.equal(piece.height, rows === 1 ? 1 : 2);
    assert.deepEqual(piece.anchors.six, [0]); assert.equal(piece.maxQuantity, 1);
    f.change(`module-${piece.id}-name`, 'Plancha removible');
    assert.equal(f.data().modules[1].name, 'Plancha removible');
    f.button('Añadir módulo').click();
    assert.equal(f.data().modules.at(-1).kind, 'other');
    assert.match(f.controls.textContent, /Necesita su propia pieza 3D/);
  }
  const single = starterConfig(); single.layouts[0].rows = 1; single.layouts[0].columns = 1;
  single.modules = [single.modules[0]]; synchronizeBase(single);
  assert.equal(modulePreset(single, 'griddle'), null);
  assert.equal(browserFixture(JSON.stringify(single)).button('Añadir plancha de 2 posiciones').disabled, true);
});

test('admin trial follows the public placement rules for replacing pairs and rejecting incompatible combinations', () => {
  const draft = JSON.parse(JSON.stringify(starterConfig())); draft.enabled = true;
  const config = parseCooktopConfig(draft);
  const initial = { layoutId: 'six', energy: 'gas', placements: [] };
  for (const [steps, rejected] of [
    [[['griddle', 0], ['wok', 2], ['burner', 3]], false],
    [[['griddle', 0], ['grill', 3]], false],
    [[['wok', 3], ['griddle', 0]], true],
    [[['griddle', 1]], true],
    [[['wok', 0], ['wok', 1], ['wok', 2]], true],
  ]) {
    let admin = initial, publicState = initial;
    steps.forEach(([moduleId, cell], index) => {
      if (rejected && index === steps.length - 1) {
        assert.throws(() => previewPlacement(draft, admin, moduleId, cell));
        assert.throws(() => placeCooktopModule(config, publicState, moduleId, cell));
      } else {
        admin = previewPlacement(draft, admin, moduleId, cell);
        publicState = placeCooktopModule(config, publicState, moduleId, cell);
        assert.deepEqual(JSON.parse(JSON.stringify(admin)), publicState);
        assert.deepEqual(validateCooktopSelection(config, admin), publicState);
      }
    });
  }
});
