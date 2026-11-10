import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
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

async function isFile(filename) {
  try { return (await stat(filename)).isFile(); } catch { return false; }
}

async function verifyReference(rawValue, filename, context) {
  // HTML attributes arrive decoded exactly once by the HTML parser. CSS URLs
  // are not HTML, and must never be passed through an HTML entity decoder.
  const value = rawValue.trim();
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

export function inspectHtml(html) {
  // This is a verifier, not a sanitizer: traverse the parsed document without
  // rewriting markup or accidentally creating tags by removing substrings.
  const result = { titles: [], h1Count: 0, hasMain: false, references: [], styles: [] };
  const referenceTags = new Set(['a', 'img', 'source', 'video', 'audio', 'script', 'link', 'iframe', 'track', 'use']);
  const referenceAttributes = new Set(['src', 'href', 'poster', 'srcset', 'imagesrcset']);
  const pending = [{ node: parse(html), inert: false }];
  while (pending.length) {
    const { node, inert } = pending.pop();
    const tag = node.tagName;
    if (!inert && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      if (tag === 'title') result.titles.push((node.childNodes || []).filter(child => child.nodeName === '#text').map(child => child.value).join('').trim());
      if (tag === 'h1') result.h1Count += 1;
      if (tag === 'main') result.hasMain = true;
    }
    if (referenceTags.has(tag)) {
      for (const attribute of node.attrs || []) {
        if (referenceAttributes.has(attribute.name)) result.references.push({ name: attribute.name, value: attribute.value });
      }
    }
    if (tag === 'style') result.styles.push((node.childNodes || []).filter(child => child.nodeName === '#text').map(child => child.value).join(''));
    for (const child of node.childNodes || []) pending.push({ node: child, inert });
    // Template content is not a visible landmark, but its assets can be used
    // by the catalog at runtime and must still exist in the build.
    if (node.content) pending.push({ node: node.content, inert: true });
  }
  return result;
}

async function verifyHtml(filename) {
  const html = await readFile(filename, 'utf8');
  const document = inspectHtml(html);
  const title = document.titles.length === 1 ? document.titles[0] : '';
  if (!title) errors.push(`${relativeName(filename)}: expected one nonempty title`);
  if (title && titleOwners.has(title)) {
    errors.push(`${relativeName(filename)}: title duplicated in ${titleOwners.get(title)}`);
  }
  if (title) titleOwners.set(title, relativeName(filename));
  if (document.h1Count !== 1) {
    errors.push(`${relativeName(filename)}: expected exactly one h1`);
  }
  if (!document.hasMain) errors.push(`${relativeName(filename)}: missing main landmark`);

  for (const { name, value } of document.references) {
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
  for (const style of document.styles) {
    await verifyCss(style, filename);
  }
  return html;
}

async function main() {
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    console.error(error.code === 'ENOENT'
      ? 'Build output not found. Run npm run build before npm test.'
      : `Build verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
