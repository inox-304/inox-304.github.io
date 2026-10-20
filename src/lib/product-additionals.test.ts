import test from 'node:test';
import assert from 'node:assert/strict';
import { contactUrl, type CmsAdditional } from './cms.ts';
import { additionalRate, additionalsQuoteSummary, reconcileAdditionalSelection } from './product-additionals.ts';

const additionals: CmsAdditional[] = [
  { id: 'glass', name: '<Vidrio & aluminio>', description: 'Sin instalación', price: null, chargeUnit: 'unit', unitLabel: '' },
  { id: 'shelf', name: 'Repisa', description: '', price: 120, chargeUnit: 'm', unitLabel: '' },
  { id: 'panel', name: 'Panel', description: '', price: 80, chargeUnit: 'm2', unitLabel: '' },
  { id: 'visit', name: 'Visita', description: '', price: 0, chargeUnit: 'custom', unitLabel: 'por visita' },
];
const product = { id: 'table', currency: 'PEN' as const, additionals };

test('keeps only current product choices and drops removed or duplicate selections after a refresh', () => {
  const previous = { productId: 'table', ids: ['removed', 'shelf', 'glass', 'shelf'] };
  assert.deepEqual(reconcileAdditionalSelection(product, previous), { productId: 'table', ids: ['glass', 'shelf'] });
  assert.deepEqual(reconcileAdditionalSelection({ ...product, additionals: [additionals[0]] }, previous), { productId: 'table', ids: ['glass'] });
  assert.deepEqual(reconcileAdditionalSelection({ ...product, id: 'oven' }, previous), { productId: 'oven', ids: [] });
  assert.deepEqual(reconcileAdditionalSelection({ id: 'table' }, previous), { productId: 'table', ids: [] });
  assert.deepEqual(previous.ids, ['removed', 'shelf', 'glass', 'shelf']);
});

test('formats optional prices independently of the base and preserves zero and quote-only options', () => {
  assert.equal(additionalRate(additionals[0], 'PEN'), 'A cotizar');
  assert.match(additionalRate(additionals[1], 'PEN'), /120\.00 por metro lineal$/);
  assert.match(additionalRate(additionals[2], 'USD'), /80\.00 por m²$/);
  assert.match(additionalRate(additionals[3], 'PEN'), /0\.00 por visita$/);
  assert.match(additionalRate({ ...additionals[3], unitLabel: 'juego', price: 80 }, 'PEN'), /80\.00 por juego$/);
});

test('quote lists selected names and independent units without inventing a combined price', () => {
  const summary = additionalsQuoteSummary(product, { productId: 'table', ids: ['glass', 'shelf', 'panel', 'visit'] });
  assert.match(summary, /<Vidrio & aluminio>: A cotizar \(por unidad\)/);
  assert.match(summary, /Repisa: .*120\.00 por metro lineal/);
  assert.match(summary, /Panel: .*80\.00 por m²/);
  assert.match(summary, /Cantidades y medidas por confirmar en la cotización\./);
  assert.doesNotMatch(summary, /200\.00/);
  assert.equal(additionalsQuoteSummary(product, { productId: 'different-product', ids: ['glass'] }), '');
  assert.equal(additionalsQuoteSummary(product, { productId: 'table', ids: ['removed'] }), '');
});

test('WhatsApp encodes special catalog text as message content, not extra URL parameters', () => {
  const dangerous = { ...additionals[0], name: '<img src=x onerror=alert(1)> &phone=other #fragment' };
  const summary = additionalsQuoteSummary({ ...product, additionals: [dangerous] }, { productId: 'table', ids: ['glass'] });
  const contact = { id: 'sales', name: 'Ventas', whatsapp: '51987654321', phone: '', email: '', message: '', active: true };
  const url = new URL(contactUrl(contact, summary));
  assert.equal(url.hostname, 'wa.me'); assert.equal(url.pathname, '/51987654321');
  assert.equal(url.searchParams.get('text'), summary); assert.equal(url.searchParams.size, 1); assert.equal(url.hash, '');
});
