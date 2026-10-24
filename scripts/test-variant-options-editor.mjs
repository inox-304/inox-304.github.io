import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const helpers = { exports: {} };
runInNewContext(readFileSync(new URL('../backend/static/inox/variant-options.js', import.meta.url), 'utf8'), { module: helpers, Event });
const { validateAxes, selectionStatus, clearAsDraft } = helpers.exports;
const axes = () => [{ id: 'capacity', label: 'Capacidad', options: [{ id: 'small', label: 'Capacidad confirmada A' }, { id: 'large', label: 'Capacidad confirmada B' }] }, { id: 'energy', label: 'Energía', options: [{ id: 'gas', label: 'Gas' }] }];

test('empty definitions retain legacy named variants and explicit complete combinations work', () => {
  assert.match(selectionStatus([], {}, true), /Variación libre/);
  assert.match(selectionStatus(axes(), { capacity: 'small', energy: 'gas' }, true), /completa/);
  assert.match(selectionStatus(axes(), {}, false), /Borrador/);
  assert.throws(() => selectionStatus(axes(), {}, true), /antes de activar/);
});

test('changed or partial selections cannot silently become a different allowed combination', () => {
  assert.throws(() => selectionStatus(axes(), { capacity: 'small' }, false), /cambiaron/);
  assert.throws(() => selectionStatus(axes(), { capacity: 'removed', energy: 'gas' }, true), /Capacidad/);
  assert.throws(() => selectionStatus(axes(), { capacity: 'small', energy: 'gas', inherited: 'x' }, true), /cambiaron/);
  assert.throws(() => selectionStatus([], { capacity: 'small' }, false), /cambiaron/);
});

test('axes limits and strict keys match the backend contract', () => {
  for (const malformed of [null, {}, Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, label: 'Tipo', options: [{ id: 'a', label: 'A' }] })), [{ ...axes()[0], options: [] }], [{ ...axes()[0], options: Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, label: 'A' })) }], [{ ...axes()[0], extra: true }], [{ ...axes()[0], label: '' }], [{ ...axes()[0], label: 'X'.repeat(121) }]]) {
    assert.throws(() => validateAxes(malformed));
  }
  assert.throws(() => validateAxes([axes()[0], axes()[0]]), /repetido/);
});

test('after a rejected save the visual editor keeps incomplete labels editable instead of exposing raw JSON', () => {
  const unfinished = [{ id: 'capacity', label: '', options: [] }];
  assert.doesNotThrow(() => validateAxes(unfinished, true));
  assert.throws(() => validateAxes(unfinished), /nombre/);
  const missingValue = [{ id: 'capacity', label: 'Capacidad', options: [{ id: 'large', label: '' }] }];
  assert.doesNotThrow(() => validateAxes(missingValue, true));
  assert.throws(() => validateAxes(missingValue), /nombre/);
});

test('prototype identifiers and unsafe labels are rejected in both axes and options', () => {
  for (const id of ['__proto__', 'prototype', 'constructor', 'has space', 'x'.repeat(65)]) {
    assert.throws(() => validateAxes([{ ...axes()[0], id }]));
    assert.throws(() => validateAxes([{ ...axes()[0], options: [{ id, label: 'A' }] }]));
  }
  for (const label of ['\u0000', '\ud800', '']) assert.throws(() => validateAxes([{ ...axes()[0], options: [{ id: 'a', label }] }]));
  assert.doesNotThrow(() => validateAxes([{ ...axes()[0], label: '🔥'.repeat(120) }]));
  assert.throws(() => validateAxes([{ ...axes()[0], label: '🔥'.repeat(121) }]));
});

test('clearing a combination is an explicit inactive draft transition without changing files or name', () => {
  const events = [], source = { value: JSON.stringify({ capacity: 'small', energy: 'gas' }), dispatchEvent: event => events.push(`values:${event.type}`) };
  const active = { checked: true, dispatchEvent: event => events.push(`active:${event.type}`) };
  clearAsDraft(source, active);
  assert.equal(active.checked, false);
  assert.deepEqual(JSON.parse(source.value), {});
  assert.deepEqual(events, ['active:change', 'values:input', 'values:change']);
});
