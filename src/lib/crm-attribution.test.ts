import test from 'node:test';
import assert from 'node:assert/strict';
import { crmEndpoint, metricsAllowed, normalizeSource, readAttribution } from './crm-attribution.ts';

test('keeps only bounded campaign attribution, never query tokens or contact values', () => {
  assert.deepEqual(readAttribution('?utm_source=fb&utm_campaign=cocinas_2026&utm_medium=social&email=private@example.com&token=secret'), { source: 'facebook', campaign: 'cocinas_2026', medium: 'social' });
  assert.deepEqual(readAttribution('?utm_source=untrusted&utm_campaign=private@example.com&utm_medium=https://example.com/private'), { source: 'other', campaign: '', medium: '' });
  assert.equal(readAttribution(`?utm_campaign=${'a'.repeat(500)}`).campaign.length, 120);
  assert.equal(readAttribution('?utm_campaign=%3Cscript%3E').campaign, '');
});
test('campaign survives a catalogue navigation and new explicit campaign replaces it', () => {
  const previous = { source: 'instagram', campaign: 'cocinas', medium: 'social', secret: 'discard' };
  assert.deepEqual(readAttribution('', '', previous), { source: 'instagram', campaign: 'cocinas', medium: 'social' });
  assert.equal(readAttribution('?utm_source=google', '', previous).source, 'google');
});
test('referral attribution uses exact known domains, not spoofed names or full URL', () => {
  assert.equal(readAttribution('', 'https://l.facebook.com/private?user=123').source, 'facebook');
  assert.equal(readAttribution('', 'https://facebook.com.evil.example/?private=1').source, 'website');
  assert.equal(normalizeSource({ source: 'google' }), 'website');
});
test('DNT and GPC disable anonymous metrics and deployment endpoint is fixed', () => {
  assert.equal(metricsAllowed({ doNotTrack: '1' }), false);
  assert.equal(metricsAllowed({ globalPrivacyControl: true }), false);
  assert.equal(metricsAllowed({}), true);
  assert.equal(crmEndpoint('inquiries'), 'https://inox304-panel.onrender.com/api/crm/inquiries/');
  assert.equal(crmEndpoint('events', true), '/api/crm/events/');
});
