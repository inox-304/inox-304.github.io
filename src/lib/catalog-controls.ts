import { normalizeCategory, type ProductCategory } from '../data/categories.ts';

export type CatalogOrder = 'catalogo' | 'nombre';
export type CatalogState = { category: ProductCategory | 'todos'; query: string; order: CatalogOrder };

export function catalogSearchText(product: { id: string; name: string; summary: string; features?: readonly string[] }, category: string) {
  return [product.id, product.name, product.summary, category, ...(product.features || [])].join(' ');
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matchesCatalogSearch(text: string, query: string) {
  const searchable = normalize(text);
  return normalize(query).split(/\s+/).filter(Boolean).every(term => searchable.includes(term));
}

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
