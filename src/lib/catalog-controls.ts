import { normalizeCategory, type ProductCategory } from '../data/categories.ts';

export type CatalogOrder = 'catalogo' | 'nombre';
export type CatalogState = { category: ProductCategory | 'todos'; query: string; order: CatalogOrder };

export function catalogSearchText(product: { id: string; name: string; summary: string; features?: readonly string[]; brand?: string; supplierModel?: string; equipmentFamily?: string; capacity?: string }, category: string) {
  return [product.id, product.name, product.summary, category, product.brand, product.supplierModel, product.equipmentFamily, product.capacity, ...(product.features || [])].filter(Boolean).join(' ');
}

const productPlurals: Record<string, string> = {
  cocinas: 'cocina', hornos: 'horno', carritos: 'carrito', lavaderos: 'lavadero',
  lavatorios: 'lavatorio', licuadoras: 'licuadora', batidoras: 'batidora',
  dispensadores: 'dispensador', cremoladeras: 'cremoladera', amasadoras: 'amasadora',
  vitrinas: 'vitrina', freidoras: 'freidora', parrillas: 'parrilla', planchas: 'plancha',
  mesas: 'mesa', estantes: 'estante', refrigeradores: 'refrigerador',
  congeladores: 'congelador', hornillas: 'hornilla', bandejas: 'bandeja',
};

function fold(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[‐‑‒–—]/g, '-');
}

function searchTokens(value: string) {
  // Keep codes intact, and bind a quantity to its adjacent unit. Splitting P31
  // into "p" + "31" would incorrectly match "tapa ... peso: 31 kg".
  return fold(value).replace(/(?<![\p{L}\p{N}-])(\d+(?:[.,]\d+)?)\s*(?:litros?|l)\b/gu,
    (_match, amount: string) => `${amount.replace(/[.,]/g, 'd')}l`)
    .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) || [];
}

function canonicalToken(token: string) { return productPlurals[token] || token.replace(/-/g, ''); }

export function matchesCatalogSearch(text: string, query: string) {
  const sourceTokens = searchTokens(text);
  const words = new Set(sourceTokens.map(canonicalToken));
  for (const token of sourceTokens) {
    const parts = token.split('-');
    // The supplier code ILUMI-DJ-181 is also searchable as DJ-181/DJ181.
    // Only letter-led code suffixes become aliases, never an inferred capacity.
    for (let index = 1; index < parts.length; index++) {
      const alias = parts.slice(index).join('');
      if (/^\p{L}/u.test(alias) && /\d/.test(alias)) words.add(alias);
    }
    for (const part of parts) if (/^\p{L}+$/u.test(part)) words.add(canonicalToken(part));
  }
  // Explicit capacity lists share their final unit: "Capacidades: 10, 15 y 20 L".
  // Do not associate unrelated dimensions or weights with a unit elsewhere.
  for (const match of fold(text).matchAll(/\bcapacidades?\s*:\s*((?:\d+\s*[,y]\s*)+\d+)\s*(?:litros?|l)\b/g)) {
    for (const amount of match[1].match(/\d+/g) || []) words.add(`${amount}l`);
  }
  const plainWords = [...words].filter(word => !/\d/.test(word));
  return searchTokens(query).map(canonicalToken).every(term => /\d/.test(term) || term.length < 2
    ? words.has(term)
    : plainWords.some(word => word.includes(term)));
}

export function sameCatalogQuery(a: string, b: string) { return searchTokens(a).map(canonicalToken).join(' ') === searchTokens(b).map(canonicalToken).join(' '); }

export function readCatalogState(params: URLSearchParams): CatalogState {
  return {
    category: normalizeCategory(params.get('categoria')) || 'todos',
    query: (params.get('buscar') || '').slice(0, 160),
    order: params.get('orden') === 'nombre' ? 'nombre' : 'catalogo',
  };
}

export function catalogStateUrl(current: string, state: CatalogState) {
  const url = new URL(current);
  state.category === 'todos' ? url.searchParams.delete('categoria') : url.searchParams.set('categoria', state.category);
  state.query.trim() ? url.searchParams.set('buscar', state.query.trim()) : url.searchParams.delete('buscar');
  state.order === 'catalogo' ? url.searchParams.delete('orden') : url.searchParams.set('orden', state.order);
  return url;
}

const names = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
export function compareCatalogItems(a: { name: string; order: number }, b: { name: string; order: number }, order: CatalogOrder) {
  return (order === 'nombre' ? names.compare(a.name, b.name) : 0) || a.order - b.order;
}

export function catalogStatus(api: boolean, state: string | undefined, total: number): 'loading' | 'unavailable' | 'ready' {
  if (!api || total > 0) return 'ready';
  if (state === 'unavailable') return 'unavailable';
  return ['live', 'stale', 'preview'].includes(state || '') ? 'ready' : 'loading';
}
