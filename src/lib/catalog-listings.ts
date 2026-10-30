import { getProductFamily } from './product-families.ts';
import { catalogSearchText } from './catalog-controls.ts';

/** One published combination, not a generated permutation of customization options. */
export type CatalogListingVariant = {
  id: string;
  name: string;
  image?: string;
  model3d?: string;
  technicalSheet?: string;
  price?: number;
  availability?: string;
  visible?: boolean;
};

export type CatalogListingProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  image: string;
  summary?: string;
  features?: readonly string[];
  brand?: string;
  supplierModel?: string;
  equipmentFamily?: string;
  capacity?: string;
  model3d?: string;
  technicalSheet?: string;
  price?: number;
  availability?: string;
  visible?: boolean;
  variants?: readonly CatalogListingVariant[];
  variantAxes?: readonly unknown[];
};

export type CatalogListing<T extends CatalogListingProduct = CatalogListingProduct> = {
  /** Used by card identity/filtering; the base product ID remains unchanged. */
  key: string;
  product: T;
  variant?: CatalogListingVariant;
  title: string;
  /** The actual capacity/model/combination shown under the product title. */
  label: string;
  image: string;
  model3d: string;
  technicalSheet: string;
  price?: number;
  availability: string;
  href: string;
};

/** Preserve an existing base-path/API route while selecting this exact variation. */
export function catalogListingHref(listing: Pick<CatalogListing, 'variant'>, baseHref: string): string {
  if (!listing.variant) return baseHref;
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(baseHref);
  const url = new URL(baseHref, 'https://catalog-listing.invalid');
  url.searchParams.set('variant', listing.variant.id);
  return absolute ? url.href : `${url.pathname}${url.search}${url.hash}`;
}

/** Do not let a parent's complete capacity/energy list match every exact variant. */
export function catalogListingSearchText(listing: CatalogListing, category: string): string {
  const product = listing.product;
  return [catalogSearchText({
    ...product,
    summary: listing.variant ? '' : product.summary || '',
    features: listing.variant ? [] : product.features,
    capacity: listing.variant ? listing.label : product.capacity,
  }, category), listing.label, listing.variant?.id || ''].join(' ');
}

/**
 * Catalog presentation only. Families stay grouped in other contexts, and every
 * record/model remains owned by its original product. Structured variants are
 * exhaustive choices, so their parent is not repeated as an extra product card.
 * Free-form variants retain the explicitly available principal configuration.
 */
export function expandedCatalogListings<T extends CatalogListingProduct>(products: readonly T[]): CatalogListing<T>[] {
  const visible = products.filter(product => product.visible !== false);
  const result: CatalogListing<T>[] = [];
  const seenProducts = new Set<string>();
  for (const product of visible) {
    if (!product.id || seenProducts.has(product.id)) continue;
    seenProducts.add(product.id);
    const family = getProductFamily(product.id, visible);
    const familyLabel = family?.members.find(member => member.product.id === product.id)?.label || '';
    const seenVariants = new Set<string>();
    const variants = (product.variants || []).filter(variant => {
      if (variant.visible === false || !variant.id || !variant.name?.trim() || seenVariants.has(variant.id)) return false;
      seenVariants.add(variant.id);
      return true;
    });
    const make = (variant?: CatalogListingVariant): CatalogListing<T> => {
      const item: CatalogListing<T> = {
        key: JSON.stringify([product.id, variant?.id || null]),
        product,
        variant,
        title: product.name,
        label: variant?.name || familyLabel,
        image: variant?.image || product.image,
        model3d: variant?.model3d || product.model3d || '',
        technicalSheet: variant?.technicalSheet || product.technicalSheet || '',
        // An unpriced variation must not borrow the principal configuration's price.
        price: variant ? variant.price : product.price,
        availability: variant?.availability || product.availability || '',
        href: '',
      };
      item.href = catalogListingHref(item, `/catalogo/${encodeURIComponent(product.slug)}/`);
      return item;
    };
    const exhaustive = !!product.variantAxes?.length && !!product.variants?.length;
    if (!exhaustive) result.push(make());
    result.push(...variants.map(make));
  }
  return result;
}
