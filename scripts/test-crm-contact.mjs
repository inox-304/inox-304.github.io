import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/scripts/crm-contact.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const node = value => ({ value: value || '', dataset: {}, textContent: '', disabled: false, hidden: false,
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; if (name === 'href') delete this.href; },
    setCustomValidity(value) { this.validationMessage = value; } });
  const fields = Object.fromEntries(Object.entries({ name: 'Cliente de prueba', phone: '+51999000111', email: '',
    business: 'Negocio de prueba', city: 'Cusco', need: 'Fabricación a medida', message: 'Consulta sintética & medidas',
    product_code: '', configuration: '', website: '' }).map(([name, value]) => [name, node(value)]));
  const status = node(), button = node(), fallback = node(), prompt = node();
  prompt.textContent = '¿Prefieres conversar ahora?';
  const nodes = { '#form-status': status, 'button[type="submit"]': button, '#quote-fallback': fallback,
    '.contact-alternative > span': prompt, '[name="phone"]': fields.phone,
    '[data-crm-selection]': node(), '[data-crm-product]': node(), '[data-crm-configuration]': node(),
    '[data-crm-selection] details': node() };
  const events = {}, requests = [], timers = new Map();
  let uuid = 0, timer = 0;
  let respond = async () => ({ ok: true, status: 201, json: async () => ({ ok: true, reference: 'CRM-000042' }) });
  const form = { ...node(), fields, dataset: { whatsapp: '51999000222', endpoint: 'https://panel.example.test/api/crm/inquiries/' },
    elements: { namedItem: name => fields[name] }, querySelector: selector => nodes[selector] || null,
    querySelectorAll: selector => selector === 'select' ? [fields.need] : Object.entries(fields).filter(([name]) => !['need', 'product_code', 'configuration'].includes(name)).map(([, field]) => field),
    addEventListener: (name, callback) => { events[name] = callback; }, reportValidity: () => true };
  runInNewContext(compiled, { document: { querySelector: () => form },
    location: { search: '?product_code=P15&configuration=Plancha%20en%20posici%C3%B3n%201' },
    currentAttribution: () => ({ source: 'instagram', campaign: 'cocinas', medium: 'social' }),
    FormData: class { constructor(form) { this.values = new Map(Object.entries(form.fields).filter(([, field]) => !field.disabled).map(([name, field]) => [name, field.value])); } get(name) { return this.values.get(name); } },
    URLSearchParams, AbortController, Error, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    window: { setTimeout(callback) { timers.set(++timer, callback); return timer; }, clearTimeout(id) { timers.delete(id); } },
    fetch: async (url, options) => { requests.push({ url, options, payload: JSON.parse(options.body) }); return respond(); } });
  return { fields, status, button, fallback, prompt, form, requests, timers, events,
    submit: () => events.submit({ preventDefault() {} }),
    change(name, value, event = 'input') { fields[name].value = value; events[event](); },
    respondWith(callback) { respond = callback; },
    message: () => new URL(fallback.href).searchParams.get('text') };
}

test('a confirmed inquiry is the same optional WhatsApp conversation, with its reference and full selection', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0, 'viewing the form or its WhatsApp link does not create an inquiry');
  assert.doesNotMatch(f.message(), /CRM-/);
  await f.submit();
  assert.equal(f.status.dataset.state, 'success');
  assert.match(f.message(), /Mi consulta registrada es CRM-000042/);
  assert.match(f.message(), /Fabricación a medida/);
  assert.match(f.message(), /Equipo: P15/);
  assert.match(f.message(), /Plancha en posición 1/);
  assert.match(f.message(), /Consulta sintética & medidas/);
  assert.match(f.prompt.textContent, /Si quieres.*misma consulta por WhatsApp/);
  assert.equal(f.button.disabled, true);
  assert.equal(f.requests[0].options.credentials, 'omit');
  assert.equal(f.requests[0].payload.source, 'instagram');
  await f.submit();
  assert.equal(f.requests.length, 1, 'a confirmed form cannot be submitted again without an edit');
  f.events['inox:contact-updated']();
  assert.match(f.message(), /CRM-000042/, 'refreshing published contact details keeps the confirmed reference');
});

test('editing details clears the old reference before another WhatsApp message or inquiry is prepared', async () => {
  const f = fixture();
  await f.submit();
  const firstId = f.requests[0].payload.submission_id;
  f.change('message', 'Una consulta diferente');
  assert.equal(f.status.textContent, '');
  assert.equal(f.button.disabled, false);
  assert.doesNotMatch(f.message(), /CRM-/);
  assert.match(f.message(), /Una consulta diferente/);
  assert.equal(f.prompt.textContent, '¿Prefieres conversar ahora?');
  await f.submit();
  assert.notEqual(f.requests[1].payload.submission_id, firstId);
  f.change('need', 'Instalación o mantenimiento', 'change');
  assert.doesNotMatch(f.message(), /CRM-/);
  assert.match(f.message(), /Instalación o mantenimiento/);
});

test('an unconfirmed network response preserves the payload and id when the customer retries', async () => {
  const f = fixture();
  f.respondWith(async () => { throw new Error('offline'); });
  await f.submit();
  assert.equal(f.status.dataset.state, 'error');
  assert.match(f.status.textContent, /no pudimos confirmar/);
  assert.doesNotMatch(f.message(), /CRM-/);
  assert.equal(f.button.disabled, false);
  f.respondWith(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, reference: 'CRM-000042' }) }));
  await f.submit();
  assert.deepEqual(f.requests[1].payload, f.requests[0].payload);
  assert.match(f.message(), /CRM-000042/);
  assert.equal(f.timers.size, 0);
});

test('an explicit new inquiry can reuse the same details after the previous one was confirmed', async () => {
  const f = fixture();
  const original = f.fields.message.value;
  await f.submit();
  f.change('message', 'Otra idea');
  f.change('message', original);
  await f.submit();
  assert.notEqual(f.requests[1].payload.submission_id, f.requests[0].payload.submission_id);
  assert.equal(f.requests[1].payload.interest, f.requests[0].payload.interest);
});

test('invalid successful responses and rate limits never claim a saved inquiry or add a reference', async () => {
  for (const response of [
    { ok: true, status: 200, json: async () => ({ ok: true, reference: 'untrusted-reference' }) },
    { ok: false, status: 429 }, { ok: false, status: 400 },
  ]) {
    const f = fixture(); f.respondWith(async () => response);
    await f.submit();
    assert.equal(f.status.dataset.state, 'error');
    assert.doesNotMatch(f.status.textContent, /Solicitud recibida/);
    assert.doesNotMatch(f.message(), /CRM-|untrusted-reference/);
    assert.equal(f.button.disabled, false);
  }
});

test('concurrent submits create one request and the restored form retains the selected need in WhatsApp', async () => {
  const f = fixture();
  let finish;
  f.respondWith(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.submit();
  assert.equal(f.fields.need.disabled, true);
  assert.equal(f.fields.message.readOnly, true);
  await f.submit();
  assert.equal(f.requests.length, 1);
  finish({ ok: true, status: 201, json: async () => ({ ok: true, reference: 'CRM-000042' }) });
  await pending;
  assert.equal(f.fields.need.disabled, false);
  assert.equal(f.fields.message.readOnly, false);
  assert.match(f.message(), /Fabricación a medida/);
});
