import { categoryNames, cmsProductRoute, contactUrl, formatAvailability, formatProductPrice, productOriginLabel, productQuoteNote, resolveContact, visibleCmsProducts, type CmsData, type CmsProduct } from '../lib/cms';
import { apiProductRoute, catalogSlug, emptyCmsData, parsePublicCatalog } from '../lib/cms-api';
import { withBase } from '../lib/paths';
import { getProductStage } from '../lib/product-stage';
import { additionalsQuoteSummary, createAdditionalOption, reconcileAdditionalSelection, type AdditionalSelection } from '../lib/product-additionals';
import { catalogSearchText } from '../lib/catalog-controls';

type Bootstrap = { mode?: 'api' | 'static'; apiUrl?: string; preview?: boolean; previewProductId?: string; routes: Record<string, string>; data: CmsData };
const node = document.querySelector<HTMLScriptElement>('#inox-cms-bootstrap');
let payload: Bootstrap | null = null;
try { payload = node ? JSON.parse(node.textContent || 'null') : null; } catch { /* An invalid bootstrap is replaced by a fresh public request. */ }
const apiMode = payload?.mode === 'api' || import.meta.env?.PUBLIC_CMS_MODE === 'api';
let lastApplied = '';
let additionalSelection: AdditionalSelection = { productId: '', ids: [] };
const cardTemplate = document.querySelector<HTMLTemplateElement>('[data-cms-card-template]')?.content.querySelector<HTMLElement>('.product-card') || document.querySelector<HTMLElement>('.product-card');
const initialDefaultMessage = 'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.';
const defaultHero = [...document.querySelectorAll<HTMLElement>('[data-business="hero_title"], [data-business="hero_description"], [data-business="home_text"]')].map(element => ({ element, children: [...element.childNodes].map(child => child.cloneNode(true)) }));

function route(product: CmsProduct) { return apiMode ? apiProductRoute(product) : cmsProductRoute(product, payload?.routes || {}); }
function category(product: CmsProduct) { return categoryNames[product.category] || product.category; }
function setText(selector: string, value: string, root: ParentNode = document) { root.querySelectorAll(selector).forEach(element => { element.textContent = value; }); }
function createCard(product: CmsProduct, index: number, data: CmsData): HTMLElement {
  const card = cardTemplate?.cloneNode(true) as HTMLElement || document.createElement('article');
  if (!cardTemplate) {
    card.className = 'product-card';
    const photo = document.createElement('div'); photo.className = 'product-card-image';
    const number = document.createElement('span'); number.className = 'product-index';
    const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.width = 640; image.height = 520;
    photo.append(number, image);
    const copy = document.createElement('div'); copy.className = 'product-card-info';
    const label = document.createElement('p'); label.className = 'eyebrow';
    const name = document.createElement('h3'); const link = document.createElement('span'); link.className = 'card-link'; link.textContent = 'Explorar equipo ↗';
    const code = document.createElement('span'); code.className = 'product-card-code'; code.dataset.cardCode = '';
    const meta = document.createElement('div'); meta.className = 'product-card-meta'; meta.append(label, code);
    copy.append(meta, name, link);
    const main = document.createElement('a'); main.className = 'product-card-main'; main.append(photo, copy);
    const commerce = document.createElement('div'); commerce.className = 'product-card-commerce';
    const price = document.createElement('p'); price.className = 'product-card-price'; price.dataset.cardPrice = '';
    const quote = document.createElement('a'); quote.className = 'button button-chrome product-card-quote'; quote.dataset.cardQuote = ''; quote.textContent = 'Cotizar ↗'; quote.target = '_blank'; quote.rel = 'noopener noreferrer';
    commerce.append(price, quote); card.append(main, commerce);
  }
  card.hidden = false;
  const main = card.querySelector<HTMLAnchorElement>('.product-card-main'); if (main) main.href = route(product);
  card.dataset.productId = product.id;
  card.dataset.category = product.category; card.dataset.name = catalogSearchText(product, category(product));
  card.dataset.title = product.name; card.dataset.catalogOrder = String(index);
  card.classList.add('product-photo-white');
  card.removeAttribute('data-reveal'); card.removeAttribute('style');
  setText('.product-index', String(index + 1).padStart(2, '0'), card);
  setText('.product-card-info .eyebrow', category(product), card);
  setText('.product-card-info h3', product.name, card);
  setText('[data-card-code]', product.id, card);
  const image = card.querySelector('img'); if (image) { image.src = withBase(product.image); image.alt = product.name; image.removeAttribute('srcset'); }
  const price = formatProductPrice(product);
  const priceNode = card.querySelector<HTMLElement>('[data-card-price]'); if (priceNode) { priceNode.textContent = price; priceNode.hidden = !price; }
  const quote = card.querySelector<HTMLAnchorElement>('[data-card-quote]');
  if (quote) {
    const contact = resolveContact(data, product.contactId);
    quote.hidden = !!price;
    quote.setAttribute('aria-label', `Cotizar ${product.name}`);
    quote.href = contact ? contactUrl(contact, `${contact.message || `Hola ${data.settings.empresa}.`}\nMe interesa ${product.name}. Me gustaría recibir una cotización. ${new URL(route(product), location.origin).href}`) : withBase('/contacto/');
    if (contact) quote.target = '_blank'; else quote.removeAttribute('target');
  }
  return card;
}
function fillCards(container: Element, products: CmsProduct[], data: CmsData) {
  const fragment = document.createDocumentFragment(); products.forEach((product, index) => fragment.append(createCard(product, index, data)));
  container.replaceChildren(fragment);
}

function updateDetail(data: CmsData) {
  const detail = document.querySelector<HTMLElement>('[data-product-detail]'); if (!detail) return;
  const productId = payload?.previewProductId || detail.dataset.productDetail || new URLSearchParams(location.search).get('id') || '';
  const slug = apiMode ? catalogSlug(location.pathname) : '';
  const product = data.products.find(item => item.visible && (productId ? item.id === productId : item.slug === slug));
  const unavailable = detail.querySelector<HTMLElement>('[data-product-unavailable]');
  const grid = detail.querySelector<HTMLElement>('.product-detail-grid');
  const related = detail.querySelector<HTMLElement>('.related-products');
  if (!product) {
    additionalSelection = { productId: '', ids: [] };
    const image = detail.querySelector<HTMLImageElement>('.equipment-image'); if (image) image.onload = null;
    if (unavailable) unavailable.hidden = false;
    if (grid) grid.hidden = true;
    if (related) related.hidden = true;
    detail.querySelectorAll<HTMLAnchorElement>('[data-product-quote]').forEach(anchor => { anchor.removeAttribute('href'); anchor.hidden = true; });
    document.title = `Equipo no disponible | ${data.settings.empresa}`;
    detail.querySelector('[data-product-media]')?.setAttribute('data-current-product', 'null');
    document.dispatchEvent(new CustomEvent('inox:product-updated', { detail: { product: null } }));
    return;
  }
  if (unavailable) unavailable.hidden = true;
  if (grid) grid.hidden = false;
  setText('[data-product-name]', product.name, detail);
  setText('[data-product-summary]', product.summary, detail);
  const origin = detail.querySelector<HTMLElement>('[data-product-origin]');
  if (origin) { origin.textContent = productOriginLabel(product); origin.hidden = !origin.textContent; }
  setText('[data-product-category]', category(product), detail);
  setText('[data-product-id-label]', `${data.settings.empresa} / ${product.id}`, detail);
  setText('[data-product-caption]', category(product).toUpperCase(), detail);
  const stage = detail.querySelector<HTMLElement>('.product-detail-photo');
  const image = detail.querySelector<HTMLImageElement>('.equipment-image');
  if (stage && image) {
    const source = withBase(product.image);
    const expectedSource = new URL(source, location.href).href;
    const applyStage = (natural?: { width: number; height: number }) => {
      const profile = getProductStage(product.image, natural);
      image.width = profile.width; image.height = profile.height;
    };
    // Clear placeholder geometry before loading a different product or CMS image.
    applyStage();
    const loaded = () => {
      if (image.onload !== loaded || image.currentSrc !== expectedSource || !image.naturalWidth || !image.naturalHeight) return;
      applyStage({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onload = loaded;
    image.removeAttribute('srcset');
    image.src = source; image.alt = product.name;
    if (image.complete) loaded();
  }
  const list = detail.querySelector('[data-product-features]');
  if (list) {
    const featureTemplate = list.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    const items = product.features.map(feature => { const li = featureTemplate?.cloneNode(true) as HTMLElement || document.createElement('li'); const span = li.querySelector('span'); if (span) span.textContent = feature; else li.textContent = feature; return li; });
    list.replaceChildren(...items);
  }
  detail.querySelectorAll<HTMLAnchorElement>('[data-product-category-link]').forEach(anchor => { anchor.href = withBase(`/catalogo/?categoria=${encodeURIComponent(product.category)}`); });
  const contact = resolveContact(data, product.contactId);
  additionalSelection = reconcileAdditionalSelection(product, additionalSelection);
  const variants = detail.querySelector<HTMLSelectElement>('[data-product-variant]');
  const updateQuote = () => {
    const variant = product.variants?.find(item => item.id === variants?.value);
    const message = `${contact?.message || `Hola ${data.settings.empresa}.`}\nMe interesa ${product.name}${variant ? `, variación ${variant.name}` : ''}. Me gustaría recibir una cotización.${additionalsQuoteSummary(product, additionalSelection)}\n${new URL(route(product), location.origin).href}`;
    detail.querySelectorAll<HTMLAnchorElement>('[data-product-quote]').forEach(anchor => {
      anchor.hidden = !contact;
      if (contact) { anchor.href = contactUrl(contact, message); anchor.dataset.contact = contact.id; }
      else anchor.removeAttribute('href');
    });
  };
  const quoteNote = detail.querySelector<HTMLElement>('[data-product-quote-note]'); if (quoteNote) quoteNote.textContent = contact ? productQuoteNote(product) : 'Por el momento no hay un contacto de cotización disponible.';
  const price = formatProductPrice(product);
  const styleQuote = (amount: string) => detail.querySelectorAll<HTMLElement>('[data-product-quote]').forEach(anchor => {
    anchor.classList.toggle('button-chrome', !amount);
    anchor.classList.toggle('button-dark', !!amount);
  });
  styleQuote(price);
  const priceNode = detail.querySelector<HTMLElement>('[data-product-price]');
  if (priceNode) { priceNode.textContent = price; priceNode.hidden = !price; }
  const unit = detail.querySelector<HTMLElement>('[data-product-unit]');
  if (unit) { unit.textContent = product.unitLabel || product.chargeUnit || ''; unit.hidden = !price || !unit.textContent; }
  const availability = detail.querySelector<HTMLElement>('[data-product-availability]');
  if (availability) { availability.textContent = formatAvailability(product.availability); availability.hidden = !availability.textContent; }
  if (variants) {
    const variantLabel = product.supplyType === 'distributed' ? 'Opción del fabricante' : 'Variación';
    setText('[data-product-variant-label]', variantLabel, detail);
    variants.setAttribute('aria-label', variantLabel);
    const selected = variants.dataset.productId === product.id ? variants.value : '';
    variants.dataset.productId = product.id;
    const options = [new Option('Configuración principal', ''), ...(product.variants || []).map(variant => new Option(variant.name, variant.id))];
    variants.replaceChildren(...options);
    variants.value = (product.variants || []).some(item => item.id === selected) ? selected : '';
    variants.closest<HTMLElement>('[data-product-variants]')!.hidden = !product.variants?.length;
    const selectVariant = () => {
      const variant = product.variants?.find(item => item.id === variants.value);
      const selectedPrice = variant ? formatProductPrice({ price: variant.price, currency: product.currency, showPrice: product.showPrice }) : price;
      if (priceNode) { priceNode.textContent = selectedPrice; priceNode.hidden = !selectedPrice; }
      styleQuote(selectedPrice);
      if (unit) unit.hidden = !selectedPrice || !unit.textContent;
      if (availability) { availability.textContent = formatAvailability(variant?.availability || product.availability); availability.hidden = !availability.textContent; }
      const selectedSheet = variant?.technicalSheet || product.technicalSheet;
      const sheetLink = detail.querySelector<HTMLAnchorElement>('[data-product-technical-sheet]');
      if (sheetLink) { sheetLink.href = selectedSheet ? withBase(selectedSheet) : ''; sheetLink.hidden = !selectedSheet; }
      document.dispatchEvent(new CustomEvent('inox:configuration-updated', { detail: { productId: product.id, variant } }));
      updateQuote();
    };
    variants.onchange = selectVariant; selectVariant();
  }
  const extras = detail.querySelector<HTMLElement>('[data-product-extras]');
  const extraOptions = detail.querySelector<HTMLElement>('[data-product-extra-options]');
  const extraSummary = detail.querySelector<HTMLElement>('[data-product-extra-summary]');
  const updateExtraSummary = () => {
    if (!extraSummary) return;
    const count = additionalSelection.ids.length;
    extraSummary.textContent = count ? `${count} ${count === 1 ? 'adicional seleccionado' : 'adicionales seleccionados'}. Se incluirán en tu solicitud de cotización.` : 'Puedes cotizar el equipo con o sin adicionales.';
  };
  if (extras && extraOptions) {
    extras.hidden = !product.additionals?.length;
    extraOptions.replaceChildren(...(product.additionals || []).map(additional => createAdditionalOption(document, additional, product.currency, additionalSelection.ids.includes(additional.id))));
    extraOptions.onchange = () => {
      additionalSelection = reconcileAdditionalSelection(product, { productId: product.id, ids: [...extraOptions.querySelectorAll<HTMLInputElement>('input[data-product-extra]:checked')].map(input => input.value) });
      updateExtraSummary(); updateQuote();
    };
  }
  updateExtraSummary(); updateQuote();
  const charges = detail.querySelector<HTMLElement>('[data-product-charges]');
  if (charges) {
    charges.replaceChildren(...(product.additionalCharges || []).map(charge => {
      const item = document.createElement('li');
      const chargePrice = formatProductPrice({ price: charge.price, currency: product.currency, showPrice: product.showPrice });
      item.textContent = `${charge.name}${chargePrice ? `: ${chargePrice}` : ''}`; return item;
    }));
    charges.closest<HTMLElement>('[data-product-additional]')!.hidden = !charges.childElementCount;
  }
  const technicalSheet = detail.querySelector<HTMLAnchorElement>('[data-product-technical-sheet]');
  if (technicalSheet) {
    const sheet = product.variants?.find(item => item.id === variants?.value)?.technicalSheet || product.technicalSheet;
    technicalSheet.hidden = !sheet;
    if (sheet) technicalSheet.href = withBase(sheet);
    else technicalSheet.removeAttribute('href');
  }
  const commerce = detail.querySelector<HTMLElement>('[data-product-commerce]'); if (commerce) commerce.hidden = !price && !product.technicalSheet && !product.availability && !product.variants?.length && !product.additionalCharges?.length && !product.additionals?.length;
  const relatedProducts = visibleCmsProducts(data).filter(item => item.category === product.category && item.id !== product.id).slice(0, 3);
  if (related) { related.hidden = relatedProducts.length === 0; const container = related.querySelector('.product-grid'); if (container) fillCards(container, relatedProducts, data); }
  document.title = `${product.name} | ${data.settings.empresa}`;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]'); if (description) description.content = product.summary;
  detail.querySelector('[data-product-media]')?.setAttribute('data-current-product', JSON.stringify(product));
  document.dispatchEvent(new CustomEvent('inox:product-updated', { detail: { product } }));
}

function updateContacts(data: CmsData) {
  const primary = resolveContact(data, data.settings.contacto_principal);
  document.querySelectorAll<HTMLElement>('[data-business]').forEach(element => {
    const key = element.dataset.business || '';
    if (key.startsWith('hero_') || key === 'home_text') {
      const custom = data.settings[key];
      if (custom) { element.textContent = custom; element.style.whiteSpace = 'pre-line'; }
      else { const original = defaultHero.find(item => item.element === element); if (original) element.replaceChildren(...original.children.map(child => child.cloneNode(true))); element.style.removeProperty('white-space'); }
    } else if (Object.hasOwn(data.settings, key)) { element.textContent = data.settings[key]; if (element.hasAttribute('data-hide-empty')) element.hidden = !data.settings[key]; }
  });
  document.querySelectorAll<HTMLElement>('[data-cms-phone]').forEach(element => { element.textContent = primary?.phone || 'Consulta disponibilidad de contacto'; });
  document.querySelectorAll<HTMLElement>('[data-business-container]').forEach(element => { element.hidden = !data.settings[element.dataset.businessContainer || '']; });
  document.querySelectorAll<HTMLAnchorElement>('[data-cms-email]').forEach(element => { element.textContent = primary?.email || ''; if (primary?.email) { element.href = `mailto:${primary.email}`; element.hidden = false; } else { element.removeAttribute('href'); element.hidden = true; } });
  document.querySelectorAll<HTMLAnchorElement>('[data-cms-facebook], [data-cms-social]').forEach(element => { const url = data.settings[element.dataset.cmsSocial || 'facebook']; element.hidden = !url; if (url) element.href = url; else element.removeAttribute('href'); });
  document.querySelectorAll<HTMLAnchorElement>('[data-cms-map]').forEach(element => {
    const address = data.settings.direccion;
    element.hidden = !address;
    if (address) element.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    else element.removeAttribute('href');
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me/"],a[data-cms-whatsapp],a[data-contact-setting]').forEach(anchor => {
    if (anchor.hasAttribute('data-product-quote') || anchor.hasAttribute('data-card-quote') || anchor.id === 'quote-fallback') return;
    anchor.dataset.cmsWhatsapp = 'true';
    const role = anchor.dataset.contactSetting;
    const requested = role ? data.settings[role] : anchor.dataset.contact === 'instalaciones' ? data.settings.contacto_instalaciones : anchor.dataset.contact;
    const contact = resolveContact(data, requested);
    if (!anchor.dataset.waMessage) {
      try { anchor.dataset.waMessage = new URL(anchor.href).searchParams.get('text') || initialDefaultMessage; } catch { anchor.dataset.waMessage = initialDefaultMessage; }
    }
    const storedMessage = anchor.dataset.waMessage;
    const message = storedMessage === initialDefaultMessage ? (contact?.message || storedMessage) : storedMessage;
    if (contact) { anchor.href = contactUrl(contact, message); anchor.removeAttribute('aria-disabled'); anchor.removeAttribute('tabindex'); }
    else { anchor.removeAttribute('href'); anchor.setAttribute('aria-disabled', 'true'); anchor.tabIndex = -1; }
  });
  const form = document.querySelector<HTMLFormElement>('#quote-form');
  if (form) {
    const fallback = document.querySelector<HTMLAnchorElement>('#quote-fallback');
    if (fallback) { fallback.hidden = true; fallback.removeAttribute('href'); }
    const contact = resolveContact(data, data.settings.contacto_formulario);
    form.dataset.whatsapp = contact?.whatsapp || ''; form.dataset.contactMessage = contact?.message || `Hola ${data.settings.empresa}`;
    form.dataset.company = data.settings.empresa;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (submit) submit.disabled = !contact;
    const status = document.querySelector<HTMLElement>('#form-status'); if (status) status.textContent = contact ? '' : 'Por el momento no hay un contacto disponible para esta consulta.';
  }
}
function apply(data: CmsData) {
  const serialized = JSON.stringify(data);
  if (serialized === lastApplied) return;
  const visible = visibleCmsProducts(data);
  document.querySelectorAll('[data-cms-products]').forEach(container => { const kind = container.getAttribute('data-cms-products'); fillCards(container, kind === 'featured' ? visible.filter(product => product.featured) : visible, data); });
  updateContacts(data); updateDetail(data);
  lastApplied = serialized;
  document.dispatchEvent(new CustomEvent('inox:catalog-updated', { detail: { count: visible.length } }));
}

let inFlight: AbortController | undefined;
let revision = 0;
let successful = false;
function showStatus(message = '') {
  const status = document.querySelector<HTMLElement>('[data-cms-status]');
  if (status) { status.textContent = message; status.hidden = !message; }
}
async function refresh() {
  if (document.hidden || inFlight || payload?.preview) return;
  if (!successful) document.documentElement.dataset.cmsState = 'loading';
  const controller = new AbortController(); inFlight = controller;
  const request = ++revision;
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    // The public feed is same-origin and cannot redirect a visitor to another service.
    const response = await fetch('/api/catalog/', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Catalog unavailable');
    const body = await response.text();
    if (body.length > 5_000_000) throw new Error('Catalog too large');
    const data = parsePublicCatalog(JSON.parse(body));
    if (request !== revision || controller.signal.aborted) return;
    apply(data); successful = true; showStatus(); document.documentElement.dataset.cmsState = 'live';
  } catch {
    if (request !== revision) return;
    document.documentElement.dataset.cmsState = successful ? 'stale' : 'unavailable';
    showStatus(successful ? 'No se pudo actualizar. Mostramos la última información disponible.' : 'El catálogo no está disponible en este momento. Volveremos a intentar en unos segundos.');
  } finally { window.clearTimeout(timeout); if (inFlight === controller) inFlight = undefined; }
}
function start() {
  if (!apiMode) { if (payload?.data) { apply(payload.data); document.documentElement.dataset.cmsState = 'static'; } return; }
  try { if (payload?.data) { const data = parsePublicCatalog(payload.data, { preview: payload.preview === true }); apply(data); successful = Boolean(data.products.length || data.contacts.length); } else apply(emptyCmsData()); }
  catch { apply(emptyCmsData()); }
  if (payload?.preview) { document.documentElement.dataset.cmsState = 'preview'; showStatus('Vista previa privada. Los cambios sin publicar solo son visibles aquí.'); return; }
  void refresh();
  document.addEventListener('inox:catalog-refresh', () => { void refresh(); });
  window.setInterval(() => { void refresh(); }, 30000);
  window.addEventListener('focus', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { revision++; inFlight?.abort(); inFlight = undefined; }
    else void refresh();
  });
  window.addEventListener('pagehide', () => { revision++; inFlight?.abort(); inFlight = undefined; });
}
start();
