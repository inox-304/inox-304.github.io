// Reproducible, self-hosted browser OCR assets. Tesseract comes from npm ci;
// Paddle's model downloads are pinned by size/SHA-256 and cached at build time.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'backend/static/inox/ocr-vendor/v7');
const check = process.argv.includes('--check');
const packages = {
  'tesseract.js': '7.0.0',
  'tesseract.js-core': '7.0.0',
  '@tesseract.js-data/spa': '1.0.0',
  '@tesseract.js-data/eng': '1.0.0',
};
const entries = [];
const add = (packageName, source, target = source) => {
  entries.push({ source: join(root, 'node_modules', packageName, source), target });
};

for (const [name, expectedVersion] of Object.entries(packages)) {
  const installed = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (installed.version !== expectedVersion) throw new Error(`OCR package ${name}: expected ${expectedVersion}, found ${installed.version}. Run npm ci.`);
}

for (const name of ['tesseract.min.js', 'worker.min.js']) {
  add('tesseract.js', `dist/${name}`, name);
  add('tesseract.js', `dist/${name}.map`, `${name}.map`);
  add('tesseract.js', `dist/${name}.LICENSE.txt`, `${name}.LICENSE.txt`);
}
// These .wasm.js bundles already embed their WebAssembly; no separate wasm
// download is necessary. Ship all variants so Tesseract selects the compatible
// implementation locally, including devices without SIMD support.
for (const suffix of ['', '-lstm', '-simd', '-simd-lstm', '-relaxedsimd', '-relaxedsimd-lstm']) {
  const name = `tesseract-core${suffix}.wasm.js`;
  add('tesseract.js-core', name, `core/${name}`);
  entries.push({ source: join(root, 'node_modules/tesseract.js-core', name), target: `core/${name}.gz`, gzip: true });
}
for (const language of ['spa', 'eng']) {
  add(`@tesseract.js-data/${language}`, `4.0.0_best_int/${language}.traineddata.gz`, `lang/${language}.traineddata.gz`);
  add(`@tesseract.js-data/${language}`, 'package.json', `licenses/${language}-package.json`);
}
add('tesseract.js', 'LICENSE.md', 'licenses/tesseract.js-APACHE-2.0.txt');
add('tesseract.js-core', 'LICENSE', 'licenses/tesseract.js-core-APACHE-2.0.txt');
entries.push({ source: join(root, 'scripts/receipt-ocr-NOTICE.txt'), target: 'NOTICE.txt' });

const files = [];
for (const entry of entries) {
  const source = await readFile(entry.source);
  const original = entry.gzip ? gzipSync(source, { level: 9 }) : source;
  const sha256 = createHash('sha256').update(original).digest('hex');
  const target = join(destination, entry.target);
  if (check) {
    const actual = await readFile(target);
    if (createHash('sha256').update(actual).digest('hex') !== sha256) throw new Error(`Modified or stale OCR asset: ${entry.target}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    if (entry.gzip) await writeFile(target, original);
    else await copyFile(entry.source, target);
  }
  files.push({ path: entry.target, bytes: original.length, sha256 });
}
const manifest = JSON.stringify({ packages, files }, null, 2) + '\n';
if (check) {
  if (await readFile(join(destination, 'manifest.json'), 'utf8') !== manifest) throw new Error('OCR manifest does not match the installed packages.');
} else {
  await writeFile(join(destination, 'manifest.json'), manifest);
}
console.log(`Receipt OCR: ${check ? 'verified' : 'prepared'} ${files.length} local assets (${(files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(1)} MiB).`);
await import('./paddle-prepare.mjs');
