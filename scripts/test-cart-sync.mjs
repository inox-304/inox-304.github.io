import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseCartConfig } from '../src/lib/cart-config.ts';

const rules = JSON.parse(readFileSync(new URL('../src/data/cart-published.json', import.meta.url), 'utf8')).cartConfig;
const source = ts.transpileModule(readFileSync(new URL('../src/lib/cart-sync.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nthis.startSync = startCartSync;',
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), requests = [], statuses = [], configs = [];
  const context = {
    parseCartConfig, URL, AbortController,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({ url: String(url), options, resolve, reject }));
    },
  };
  runInNewContext(source, context);
  const controller = context.startSync({ origin: 'https://panel.example.test', productId: 'P15',
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
  const respond = async (index, body = { productId: 'P15', cartConfig: rules }, status = 200) => {
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
  assert.deepEqual(f.configs, [plain(parseCartConfig(rules))]);
  assert.deepEqual(f.statuses, ['loading', 'slow', 'ready']); assert.equal(f.timers.size, 0);
  await f.tick(70000); assert.equal(f.statuses.at(-1), 'ready');
});

test('requests are public, uncached, nonredirecting and encode the exact product identity', async () => {
  const f = fixture({ productId: 'COOK A/2' }), { url, options } = f.requests[0];
  assert.equal(url, 'https://panel.example.test/api/catalog/COOK%20A%2F2/cart/');
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
    [{ productId: 'P15', cartConfig: null }, 200],
    [{ productId: 'P15', cartConfig: { ...rules, enabled: false } }, 200],
    [null, 404], [null, 410],
  ]) {
    const f = fixture(); await f.respond(0, body, status);
    assert.deepEqual(f.configs, [null]); assert.equal(f.statuses.at(-1), 'disabled'); assert.equal(f.timers.size, 0);
  }
});

test('foreign, incomplete and malformed responses cannot overwrite approved rules', async () => {
  for (const body of [null, [], {}, { productId: 'COOK-B', cartConfig: rules }, { productId: 'P15' },
    { productId: 'P15', cartConfig: {} }, { productId: 'P15', cartConfig: undefined },
    { productId: 'P15', cartConfig: { ...rules, modules: [] } },
    { productId: 'P15', cartConfig: { ...rules, foreignProductId: 'COOK-B' } },
    { productId: 'P15', cartConfig: 'not a configuration' }]) {
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
  await f.respond(0, { productId: 'P15', cartConfig: null });
  assert.deepEqual(f.statuses, statuses); assert.deepEqual(f.configs, configs); assert.equal(f.timers.size, 0);
});

test('a stale request finalizer cannot clear a newer retry timers or release its in-flight lock', async () => {
  for (const lateFailure of [false, true]) {
    const f = fixture(); await f.tick(65000); f.controller.retry();
    assert.equal(f.timers.size, 2);
    if (lateFailure) { f.requests[0].reject(new TypeError('Late failure')); await flush(); }
    else await f.respond(0, { productId: 'P15', cartConfig: null });
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
  f.controller.dispose(); resolveBody({ productId: 'P15', cartConfig: rules }); await flush();
  assert.deepEqual(f.statuses, ['loading']); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
});

test('unsafe configuration origins are rejected before sending any request', async () => {
  for (const origin of ['http://panel.example.test', 'https://user:password@panel.example.test', 'https://panel.example.test/path', 'https://panel.example.test/?secret=x', 'https://panel.example.test/#fragment', 'not a url']) {
    const f = fixture({ origin }); await flush();
    assert.equal(f.requests.length, 0); assert.deepEqual(f.statuses, ['loading', 'error']); assert.deepEqual(f.configs, []); assert.equal(f.timers.size, 0);
  }
});
