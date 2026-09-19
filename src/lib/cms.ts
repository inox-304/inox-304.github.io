export type CmsContact = { id: string; name: string; whatsapp: string; phone: string; email: string; message: string; active: boolean };
export type CmsProduct = { id: string; slug: string; name: string; category: string; summary: string; features: string[]; image: string; visible: boolean; featured: boolean; order: number; contactId: string };
export type CmsData = { products: CmsProduct[]; contacts: CmsContact[]; settings: Record<string, string> };
export const categoryNames: Record<string, string> = { coccion: 'Cocción', fritura: 'Fritura y comida rápida', refrigeracion: 'Refrigeración', lavado: 'Lavado', mobiliario: 'Mobiliario', preparacion: 'Equipos de preparación' };
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** RFC 4180-style parser: escaped quotes, quoted commas and embedded newlines. */
export function parseCsv(input: string): string[][] {
  if (input.length > 5_000_000) throw new Error('CSV too large');
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let closed = false;
  const field = () => { row.push(value); value = ''; closed = false; };
  const finish = () => { field(); if (row.some(cell => cell.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += character;
    } else if (character === '"') {
      if (value !== '' || closed) throw new Error('Invalid CSV quote'); quoted = true;
    } else if (character === ',') field();
    else if (character === '\n' || character === '\r') { if (character === '\r' && text[i + 1] === '\n') i++; finish(); }
    else { if (closed && !/\s/.test(character)) throw new Error('Unexpected text after CSV quote'); if (!closed) value += character; }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (value || row.length || closed) finish();
  return rows;
}

function records(csv: string, required: string[]): Record<string, string>[] {
  const rows = parseCsv(csv); const header = rows.shift()?.map(cell => cell.trim().toLowerCase()) || [];
  if (new Set(header).size !== header.length || required.some(key => !header.includes(key))) throw new Error('Invalid CMS headers');
  if (rows.length > 2000) throw new Error('Too many CMS rows');
  return rows.map(row => {
    if (row.length !== header.length) throw new Error('Invalid CMS row width');
    return Object.fromEntries(header.map((key, index) => [key, row[index].trim()]));
  });
}
function text(value: string, max = 2000) { if (value.length > max || /\u0000/.test(value)) throw new Error('Invalid CMS text'); return value; }
function id(value: string) { if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error('Invalid CMS ID'); return value; }
function flag(value: string, fallback: boolean) {
  if (!value) return fallback;
  const normalized = normalize(value);
  if (['si', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  throw new Error('Invalid CMS visibility');
}
function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('Duplicate CMS ID or slug'); }
export function normalizeWhatsapp(value: string): string {
  if (!value || !/^[+\d\s().-]+$/.test(value)) return '';
  let digits = value.replace(/\D/g, '').replace(/^00/, '');
  if (/^9\d{8}$/.test(digits)) digits = `51${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}
export function safeHttps(value: string): string {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function safeImage(value: string): string {
  if (/^\/images\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes('..') && !value.includes('//')) return value;
  return safeHttps(value);
}
export function validatePublishedUrl(value: string): string {
  const safe = safeHttps(value); if (!safe) return '';
  const url = new URL(safe);
  return url.hostname === 'docs.google.com' && /^\/spreadsheets\/d\/e\/[^/]+\/pub$/.test(url.pathname) && url.searchParams.get('output') === 'csv' ? safe : '';
}
export function parseCms(catalogCsv: string, contactsCsv: string, settingsCsv: string): CmsData {
  const products = records(catalogCsv, ['id','slug','nombre','categoria','descripcion','caracteristicas','imagen','visible','destacado','orden','contacto_id']).map((row, index): CmsProduct => {
    const category = normalize(row.categoria);
    const categoryId = Object.keys(categoryNames).find(key => key === category || normalize(categoryNames[key]) === category);
    const image = safeImage(row.imagen);
    if (!categoryId || !image || !row.nombre || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)) throw new Error('Invalid CMS product');
    const order = row.orden ? Number(row.orden) : index;
    if (!Number.isFinite(order)) throw new Error('Invalid CMS product order');
    return { id: id(row.id), slug: text(row.slug, 150), name: text(row.nombre, 250), category: categoryId, summary: text(row.descripcion), features: text(row.caracteristicas, 5000).split('|').map(value => value.trim()).filter(Boolean).slice(0, 50), image, visible: flag(row.visible, true), featured: flag(row.destacado, false), order, contactId: row.contacto_id ? id(row.contacto_id) : '' };
  });
  unique(products.map(product => product.id)); unique(products.map(product => product.slug));
  const contacts = records(contactsCsv, ['id','nombre','whatsapp','telefono','correo','mensaje','activo']).map((row): CmsContact => {
    const active = flag(row.activo, true); const whatsapp = normalizeWhatsapp(row.whatsapp);
    if (active && !whatsapp) throw new Error('Active CMS contact needs WhatsApp');
    if (row.correo && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(row.correo)) throw new Error('Invalid CMS email');
    return { id: id(row.id), name: text(row.nombre, 150), whatsapp, phone: text(row.telefono || row.whatsapp, 80), email: text(row.correo, 200), message: text(row.mensaje), active };
  });
  unique(contacts.map(contact => contact.id));
  const settingRows = records(settingsCsv, ['clave','valor','descripcion']); unique(settingRows.map(row => row.clave));
  const settings: Record<string, string> = {};
  const allowed = ['empresa','direccion','referencia_direccion','facebook','contacto_principal','contacto_instalaciones','contacto_medida','contacto_formulario'];
  for (const row of settingRows) {
    if (!allowed.includes(row.clave)) continue;
    const value = text(row.valor);
    if (row.clave === 'facebook' && value && !safeHttps(value)) throw new Error('Invalid CMS Facebook URL');
    if (row.clave.startsWith('contacto_') && value) id(value);
    settings[row.clave] = value;
  }
  if (!settings.empresa || !settings.contacto_principal) throw new Error('Missing required CMS settings');
  return { products: products.sort((a,b) => a.order - b.order || a.id.localeCompare(b.id)), contacts, settings };
}
export function visibleCmsProducts(data: CmsData) { return data.products.filter(product => product.visible); }
export function resolveContact(data: CmsData, requested = ''): CmsContact | undefined {
  return data.contacts.find(contact => contact.id === requested && contact.active && contact.whatsapp)
    || data.contacts.find(contact => contact.id === data.settings.contacto_principal && contact.active && contact.whatsapp)
    || data.contacts.find(contact => contact.active && contact.whatsapp);
}
export function contactUrl(contact: CmsContact, message: string) { return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(message)}`; }
export function cmsProductRoute(product: Pick<CmsProduct, 'id'>, routes: Record<string, string>) {
  return Object.hasOwn(routes, product.id) && typeof routes[product.id] === 'string'
    ? routes[product.id]
    : `/equipo/?id=${encodeURIComponent(product.id)}`;
}
