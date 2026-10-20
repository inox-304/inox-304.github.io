import { formatProductPrice, type CmsAdditional, type CmsProduct } from './cms.ts';

export type AdditionalSelection = { productId: string; ids: string[] };

/** Keep choices only while they still belong to the same published product. */
export function reconcileAdditionalSelection(product: Pick<CmsProduct, 'id' | 'additionals'>, previous: AdditionalSelection): AdditionalSelection {
  const selected = new Set(previous.productId === product.id ? previous.ids : []);
  return { productId: product.id, ids: (product.additionals || []).filter(item => selected.has(item.id)).map(item => item.id) };
}

export function additionalUnit(additional: Pick<CmsAdditional, 'chargeUnit' | 'unitLabel'>): string {
  const custom = additional.unitLabel.trim();
  return { unit: 'por unidad', m: 'por metro lineal', m2: 'por m²', custom: /^(por|cada)\s/i.test(custom) ? custom : `por ${custom}` }[additional.chargeUnit];
}

export function additionalRate(additional: CmsAdditional, currency: CmsProduct['currency']): string {
  const price = formatProductPrice({ price: additional.price ?? undefined, currency, showPrice: true });
  return price ? `${price} ${additionalUnit(additional)}` : 'A cotizar';
}

/** Rates with different dimensions are intentionally never added into a total. */
export function additionalsQuoteSummary(product: Pick<CmsProduct, 'id' | 'additionals' | 'currency'>, previous: AdditionalSelection): string {
  const selected = new Set(reconcileAdditionalSelection(product, previous).ids);
  const items = (product.additionals || []).filter(item => selected.has(item.id));
  if (!items.length) return '';
  return `\nAdicionales solicitados:\n${items.map(item => `• ${item.name}: ${additionalRate(item, product.currency)}${item.price === null ? ` (${additionalUnit(item)})` : ''}`).join('\n')}\nCantidades y medidas por confirmar en la cotización.`;
}

/** Catalog labels are always text nodes, never HTML or selector fragments. */
export function createAdditionalOption(document: Document, additional: CmsAdditional, currency: CmsProduct['currency'], checked: boolean): HTMLLabelElement {
  const label = document.createElement('label'); label.className = 'product-extra-option';
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = additional.id; input.checked = checked; input.dataset.productExtra = '';
  const body = document.createElement('span'); body.className = 'product-extra-copy';
  const name = document.createElement('strong'); name.textContent = additional.name;
  const description = document.createElement('span'); description.className = 'product-extra-description'; description.textContent = additional.description; description.hidden = !additional.description;
  const rate = document.createElement('span'); rate.className = 'product-extra-rate'; rate.textContent = additionalRate(additional, currency);
  const unit = document.createElement('span'); unit.className = 'product-extra-unit'; unit.textContent = additionalUnit(additional); unit.hidden = additional.price !== null;
  body.append(name, description, rate, unit); label.append(input, body);
  return label;
}
