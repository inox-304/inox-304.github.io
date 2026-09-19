import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseCsv, parseCms } from '../../src/lib/cms.ts';

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const fields = ['imagen','galeria','ficha_tecnica','modelo_3d','poster_3d'];
const enabled = value => /^(true|si|sí|1)$/i.test(String(value).trim());
const csv = rows => rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
const fail = message => { throw new Error(message); };

export function validateExportUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.hash || url.search || !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url.pathname)) fail('CMS_EXPORT_URL must be a deployed Google Apps Script /exec URL');
  return url.href;
}
export function driveId(value) {
  const text = String(value).trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.port) return '';
    const id = url.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]{10,200})(?:\/|$)/)?.[1] || (['/open','/uc'].includes(url.pathname) ? url.searchParams.get('id') : '');
    return /^[a-zA-Z0-9_-]{10,200}$/.test(id || '') ? id : '';
  } catch { return ''; }
}
export async function googleJson(url, maxBytes, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(30_000);
  for (let redirect = 0; redirect < 5; redirect++) {
    const current = new URL(url);
    if (current.protocol !== 'https:' || !['script.google.com','script.googleusercontent.com'].includes(current.hostname) || current.username || current.password || current.port || /\/(?:accounts|signin|login)(?:\/|$)/i.test(current.pathname)) fail('CMS redirect left the approved Google export hosts');
    const response = await fetchImpl(current.href, { redirect: 'manual', signal, headers: { Accept: 'application/json' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); if (!location) fail('CMS redirect missing location');
      await response.body?.cancel();
      url = new URL(location, current).href; continue;
    }
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) fail('CMS export is unavailable or requires login');
    if (Number(response.headers.get('content-length') || 0) > maxBytes) fail('CMS response is too large');
    const reader = response.body?.getReader(); if (!reader) fail('CMS response is empty');
    const chunks = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) fail('CMS response is too large'); chunks.push(value); } }
    finally { await reader.cancel(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || result.error) fail('CMS rejected the export; check the sheet and published assets');
    return result;
  }
  fail('Too many CMS redirects');
}
function publishedRows(input, column) {
  if (typeof input !== 'string') fail('CMS export is missing a CSV');
  const rows = parseCsv(input); const header = rows.shift();
  if (!header || new Set(header).size !== header.length) fail('Invalid CMS headers');
  const index = header.indexOf(column); if (index < 0) fail(`CMS export requires ${column}`);
  for (const row of rows) if (row.length !== header.length) fail('Invalid CMS row width');
  return [header, ...rows.filter(row => enabled(row[index]))];
}
async function convertAsset(payload) {
  if (typeof payload.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64) || payload.base64.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4) fail('Invalid CMS asset encoding');
  let bytes = Buffer.from(payload.base64, 'base64'); const originalSize = bytes.length;
  if (!originalSize || originalSize > MAX_ASSET_BYTES || bytes.toString('base64') !== payload.base64) fail('Invalid CMS asset size');
  let directory; let extension;
  const imageFormat = { 'image/png':'png', 'image/jpeg':'jpeg', 'image/webp':'webp' }[payload.mimeType];
  if (imageFormat) {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (metadata.format !== imageFormat || (metadata.pages || 1) !== 1) fail('CMS image MIME does not match its content');
    const transparent = metadata.hasAlpha && !(await sharp(bytes, { limitInputPixels: 40_000_000 }).stats()).isOpaque;
    const optimized = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    bytes = await (transparent ? optimized.webp({ quality: 88, alphaQuality: 100 }) : optimized.jpeg({ quality: 88 })).toBuffer();
    directory = 'images'; extension = transparent ? 'webp' : 'jpg';
  } else if (payload.mimeType === 'application/pdf') {
    if (bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) fail('Invalid CMS PDF');
    directory = 'documents'; extension = 'pdf';
  } else if (payload.mimeType === 'model/gltf-binary' || (payload.mimeType === 'application/octet-stream' && /\.glb$/i.test(payload.name || ''))) {
    if (bytes.length < 20 || bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a || bytes.readUInt32LE(12) + 20 > bytes.length) fail('Invalid CMS GLB');
    const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    if (model.asset?.version !== '2.0' || [...(model.buffers || []), ...(model.images || [])].some(item => item.uri && !item.uri.startsWith('data:'))) fail('CMS GLB must be self-contained');
    directory = 'models'; extension = 'glb';
  } else fail('Unsupported CMS asset MIME');
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  return { path: `/${directory}/cms/${digest}.${extension}`, bytes, originalSize };
}
export async function importPublishedCms(exportUrl, { fetchImpl = fetch } = {}) {
  const endpoint = validateExportUrl(exportUrl);
  const payload = await googleJson(endpoint, 6_000_000, fetchImpl);
  if (payload.version !== 1 || typeof payload.settingsCsv !== 'string') fail('Unsupported CMS export version');
  const catalog = publishedRows(payload.catalogCsv, 'publicar'); const contacts = publishedRows(payload.contactsCsv, 'activo');
  const assetColumns = fields.map(field => [field, catalog[0].indexOf(field)]).filter(([, index]) => index >= 0);
  const references = new Map();
  // Validate business records before any Drive asset request, using temporary local URLs.
  const provisional = catalog.map(row => [...row]);
  for (let i = 1; i < catalog.length; i++) for (const [field, column] of assetColumns) {
    provisional[i][column] = catalog[i][column].split('|').map(value => {
      const id = driveId(value); if (!id) return value.trim();
      references.set(id, null);
      return field === 'ficha_tecnica' ? '/documents/cms/pending.pdf' : field === 'modelo_3d' ? '/models/cms/pending.glb' : '/images/cms/pending.webp';
    }).join('|');
  }
  parseCms(csv(provisional), csv(contacts), payload.settingsCsv);
  if (references.size > 500) fail('Too many CMS media assets');
  let totalBytes = 0;
  for (const id of references.keys()) {
    const assetUrl = new URL(endpoint); assetUrl.searchParams.set('asset', id);
    const asset = await convertAsset(await googleJson(assetUrl.href, 12_000_000, fetchImpl));
    totalBytes += asset.originalSize; if (totalBytes > MAX_TOTAL_BYTES) fail('CMS media exceeds the 200 MB import limit');
    references.set(id, asset);
  }
  for (let i = 1; i < catalog.length; i++) for (const [, column] of assetColumns) catalog[i][column] = catalog[i][column].split('|').map(value => references.get(driveId(value))?.path || value.trim()).join('|');
  const data = parseCms(csv(catalog), csv(contacts), payload.settingsCsv);
  return { data, assets: [...new Map([...references.values()].map(asset => [asset.path, asset])).values()] };
}
