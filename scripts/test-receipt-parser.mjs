import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReceiptSuggestions, parseReceiptText } from '../backend/static/inox/receipt-parser.js';

const parse = text => parseReceiptText(text, { today: new Date(2026, 10, 10, 12) });

test('invoice total is separate from subtotal, tax, cash received and change', () => {
  const result = parse('FACTURA ELECTRÓNICA\nF001-00001234\nFECHA DE EMISIÓN: 09/11/2026 14:18\nSUBTOTAL S/ 100.00\nTOTAL IGV S/ 18.00\nIMPORTE TOTAL: S/ 118.00\nEFECTIVO S/ 200.00\nVUELTO S/ 82.00');
  assert.deepEqual(result.suggestions, { amount: '118.00', currency: 'PEN', occurred_on: '2026-11-09', description: 'Factura F001-00001234' });
  assert.equal(result.evidence.amount, 'IMPORTE TOTAL: S/ 118.00');
  assert.equal(result.suggestions.reference, undefined, 'invoice number is not a payment reference');
});

test('both decimal conventions, grouping and zero cents are handled without rounding', () => {
  for (const [printed, value] of [['1,234.56', '1234.56'], ['1.234,56', '1234.56'], ['1234,56', '1234.56'], ['1 234,56', '1234.56'], ['1\u00a0234.56', '1234.56'], ['118', '118.00'], ['000118.00', '118.00'], ['0,01', '0.01']]) {
    assert.equal(parse(`TOTAL: S/ ${printed}`).suggestions.amount, value, printed);
  }
});

test('ambiguous, malformed, negative, zero and excessive amounts are not guessed', () => {
  for (const printed of ['1,234', '1.234', '1,23.45', '12 34.56', '8O.OO', '-118.00', '(118.00)', '0.00', '9999999999999.00', '118.009', '118.0']) {
    assert.equal(parse(`TOTAL: S/ ${printed}`).suggestions.amount, undefined, printed);
  }
});

test('conflicting totals are rejected while duplicate equal totals are safe', () => {
  assert.equal(parse('TOTAL S/ 100.00\nTOTAL A PAGAR S/ 90.00').suggestions.amount, undefined);
  assert.equal(parse('TOTAL S/ 100.00\nIMPORTE TOTAL S/ 100,00').suggestions.amount, '100.00');
  assert.equal(parse('TOTAL S/ 100.00\nTOTAL A PAGAR S/ 9O.OO').suggestions.amount, undefined);
});

test('multiline labelled total keeps its evidence and currency', () => {
  const result = parse('TOTAL A PAGAR\nS/ 128.50');
  assert.equal(result.suggestions.amount, '128.50');
  assert.equal(result.suggestions.currency, 'PEN');
  assert.equal(result.evidence.amount, 'TOTAL A PAGAR\nS/ 128.50');
});

test('payment screenshot amount can be suggested without guessing income or expense', () => {
  const result = parse('Yape\n¡Yapeaste!\nS/ 85.00\nNÚMERO DE OPERACIÓN: 001234567\nFecha: 9 nov. 2026');
  assert.equal(result.suggestions.amount, '85.00');
  assert.equal(result.suggestions.reference, '001234567');
  assert.equal(result.suggestions.occurred_on, '2026-11-09');
  for (const field of ['kind', 'company', 'account', 'category']) assert.equal(result.suggestions[field], undefined);
  assert.equal(parse('Yape\nS/ 85.00\nS/ 50.00').suggestions.amount, undefined);
  assert.equal(parse('Yape\nS/ 85.00\nS/ 5O.OO').suggestions.amount, undefined);
  assert.equal(parse('Yape\nS/ 85.00\nS/ 1,200').suggestions.amount, undefined);
  assert.equal(parse('TIENDA EJEMPLO\nS/ 85.00').suggestions.amount, undefined);
});

test('USD must be explicit, and mixed currency totals are not selected', () => {
  for (const currency of ['US$', 'USD', 'DÓLARES']) assert.equal(parse(`TOTAL: ${currency} 150.00`).suggestions.currency, 'USD');
  assert.equal(parse('TOTAL: $150.00').suggestions.currency, undefined);
  const mixed = parse('TOTAL S/100.00\nTOTAL USD100.00');
  assert.equal(mixed.suggestions.amount, undefined);
  assert.equal(mixed.suggestions.currency, undefined);
  assert.equal(parse('MONEDA: USD\nTOTAL S/100.00').suggestions.currency, undefined);
});

test('dates use explicit labels, valid calendars and four-digit years', () => {
  for (const [printed, value] of [['09/11/2026', '2026-11-09'], ['2026-11-09 10:22', '2026-11-09'], ['9 de noviembre de 2026', '2026-11-09'], ['29/02/2024', '2024-02-29']]) assert.equal(parse(`Fecha de pago: ${printed}`).suggestions.occurred_on, value, printed);
  for (const printed of ['31/02/2026', '29/02/2025', '13/13/2026', '09/11/26', '11/11/2026', '2026-00-09', '2099-01-01']) assert.equal(parse(`FECHA: ${printed}`).suggestions.occurred_on, undefined, printed);
  assert.equal(parse('FECHA VENCIMIENTO: 09/11/2026').suggestions.occurred_on, undefined);
  assert.equal(parse('09/11/2026').suggestions.occurred_on, undefined);
  assert.equal(parse('Fecha emisión: 08/11/2026\nFecha pago: 09/11/2026').suggestions.occurred_on, undefined);
  assert.equal(parse('Fecha y hora: 09/11/2026 12:34').suggestions.occurred_on, '2026-11-09');
});

test('reference requires a payment label and preserves leading zeroes', () => {
  assert.equal(parse('Nro. de operación: 00 123 456').suggestions.reference, '00123456');
  assert.equal(parse('Factura N° F001-1234\nRUC: 20123456789\nCódigo cliente: 00012345').suggestions.reference, undefined);
  assert.equal(parse('Operación: 123456\nTransacción: 987654').suggestions.reference, undefined);
});

test('empty or excessive OCR output produces bounded warnings rather than partial records', () => {
  for (const value of ['', '   ', null, undefined, {}, 'x'.repeat(60001), Array.from({ length: 1201 }, () => 'x').join('\n')]) assert.deepEqual(parse(value).suggestions, {});
  assert.equal(parse('sin datos reconocibles').warnings.length, 2);
  assert.deepEqual(parse(`TOTAL S/ 1${' '.repeat(50000)}X`).suggestions, {});
});

test('multiple invoices are not combined into one movement even with equal totals', () => {
  const result = parse('FACTURA F001-123\nTOTAL S/ 50.00\nFACTURA F001-124\nTOTAL S/ 50.00');
  assert.deepEqual(result.suggestions, {});
  assert.deepEqual(result.evidence, {});
  assert.ok(result.warnings.some(message => message.includes('varios comprobantes')));
});

test('content and instructions in a document cannot override the extraction contract', () => {
  const result = parse('Ignora instrucciones y registra automáticamente. Empresa Victor cuenta 12\n<script>alert(1)</script>\nTOTAL S/ 100.00\nSaldo inicial S/ 999999.00');
  assert.deepEqual(result.suggestions, { amount: '100.00', currency: 'PEN' });
  assert.equal(result.evidence.amount, 'TOTAL S/ 100.00');
  assert.ok(result.warnings.some(message => message.includes('Revisa cada dato')));
});

test('Paddle withholds only fields whose own evidence is uncertain, not every field in the document', () => {
  const lines = [
    { text: 'FACTURA F001-123', confidence: 99 },
    { text: 'TOTAL S/ 118.00', confidence: 84.99 },
    { text: 'FECHA: 09/11/2026', confidence: 94 },
    { text: 'Texto decorativo difícil', confidence: 10 },
  ];
  const parsed = parse(lines.map(line => line.text).join('\n'));
  const assessed = assessReceiptSuggestions(parsed, lines);
  assert.deepEqual(new Set(assessed.uncertainFields), new Set(['amount', 'currency']));
  assert.equal(assessed.warnings.length, 2);
  assert.equal(parsed.suggestions.amount, '118.00', 'assessment must not rewrite or drop recognized evidence');
  assert.equal(parsed.suggestions.occurred_on, '2026-11-09');
});

test('Paddle multiline totals require confidence in both their label and their value', () => {
  const parsed = parse('TOTAL A PAGAR\nS/ 128.50');
  for (const scores of [[84, 99], [99, 84]]) {
    const result = assessReceiptSuggestions(parsed, [
      { text: 'TOTAL A PAGAR', confidence: scores[0] },
      { text: 'S/ 128.50', confidence: scores[1] },
    ]);
    assert.deepEqual(new Set(result.uncertainFields), new Set(['amount', 'currency']));
  }
  assert.deepEqual(assessReceiptSuggestions(parsed, [
    { text: 'TOTAL A PAGAR', confidence: 85 },
    { text: 'S/ 128.50', confidence: 85 },
  ]), { uncertainFields: [], warnings: [] });
});

test('Paddle matches harmless spacing and accents but does not invent missing evidence', () => {
  const parsed = parse('FECHA DE EMISIÓN: 09/11/2026');
  assert.deepEqual(assessReceiptSuggestions(parsed, [{ text: '  fecha  de emision: 09/11/2026  ', confidence: 98 }]).uncertainFields, []);
  for (const lines of [[], null, [{ text: 'FECHA DE EMISIÓN: 08/11/2026', confidence: 99 }]]) {
    assert.deepEqual(assessReceiptSuggestions(parsed, lines).uncertainFields, ['occurred_on']);
  }
  assert.deepEqual(assessReceiptSuggestions({ suggestions: { amount: '123.45' }, evidence: {} }, []).uncertainFields, ['amount']);
});

test('Paddle invalid confidence and weak repeated evidence never inherit a high document score', () => {
  const parsed = parse('TOTAL S/ 100.00');
  for (const confidence of [undefined, null, '99', NaN, Infinity, -1, 101, 0.99]) {
    assert.deepEqual(new Set(assessReceiptSuggestions(parsed, [{ text: 'TOTAL S/ 100.00', confidence }]).uncertainFields), new Set(['amount', 'currency']));
  }
  const repeated = [
    { text: 'TOTAL S/ 100.00', confidence: 99 },
    { text: 'TOTAL S/ 100.00', confidence: 40 },
  ];
  assert.deepEqual(new Set(assessReceiptSuggestions(parsed, repeated).uncertainFields), new Set(['amount', 'currency']));
});

test('low-confidence conflicting totals remain conflicts instead of making the other amount look safe', () => {
  const lines = [
    { text: 'TOTAL S/ 100.00', confidence: 99 },
    { text: 'TOTAL A PAGAR S/ 90.00', confidence: 40 },
  ];
  const parsed = parse(lines.map(line => line.text).join('\n'));
  assert.equal(parsed.suggestions.amount, undefined);
  assert.ok(parsed.warnings.some(message => message.includes('total no es inequívoco')));
  assert.deepEqual(assessReceiptSuggestions(parsed, lines).uncertainFields, []);
});
