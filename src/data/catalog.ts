import { products } from './products';

// P01 now has an owner-supplied clean image without its old promotional price.
export const visibleProducts = products;
export const featuredProducts = ['P01', 'P16', 'P24', 'P03', 'P09', 'P21']
  .map(id => visibleProducts.find(product => product.id === id)!)
  .filter(Boolean);
