import { categoryNames, cmsProductRoute, contactUrl, formatProductPrice, parseCms, resolveContact, validatePublishedUrl, visibleCmsProducts, type CmsData, type CmsProduct } from '../lib/cms';
import { withBase } from '../lib/paths';
import { getProductStage } from '../lib/product-stage';

type Bootstrap = { config: { catalogUrl: string; contactsUrl: string; settingsUrl: string }; snapshot?: boolean; routes: Record<string, string>; data: CmsData };
const node = document.querySelector<HTMLScriptElement>('#inox-cms-bootstrap');
const payload: Bootstrap | null = node ? JSON.parse(node.textContent || 'null') : null;
let current = payload?.data;
const cardTemplate = document.querySelector<HTMLAnchorElement>('.product-card')?.cloneNode(true) as HTMLAnchorElement | undefined;
const initialDefaultMessage = 'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.';

function route(product: CmsProduct) { return cmsProductRoute(product, payload?.routes || {}); }
function category(product: CmsProduct) { return categoryNames[product.category] || product.category; }
function setText(selector: string, value: string, root: ParentNode = document) { root.querySelectorAll(selector).forEach(element => { element.textContent = value; }); }
function createCard(product: CmsProduct, index: number): HTMLAnchorElement {
  const card = cardTemplate?.cloneNode(true) as HTMLAnchorElement || document.createElement('a');
  if (!cardTemplate) {
    card.className = 'product-card';
    const photo = document.createElement('div'); photo.className = 'product-card-image';
    const number = document.createElement('span'); number.className = 'product-index';
    const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.width = 640; image.height = 520;
    photo.append(number, image);
    const copy = document.createElement('div'); copy.className = 'product-card-info';
    const label = document.createElement('p'); label.className = 'eyebrow';
    const name = document.createElement('h3'); const link = document.createElement('span'); link.className = 'card-link'; link.textContent = 'Explorar equipo ↗';
    copy.append(label, name, link); card.append(photo, copy);
  }
  card.hidden = false;
  card.href = route(product); card.dataset.productId = product.id;
  card.dataset.category = product.category; card.dataset.name = `${product.name} ${product.summary} ${category(product)}`;
  card.classList.toggle('product-cutout', getProductStage(product.image).isCutout);
  card.removeAttribute('data-reveal'); card.removeAttribute('style');
  setText('.product-index', String(index + 1).padStart(2, '0'), card);
  setText('.product-card-info .eyebrow', category(product), card);
  setText('.product-card-info h3', product.name, card);
  const image = card.querySelector('img'); if (image) { image.src = withBase(product.image); image.alt = product.name; image.removeAttribute('srcset'); }
  return card;
}
function fillCards(container: Element, products: CmsProduct[]) {
  const fragment = document.createDocumentFragment(); products.forEach((product, index) => fragment.append(createCard(product, index)));
  container.replaceChildren(fragment);
}

function updateDetail(data: CmsData) {
  const detail = document.querySelector<HTMLElement>('[data-product-detail]'); if (!detail) return;
  const productId = detail.dataset.productDetail || new URLSearchParams(location.search).get('id') || '';
  const product = data.products.find(item => item.id === productId && item.visible);
  const unavailable = detail.querySelector<HTMLElement>('[data-product-unavailable]');
  const grid = detail.querySelector<HTMLElement>('.product-detail-grid');
  const related = detail.querySelector<HTMLElement>('.related-products');
  if (!product) {
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
      stage.classList.toggle('product-studio', profile.isCutout);
      stage.dataset.stageShape = profile.shape;
      stage.style.cssText = profile.style;
      stage.querySelectorAll<HTMLElement>('.studio-backdrop, .studio-pedestal, .equipment-shadow').forEach(element => { element.hidden = !profile.isCutout; });
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
  detail.querySelectorAll<HTMLAnchorElement>('[data-product-quote]').forEach(anchor => {
    anchor.hidden = !contact;
    if (contact) {
      const message = `${contact.message || `Hola ${data.settings.empresa}.`}\nMe interesa ${product.name}. Me gustaría conocer las opciones y recibir una cotización. ${new URL(route(product), location.origin).href}`;
      anchor.href = contactUrl(contact, message); anchor.dataset.contact = contact.id;
    } else anchor.removeAttribute('href');
  });
  const quoteNote = detail.querySelector<HTMLElement>('[data-product-quote-note]'); if (quoteNote) quoteNote.textContent = contact ? 'Consulta medidas, disponibilidad y opciones para tu negocio.' : 'Por el momento no hay un contacto de cotización disponible.';
  const price = formatProductPrice(product);
  const priceNode = detail.querySelector<HTMLElement>('[data-product-price]');
  if (priceNode) { priceNode.textContent = price; priceNode.hidden = !price; }
  const technicalSheet = detail.querySelector<HTMLAnchorElement>('[data-product-technical-sheet]');
  if (technicalSheet) {
    technicalSheet.hidden = !product.technicalSheet;
    if (product.technicalSheet) technicalSheet.href = withBase(product.technicalSheet);
    else technicalSheet.removeAttribute('href');
  }
  const commerce = detail.querySelector<HTMLElement>('[data-product-commerce]'); if (commerce) commerce.hidden = !price && !product.technicalSheet;
  const relatedProducts = visibleCmsProducts(data).filter(item => item.category === product.category && item.id !== product.id).slice(0, 3);
  if (related) { related.hidden = relatedProducts.length === 0; const container = related.querySelector('.product-grid'); if (container) fillCards(container, relatedProducts); }
  document.title = `${product.name} | ${data.settings.empresa}`;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]'); if (description) description.content = product.summary;
  detail.querySelector('[data-product-media]')?.setAttribute('data-current-product', JSON.stringify(product));
  document.dispatchEvent(new CustomEvent('inox:product-updated', { detail: { product } }));
}

function updateContacts(data: CmsData) {
  const primary = resolveContact(data, data.settings.contacto_principal);
  document.querySelectorAll<HTMLElement>('[data-business]').forEach(element => { const key = element.dataset.business || ''; if (Object.hasOwn(data.settings, key)) element.textContent = data.settings[key]; });
  document.querySelectorAll<HTMLElement>('[data-cms-phone]').forEach(element => { element.textContent = primary?.phone || 'Consulta disponibilidad de contacto'; });
  document.querySelectorAll<HTMLAnchorElement>('[data-cms-email]').forEach(element => { element.textContent = primary?.email || ''; if (primary?.email) { element.href = `mailto:${primary.email}`; element.hidden = false; } else { element.removeAttribute('href'); element.hidden = true; } });
  document.querySelectorAll<HTMLAnchorElement>('[data-cms-facebook]').forEach(element => { const url = data.settings.facebook; element.hidden = !url; if (url) element.href = url; else element.removeAttribute('href'); });
  document.querySelectorAll<HTMLAnchorElement>('[data-cms-map]').forEach(element => {
    const address = data.settings.direccion;
    element.hidden = !address;
    if (address) element.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    else element.removeAttribute('href');
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me/"],a[data-cms-whatsapp]').forEach(anchor => {
    if (anchor.hasAttribute('data-product-quote') || anchor.id === 'quote-fallback') return;
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
  const visible = visibleCmsProducts(data);
  document.querySelectorAll('[data-cms-products]').forEach(container => { const kind = container.getAttribute('data-cms-products'); fillCards(container, kind === 'featured' ? visible.filter(product => product.featured) : visible); });
  updateContacts(data); updateDetail(data);
  current = data;
  document.dispatchEvent(new CustomEvent('inox:catalog-updated', { detail: { count: visible.length } }));
}

async function fetchCsv(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  if (!response.ok) throw new Error(`CMS HTTP ${response.status}`);
  const value = await response.text();
  if (/^\s*(?:<!doctype|<html)/i.test(value)) throw new Error('CMS URL returned HTML');
  return value;
}
async function start() {
  if (!payload || !current) return;
  if (payload.snapshot) { apply(current); document.documentElement.dataset.cmsState = 'published'; return; }
  // Generic product routes have no build-time data; known IDs can still use the bundled fallback.
  if (document.querySelector('[data-product-detail=""]')) updateDetail(current);
  const rawUrls = [payload.config.catalogUrl, payload.config.contactsUrl, payload.config.settingsUrl];
  if (rawUrls.every(url => !url)) { document.documentElement.dataset.cmsState = 'unconfigured'; return; }
  const urls = rawUrls.map(validatePublishedUrl);
  if (urls.some(url => !url)) { document.documentElement.dataset.cmsState = 'fallback'; console.warn('INOX CMS: configure all three published Google Sheets CSV URLs. Static content retained.'); return; }
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const [catalogCsv, contactsCsv, settingsCsv] = await Promise.all(urls.map(url => fetchCsv(withBase(url), controller.signal)));
    const data = parseCms(catalogCsv, contactsCsv, settingsCsv);
    apply(data); document.documentElement.dataset.cmsState = 'live';
  } catch (error) {
    document.documentElement.dataset.cmsState = 'fallback';
    console.warn('INOX CMS: current static content retained because live data was unavailable or invalid.', error);
  } finally { window.clearTimeout(timeout); }
}
void start();
