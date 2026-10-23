import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backend/static/inox/cooktop-editor.js', import.meta.url), 'utf8');
const helpers = { exports: {} };
runInNewContext(source, { module: helpers });
const { starterConfig, validAnchors, positionName, synchronizeBase, trimAnchors, problems } = helpers.exports;

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
