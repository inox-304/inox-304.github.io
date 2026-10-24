import snapshot from './cart-published.json' with { type: 'json' };
import { parseCartConfig } from '../lib/cart-config.ts';
import { cartAssetFor } from '../lib/cart-assets.ts';
import type { Product } from './products.ts';

/** Owner-requested, reviewed four-in-one equipment, available without a live server. */
export function withPublishedCart(products: Product[]): Product[] {
  const config = parseCartConfig(snapshot.cartConfig);
  if (snapshot.version !== 1 || !config || !cartAssetFor(snapshot.productId, snapshot.model3d)) throw new Error('Invalid published cart');
  return products.map(product => {
    if (product.id !== snapshot.productId) return product;
    if (product.category !== 'linea-caliente' || product.supplyType === 'distributed' || !cartAssetFor(product.id, product.model3d || '')) throw new Error('Cart model needs review');
    return { ...product, supplyType: 'manufactured', equipmentFamily: 'carritos-comida', cartConfig: structuredClone(config), model3d: snapshot.model3d };
  });
}
