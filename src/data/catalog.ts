import { products, type Product, type ProductCategory } from './products.ts';
import { buildCmsData } from './cms-build.ts';

// P01 now has an owner-supplied clean image without its old promotional price.
export const visibleProducts: Product[] = buildCmsData
  ? buildCmsData.products.filter(product => product.visible).map(product => ({ ...product, category: product.category as ProductCategory }))
  : products;
export const featuredProducts = buildCmsData ? visibleProducts.filter(product => product.featured) : ['P01', 'P16', 'P24', 'P03', 'P09', 'P21']
  .map(id => visibleProducts.find(product => product.id === id)!)
  .filter(Boolean);
