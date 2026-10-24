import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { products } from '../src/data/products.ts';
import { parsePublishedCooktops, publishedCooktopSnapshot, withPublishedCooktops } from '../src/data/cooktop-published.ts';
import { parseCooktopConfig } from '../src/lib/cooktop-config.ts';
import { cooktopAssetFor } from '../src/lib/cooktop-assets.ts';
import { captureCooktopSnapshot, refreshCooktopSnapshot, snapshotProductIds, snapshotOrigin } from './refresh-cooktop-snapshot.mjs';

const clone = value => structuredClone(value);
async function removeTestFolder(folder) {
  const target = resolve(folder);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('inox-cooktop-snapshot-'));
  await rm(target, { recursive: true, force: true });
}
function publicFeed(change = value => value) {
  const requests = [];
  const fetchPublic = async (url, options) => {
    requests.push({ url, options });
    const productId = decodeURIComponent(new URL(url).pathname.split('/')[3]);
    const entry = publishedCooktopSnapshot.products.find(item => item.productId === productId);
    const body = change({ productId, cooktopConfig: clone(entry.cooktopConfig) });
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  return { requests, fetchPublic };
}

test('six published kitchen identities have validated rules before any network request', () => {
  assert.deepEqual(publishedCooktopSnapshot.products.map(item => item.productId), snapshotProductIds);
  for (const entry of publishedCooktopSnapshot.products) {
    const product = products.find(item => item.id === entry.productId);
    assert.equal(product.supplyType, 'manufactured'); assert.equal(product.equipmentFamily, 'cocinas');
    assert.equal(product.model3d, entry.model3d); assert.ok(cooktopAssetFor(product.id, product.model3d));
    assert.deepEqual(product.cooktopConfig, clone(parseCooktopConfig(entry.cooktopConfig)));
    assert.equal(product.cooktopConfig.enabled, true);
  }
  for (const product of products.filter(item => !snapshotProductIds.includes(item.id))) {
    assert.equal(product.cooktopConfig, undefined, 'do not lend kitchen options to another product');
  }
});

test('snapshot parser rejects foreign, duplicate, malformed and unsupported model configurations', () => {
  const changes = [
    data => { data.sourceOrigin = 'https://another.example'; },
    data => { data.capturedAt = 'invalid'; },
    data => { data.products.pop(); },
    data => { data.products[0].productId = 'ILUMI-DJ-181'; },
    data => { data.products[0].productId = data.products[1].productId; },
    data => { data.products[0].model3d = '/models/inox/unknown.glb'; },
    data => { data.products[0].cooktopConfig.modules[0].kind = 'invented'; },
    data => { data.products[0].cooktopConfig.foreignProductId = 'OTHER'; },
    data => { data.products[0].cooktopConfig = {}; },
    data => { data.products[0].secret = 'not-permitted'; },
  ];
  for (const change of changes) { const data = clone(publishedCooktopSnapshot); change(data); assert.throws(() => parsePublishedCooktops(data)); }
});

test('snapshot applies only to the approved exact model and leaves unrelated products alone', () => {
  const source = clone(products);
  const unknown = { ...source[0], id: 'NEW-KITCHEN', cooktopConfig: undefined };
  assert.equal(withPublishedCooktops([unknown])[0], unknown);
  for (const patch of [{ model3d: '/models/inox/replacement-sketchup.glb' }, { supplyType: 'distributed' }, { category: 'linea-fria' }, { equipmentFamily: 'mesas' }]) {
    assert.throws(() => withPublishedCooktops([{ ...source[0], ...patch }]));
  }
  const before = clone(source); withPublishedCooktops(source); assert.deepEqual(source, before, 'never mutate live API or source data');
});

test('explicit null and disabled rules can be captured without restoring old approval', async () => {
  for (const config of [null, { ...clone(publishedCooktopSnapshot.products[0].cooktopConfig), enabled: false }]) {
    const feed = publicFeed(value => value.productId === 'P01' ? { ...value, cooktopConfig: config } : value);
    const snapshot = await captureCooktopSnapshot(feed.fetchPublic);
    const result = withPublishedCooktops(products, snapshot).find(item => item.id === 'P01');
    assert.deepEqual(result.cooktopConfig, clone(parseCooktopConfig(config)));
  }
});

test('refresh uses only public credential-free requests and atomically replaces a complete snapshot', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'inox-cooktop-snapshot-'));
  const destination = pathToFileURL(join(folder, 'snapshot.json'));
  try {
    await writeFile(destination, 'previous published copy');
    const feed = publicFeed();
    const result = await refreshCooktopSnapshot({ ...feed, destination, now: new Date('2026-10-24T00:00:00Z'), log() {} });
    assert.deepEqual(parsePublishedCooktops(JSON.parse(await readFile(destination, 'utf8'))), result);
    assert.equal(feed.requests.length, 6);
    for (const request of feed.requests) {
      assert.equal(new URL(request.url).origin, snapshotOrigin);
      assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error');
      assert.deepEqual(request.options.headers, { Accept: 'application/json' });
    }
    assert.deepEqual(await readdir(folder), ['snapshot.json']);
  } finally { await removeTestFolder(folder); }
});

test('a failed, foreign or malformed endpoint never replaces the previously published snapshot', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'inox-cooktop-snapshot-'));
  const destination = pathToFileURL(join(folder, 'snapshot.json'));
  try {
    await writeFile(destination, 'previous published copy');
    for (const fetchPublic of [
      async () => { throw new Error('offline'); },
      async () => new Response('unavailable', { status: 503 }),
      publicFeed(value => ({ ...value, productId: 'FOREIGN' })).fetchPublic,
      publicFeed(value => ({ ...value, cooktopConfig: { invalid: true } })).fetchPublic,
      publicFeed(value => ({ ...value, cooktopConfig: {} })).fetchPublic,
    ]) {
      await assert.rejects(refreshCooktopSnapshot({ fetchPublic, destination, log() {} }));
      assert.equal(await readFile(destination, 'utf8'), 'previous published copy');
      assert.deepEqual(await readdir(folder), ['snapshot.json']);
    }
  } finally { await removeTestFolder(folder); }
});
