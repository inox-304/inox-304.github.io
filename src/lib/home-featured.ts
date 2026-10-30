import { catalogFamilyProducts, getProductFamily, type FamilyProduct } from './product-families.ts';

type FeaturedProduct = FamilyProduct & { featured?: boolean };

/** Public family cards only. CMS highlights lead; published equipment fills the showcase. */
export function selectHomeFeatured<T extends FeaturedProduct>(products: readonly T[], limit = 10): T[] {
  const unique = [...new Map(products.filter(product => product.visible !== false).map(product => [product.id, product])).values()];
  const families = catalogFamilyProducts(unique);
  const highlighted = families.filter(product => product.featured || getProductFamily(product.id, unique)?.members.some(member => member.product.featured));
  const result = highlighted.slice(0, Math.max(0, limit));
  const selected = new Set(result.map(product => product.id));
  const groups = new Map<string, T[]>();
  for (const product of families) {
    if (selected.has(product.id)) continue;
    if (!groups.has(product.category)) groups.set(product.category, []);
    groups.get(product.category)!.push(product);
  }
  // Include the breadth of the catalog instead of filling every remaining slot with cookers.
  while (result.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const product = group.shift();
      if (!product) continue;
      result.push(product); added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}
