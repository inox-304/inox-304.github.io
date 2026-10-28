import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { catalogEndpoint, readCatalogCache, writeCatalogCache, CATALOG_CACHE_MAX_AGE, CATALOG_MAX_LENGTH } from '../src/lib/catalog-sync.ts';
import { parsePublicCatalog, emptyCmsData } from '../src/lib/cms-api.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
const source = ts.transpileModule(readFileSync(new URL('../src/lib/catalog-sync.ts', import.meta.url), 'utf8').replace(/^export /gm, '') + '\nthis.startSync = startCatalogSync;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const endpoint = 'https://panel.example.test/api/catalog/';
const plain = value => JSON.parse(JSON.stringify(value));
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function fixture() {
  let now = 0, nextTimer = 0;
  const timers = new Map(), requests = [], statuses = [], data = [], disk = storage();
  const context = { URL, AbortController, Date,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
  };
  runInNewContext(source, context);
  const controller = context.startSync({ endpoint, parse: parsePublicCatalog, storage: disk, onStatus: status => statuses.push(status), onData: value => data.push(plain(value)) });
  const tick = async milliseconds => {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); await flush();
    }
    now = target; await flush();
  };
  const respond = async (index, body = emptyCmsData(), status = 200, type = 'application/json', length) => {
    requests[index].resolve({ ok: status >= 200 && status < 300, headers: { get: key => key === 'content-type' ? type : length ?? null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }); await flush();
  };
  void controller.refresh();
  return { controller, timers, requests, statuses, data, disk, tick, respond };
}

test('endpoint only accepts the public catalog route and never embedded credentials', () => {
  assert.equal(catalogEndpoint('/api/catalog/', 'https://shop.example'), 'https://shop.example/api/catalog/');
  assert.equal(catalogEndpoint(endpoint, 'https://shop.example'), endpoint);
  assert.equal(catalogEndpoint('/api/catalog/', 'http://localhost:4321'), 'http://localhost:4321/api/catalog/');
  for (const invalid of ['', 'https://user:password@panel.example/api/catalog/', 'http://remote.example/api/catalog/', 'https://panel.example/admin/', 'https://panel.example/api/catalog/?token=private', 'https://panel.example/api/catalog/#private', 'javascript:alert(1)']) {
    assert.equal(catalogEndpoint(invalid, 'https://shop.example'), '', invalid);
  }
});

test('public cache is isolated by endpoint and schema version', () => {
  const disk = storage(), data = emptyCmsData();
  writeCatalogCache(endpoint, data, disk, 100);
  assert.deepEqual(readCatalogCache(endpoint, parsePublicCatalog, disk, 200), data);
  assert.equal(readCatalogCache('https://other.example/api/catalog/', parsePublicCatalog, disk, 200), null);
  const [key, raw] = [...disk.values][0], envelope = JSON.parse(raw);
  for (const patch of [{ endpoint: 'https://other.example/api/catalog/' }, { version: 999 }, { savedAt: 201 }, { savedAt: '100' }, { data: { products: [] } }]) {
    disk.setItem(key, JSON.stringify({ ...envelope, ...patch }));
    assert.equal(readCatalogCache(endpoint, parsePublicCatalog, disk, 200), null);
    assert.equal(disk.getItem(key), null);
  }
});

test('cache expires, oversized or corrupt cache is discarded, storage failure is optional', () => {
  const disk = storage(); writeCatalogCache(endpoint, emptyCmsData(), disk, 1);
  assert.equal(readCatalogCache(endpoint, parsePublicCatalog, disk, CATALOG_CACHE_MAX_AGE + 2), null);
  writeCatalogCache(endpoint, emptyCmsData(), disk, 1); const key = [...disk.values.keys()][0];
  for (const raw of ['{broken', 'x'.repeat(CATALOG_MAX_LENGTH + 1001)]) { disk.setItem(key, raw); assert.equal(readCatalogCache(endpoint, parsePublicCatalog, disk, 2), null); }
  const blocked = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('disabled'); } };
  assert.equal(readCatalogCache(endpoint, parsePublicCatalog, blocked), null);
  assert.doesNotThrow(() => writeCatalogCache(endpoint, emptyCmsData(), blocked));
});

test('a cold Render start can finish after fifty seconds without clearing available catalog', async () => {
  const f = fixture(); assert.deepEqual(f.statuses, ['loading']);
  await f.tick(5000); assert.deepEqual(f.statuses, ['loading', 'slow']); assert.deepEqual(f.data, []);
  await f.tick(50000); await f.respond(0);
  assert.equal(f.statuses.at(-1), 'ready'); assert.equal(f.data.length, 1); assert.equal(f.timers.size, 0);
});

test('requests cannot send session cookies or follow login redirects', async () => {
  const f = fixture(), request = f.requests[0];
  assert.equal(request.url, endpoint); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error'); assert.equal(request.options.cache, 'no-store');
  f.controller.dispose(); assert.equal(request.options.signal.aborted, true); assert.equal(f.timers.size, 0);
});

test('valid empty feed explicitly replaces a former catalog and persists the removal', async () => {
  const f = fixture(); await f.respond(0);
  assert.deepEqual(f.data, [emptyCmsData()]); assert.equal(f.statuses.at(-1), 'ready');
  assert.deepEqual(readCatalogCache(endpoint, parsePublicCatalog, f.disk), emptyCmsData());
});

test('failure, wrong content type, malformed JSON and invalid schema never overwrite catalog or cache', async () => {
  for (const [body, status, type, length] of [[{}, 500], [null, 404], ['<html>login</html>', 200, 'text/html'], ['{broken', 200], [{ products: [], contacts: [] }, 200], [emptyCmsData(), 200, 'application/json', CATALOG_MAX_LENGTH + 1], [' '.repeat(CATALOG_MAX_LENGTH + 1), 200]]) {
    const f = fixture(); writeCatalogCache(endpoint, emptyCmsData(), f.disk, 100); const before = [...f.disk.values];
    await f.respond(0, body, status, type, length);
    assert.equal(f.statuses.at(-1), 'error'); assert.deepEqual(f.data, []); assert.deepEqual([...f.disk.values], before); assert.equal(f.timers.size, 0);
  }
});

test('timeout releases the request, deduplicates retries and ignores its late response', async () => {
  const f = fixture(); void f.controller.refresh(); assert.equal(f.requests.length, 1);
  await f.tick(65000); assert.equal(f.statuses.at(-1), 'error'); assert.equal(f.requests[0].options.signal.aborted, true);
  void f.controller.refresh(); void f.controller.refresh(); assert.equal(f.requests.length, 2);
  await f.respond(0); assert.deepEqual(f.data, []);
  await f.respond(1); assert.equal(f.data.length, 1); assert.equal(f.statuses.at(-1), 'ready'); assert.equal(f.timers.size, 0);
});

test('hidden-page pause aborts work without deleting cached data and allows resume', async () => {
  const f = fixture(); f.controller.pause(); assert.equal(f.timers.size, 0); assert.equal(f.requests[0].options.signal.aborted, true);
  await f.respond(0); assert.equal(f.data.length, 0);
  void f.controller.refresh(); await f.respond(1); assert.equal(f.data.length, 1);
  f.controller.dispose(); void f.controller.refresh(); assert.equal(f.requests.length, 2);
});

test('network rejection retains data and a following refresh can publish', async () => {
  const f = fixture(); f.requests[0].reject(new TypeError('Network failed')); await flush();
  assert.equal(f.statuses.at(-1), 'error'); assert.equal(f.data.length, 0); assert.equal(f.timers.size, 0);
  void f.controller.refresh(); await f.respond(1); assert.equal(f.statuses.at(-1), 'ready');
});
