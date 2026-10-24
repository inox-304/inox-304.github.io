import source from './cooktop-published.json' with { type: 'json' };
import { parseCooktopConfig, type CooktopConfig } from '../lib/cooktop-config.ts';
import { cooktopAssetFor } from '../lib/cooktop-assets.ts';
import type { Product } from './products.ts';

const ids = ['P01', 'P02', 'P03', 'P04', 'P05', 'INOX-COC-EMP'];
export type PublishedCooktopSnapshot = {
  version: 1; sourceOrigin: string; capturedAt: string;
  products: { productId: string; model3d: string; cooktopConfig: CooktopConfig | null }[];
};
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid published kitchen snapshot');
  return value as Record<string, unknown>;
}

/** Only reviewed public rules tied to the exact published SKU and base model. */
export function parsePublishedCooktops(value: unknown): PublishedCooktopSnapshot {
  const data = record(value, ['version', 'sourceOrigin', 'capturedAt', 'products']);
  if (data.version !== 1 || data.sourceOrigin !== 'https://inox304-panel.onrender.com'
    || typeof data.capturedAt !== 'string' || !Number.isFinite(Date.parse(data.capturedAt))
    || !Array.isArray(data.products) || data.products.length !== ids.length) throw new Error('Invalid published kitchen snapshot');
  const seen = new Set<string>();
  const products = data.products.map(value => {
    const item = record(value, ['productId', 'model3d', 'cooktopConfig']);
    if (typeof item.productId !== 'string' || !ids.includes(item.productId) || seen.has(item.productId)
      || typeof item.model3d !== 'string' || !item.model3d.startsWith('/models/inox/')
      || !cooktopAssetFor(item.productId, item.model3d)) throw new Error('Invalid published kitchen identity');
    seen.add(item.productId);
    const cooktopConfig = parseCooktopConfig(item.cooktopConfig);
    if (item.cooktopConfig !== null && !cooktopConfig) throw new Error('Incomplete published kitchen rules');
    return { productId: item.productId, model3d: item.model3d, cooktopConfig };
  });
  return { version: 1, sourceOrigin: data.sourceOrigin, capturedAt: data.capturedAt, products };
}

export const publishedCooktopSnapshot = parsePublishedCooktops(source);

/** Static catalog only. Live API products retain the owner's current rules. */
export function withPublishedCooktops(products: Product[], snapshot: PublishedCooktopSnapshot = publishedCooktopSnapshot): Product[] {
  const approved = parsePublishedCooktops(snapshot);
  return products.map(product => {
    const entry = approved.products.find(item => item.productId === product.id);
    if (!entry) return product;
    if (product.category !== 'linea-caliente' || product.supplyType === 'distributed'
      || (product.equipmentFamily && product.equipmentFamily !== 'cocinas')
      || product.model3d !== entry.model3d) throw new Error(`Published kitchen model needs review: ${product.id}`);
    // Product data is a serializable DTO; client parsing rebuilds safe rule maps.
    return { ...product, supplyType: 'manufactured', equipmentFamily: 'cocinas', cooktopConfig: structuredClone(entry.cooktopConfig) };
  });
}
