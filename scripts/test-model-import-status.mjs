import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../backend/model_imports/static/model_imports/status.js', import.meta.url), 'utf8');

function harness({ active = true, endpoint = '/admin/modelos/00000000-0000-0000-0000-000000000001/estado/' } = {}) {
  const timers = new Map();
  const requests = [];
  const events = {};
  const nodes = Object.fromEntries(['poll-message', 'poll-retry', 'detail-link', 'review-link', 'job-actions', 'status-label', 'status-notice', 'status-progress', 'status-error'].map((key) => [key, { hidden: key !== 'job-actions', textContent: key === 'status-label' ? 'En cola' : '', disabled: false, addEventListener(name, callback) { this[name] = callback; } }]));
  const panel = { dataset: {active: String(active), status: 'queued', state: 'queued', statusUrl: endpoint}, querySelector(selector) { return nodes[selector.slice(6, -1)]; } };
  const document = { hidden: false, querySelector() { return panel; }, addEventListener(name, callback) { events[name] = callback; } };
  let nextTimer = 0;
  let reply = async () => ({ok: true, status: 200, json: async () => ({state: 'running', label: 'Preparando', notice: 'Trabajando', progress: 'Geometría', error: ''})});
  const context = {
    document, URL, AbortController, location: {href: 'https://panel.example.test/admin/modelos/job/', origin: 'https://panel.example.test'},
    window: {addEventListener(name, callback) { events[name] = callback; }},
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(...args) { requests.push(args); return reply(...args); },
  };
  vm.runInNewContext(source, context);
  return { nodes, panel, document, timers, requests, events, setReply(value) { reply = value; }, async tick() {
    const [id, timer] = [...timers].sort((a, b) => a[1].delay - b[1].delay)[0] || [];
    assert.ok(timer, 'Expected a pending status poll');
    timers.delete(id);
    await timer.callback();
  } };
}

test('background reads carry the narrow idle-exemption header and never redirect with cookies', async () => {
  const h = harness();
  await h.tick();
  assert.equal(h.requests.length, 1);
  const [url, options] = h.requests[0];
  assert.equal(new URL(url).origin, 'https://panel.example.test');
  assert.equal(options.headers['X-Inox-Automatic'], '1');
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(h.nodes['status-label'].textContent, 'Preparando');
});

test('completion exposes explicit review without automatic navigation or another poll', async () => {
  const h = harness();
  h.setReply(async () => ({ok: true, status: 200, json: async () => ({state: 'ready', label: 'Listo', notice: 'Revisar', progress: '', error: ''})}));
  await h.tick();
  assert.equal(h.nodes['review-link'].hidden, false);
  assert.equal(h.nodes['detail-link'].hidden, false);
  assert.equal(h.nodes['job-actions'].hidden, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 1);
});

test('session expiry stops automatic work and hides stale mutation buttons', async () => {
  const h = harness();
  h.setReply(async () => ({ok: false, status: 401}));
  await h.tick();
  assert.match(h.nodes['poll-message'].textContent, /sesión venció/);
  assert.equal(h.nodes['detail-link'].hidden, false);
  assert.equal(h.nodes['job-actions'].hidden, true);
  assert.equal(h.nodes['review-link'].hidden, true);
  assert.equal(h.timers.size, 0);
  h.events.visibilitychange();
  assert.equal(h.timers.size, 0);
});

test('network failure preserves the last state, backs off and permits an explicit retry', async () => {
  const h = harness();
  h.setReply(async () => { throw new Error('offline'); });
  await h.tick();
  assert.equal(h.nodes['status-label'].textContent, 'En cola');
  assert.equal(h.nodes['job-actions'].hidden, false);
  assert.equal(h.nodes['poll-retry'].hidden, false);
  assert.equal([...h.timers.values()][0].delay, 10000);
  assert.match(h.nodes['poll-message'].textContent, /archivo sigue guardado/);
});

test('hidden pages pause polling; restored pages resume pending work', async () => {
  const h = harness();
  h.document.hidden = true;
  h.events.visibilitychange();
  assert.equal(h.timers.size, 0);
  h.document.hidden = false;
  h.events.visibilitychange();
  await h.tick();
  assert.equal(h.requests.length, 1);
});

test('completed jobs and non-local endpoints do not start polling', () => {
  assert.equal(harness({active: false}).timers.size, 0);
  assert.equal(harness({endpoint: 'https://external.example.test/estado/'}).timers.size, 0);
});
