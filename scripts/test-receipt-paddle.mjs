import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaddleResult } from './paddle-normalize.mjs';
import { assessReceiptSuggestions, parseReceiptText } from '../backend/static/inox/receipt-parser.js';

const box = (text, x, y, width = 250, height = 40, score = 0.99) => ({ text, score, poly: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] });
const normalize = items => normalizePaddleResult({ image: { width: 1600, height: 1500 }, items });
const parse = text => parseReceiptText(text, { today: new Date(2026, 10, 10, 12) });

test('Paddle restores separated label and amount columns in reading order', () => {
  const result = normalize([
    box('S/ 118.00', 1100, 304),
    box('09/11/2026', 1100, 104),
    box('TOTAL', 80, 300),
    box('FECHA:', 80, 100),
  ]);
  assert.deepEqual(result.lines.map(line => line.text), ['FECHA: 09/11/2026', 'TOTAL S/ 118.00']);
  assert.deepEqual(parse(result.text).suggestions, { amount: '118.00', currency: 'PEN', occurred_on: '2026-11-09' });
  assert.deepEqual(assessReceiptSuggestions(parse(result.text), result.lines).uncertainFields, []);
});

test('Paddle retains weak conflicting totals so the parser cannot silently choose the clear one', () => {
  const result = normalize([
    box('TOTAL', 80, 100), box('S/ 100.00', 1100, 100),
    box('TOTAL A PAGAR', 80, 200), box('S/ 90.00', 1100, 200, 250, 40, 0.15),
  ]);
  assert.match(result.text, /TOTAL A PAGAR S\/ 90\.00/u);
  assert.equal(result.words.length, 4);
  assert.equal(result.lines[1].confidence, 15);
  const parsed = parse(result.text);
  assert.equal(parsed.suggestions.amount, undefined);
  assert.ok(parsed.warnings.some(warning => warning.includes('total no es inequívoco')));
});

test('Paddle field confidence uses its weakest box without rejecting an unrelated clear date', () => {
  const result = normalize([
    box('FECHA:', 80, 100), box('09/11/2026', 1100, 100),
    box('TOTAL', 80, 200), box('S/ 118.00', 1100, 200, 250, 40, 0.4),
  ]);
  assert.equal(result.confidence, 40);
  assert.deepEqual(result.lines.map(line => line.confidence), [99, 40]);
  assert.deepEqual(new Set(assessReceiptSuggestions(parse(result.text), result.lines).uncertainFields), new Set(['amount', 'currency']));
});

test('Paddle rejects invalid score scales without discarding their recognized text', () => {
  for (const score of [-1, 1.01, 99, '0.99', NaN, Infinity, null]) {
    const result = normalize([box('TOTAL S/ 118.00', 80, 100, 500, 40, score)]);
    assert.equal(result.text, 'TOTAL S/ 118.00');
    assert.equal(result.confidence, 0);
    assert.deepEqual(new Set(assessReceiptSuggestions(parse(result.text), result.lines).uncertainFields), new Set(['amount', 'currency']));
  }
});

test('Paddle refuses malformed geometry instead of guessing a line for financial text', () => {
  const base = box('TOTAL S/ 118.00', 80, 100);
  for (const poly of [undefined, [], [[80, 100]], [[80, 100], [80, 100], [80, 100], [80, 100]], [[80, 100], [Infinity, 100], [330, 140], [80, 140]], [[80, 100, 5], [330, 100], [330, 140], [80, 140]]]) {
    assert.throws(() => normalize([{ ...base, poly }]));
  }
});

test('Paddle refuses excessive output instead of truncating a later conflicting amount', () => {
  assert.throws(() => normalize(Array.from({ length: 513 }, (_, i) => box(i === 512 ? 'TOTAL S/ 90.00' : 'TOTAL S/ 100.00', 80, i * 60))));
  assert.throws(() => normalize([box('x'.repeat(60001), 80, 100)]));
});

test('Paddle empty output remains an empty manual-review result', () => {
  const result = normalize([]);
  assert.equal(result.text, '');
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.lines, []);
  assert.deepEqual(parse(result.text).suggestions, {});
});

test('two side-by-side totals in one row are not interpreted as one safe amount', () => {
  const result = normalize([
    box('TOTAL', 80, 100, 200), box('S/ 100.00', 330, 100, 250),
    box('TOTAL', 830, 100, 200), box('S/ 90.00', 1130, 100, 250),
  ]);
  assert.equal(result.text, 'TOTAL S/ 100.00 TOTAL S/ 90.00');
  assert.equal(parse(result.text).suggestions.amount, undefined);
});
