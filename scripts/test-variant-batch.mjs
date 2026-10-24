import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const helpers = { exports: {} };
runInNewContext(readFileSync(new URL('../backend/static/inox/variant-batch.js', import.meta.url), 'utf8'), { module: helpers, Event });
const { parseVariantNames, prepareVariantRows, initialize } = helpers.exports;

function fixture(existing = [], { permission = true, max = 1000, failAfter = Infinity } = {}) {
  const fields = new Map(), events = [];
  function input(name, value = '', checked = false) {
    const result = { name, value: String(value), checked, dispatchEvent: event => events.push([name, event.type]) };
    fields.set(name, result); return result;
  }
  function row(index, name, active = true) {
    input(`variants-${index}-name`, name); input(`variants-${index}-is_active`, '', active);
    input(`variants-${index}-order`, index); input(`variants-${index}-DELETE`);
    input(`variants-${index}-price`); input(`variants-${index}-manufacturing_code`); input(`variants-${index}-model_asset`);
  }
  existing.forEach((name, index) => row(index, name));
  input('variants-TOTAL_FORMS', existing.length); input('variants-MAX_NUM_FORMS', max);
  input('variants-__prefix__-name'); input('variants-__prefix__-order', 0);
  let additions = 0;
  const add = { click() { if (additions >= failAfter) return; const index = Number(fields.get('variants-TOTAL_FORMS').value); row(index, ''); fields.get('variants-TOTAL_FORMS').value = String(index + 1); additions++; } };
  const group = {
    querySelector: selector => selector === '.add-row a' && permission ? add : null,
    querySelectorAll: selector => [...fields.values()].filter(field => selector.includes('-order') ? field.name.endsWith('-order') : field.name.endsWith('-name')),
  };
  const form = { elements: { namedItem: name => fields.get(name) }, querySelector: selector => selector === '#variants-group' ? group : null };
  const names = { value: '' }, status = { textContent: '', dataset: {} };
  const handlers = {}, create = { addEventListener: (event, action) => { handlers[event] = action; }, click: () => handlers.click?.() };
  const root = { hidden: true, closest: () => form, querySelector: selector => ({ '[data-inox-variant-names]': names, '[data-inox-variant-create]': create, '[data-inox-variant-status]': status })[selector] };
  return { fields, form, group, root, names, status, create, events, add };
}

test('batch accepts only names the user supplies without inventing capacities or dimensions', () => {
  assert.deepEqual([...parseVariantNames('  Opción confirmada A\r\n\nOpción confirmada B  ')], ['Opción confirmada A', 'Opción confirmada B']);
  assert.throws(() => parseVariantNames('  \n '), /al menos/);
  assert.throws(() => parseVariantNames(Array.from({ length: 21 }, (_, i) => `Opción ${i}`).join('\n')), /20 opciones/);
  assert.throws(() => parseVariantNames('A\nB', [], 1), /No hay espacio/);
  assert.throws(() => parseVariantNames('A'.repeat(181)), /180 caracteres/);
  assert.throws(() => parseVariantNames('A\u0000B'), /control/);
});

test('names cannot duplicate existing variants or repeat after case whitespace and Unicode normalization', () => {
  for (const [names, existing] of [['  25 L ', ['25 l']], ['A\na', []], ['Mesa  grande', ['mesa grande']], ['Cafe\u0301', ['Café']]]) {
    assert.throws(() => parseVariantNames(names, existing), /repetida/);
  }
});

test('prepared rows are inactive and leave existing variants prices codes models and uploads untouched', () => {
  const f = fixture(['Existente']); f.fields.get('variants-0-price').value = '900';
  const result = prepareVariantRows(f.form, f.group, ['Nueva A', 'Nueva B']);
  assert.equal(result.prepared, 2); assert.equal(result.remaining.length, 0);
  assert.equal(f.fields.get('variants-0-name').value, 'Existente'); assert.equal(f.fields.get('variants-0-is_active').checked, true); assert.equal(f.fields.get('variants-0-price').value, '900');
  for (const index of [1, 2]) {
    assert.equal(f.fields.get(`variants-${index}-is_active`).checked, false);
    assert.equal(f.fields.get(`variants-${index}-order`).value, String(index));
    for (const key of ['price', 'manufacturing_code', 'model_asset']) assert.equal(f.fields.get(`variants-${index}-${key}`).value, '');
  }
  assert.equal(f.events.length, 12); assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '3');
});

test('permission-restricted inline never exposes the batch tool or creates rows', () => {
  const f = fixture([], { permission: false }); initialize(f.root);
  assert.equal(f.root.hidden, true); f.create.click(); assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '0');
});

test('UI does not add duplicate rows and keeps names for correction', () => {
  const f = fixture(['Ya existe']); initialize(f.root); f.names.value = 'NUEVA\nYA EXISTE'; f.create.click();
  assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '1'); assert.equal(f.names.value, 'NUEVA\nYA EXISTE'); assert.equal(f.status.dataset.error, 'true');
  assert.match(f.status.textContent, /repetida/);
});

test('the batch cannot bypass the 100 variant cap through altered management fields', () => {
  const f = fixture(Array.from({ length: 99 }, (_, index) => `Existente ${index}`), { max: 9999 }); initialize(f.root);
  f.names.value = 'Nueva A\nNueva B'; f.create.click();
  assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '99'); assert.equal(f.status.dataset.error, 'true');
  f.names.value = 'Nueva A'; f.create.click(); assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '100');
  f.names.value = 'Nueva B'; f.create.click(); assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '100'); assert.equal(f.names.value, 'Nueva B');
});

test('deletions can be replaced but inactive existing variants still prevent duplicates', () => {
  const f = fixture(['Retirada', 'Inactiva']); f.fields.get('variants-0-DELETE').checked = true; f.fields.get('variants-1-is_active').checked = false;
  initialize(f.root); f.names.value = 'Inactiva'; f.create.click(); assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '2');
  f.names.value = 'Retirada'; f.create.click(); assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '3'); assert.equal(f.fields.get('variants-2-is_active').checked, false);
});

test('a partial inline failure reports prepared rows and retains pending names without resubmitting', () => {
  const f = fixture([], { failAfter: 1 }); initialize(f.root); f.names.value = 'Primera\nPendiente'; f.create.click();
  assert.equal(f.fields.get('variants-TOTAL_FORMS').value, '1'); assert.equal(f.names.value, 'Pendiente'); assert.equal(f.status.dataset.error, 'true');
  assert.match(f.status.textContent, /1 variación preparada/); assert.equal(f.fields.get('variants-0-is_active').checked, false);
});

test('UI displays user labels as text and requires an explicit save outside the batch tool', () => {
  const f = fixture(); initialize(f.root); f.names.value = '<img src=x onerror=alert(1)>'; f.create.click();
  assert.equal(f.fields.get('variants-0-name').value, '<img src=x onerror=alert(1)>'); assert.equal(f.names.value, '');
  assert.match(f.status.textContent, /sin guardar/); assert.equal(f.status.dataset.error, 'false');
  // The fixture exposes neither submit nor network methods; preparing rows needs neither.
  assert.equal(f.fields.get('variants-0-is_active').checked, false);
});
