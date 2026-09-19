import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inspectGlb } from './lib/model-budget.mjs';

const directory = resolve(process.argv[2] || 'public/models');
async function findModels(folder) {
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? findModels(join(folder, entry.name)) : /\.glb$/i.test(entry.name) ? [join(folder, entry.name)] : []));
  return files.flat();
}
const files = await findModels(directory);
if (!files.length) console.log('No hay modelos GLB todavía. El catálogo mantiene sus fotografías; el botón 360° aparece al asignar un modelo.');
let invalid = 0;
for (const file of files) {
  const report = inspectGlb(await readFile(file));
  console.log(`${file}: ${(report.bytes / 1024 / 1024).toFixed(2)} MB, ${report.triangles.toLocaleString('es-PE')} triángulos`);
  report.warnings.forEach(value => console.warn(`  Aviso: ${value}`));
  report.errors.forEach(value => console.error(`  Error: ${value}`));
  if (report.errors.length) invalid++;
}
if (files.length) console.log(`${files.length} modelos revisados; ${invalid} requieren corrección.`);
if (invalid) process.exitCode = 1;
