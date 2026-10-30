import { categoryNames, cmsProductRoute, contactUrl, formatAvailability, formatProductPrice, productOriginLabel, productQuoteNote, resolveContact, visibleCmsProducts, type CmsData, type CmsProduct } from '../lib/cms';
import { apiProductRoute, catalogSlug, emptyCmsData, parsePublicCatalog } from '../lib/cms-api';
import { withBase } from '../lib/paths';
import { getProductStage } from '../lib/product-stage';
import { additionalsQuoteSummary, createAdditionalOption, reconcileAdditionalSelection, type AdditionalSelection } from '../lib/product-additionals';
import { catalogSearchText } from '../lib/catalog-controls';
import { catalogFamilyProducts, getProductFamily } from '../lib/product-families';
import { selectHomeFeatured } from '../lib/home-featured';
import { expandedCatalogListings, catalogListingHref, catalogListingSearchText, type CatalogListing } from '../lib/catalog-listings';
import { getCatalogType } from '../lib/catalog-taxonomy';
import { syncCustomization } from './product-customization';
import { parseCooktopConfig, type CooktopConfig } from '../lib/cooktop-config';
import { hasCooktopAsset } from '../lib/cooktop-assets';
import { startCooktopSync, type CooktopSyncStatus } from '../lib/cooktop-sync';
import { renderCooktop } from './cooktop-ui';
import { renderVariantOptions } from './variant-options-ui';
import { parseCartConfig, type CartConfig } from '../lib/cart-config';
import { cartAssetFor } from '../lib/cart-assets';
import { startCartSync, type CartSyncStatus } from '../lib/cart-sync';
import { renderCart } from './cart-ui';
import { catalogEndpoint, readCatalogCache, startCatalogSync, type CatalogSyncStatus } from '../lib/catalog-sync';

type Bootstrap = { mode?: 'api' | 'static'; apiUrl?: string; cooktopOrigin?: string; preview?: boolean; previewProductId?: string; routes: Record<string, string>; data: CmsData };
const node = document.querySelector<HTMLScriptElement>('#inox-cms-bootstrap');
let payload: Bootstrap | null = null;
try { payload = node ? JSON.parse(node.textContent || 'null') : null; } catch { /* An invalid bootstrap is replaced by a fresh public request. */ }
const apiMode = payload?.mode === 'api' || import.meta.env?.PUBLIC_CMS_MODE === 'api';
const publicEndpoint = payload?.preview ? '' : catalogEndpoint(payload?.apiUrl || (apiMode ? '/api/catalog/' : ''), location.origin);
let lastApplied = '';
let lastDetailApplied = '';
let confirmedThisVisit = false;
let syncStatus: CatalogSyncStatus | undefined;
let currentData: CmsData | undefined;
let cooktopSync: ReturnType<typeof startCooktopSync> | undefined;
let cartSync: ReturnType<typeof startCartSync> | undefined;
const verifiedCarts = new Map<string, CartConfig | null>();
// Current-session server decisions take precedence over the published snapshot,
// including an explicit removal. Never share rules between product identities.
const verifiedCooktops = new Map<string, CooktopConfig | null>();
let additionalSelection: AdditionalSelection = { productId: '', ids: [] };
const cardTemplate = document.querySelector<HTMLTemplateElement>('[data-cms-card-template]')?.content.querySelector<HTMLElement>('.product-card') || document.querySelector<HTMLElement>('.product-card');
const initialDefaultMessage = 'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.';
const defaultHero = [...document.querySelectorAll<HTMLElement>('[data-business="hero_title"], [data-business="hero_description"], [data-business="home_text"]')].map(element => ({ element, children: [...element.childNodes].map(child => child.cloneNode(true)) }));

function route(product: CmsProduct) { return apiMode ? apiProductRoute(product) : cmsProductRoute(product, payload?.routes || {}); }
function category(product: CmsProduct) { return categoryNames[product.category] || product.category; }
function setText(selector: string, value: string, root: ParentNode = document) { root.querySelectorAll(selector).forEach(element => { element.textContent = value; }); }
function createCard(product: CmsProduct, index: number, data: CmsData, listing?: CatalogListing<CmsProduct>): HTMLElement {
  const family = listing ? null : getProductFamily(product.id, data.products);
  const title = listing?.title || family?.name || product.name;
  const photoSource = listing?.image || product.image;
  const label = listing?.label || '';
  const target = listing ? catalogListingHref(listing, route(product)) : route(product);
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
    const quote = document.createElement('a'); quote.className = 'button button-chrome button-quote product-card-quote'; quote.dataset.cardQuote = ''; quote.textContent = 'Cotizar ↗'; quote.target = '_blank'; quote.rel = 'noopener noreferrer';
    commerce.append(price, quote); card.append(main, commerce);
  }
  card.hidden = false;
  const main = card.querySelector<HTMLAnchorElement>('.product-card-main'); if (main) main.href = target;
  card.dataset.productId = product.id;
  card.dataset.productType = getCatalogType(product)?.id || '';
  card.dataset.listingKey = listing?.key || product.id;
  card.dataset.variantId = listing?.variant?.id || '';
  card.dataset.category = product.category;
  card.dataset.name = listing ? catalogListingSearchText(listing, category(product)) : family ? [family.name, ...family.members.map(member => `${member.label} ${catalogSearchText(member.product, category(member.product))}`)].join(' ') : catalogSearchText(product, category(product));
  card.dataset.title = [title, label].filter(Boolean).join(' · '); card.dataset.catalogOrder = String(index);
  card.classList.add('product-photo-white');
  card.removeAttribute('data-reveal'); card.removeAttribute('style');
  setText('.product-index', String(index + 1).padStart(2, '0'), card);
  setText('.product-card-info .eyebrow', category(product), card);
  setText('.product-card-info h3', title, card);
  let familyNote = card.querySelector<HTMLElement>('[data-card-family]');
  if (!familyNote) { familyNote = document.createElement('p'); familyNote.className = 'product-card-family'; familyNote.dataset.cardFamily = ''; card.querySelector('.product-card-info h3')?.after(familyNote); }
  familyNote.hidden = !family && !label;
  familyNote.textContent = label || (family ? family.cardSummary || `${family.members.length} ${family.members.length === 1 ? 'modelo disponible' : 'modelos disponibles'}` : '');
  setText('[data-card-link-label]', listing?.variant ? 'Ver esta versión' : family ? family.cardAction || 'Elegir capacidad / modelo' : 'Explorar equipo', card);
  setText('[data-card-code]', product.id, card);
  const image = card.querySelector('img');
  if (image) {
    const source = withBase(photoSource), expectedSource = new URL(source, location.href).href;
    const applyPhoto = (natural?: { width: number; height: number }) => {
      const profile = getProductStage(photoSource, natural);
      image.setAttribute('data-product-photo', ''); image.setAttribute('style', profile.photoStyle);
      image.width = profile.width; image.height = profile.height;
    };
    applyPhoto();
    const loaded = () => {
      if (image.onload !== loaded || image.currentSrc !== expectedSource || !image.naturalWidth || !image.naturalHeight) return;
      applyPhoto({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onload = loaded; image.src = source; image.alt = [title, label].filter(Boolean).join(' · '); image.removeAttribute('srcset');
    if (image.complete) loaded();
  }
  const price = formatProductPrice(listing ? { ...product, price: listing.price } : product);
  const priceNode = card.querySelector<HTMLElement>('[data-card-price]'); if (priceNode) { priceNode.textContent = price; priceNode.hidden = !price; }
  const quote = card.querySelector<HTMLAnchorElement>('[data-card-quote]');
  if (quote) {
    const contact = resolveContact(data, product.contactId);
    quote.hidden = !!price;
    const selectedName = [product.name, label].filter(Boolean).join(' · ');
    quote.setAttribute('aria-label', `Cotizar ${selectedName}`);
    quote.href = contact ? contactUrl(contact, `${contact.message || `Hola ${data.settings.empresa}.`}\nMe interesa ${selectedName}. Me gustaría recibir una cotización. ${new URL(target, location.origin).href}`) : withBase('/contacto/');
    if (contact) quote.target = '_blank'; else quote.removeAttribute('target');
  }
  return card;
}
function fillCards(container: Element, products: CmsProduct[], data: CmsData, expanded = false) {
  const fragment = document.createDocumentFragment();
  if (expanded) expandedCatalogListings(products).forEach((listing, index) => fragment.append(createCard(listing.product, index, data, listing)));
  else products.forEach((product, index) => fragment.append(createCard(product, index, data)));
  container.replaceChildren(fragment);
}

function updateRelatedProducts(detail: HTMLElement, data: CmsData, product: CmsProduct) {
  const related = detail.querySelector<HTMLElement>('.related-products');
  if (!related) return;
  const family = getProductFamily(product.id, data.products);
  const familyIds = new Set(family?.members.map(member => member.product.id) || [product.id]);
  const items = catalogFamilyProducts(visibleCmsProducts(data)).filter(item => item.category === product.category && !familyIds.has(item.id)).slice(0, 3);
  related.hidden = items.length === 0;
  const container = related.querySelector('.product-grid'); if (container) fillCards(container, items, data);
}

function updateDetail(data: CmsData, selectedProductId?: string) {
  const detail = document.querySelector<HTMLElement>('[data-product-detail]'); if (!detail) return;
  const productId = selectedProductId ?? (payload?.previewProductId || detail.dataset.productDetail || new URLSearchParams(location.search).get('id') || '');
  const slug = catalogSlug(location.pathname);
  const product = data.products.find(item => item.visible && (productId ? item.id === productId : item.slug === slug));
  const requestedVariant = new URLSearchParams(location.search).get('variant') || '';
  const previousVariantRequest = detail.dataset.variantRequest;
  // Updating another catalogue item must not reset the active 3D camera, doors,
  // keyboard focus, variant or a customer's in-progress configuration.
  const signature = JSON.stringify({ identity: product?.id || productId || slug, product: product || null, contacts: data.contacts, settings: data.settings, family: product ? getProductFamily(product.id, data.products) : null });
  if (lastDetailApplied === signature && previousVariantRequest === requestedVariant) { if (product) updateRelatedProducts(detail, data, product); updateAvailabilityNotice(); return; }
  lastDetailApplied = signature;
  detail.dataset.variantRequest = requestedVariant;
  cooktopSync?.dispose(); cooktopSync = undefined;
  cartSync?.dispose(); cartSync = undefined;
  const cartConnection = detail.querySelector<HTMLElement>('[data-cart-connection]');
  if (cartConnection) { cartConnection.hidden = true; cartConnection.replaceChildren(); }
  const connection = detail.querySelector<HTMLElement>('[data-cooktop-connection]');
  if (connection) { connection.hidden = true; connection.replaceChildren(); }
  const unavailable = detail.querySelector<HTMLElement>('[data-product-unavailable]');
  const grid = detail.querySelector<HTMLElement>('.product-detail-grid');
  const related = detail.querySelector<HTMLElement>('.related-products');
  if (!product) {
    syncCustomization(detail, '');
    // Keep the requested identity after history navigation, so later polling
    // cannot repopulate this URL with the previously displayed product.
    detail.dataset.productDetail = productId;
    additionalSelection = { productId: '', ids: [] };
    const image = detail.querySelector<HTMLImageElement>('.equipment-image'); if (image) image.onload = null;
    if (unavailable) unavailable.hidden = false;
    if (grid) grid.hidden = true;
    if (related) related.hidden = true;
    detail.querySelectorAll<HTMLAnchorElement>('[data-product-quote],[data-product-inquiry]').forEach(anchor => { anchor.removeAttribute('href'); anchor.hidden = true; });
    document.title = `Equipo no disponible | ${data.settings.empresa}`;
    detail.querySelector('[data-product-media]')?.setAttribute('data-current-product', 'null');
    document.dispatchEvent(new CustomEvent('inox:product-updated', { detail: { product: null } }));
    updateAvailabilityNotice();
    return;
  }
  if (unavailable) unavailable.hidden = true;
  if (grid) grid.hidden = false;
  detail.dataset.productDetail = product.id;
  const family = getProductFamily(product.id, data.products);
  const familyControl = detail.querySelector<HTMLElement>('[data-product-family]');
  const familySelect = detail.querySelector<HTMLSelectElement>('[data-product-family-select]');
  if (familyControl && familySelect) {
    familyControl.hidden = !family;
    familySelect.replaceChildren(...(family?.members || []).map(member => new Option(`${member.label} · ${member.product.supplierModel || member.product.id}`, member.product.id)));
    familySelect.value = product.id;
    setText('[data-product-family-heading]', family?.selectorLabel || 'Capacidad / modelo', detail);
    setText('[data-product-family-label]', (family?.selectorLabel === family?.label ? family?.cardSummary : family?.label) || '', detail);
    const selectedLabel = family?.members.find(member => member.product.id === product.id)?.label;
    setText('[data-product-family-selection]', `${family?.selectorLabel ? selectedLabel : `Modelo ${product.supplierModel || product.id}`} · Código ${product.id}`, detail);
    familySelect.onchange = () => {
      const selected = family?.members.find(member => member.product.id === familySelect.value)?.product;
      if (!selected) return;
      if (!payload?.preview) history.pushState({}, '', route(selected));
      updateDetail(data, selected.id);
    };
  }
  setText('[data-product-name]', product.name, detail);
  setText('[data-product-summary]', product.summary, detail);
  const origin = detail.querySelector<HTMLElement>('[data-product-origin]');
  if (origin) { origin.textContent = productOriginLabel(product); origin.hidden = !origin.textContent; }
  setText('[data-product-category]', category(product), detail);
  setText('[data-product-id-label]', `${data.settings.empresa} / ${product.id}`, detail);
  setText('[data-product-caption]', category(product).toUpperCase(), detail);
  const stage = detail.querySelector<HTMLElement>('.product-detail-photo');
  const image = detail.querySelector<HTMLImageElement>('.equipment-image');
  const showProductPhoto = (photo: string, label: string) => {
    if (!stage || !image) return;
    const source = withBase(photo);
    const expectedSource = new URL(source, location.href).href;
    const applyStage = (natural?: { width: number; height: number }) => {
      const profile = getProductStage(photo, natural);
      image.setAttribute('data-product-photo', ''); image.setAttribute('style', profile.photoStyle);
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
    image.src = source; image.alt = label;
    if (image.complete) loaded();
  };
  showProductPhoto(product.image, product.name);
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
  let configuredSurface = '';
  let configuredCart = '';
  let cartRules: CartConfig | null = null;
  const cartRoot = detail.querySelector<HTMLElement>('[data-cart-root]');
  try { if (product.supplyType === 'manufactured' && product.category === 'linea-caliente' && product.equipmentFamily === 'carritos-comida') cartRules = parseCartConfig(product.cartConfig); } catch { /* Only validated product-specific cart options are shown. */ }
  const syncCartAllowed = !apiMode && !publicEndpoint && !!payload?.cooktopOrigin && !payload.preview && !!cartAssetFor(product.id, product.model3d);
  if (syncCartAllowed && verifiedCarts.has(product.id)) cartRules = verifiedCarts.get(product.id)!;
  let cartStatus: CartSyncStatus | undefined;
  let retryCart: (() => void) | undefined;
  const updateCartConnection = () => {
    if (!cartConnection) return;
    cartConnection.hidden = !!variants?.value || !cartStatus || cartStatus === 'ready';
    if (cartConnection.hidden) return;
    const messages = {
      loading: cartRules?.enabled ? 'Puedes personalizar ahora. Comprobando las últimas opciones del taller…' : 'Cargando equipamiento disponible…',
      slow: cartRules?.enabled ? 'Puedes seguir personalizando. El taller tarda en confirmar las últimas opciones.' : 'El taller está tardando en responder.',
      error: cartRules?.enabled ? 'Puedes seguir personalizando con las opciones publicadas. Tus elecciones se conservan.' : 'No pudimos cargar el equipamiento. Vuelve a intentarlo.',
      disabled: 'El taller ha deshabilitado la personalización de este carrito.', ready: '',
    };
    const message = document.createElement('p'); message.textContent = messages[cartStatus!]; message.setAttribute('role', 'status');
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reintentar conexión'; retry.hidden = cartStatus !== 'error'; retry.onclick = () => retryCart?.();
    cartConnection.replaceChildren(message, retry);
  };
  let cooktopRules: CooktopConfig | null = null;
  try { if (product.supplyType === 'manufactured' && product.category === 'linea-caliente' && product.equipmentFamily === 'cocinas') cooktopRules = parseCooktopConfig(product.cooktopConfig); } catch { /* Invalid rules must never create options. */ }
  const cooktopRoot = detail.querySelector<HTMLElement>('[data-cooktop-root]');
  const cooktopCandidate = product.category === 'linea-caliente' && product.supplyType !== 'distributed' && product.equipmentFamily !== 'carritos-comida';
  const syncAllowed = !apiMode && !publicEndpoint && !!payload?.cooktopOrigin && !payload.preview && cooktopCandidate;
  if (syncAllowed && verifiedCooktops.has(product.id)) cooktopRules = verifiedCooktops.get(product.id)!;
  let connectionState: CooktopSyncStatus | undefined;
  let retryRules: (() => void) | undefined;
  const updateConnection = () => {
    if (!connection) return;
    const kitchen = product.equipmentFamily === 'cocinas' || hasCooktopAsset(product.id) || !!cooktopRules;
    connection.hidden = !!variants?.value || !connectionState || connectionState === 'ready' || !kitchen;
    if (connection.hidden) return;
    const available = !!cooktopRules?.enabled;
    const messages = {
      loading: available ? 'Puedes personalizar ahora. Comprobando las últimas opciones del taller…' : 'Cargando las opciones de personalización…',
      slow: available ? 'El taller está tardando en responder. Puedes seguir personalizando con las opciones publicadas.' : 'El taller está tardando en responder. Las opciones aparecerán aquí cuando termine la conexión.',
      error: available ? 'No pudimos actualizar las opciones. Puedes seguir personalizando; tus cambios se conservan. Confirmaremos la configuración al cotizar.' : 'No pudimos cargar la personalización. Revisa tu conexión y vuelve a intentarlo.',
      disabled: 'Este equipo ya no tiene personalización habilitada por el taller.',
      ready: '',
    };
    let message = connection.querySelector<HTMLElement>('[data-cooktop-connection-message]');
    let retry = connection.querySelector<HTMLButtonElement>('[data-cooktop-retry]');
    if (!message || !retry) {
      message = document.createElement('p'); message.dataset.cooktopConnectionMessage = '';
      message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
      retry = document.createElement('button'); retry.type = 'button'; retry.dataset.cooktopRetry = ''; retry.textContent = 'Reintentar conexión';
      retry.onclick = () => retryRules?.(); connection.replaceChildren(message, retry);
    }
    message.textContent = messages[connectionState!];
    retry.hidden = connectionState !== 'error'; retry.disabled = connectionState !== 'error';
  };
  const updateQuote = () => {
    const variant = product.variants?.find(item => item.id === variants?.value);
    const configuration = family?.selectorLabel ? family.members.find(member => member.product.id === product.id)?.label : '';
    const message = `${contact?.message || `Hola ${data.settings.empresa}.`}\nMe interesa ${product.name} (código ${product.id})${variant ? `, variación ${variant.name}` : ''}.${configuration ? ` ${family!.selectorLabel}: ${configuration}.` : ''} Me gustaría recibir una cotización.${additionalsQuoteSummary(product, additionalSelection)}${configuredSurface}${configuredCart}\n${new URL(catalogListingHref({ variant }, route(product)), location.origin).href}`;
    detail.querySelectorAll<HTMLAnchorElement>('[data-product-inquiry]').forEach(anchor => {
      const selected = `${product.name}${variant ? ` · ${variant.name}` : ''}${configuration ? ` · ${configuration}` : ''}${additionalsQuoteSummary(product, additionalSelection)}${configuredSurface}${configuredCart}`;
      anchor.href = withBase('/contacto/') + '?' + new URLSearchParams({ product_code: product.id, configuration: selected.slice(0, 4000) });
      anchor.hidden = false;
    });
    detail.querySelectorAll<HTMLAnchorElement>('[data-product-quote]').forEach(anchor => {
      anchor.hidden = !contact;
      if (contact) { anchor.href = contactUrl(contact, message); anchor.dataset.contact = contact.id; }
      else anchor.removeAttribute('href');
    });
  };
  const updateCooktop = () => {
    if (!cooktopRoot) return;
    // A different SKU/variant has not inherited approval for this base's modules.
    renderCooktop(cooktopRoot, variants?.value ? null : cooktopRules, product.id, text => { configuredSurface = text; updateConfiguredPrice(); updateQuote(); }, payload?.preview === true, product.model3d);
    updateConnection();
    syncCustomization(detail, product.id, product.supplyType);
  };
  const updateCart = () => {
    if (!cartRoot) return;
    renderCart(cartRoot, variants?.value ? null : cartRules, product.id, text => { configuredCart = text; updateConfiguredPrice(); updateQuote(); }, product.model3d, payload?.preview === true);
    updateCartConnection();
    syncCustomization(detail, product.id, product.supplyType);
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
  const syncCommerce = () => {
    const commerce = detail.querySelector<HTMLElement>('[data-product-commerce]');
    if (!commerce) return;
    const variant = product.variants?.find(item => item.id === variants?.value);
    const amount = variant ? formatProductPrice({ price: variant.price, currency: product.currency, showPrice: product.showPrice }) : price;
    commerce.hidden = !configuredSurface && !configuredCart && !amount
      && !(variant?.technicalSheet || product.technicalSheet)
      && !formatAvailability(variant?.availability || product.availability)
      && !product.additionalCharges?.length;
  };
  const updateConfiguredPrice = () => {
    const configured = !!(configuredSurface || configuredCart);
    const variant = product.variants?.find(item => item.id === variants?.value);
    const amount = variant ? formatProductPrice({ price: variant.price, currency: product.currency, showPrice: product.showPrice }) : price;
    if (priceNode) { priceNode.textContent = configured ? 'A cotizar' : amount; priceNode.hidden = !configured && !amount; }
    if (unit) unit.hidden = configured || !amount || !unit.textContent;
    if (quoteNote) quoteNote.textContent = !contact ? 'Por el momento no hay un contacto de cotización disponible.' : configured ? 'Configuración a cotizar. Confirmaremos el precio y las medidas de las opciones elegidas.' : productQuoteNote(product);
    styleQuote(configured ? '' : amount);
    syncCommerce();
  };
  const availability = detail.querySelector<HTMLElement>('[data-product-availability]');
  if (availability) { availability.textContent = formatAvailability(product.availability); availability.hidden = !availability.textContent; }
  if (variants) {
    const variantLabel = product.supplyType === 'distributed' ? 'Opción del fabricante' : 'Variación';
    setText('[data-product-variant-label]', variantLabel, detail);
    variants.setAttribute('aria-label', variantLabel);
    // A card deep link/history entry selects its exact published variant. Polling
    // the same URL preserves the customer's current selection.
    const selected = variants.dataset.productId === product.id && previousVariantRequest === requestedVariant ? variants.value : requestedVariant;
    variants.dataset.productId = product.id;
    const structured = !!product.variantAxes?.length;
    const options = [...(structured ? [] : [new Option('Configuración principal', '')]), ...(product.variants || []).map(variant => new Option(variant.name, variant.id))];
    variants.replaceChildren(...options);
    variants.value = (product.variants || []).some(item => item.id === selected) ? selected : structured ? product.variants?.[0]?.id || '' : '';
    variants.closest<HTMLElement>('[data-product-variants]')!.hidden = structured || !product.variants?.length;
    const selectVariant = (persistUrl = false) => {
      const variant = product.variants?.find(item => item.id === variants.value);
      if (persistUrl && !payload?.preview) {
        const url = new URL(location.href);
        if (variant) url.searchParams.set('variant', variant.id); else url.searchParams.delete('variant');
        history.replaceState({}, '', url);
        detail.dataset.variantRequest = variant?.id || '';
      }
      showProductPhoto(variant?.image || product.image, variant ? `${product.name} · ${variant.name}` : product.name);
      const selectedPrice = variant ? formatProductPrice({ price: variant.price, currency: product.currency, showPrice: product.showPrice }) : price;
      if (priceNode) { priceNode.textContent = selectedPrice; priceNode.hidden = !selectedPrice; }
      styleQuote(selectedPrice);
      if (unit) unit.hidden = !selectedPrice || !unit.textContent;
      if (availability) { availability.textContent = formatAvailability(variant?.availability || product.availability); availability.hidden = !availability.textContent; }
      const selectedSheet = variant?.technicalSheet || product.technicalSheet;
      const sheetLink = detail.querySelector<HTMLAnchorElement>('[data-product-technical-sheet]');
      if (sheetLink) { sheetLink.href = selectedSheet ? withBase(selectedSheet) : ''; sheetLink.hidden = !selectedSheet; }
      document.dispatchEvent(new CustomEvent('inox:configuration-updated', { detail: { productId: product.id, variant } }));
      updateCooktop();
      updateCart();
      updateQuote();
      syncCommerce();
      syncCustomization(detail, product.id, product.supplyType);
    };
    variants.onchange = () => selectVariant(true); selectVariant();
    renderVariantOptions(detail.querySelector<HTMLElement>('[data-variant-options]'), product, variants.value, id => {
      variants.value = id; selectVariant(true);
      document.dispatchEvent(new CustomEvent('inox:variant-interaction', { detail: { productId: product.id } }));
    });
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
  updateCooktop();
  updateCart();
  if (syncCartAllowed && cartRoot) {
    cartSync = startCartSync({ origin: payload!.cooktopOrigin!, productId: product.id,
      onStatus: status => { cartStatus = status; updateCartConnection(); },
      onConfig: config => {
        verifiedCarts.set(product.id, config);
        const changed = JSON.stringify(cartRules) !== JSON.stringify(config); cartRules = config;
        if (changed) updateCart();
      },
    });
    retryCart = cartSync.retry;
  }
  // The approved published rules work immediately. A failed update never erases them.
  if (syncAllowed && cooktopRoot) {
    cooktopSync = startCooktopSync({
      origin: payload!.cooktopOrigin!, productId: product.id,
      onStatus: status => { connectionState = status; updateConnection(); },
      onConfig: config => {
        verifiedCooktops.set(product.id, config);
        const changed = JSON.stringify(cooktopRules) !== JSON.stringify(config);
        cooktopRules = config;
        // An unchanged background confirmation must not replace focused inputs.
        if (changed) updateCooktop();
      },
    });
    retryRules = cooktopSync.retry;
  }
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
  syncCommerce();
  syncCustomization(detail, product.id, product.supplyType);
  updateRelatedProducts(detail, data, product);
  document.title = `${product.name} | ${data.settings.empresa}`;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]'); if (description) description.content = product.summary;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]'); if (canonical && !payload?.preview) canonical.href = new URL(route(product), location.origin).href;
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
    if (fallback && !form.hasAttribute('data-crm-form')) { fallback.hidden = true; fallback.removeAttribute('href'); }
    const contact = resolveContact(data, data.settings.contacto_formulario);
    form.dataset.whatsapp = contact?.whatsapp || ''; form.dataset.contactMessage = contact?.message || `Hola ${data.settings.empresa}`;
    form.dataset.company = data.settings.empresa;
    if (form.hasAttribute('data-crm-form')) {
      form.dispatchEvent(new CustomEvent('inox:contact-updated'));
    } else {
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (submit) submit.disabled = !contact;
      const status = document.querySelector<HTMLElement>('#form-status'); if (status) status.textContent = contact ? '' : 'Por el momento no hay un contacto disponible para esta consulta.';
    }
  }
}
function apply(data: CmsData) {
  currentData = data;
  const serialized = JSON.stringify(data);
  if (serialized === lastApplied) return;
  const visible = catalogFamilyProducts(visibleCmsProducts(data));
  document.querySelectorAll('[data-cms-products]').forEach(container => {
    const kind = container.getAttribute('data-cms-products');
    const items = kind === 'all' ? visibleCmsProducts(data) : kind === 'home-featured' ? selectHomeFeatured(visibleCmsProducts(data))
      : kind === 'featured' ? visible.filter(product => product.featured || getProductFamily(product.id, data.products)?.members.some(member => member.product.featured)) : visible;
    fillCards(container, items, data, kind === 'all');
  });
  updateContacts(data); updateDetail(data);
  lastApplied = serialized;
  document.dispatchEvent(new CustomEvent('inox:catalog-updated', { detail: { count: visible.length } }));
}

window.addEventListener('popstate', () => {
  if (!currentData || payload?.preview) return;
  const id = new URLSearchParams(location.search).get('id');
  const slug = catalogSlug(location.pathname);
  const selected = currentData.products.find(product => product.visible && (id ? product.id === id : product.slug === slug));
  updateDetail(currentData, id ?? selected?.id ?? '');
});

let successful = false;
let catalogSync: ReturnType<typeof startCatalogSync<CmsData>> | undefined;
function showStatus(message = '', retry = false) {
  const status = document.querySelector<HTMLElement>('[data-cms-status]');
  if (!status) return;
  const text = status.querySelector<HTMLElement>('[data-cms-status-message]');
  const button = status.querySelector<HTMLButtonElement>('[data-cms-retry]');
  if (text) text.textContent = message;
  else status.textContent = message;
  status.hidden = !message;
  if (button) { button.hidden = !retry; button.onclick = () => { void catalogSync?.refresh(); }; }
}
function updateAvailabilityNotice() {
  const detail = document.querySelector<HTMLElement>('[data-product-detail]');
  const notice = detail?.querySelector<HTMLElement>('[data-product-unavailable]');
  if (!notice || notice.hidden) return;
  const pending = !!publicEndpoint && !confirmedThisVisit;
  const failed = syncStatus === 'error';
  const title = pending ? (failed ? 'Aún no pudimos cargar este equipo.' : 'Estamos buscando este equipo en el catálogo.') : 'Este equipo ya no está disponible en el catálogo.';
  const description = pending ? (failed ? 'El servidor tarda en responder. Puedes reintentar sin perder la dirección de este equipo.' : 'La primera conexión puede tardar un momento. La ficha aparecerá aquí en cuanto responda el servidor.') : 'Explora los equipos actuales o consulta con nuestro equipo.';
  setText('h2', title, notice); setText('p', description, notice);
  document.title = `${pending ? 'Cargando equipo' : 'Equipo no disponible'} | ${currentData?.settings.empresa || 'INOX 304'}`;
}
function transportStatus(status: CatalogSyncStatus) {
  syncStatus = status;
  if (status === 'ready') { document.documentElement.dataset.cmsState = 'live'; showStatus(); }
  else if (status === 'error') {
    document.documentElement.dataset.cmsState = successful ? 'stale' : 'unavailable';
    showStatus(successful ? 'No pudimos actualizar. Puedes seguir usando el catálogo disponible; confirmaremos disponibilidad al cotizar.' : 'El servidor no respondió. Puedes volver a intentar cargar el catálogo.', true);
  } else {
    document.documentElement.dataset.cmsState = successful ? 'refreshing' : 'loading';
    showStatus(status === 'slow' ? (successful ? 'Actualizando el catálogo. Puedes seguir explorando y personalizando mientras responde el servidor.' : 'Estamos cargando el catálogo. La primera conexión puede tardar un momento.') : '');
  }
  updateAvailabilityNotice();
}
function start() {
  let serverBootstrapValid = false;
  try {
    if (payload?.data) {
      const data = apiMode ? parsePublicCatalog(payload.data, { preview: payload.preview === true }) : payload.data;
      if (apiMode) { serverBootstrapValid = true; confirmedThisVisit = true; }
      apply(data); successful = apiMode || Boolean(data.products.length || data.contacts.length);
    } else apply(emptyCmsData());
  }
  catch { apply(emptyCmsData()); }
  if (payload?.preview) { document.documentElement.dataset.cmsState = 'preview'; showStatus('Vista previa privada. Los cambios sin publicar solo son visibles aquí.'); return; }
  if (!publicEndpoint) { document.documentElement.dataset.cmsState = 'static'; return; }
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Local storage is optional. */ }
  const feedOrigin = new URL(publicEndpoint).origin;
  const parse = (value: unknown) => parsePublicCatalog(value, feedOrigin === location.origin ? {} : { mediaOrigin: feedOrigin });
  // Django has just rendered an authoritative projection. An older cache must
  // never restore a retired product over that response, including an empty one.
  const cached = serverBootstrapValid ? null : readCatalogCache(publicEndpoint, parse, storage);
  if (cached) { apply(cached); successful = true; }
  catalogSync = startCatalogSync({ endpoint: publicEndpoint, parse, storage, onStatus: transportStatus, onData: data => {
    confirmedThisVisit = true;
    verifiedCooktops.clear(); verifiedCarts.clear();
    apply(data); successful = true; updateAvailabilityNotice();
  } });
  const refresh = () => { if (!document.hidden) void catalogSync?.refresh(); };
  refresh();
  document.addEventListener('inox:catalog-refresh', () => { void refresh(); });
  const interval = window.setInterval(refresh, 60000);
  window.addEventListener('focus', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) catalogSync?.pause();
    else void refresh();
  });
  window.addEventListener('pagehide', event => {
    catalogSync?.pause();
    if (!event.persisted) { window.clearInterval(interval); catalogSync?.dispose(); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
}
start();
