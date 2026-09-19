import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import { importPublishedCms } from './lib/cms-import.mjs';

export async function writeCmsSnapshot(root, { data, assets }, io = { mkdir, readFile, writeFile, rename, unlink }) {
  const generated = resolve(root, '.generated');
  const managed = /^\/(images|documents|models)\/cms\/[a-f0-9]{24}\.(webp|jpg|pdf|glb)$/;
  const assetPath = path => {
    if (!managed.test(path)) throw new Error('Invalid generated CMS path');
    const resolved = resolve(root, 'public', `.${path}`);
    if (!resolved.startsWith(resolve(root, 'public') + sep)) throw new Error('CMS path escaped the public directory');
    return resolved;
  };
  let previous = [];
  try { previous = JSON.parse(await io.readFile(resolve(generated, 'cms-assets.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(previous) || previous.some(path => !managed.test(path))) throw new Error('Invalid previous CMS asset manifest');
  for (const asset of assets) { const target = assetPath(asset.path); await io.mkdir(dirname(target), { recursive: true }); await io.writeFile(`${target}.tmp`, asset.bytes); await io.rename(`${target}.tmp`, target); }
  await io.mkdir(generated, { recursive: true });
  const current = assets.map(asset => asset.path);
  const commitInventory = async paths => {
    await io.writeFile(resolve(generated, 'cms-assets.tmp'), JSON.stringify(paths, null, 2));
    await io.rename(resolve(generated, 'cms-assets.tmp'), resolve(generated, 'cms-assets.json'));
  };
  // Keep both generations tracked until the snapshot commit succeeds. A failed
  // commit or interrupted cleanup can be retried without losing live resources.
  await commitInventory([...new Set([...previous, ...current])]);
  await io.writeFile(resolve(generated, 'cms-snapshot.tmp'), JSON.stringify(data, null, 2));
  await io.rename(resolve(generated, 'cms-snapshot.tmp'), resolve(generated, 'cms-snapshot.json'));
  for (const path of previous.filter(path => !current.includes(path))) await io.unlink(assetPath(path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await commitInventory(current);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const endpoint = process.env.CMS_EXPORT_URL?.trim();
  if (!endpoint) console.log('CMS_EXPORT_URL is unset; keeping the existing local catalog data.');
  else {
    const { data, assets } = await importPublishedCms(endpoint);
    await writeCmsSnapshot(fileURLToPath(new URL('../', import.meta.url)), { data, assets });
    console.log(`CMS imported: ${data.products.length} published products, ${data.contacts.length} active contacts, ${assets.length} optimized assets.`);
  }
}
