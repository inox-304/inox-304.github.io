import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseCooktopConfig } from '../src/lib/cooktop-config.ts';

const rules = JSON.parse(readFileSync(new URL('./fixtures/cooktop.json', import.meta.url), 'utf8'));
const source = ts.transpileModule(readFileSync(new URL('../src/lib/cooktop-sync.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nthis.startSync = startCooktopSync;',
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), requests = [], statuses = [], configs = [];
  const context = {
    parseCooktopConfig, URL, AbortController,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({ url: String(url), options, resolve, reject }));
    },
  };
  runInNewContext(source, context);
  const controller = context.startSync({ origin: 'https://panel.example.test', productId: 'COOK-A',
    onStatus: value => statuses.push(value), onConfig: value => configs.push(plain(value)), ...overrides });
  const tick = async milliseconds => {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); await flush();
    }
    now = target; await flush();
  };
  const respond = async (index, body = { productId: 'COOK-A', cooktopConfig: rules }, status = 200) => {
    requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) }); await flush();
  };
  return { controller, timers, requests, statuses, configs, tick, respond };
}

test('slow connection is visible after five seconds and a late successful response cancels the deadline', async () => {
  const f = fixture();
  assert.deepEqual(f.statuses, ['loading']); assert.equal(f.timers.size, 2);
  await f.tick(4999); assert.deepEqual(f.statuses, ['loading']);
  await f.tick(1); assert.deepEqual(f.statuses, ['loading', 'slow']);
  await f.respond(0);
  assert.deepEqual(f.configs, [plain(parseCooktopConfig(rules))]);
  assert.deepEqual(f.statuses, ['loading', 'slow', 'ready']); assert.equal(f.timers.size, 0);
  await f.tick(70000); assert.equal(f.statuses.at(-1), 'ready');
});

test('requests are public, uncached, nonredirecting and encode the exact product identity', async () => {
  const f = fixture({ productId: 'COOK A/2' }), { url, options } = f.requests[0];
  assert.equal(url, 'https://panel.example.test/api/catalog/COOK%20A%2F2/cooktop/');
  assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
  assert.equal(options.signal.aborted, false);
  f.controller.dispose(); assert.equal(options.signal.aborted, true); assert.equal(f.timers.size, 0);
});

test('a hard timeout reports an error without revoking existing rules and allows a deduplicated retry', async () => {
  const f = fixture();
  f.controller.retry(); f.controller.retry(); assert.equal(f.requests.length, 1);
  await f.tick(65000);
  assert.deepEqual(f.statuses, ['loading', 'slow', 'error']); assert.deepEqual(f.configs, []);
  assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.timers.size, 0);
  f.controller.retry(); f.controller.retry(); assert.equal(f.requests.length, 2);
  await f.respond(1);
  assert.equal(f.statuses.at(-1), 'ready'); assert.equal(f.configs.length, 1); assert.equal(f.timers.size, 0);
});

test('network failure preserves rules and retry succeeds without leaking timers', async () => {
  const f = fixture(); f.requests[0].reject(new TypeError('Failed to fetch')); await flush();
  assert.deepEqual(f.statuses, ['loading', 'error']); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
  f.controller.retry(); assert.deepEqual(f.statuses, ['loading', 'error', 'loading']);
  await f.respond(1); assert.equal(f.statuses.at(-1), 'ready'); assert.equal(f.configs.length, 1); assert.equal(f.timers.size, 0);
});

test('server errors never imply that the owner disabled personalization', async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
    const f = fixture(); await f.respond(0, null, status);
    assert.equal(f.statuses.at(-1), 'error', `HTTP ${status}`);
    assert.deepEqual(f.configs, [], `HTTP ${status} preserves approval`); assert.equal(f.timers.size, 0);
  }
});

test('explicit owner removal, disabled rules and unpublished products revoke configuration', async () => {
  for (const [body, status] of [
    [{ productId: 'COOK-A', cooktopConfig: null }, 200],
    [{ productId: 'COOK-A', cooktopConfig: { ...rules, enabled: false } }, 200],
    [null, 404], [null, 410],
  ]) {
    const f = fixture(); await f.respond(0, body, status);
    assert.deepEqual(f.configs, [null]); assert.equal(f.statuses.at(-1), 'disabled'); assert.equal(f.timers.size, 0);
  }
});

test('foreign, incomplete and malformed responses cannot overwrite approved rules', async () => {
  for (const body of [null, [], {}, { productId: 'COOK-B', cooktopConfig: rules }, { productId: 'COOK-A' },
    { productId: 'COOK-A', cooktopConfig: {} }, { productId: 'COOK-A', cooktopConfig: undefined },
    { productId: 'COOK-A', cooktopConfig: { ...rules, modules: [] } },
    { productId: 'COOK-A', cooktopConfig: { ...rules, foreignProductId: 'COOK-B' } },
    { productId: 'COOK-A', cooktopConfig: 'not a configuration' }]) {
    const f = fixture(); await f.respond(0, body);
    assert.equal(f.statuses.at(-1), 'error'); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
  }
  const f = fixture(); f.requests[0].resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } }); await flush();
  assert.equal(f.statuses.at(-1), 'error'); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
});

test('a response arriving after disposal cannot update a different product', async () => {
  const f = fixture(); f.controller.dispose();
  assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.timers.size, 0);
  await f.respond(0); await f.tick(70000);
  assert.deepEqual(f.statuses, ['loading']); assert.deepEqual(f.configs, []);
  f.controller.retry(); assert.equal(f.requests.length, 1);
});

test('a stale timed-out response cannot revoke a newer successful retry', async () => {
  const f = fixture(); await f.tick(65000); f.controller.retry(); await f.respond(1);
  const statuses = [...f.statuses], configs = [...f.configs];
  await f.respond(0, { productId: 'COOK-A', cooktopConfig: null });
  assert.deepEqual(f.statuses, statuses); assert.deepEqual(f.configs, configs); assert.equal(f.timers.size, 0);
});

test('a stale request finalizer cannot clear a newer retry timers or release its in-flight lock', async () => {
  for (const lateFailure of [false, true]) {
    const f = fixture(); await f.tick(65000); f.controller.retry();
    assert.equal(f.timers.size, 2);
    if (lateFailure) { f.requests[0].reject(new TypeError('Late failure')); await flush(); }
    else await f.respond(0, { productId: 'COOK-A', cooktopConfig: null });
    assert.equal(f.timers.size, 2); assert.equal(f.statuses.at(-1), 'loading'); assert.deepEqual(f.configs, []);
    assert.equal(f.requests[1].options.signal.aborted, false);
    f.controller.retry(); assert.equal(f.requests.length, 2, 'the current request remains deduplicated');
    await f.tick(5000); assert.equal(f.statuses.at(-1), 'slow');
    await f.respond(1); assert.equal(f.statuses.at(-1), 'ready'); assert.equal(f.timers.size, 0);
  }
});

test('a disposed JSON body cannot update state even after its response headers were accepted', async () => {
  const f = fixture(); let resolveBody;
  f.requests[0].resolve({ ok: true, status: 200, json: () => new Promise(resolve => { resolveBody = resolve; }) }); await flush();
  f.controller.dispose(); resolveBody({ productId: 'COOK-A', cooktopConfig: rules }); await flush();
  assert.deepEqual(f.statuses, ['loading']); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
});

test('unsafe configuration origins are rejected before sending any request', async () => {
  for (const origin of ['http://panel.example.test', 'https://user:password@panel.example.test', 'https://panel.example.test/path', 'https://panel.example.test/?secret=x', 'https://panel.example.test/#fragment', 'not a url']) {
    const f = fixture({ origin }); await flush();
    assert.equal(f.requests.length, 0); assert.deepEqual(f.statuses, ['loading', 'error']); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
  }
});
