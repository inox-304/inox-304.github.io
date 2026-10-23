import { products, type Product, type ProductCategory } from './products.ts';
import { buildCmsData } from './cms-build.ts';
import { apiMode } from './cms-mode.ts';
import { catalogFamilyProducts, getProductFamily } from '../lib/product-families.ts';

// P01 now has an owner-supplied clean image without its old promotional price.
export const visibleProducts: Product[] = apiMode ? [] : buildCmsData
  ? buildCmsData.products.filter(product => product.visible).map(product => ({ ...product, category: product.category as ProductCategory }))
  : products;
// Keep every SKU available to static routes and the CMS bootstrap. Group only listings.
export const catalogProducts = catalogFamilyProducts(visibleProducts);
export const featuredProducts = buildCmsData ? catalogProducts.filter(product => product.featured || getProductFamily(product.id, visibleProducts)?.members.some(member => member.product.featured)) : ['P01', 'P16', 'P24', 'P03', 'P09', 'P21']
  .map(id => visibleProducts.find(product => product.id === id)!)
  .filter(Boolean);
