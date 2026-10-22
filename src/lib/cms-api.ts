import { categoryNames, normalizeWhatsapp, safeHttps, safeImage, safeModel, safePreviewAsset, safeTechnicalSheet, type CmsAdditional, type CmsData, type CmsProduct } from './cms.ts';

const settingKeys = ['empresa', 'direccion', 'referencia_direccion', 'facebook', 'instagram', 'tiktok', 'horarios', 'contacto_principal', 'contacto_instalaciones', 'contacto_medida', 'contacto_formulario', 'hero_title', 'hero_description', 'home_text'];
export function emptyCmsData(): CmsData {
  return { products: [], contacts: [], settings: Object.fromEntries(settingKeys.map(key => [key, key === 'empresa' ? 'INOX 304' : ''])) };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog object');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max || /\u0000/.test(value)) throw new Error('Invalid catalog text');
  return value;
}
function identifier(value: unknown): string {
  const result = string(value, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error('Invalid catalog identifier');
  return result;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid catalog list');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid catalog flag');
  return value;
}
function amount(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000) throw new Error('Invalid catalog price');
  return value;
}
function asset(value: unknown, validate: (value: string) => string, required = false): string {
  const raw = string(value ?? '', 2048);
  const safe = raw ? validate(raw) : '';
  if ((raw || required) && !safe) throw new Error('Invalid catalog media URL');
  return safe;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error('Duplicate catalog identifier');
}

/** Validate the entire public projection before changing visible content or links. */
export function parsePublicCatalog(input: unknown, options: { preview?: boolean } = {}): CmsData {
  const preview = options.preview === true;
  const imageUrl = (value: string) => safePreviewAsset(value, safeImage, preview);
  const modelUrl = (value: string) => safePreviewAsset(value, safeModel, preview);
  const documentUrl = (value: string) => safePreviewAsset(value, safeTechnicalSheet, preview);
  const data = record(input);
  const products: CmsProduct[] = list(data.products, 2000).map(value => {
    const item = record(value);
    const slug = string(item.slug, 150);
    const category = string(item.category, 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !Object.hasOwn(categoryNames, category)) throw new Error('Invalid catalog route or category');
    if (typeof item.order !== 'number' || !Number.isFinite(item.order)) throw new Error('Invalid catalog order');
    if (item.currency !== 'PEN' && item.currency !== 'USD') throw new Error('Invalid catalog currency');
    if (item.visible !== true) throw new Error('Unpublished catalog product');
    const variants = list(item.variants ?? [], 100).map(value => {
      const variant = record(value);
      return { id: identifier(variant.id), name: string(variant.name, 250), price: amount(variant.price), availability: string(variant.availability ?? '', 250), model3d: asset(variant.model3d, modelUrl), technicalSheet: asset(variant.technicalSheet, documentUrl), materialVariant: string(variant.materialVariant ?? '', 120), doorAnimation: string(variant.doorAnimation ?? '', 120) };
    });
    const additionalCharges = list(item.additionalCharges ?? [], 100).map(value => {
      const charge = record(value);
      return { id: identifier(charge.id), name: string(charge.name, 250), price: amount(charge.price) };
    });
    const additionals = list(item.additionals ?? [], 100).map((value): CmsAdditional => {
      const additional = record(value);
      const chargeUnit = string(additional.chargeUnit, 80);
      const unitLabel = string(additional.unitLabel ?? '', 120).trim();
      const name = string(additional.name, 250).trim();
      if (!name || !['unit', 'm', 'm2', 'custom'].includes(chargeUnit) || (chargeUnit === 'custom' && !unitLabel)) throw new Error('Invalid catalog additional');
      return { id: identifier(additional.id), name, description: string(additional.description ?? '', 2000), price: amount(additional.price) ?? null, chargeUnit: chargeUnit as CmsAdditional['chargeUnit'], unitLabel };
    });
    unique(variants.map(item => item.id)); unique(additionalCharges.map(item => item.id)); unique(additionals.map(item => item.id));
    return {
      id: identifier(item.id), slug, name: string(item.name, 250), category, summary: string(item.summary, 10000),
      features: list(item.features, 50).map(value => string(value)), image: asset(item.image, imageUrl, true),
      visible: true, featured: boolean(item.featured), order: item.order,
      contactId: item.contactId ? identifier(item.contactId) : '', price: amount(item.price), currency: item.currency,
      showPrice: boolean(item.showPrice), technicalSheet: asset(item.technicalSheet, documentUrl),
      model3d: asset(item.model3d, modelUrl), modelPoster: asset(item.modelPoster, imageUrl), doorAnimation: string(item.doorAnimation ?? '', 120),
      gallery: list(item.gallery ?? [], 8).map(value => asset(value, imageUrl, true)),
      chargeUnit: string(item.chargeUnit ?? '', 80), unitLabel: string(item.unitLabel ?? '', 120),
      availability: string(item.availability ?? '', 250), variants, additionalCharges, additionals,
    };
  });
  unique(products.map(item => item.id)); unique(products.map(item => item.slug));
  const contacts = list(data.contacts, 200).map(value => {
    const item = record(value);
    const whatsapp = normalizeWhatsapp(string(item.whatsapp, 80));
    const email = string(item.email ?? '', 200);
    if (item.active !== true || !whatsapp || (email && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))) throw new Error('Invalid public catalog contact');
    return { id: identifier(item.id), name: string(item.name, 150), whatsapp, phone: string(item.phone, 80), email, message: string(item.message), active: true };
  });
  unique(contacts.map(item => item.id));
  const settings = emptyCmsData().settings;
  const source = record(data.settings);
  for (const key of settingKeys) {
    if (!Object.hasOwn(source, key)) continue;
    const value = string(source[key], ['hero_description', 'home_text'].includes(key) ? 10000 : 2000);
    if (['facebook', 'instagram', 'tiktok'].includes(key) && value && !safeHttps(value)) throw new Error('Invalid catalog social URL');
    if (key.startsWith('contacto_') && value) identifier(value);
    settings[key] = value;
  }
  settings.empresa ||= 'INOX 304';
  return { products: products.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), contacts, settings };
}

export function apiProductRoute(product: Pick<CmsProduct, 'slug'>): string {
  return `/catalogo/${encodeURIComponent(product.slug)}/`;
}
export function catalogSlug(pathname: string): string {
  return pathname.match(/\/catalogo\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1] || '';
}
