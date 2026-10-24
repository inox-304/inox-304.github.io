import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVariantAxes, parseOptionValues, validateVariantCombinations, chooseVariant } from '../src/lib/product-variant-options.ts';
import { parsePublicCatalog } from '../src/lib/cms-api.ts';
import { renderVariantOptions } from '../src/scripts/variant-options-ui.ts';

const axes = () => [
  { id: 'capacity', label: 'Capacidad', options: ['4', '6', '8', '10', 'pending'].map(id => ({ id, label: id === 'pending' ? 'Pendiente' : `${id} bandejas` })) },
  { id: 'energy', label: 'Energía', options: [{ id: 'gas', label: 'Gas' }, { id: 'electric', label: 'Eléctrico' }] },
  { id: 'glass', label: 'Cubierta', options: [{ id: 'open', label: 'Sin cubierta' }, { id: 'glass', label: 'Con vidrio' }] },
];
const variant = (id, capacity, energy, glass) => ({ id, name: `${capacity} bandejas · ${energy} · ${glass}`, availability: 'made_to_order', optionValues: { capacity, energy, glass }, image: `/images/products/${id}.webp`, model3d: `/models/inox/${id}.glb` });
const combinations = () => [
  variant('a', '4', 'gas', 'open'),
  variant('b', '6', 'gas', 'glass'),
  variant('c', '6', 'electric', 'open'),
  variant('d', '8', 'electric', 'glass'),
  variant('e', '8', 'gas', 'open'),
  variant('f', '10', 'electric', 'glass'),
];

test('axes accept at most three dimensions, ten values each, trim labels and preserve input objects', () => {
  const source = axes(); source[0].label = '  Capacidad  '; const before = structuredClone(source);
  const parsed = parseVariantAxes(source);
  assert.equal(parsed[0].label, 'Capacidad'); assert.deepEqual(source, before); assert.notEqual(parsed, source);
  assert.deepEqual(parseVariantAxes(), []);
  const maximum = Array.from({ length: 3 }, (_, n) => ({ id: `axis${n}`, label: 'Opción', options: Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, label: `Valor ${i}` })) }));
  assert.equal(parseVariantAxes(maximum).length, 3);
  assert.throws(() => parseVariantAxes([...maximum, { ...maximum[0], id: 'fourth' }]));
  assert.throws(() => parseVariantAxes([{ ...maximum[0], options: [...maximum[0].options, { id: 'extra', label: 'Extra' }] }]));
});

test('schema rejects unknown fields, duplicate identifiers, reserved keys and incomplete or malformed options', () => {
  const a = axes()[0];
  for (const bad of [null, {}, [null], [[a]], [{ ...a, unexpected: true }], [{ id: a.id, label: a.label }], [{ ...a, options: [] }], [{ ...a, options: [null] }], [{ ...a, options: [{ id: 'x', label: 'X', extra: true }] }], [a, a], [{ ...a, options: [a.options[0], a.options[0]] }]]) assert.throws(() => parseVariantAxes(bad));
  for (const id of ['', '__proto__', 'prototype', 'constructor', 'a b', 'x'.repeat(65), 3]) {
    assert.throws(() => parseVariantAxes([{ ...a, id }]));
    assert.throws(() => parseVariantAxes([{ ...a, options: [{ id, label: 'X' }] }]));
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('labels accept valid Unicode code points but reject isolated surrogates and controls consistently with Python', () => {
  const a = axes()[0];
  for (const label of ['Gas 🔥', 'Convección y energía', '🔥'.repeat(120)]) assert.equal(parseVariantAxes([{ ...a, label }])[0].label, label);
  for (const label of ['', '   ', 'x'.repeat(121), '🔥'.repeat(121), '\ud800', '\udfff', 'x\u0000y', 'x\ny', 'x\ty']) {
    assert.throws(() => parseVariantAxes([{ ...a, label }]));
    assert.throws(() => parseVariantAxes([{ ...a, options: [{ id: 'x', label }] }]));
  }
});

test('each public combination must specify exactly its own product axes with authorized values', () => {
  const schema = parseVariantAxes(axes()), complete = combinations()[0].optionValues;
  assert.deepEqual(parseOptionValues(schema, complete), complete);
  for (const values of [undefined, null, [], {}, { capacity: '4', energy: 'gas' }, { ...complete, foreign: 'x' }, { ...complete, capacity: '12' }, { ...complete, energy: 1 }]) assert.throws(() => parseOptionValues(schema, values));
  assert.deepEqual(parseOptionValues([], {}), {});
  assert.throws(() => parseOptionValues([], complete));
  assert.throws(() => parseOptionValues([{ id: 'other', label: 'Otro', options: [{ id: 'x', label: 'X' }] }], complete));
});

test('sparse combinations are legal while duplicate tuples and incomplete variants fail validation', () => {
  const schema = axes(), variants = combinations();
  assert.doesNotThrow(() => validateVariantCombinations(schema, variants));
  const duplicate = { ...variants[0], id: 'duplicate', optionValues: { glass: 'open', energy: 'gas', capacity: '4' } };
  assert.throws(() => validateVariantCombinations(schema, [...variants, duplicate]), /Duplicate/);
  assert.throws(() => validateVariantCombinations(schema, [...variants, { ...variants[0], id: 'missing', optionValues: {} }]));
  assert.doesNotThrow(() => validateVariantCombinations([], [{ id: 'legacy', name: 'Variación libre' }]));
});

test('selection uses an existing local variant, maximizes preserved choices and resolves ties in catalog order', () => {
  const schema = axes(), variants = combinations(), before = structuredClone(variants);
  assert.equal(chooseVariant(schema, variants, variants[0], 'capacity', '8'), variants[4], 'preserve gas and no cover despite an earlier incompatible candidate');
  assert.equal(chooseVariant(schema, variants, variants[0], 'capacity', '6'), variants[1], 'one preserved choice each: first catalog entry wins');
  assert.equal(chooseVariant(schema, variants, undefined, 'capacity', '6'), variants[1]);
  assert.equal(chooseVariant(schema, variants, variants[0], 'capacity', '10'), variants[5]);
  assert.equal(chooseVariant(schema, variants, variants[0], 'capacity', 'pending'), undefined);
  assert.equal(chooseVariant(schema, variants, variants[0], 'capacity', 'unauthorized'), undefined);
  assert.equal(chooseVariant(schema, variants, variants[0], 'foreign', 'gas'), undefined);
  assert.equal(chooseVariant(schema, [], variants[0], 'capacity', '4'), undefined);
  assert.deepEqual(variants, before);
});

test('public catalog validates every combination and preserves its own photo/model association', () => {
  const product = { id: 'TEST-TAVOLA', slug: 'test-tavola', name: 'Távola de prueba', category: 'linea-caliente', summary: 'Fixture', features: [], image: '/images/products/example.webp', visible: true, featured: false, order: 1, currency: 'PEN', showPrice: false, variantAxes: axes(), variants: combinations() };
  const catalog = () => ({ products: [structuredClone(product)], contacts: [], settings: {} });
  const parsed = parsePublicCatalog(catalog()).products[0];
  assert.equal(parsed.variants.length, 6); assert.equal(parsed.variants[5].model3d, '/models/inox/f.glb');
  assert.equal(parsed.variants[5].image, '/images/products/f.webp');
  for (const change of [p => { p.variants[0].optionValues = {}; }, p => { p.variants[0].optionValues.capacity = '12'; }, p => { p.variants.push({ ...p.variants[0], id: 'duplicate' }); }, p => { p.variantAxes = []; }]) {
    const input = catalog(); change(input.products[0]); assert.throws(() => parsePublicCatalog(input));
  }
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.value = ''; this.disabled = false; this._text = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { throw new Error('Labels must never become HTML'); }
}
function descend(root, predicate) { return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => descend(child, predicate))]; }
function domFixture(product = { variantAxes: axes(), variants: combinations() }, selectedId = 'a') {
  const root = new Element('fieldset'), selected = [];
  const render = (next = product, id = selectedId) => {
    const previous = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
    try { renderVariantOptions(root, next, id, value => selected.push(value)); }
    finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  };
  render();
  const control = id => descend(root, node => node.tagName === 'select' && node.dataset.variantAxis === id)[0];
  const change = (id, value) => { const node = control(id); node.value = value; node.onchange(); };
  const status = () => descend(root, node => node.className === 'variant-options-status')[0];
  return { root, selected, render, control, change, status };
}

test('DOM exposes approved axes with labels, disables unavailable values and never executes markup labels', () => {
  const schema = axes(); schema[0].label = '<img src=x onerror=bad()> Capacidad';
  const f = domFixture({ variantAxes: schema, variants: combinations() });
  assert.equal(f.root.hidden, false); assert.equal(descend(f.root, node => node.tagName === 'select').length, 3);
  assert.equal(f.control('capacity').attributes['aria-label'], schema[0].label);
  assert.ok(f.root.textContent.includes(schema[0].label));
  assert.equal(f.control('capacity').children.find(option => option.value === 'pending').disabled, true);
  assert.equal(f.control('capacity').children.find(option => option.value === '10').disabled, false);
  assert.equal(f.status().attributes['aria-live'], 'polite'); assert.deepEqual(f.selected, []);
});

test('DOM preserves compatible choices and explains adjustments required by sparse combinations', () => {
  const f = domFixture();
  f.change('capacity', '8'); assert.deepEqual(f.selected, ['e']);
  assert.equal(f.control('energy').value, 'gas'); assert.equal(f.control('glass').value, 'open');
  assert.doesNotMatch(f.status().textContent, /Ajustamos/);
  f.change('capacity', '10'); assert.deepEqual(f.selected, ['e', 'f']);
  assert.equal(f.control('energy').value, 'electric'); assert.equal(f.control('glass').value, 'glass');
  assert.match(f.status().textContent, /Ajustamos las otras opciones/);
  f.change('capacity', 'pending'); assert.equal(f.control('capacity').value, '10'); assert.deepEqual(f.selected, ['e', 'f']);
  f.change('energy', 'tampered'); assert.equal(f.control('energy').value, 'electric'); assert.deepEqual(f.selected, ['e', 'f']);
});

test('DOM re-render uses only the new product combinations and clears obsolete or empty controls', () => {
  const f = domFixture(); f.change('capacity', '10');
  const other = { variantAxes: [{ id: 'type', label: 'Tipo', options: [{ id: 'conventional', label: 'Convencional' }, { id: 'convection', label: 'Convección' }] }], variants: [{ id: 'other-a', name: 'Otro horno', optionValues: { type: 'conventional' } }, { id: 'other-b', name: 'Otro convector', optionValues: { type: 'convection' } }] };
  f.render(other, 'other-b'); assert.equal(f.control('capacity'), undefined); assert.equal(f.control('type').value, 'convection');
  f.change('type', 'conventional'); assert.equal(f.selected.at(-1), 'other-a');
  f.render({ variantAxes: axes(), variants: [] }, ''); assert.equal(f.root.hidden, true); assert.equal(f.root.children.length, 0);
  f.render({ variantAxes: [], variants: combinations() }, ''); assert.equal(f.root.hidden, true); assert.equal(f.root.children.length, 0);
  assert.doesNotThrow(() => renderVariantOptions(null, other, 'other-a', () => { throw new Error('Unexpected selection'); }));
});
