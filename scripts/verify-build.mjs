import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../astro.config.mjs';

// Read the actual static output so this also catches stale links and missing media.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const origin = new URL(config.site).origin;
const base = `/${(config.base || '/').split('/').filter(Boolean).join('/')}`.replace(/\/?$/, '/');
const errors = [];
const titleOwners = new Map();
let referenceCount = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  }));
  return files.flat();
}

function relativeName(filename) {
  return path.relative(dist, filename).split(path.sep).join('/');
}

function publicPath(filename) {
  return `${base}${relativeName(filename)}`.replace(/index\.html$/, '');
}

function decodeEntities(value) {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) =>
      String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)));
}

async function isFile(filename) {
  try { return (await stat(filename)).isFile(); } catch { return false; }
}

async function verifyReference(rawValue, filename, context) {
  const value = decodeEntities(rawValue).trim();
  if (!value || value.startsWith('#')) return;
  let url;
  try {
    url = new URL(value, new URL(publicPath(filename), origin));
  } catch {
    errors.push(`${relativeName(filename)}: invalid ${context} URL: ${value}`);
    return;
  }
  // This verification is offline: external links, mail, WhatsApp and data URIs are skipped.
  if (url.origin !== origin) return;
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch {
    errors.push(`${relativeName(filename)}: invalid URL encoding: ${value}`);
    return;
  }
  if (!decodedPath.startsWith(base)) {
    errors.push(`${relativeName(filename)}: ${context} escapes site base ${base}: ${value}`);
    return;
  }
  const target = path.resolve(dist, decodedPath.slice(base.length));
  const relative = path.relative(dist, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push(`${relativeName(filename)}: URL escapes the build directory: ${value}`);
    return;
  }
  referenceCount += 1;
  const candidates = [target, path.join(target, 'index.html')];
  if (!path.extname(target)) candidates.push(`${target}.html`);
  if (!(await Promise.all(candidates.map(isFile))).some(Boolean)) {
    errors.push(`${relativeName(filename)}: missing ${context}: ${value}`);
  }
}

async function verifyCss(css, filename) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) {
    await verifyReference(match[1] ?? match[2] ?? match[3], filename, 'CSS asset');
  }
  for (const match of clean.matchAll(/@import\s+["']([^"']+)["']/gi)) {
    await verifyReference(match[1], filename, 'CSS import');
  }
}

async function verifyHtml(filename) {
  const html = await readFile(filename, 'utf8');
  const clean = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  const semantic = clean.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const titles = [...semantic.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  const title = titles.length === 1 ? decodeEntities(titles[0][1]).trim() : '';
  if (!title) errors.push(`${relativeName(filename)}: expected one nonempty title`);
  if (title && titleOwners.has(title)) {
    errors.push(`${relativeName(filename)}: title duplicated in ${titleOwners.get(title)}`);
  }
  if (title) titleOwners.set(title, relativeName(filename));
  if ([...semantic.matchAll(/<h1\b[^>]*>/gi)].length !== 1) {
    errors.push(`${relativeName(filename)}: expected exactly one h1`);
  }
  if (!/<main\b/i.test(semantic)) errors.push(`${relativeName(filename)}: missing main landmark`);

  for (const tag of clean.matchAll(/<(?:a|img|source|video|audio|script|link|iframe|track|use)\b[^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(src|href|poster|srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const name = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (name.endsWith('srcset')) {
        // A data URI may contain commas; it does not reference a file in dist.
        if (value.trim().startsWith('data:')) continue;
        for (const candidate of value.split(',')) {
          await verifyReference(candidate.trim().split(/\s+/)[0], filename, name);
        }
      } else {
        await verifyReference(value, filename, name);
      }
    }
  }
  for (const style of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    await verifyCss(style[1], filename);
  }
  return html;
}

try {
  const files = await walk(dist);
  const htmlFiles = files.filter(filename => filename.endsWith('.html'));
  if (!htmlFiles.length) errors.push('No generated HTML found. Run npm run build first.');
  for (const route of ['index.html', 'catalogo/index.html', 'contacto/index.html']) {
    if (!(await isFile(path.join(dist, route)))) errors.push(`Missing main route: ${route}`);
  }
  const productPages = htmlFiles.filter(filename => /^catalogo\/[^/]+\/index\.html$/.test(relativeName(filename)));
  const snapshotFile = path.join(root, '.generated/cms-snapshot.json');
  if (await isFile(snapshotFile)) {
    const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
    const expected = snapshot.products.filter(product => product.visible).length;
    if (productPages.length !== expected) errors.push(`Expected ${expected} published product pages, found ${productPages.length}.`);
  } else if (!productPages.length) errors.push('The generated catalog has no product detail pages.');
  for (const filename of htmlFiles) await verifyHtml(filename);
  for (const filename of files.filter(filename => filename.endsWith('.css'))) {
    await verifyCss(await readFile(filename, 'utf8'), filename);
  }
  if (errors.length) {
    console.error(`Build verification failed (${errors.length}):\n${errors.map(error => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Build verified: ${htmlFiles.length} HTML pages, ${productPages.length} product pages, ${referenceCount} local references. No network requests made.`);
  }
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'Build output not found. Run npm run build before npm test.'
    : `Build verification failed: ${error.message}`);
  process.exitCode = 1;
}
