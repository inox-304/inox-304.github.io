import { writeFile, rename, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { products } from '../src/data/products.ts';
import { parseCooktopConfig } from '../src/lib/cooktop-config.ts';
import { cooktopAssetFor } from '../src/lib/cooktop-assets.ts';

export const snapshotOrigin = 'https://inox304-panel.onrender.com';
export const snapshotProductIds = ['P01', 'P02', 'P03', 'P04', 'P05', 'INOX-COC-EMP'];

/** Public reads only. A failed or malformed response never replaces the published copy. */
export async function captureCooktopSnapshot(fetchPublic = fetch, catalog = products, now = new Date()) {
  const entries = await Promise.all(snapshotProductIds.map(async productId => {
    const product = catalog.find(item => item.id === productId);
    if (!product || product.category !== 'linea-caliente' || product.supplyType === 'distributed'
      || (product.equipmentFamily && product.equipmentFamily !== 'cocinas')
      || !product.model3d || !cooktopAssetFor(productId, product.model3d)) throw new Error(`Invalid kitchen identity: ${productId}`);
    const response = await fetchPublic(`${snapshotOrigin}/api/catalog/${encodeURIComponent(productId)}/cooktop/`, {
      credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(70000),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error(`Public configuration unavailable: ${productId}`);
    const body = await response.text();
    if (body.length > 100000) throw new Error(`Configuration too large: ${productId}`);
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || value.productId !== productId
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'cooktopConfig')) throw new Error(`Mismatched public configuration: ${productId}`);
    const cooktopConfig = parseCooktopConfig(value.cooktopConfig);
    if (value.cooktopConfig !== null && !cooktopConfig) throw new Error(`Incomplete public configuration: ${productId}`);
    return { productId, model3d: product.model3d, cooktopConfig };
  }));
  return { version: 1, sourceOrigin: snapshotOrigin, capturedAt: now.toISOString(), products: entries };
}

export async function refreshCooktopSnapshot({ fetchPublic = fetch, catalog = products, now = new Date(), destination = new URL('../src/data/cooktop-published.json', import.meta.url), log = console.log } = {}) {
  const snapshot = await captureCooktopSnapshot(fetchPublic, catalog, now);
  const temporary = new URL(`${destination.href}.${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  log(`Updated public configuration snapshot: ${snapshot.products.length} kitchens. No server data changed.`);
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await refreshCooktopSnapshot();
}
