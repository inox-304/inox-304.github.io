import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'backend/static/inox/ocr-vendor/paddle-v0.4.2');
const cache = join(root, '.work/paddle-model-cache');
const pinned = JSON.parse(await readFile(join(root, 'scripts/paddle-assets.json'), 'utf8'));
const check = process.argv.includes('--check');
const digest = data => createHash('sha256').update(data).digest('hex');
function verify(data, entry) {
  if (data.length !== entry.bytes || digest(data) !== entry.sha256) throw new Error(`Paddle asset integrity mismatch: ${entry.path || entry.source}`);
}
for (const [name, version] of Object.entries(pinned.packages)) {
  const installed = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (installed.version !== version) throw new Error(`Expected ${name}@${version}; run npm ci.`);
}
const files = [];
async function output(path, data, compress = true) {
  const target = join(destination, path);
  if (check) {
    if (digest(await readFile(target)) !== digest(data)) throw new Error(`Modified or stale Paddle asset: ${path}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  files.push({ path, bytes: data.length, sha256: digest(data) });
  if (compress) {
    const gz = gzipSync(data, { level: 9 });
    // Normalize gzip's OS byte for identical Linux/Windows manifests.
    gz[9] = 3;
    await output(`${path}.gz`, gz, false);
  }
}
async function download(entry) {
  if (check) {
    const data = await readFile(join(destination, entry.path));
    verify(data, entry);
    return data;
  }
  await mkdir(cache, { recursive: true });
  const cached = join(cache, basename(entry.path));
  try {
    const data = await readFile(cached);
    verify(data, entry);
    return data;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Downloading verified Paddle asset: ${entry.path} (attempt ${attempt})`);
      const response = await fetch(entry.url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry.url}`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > entry.bytes) throw new Error(`Unexpected size: ${entry.path}`);
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks, bytes);
      verify(data, entry);
      const temporary = `${cached}.${process.pid}.tmp`;
      try { await writeFile(temporary, data); await rename(temporary, cached); }
      finally { await rm(temporary, { force: true }); }
      return data;
    } catch (error) { if (attempt === 3 || /integrity mismatch|Unexpected size/.test(error.message)) throw error; }
  }
}

const worker = await readFile(join(root, pinned.worker.source));
verify(worker, pinned.worker);
// Keep the published bundle intact, including third-party license comments.
await output('paddle-worker.js', worker);
await output('worker-entry-C9UNuyOJ.js.map', await readFile(join(root, `${pinned.worker.source}.map`)));
await output('receipt-paddle.js', await readFile(join(root, 'scripts/paddle-browser.mjs')));
await output('paddle-normalize.mjs', await readFile(join(root, 'scripts/paddle-normalize.mjs')));
await output('NOTICE.txt', await readFile(join(root, 'scripts/paddle-NOTICE.txt')));
await output('licenses/js-yaml-MIT.txt', await readFile(join(root, 'node_modules/js-yaml/LICENSE')));
// The SDK's bundled ORT is the JSEP build, even when backend='wasm'. Both files
// must come from 1.24.3. WebGPU stays disabled; no cross-origin isolation needed.
for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  await output(`runtime/${name}`, await readFile(join(root, 'node_modules/onnxruntime-web/dist', name)));
}
for (const entry of pinned.downloads) await output(entry.path, await download(entry));
const manifest = Buffer.from(`${JSON.stringify({ packages: pinned.packages, embedded: { opencv: '4.10.0', onnxruntime: '1.24.3', 'js-yaml': '4.1.1', 'clipper-lib': '6.4.2' }, downloads: pinned.downloads, files }, null, 2)}\n`);
await output('manifest.json', manifest, false);
const rawBytes = files.filter(file => !file.path.endsWith('.gz')).reduce((sum, file) => sum + file.bytes, 0);
const gzipBytes = files.filter(file => file.path.endsWith('.gz')).reduce((sum, file) => sum + file.bytes, 0);
console.log(`PaddleOCR: ${check ? 'verified' : 'prepared'} ${files.length} assets; raw ${(rawBytes / 1048576).toFixed(1)} MiB; gzip ${(gzipBytes / 1048576).toFixed(1)} MiB.`);
