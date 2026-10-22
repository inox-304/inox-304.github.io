import { safeImage, safeModel, safePreviewAsset, type CmsProduct } from '../lib/cms';
import { withBase } from '../lib/paths';
import type { ModelViewerElement } from '@google/model-viewer';

type MediaProduct = Pick<CmsProduct, 'name' | 'image'> & Partial<Pick<CmsProduct, 'id' | 'gallery' | 'model3d' | 'modelPoster' | 'variants' | 'doorAnimation'>>;
let viewerModule: Promise<typeof import('@google/model-viewer')> | undefined;
let closeActiveViewer: (() => void) | undefined;
let privatePreview = false;
try { privatePreview = JSON.parse(document.querySelector('#inox-cms-bootstrap')?.textContent || 'null')?.preview === true; } catch { /* Public asset validation remains active. */ }
const imageUrl = (value: string) => safePreviewAsset(value, safeImage, privatePreview);
const modelUrl = (value: string) => safePreviewAsset(value, safeModel, privatePreview);

function loadViewer() {
  // This import and all model downloads occur only after an explicit 360° click.
  viewerModule ||= import('@google/model-viewer').then(module => {
    module.ModelViewerElement.modelCacheSize = 0;
    module.ModelViewerElement.dracoDecoderLocation = withBase('/vendor/model-viewer/draco/');
    module.ModelViewerElement.ktx2TranscoderLocation = withBase('/vendor/model-viewer/basis/');
    return module;
  }).catch(error => { viewerModule = undefined; throw error; });
  return viewerModule;
}

document.querySelectorAll<HTMLElement>('[data-product-media]').forEach(root => {
  const toolbar = root.querySelector<HTMLElement>('[data-media-toolbar]')!;
  const photos = root.querySelector<HTMLElement>('[data-photo-options]')!;
  const gallery = root.querySelector<HTMLElement>('[data-gallery-photo]')!;
  const galleryImage = root.querySelector<HTMLImageElement>('[data-gallery-image]')!;
  const host = root.querySelector<HTMLElement>('[data-model-host]')!;
  const button = root.querySelector<HTMLButtonElement>('[data-show-model]')!;
  const help = root.querySelector<HTMLElement>('[data-model-help]')!;
  const status = root.querySelector<HTMLElement>('[data-media-status]')!;
  let product: MediaProduct | null = null;
  let sources: string[] = [];
  let selectedPhoto = 0;
  let revision = 0;
  let timeout: number | undefined;
  let viewer: ModelViewerElement | undefined;
  let selectedVariant: NonNullable<CmsProduct['variants']>[number] | undefined;
  let doorFrame: number | undefined;
  const doors = document.createElement('button');
  doors.type = 'button'; doors.className = 'product-view-button'; doors.hidden = true;
  doors.textContent = 'Abrir puertas'; doors.setAttribute('aria-pressed', 'false');
  toolbar.append(doors);

  function configureViewer() {
    if (!viewer || !product) return;
    if (doorFrame !== undefined) cancelAnimationFrame(doorFrame);
    const material = selectedVariant?.materialVariant || '';
    viewer.variantName = material && viewer.availableVariants.includes(material) ? material : null;
    const animation = selectedVariant?.doorAnimation || product.doorAnimation || '';
    doors.hidden = !animation || !viewer.availableAnimations.includes(animation);
    doors.setAttribute('aria-pressed', 'false'); doors.textContent = 'Abrir puertas';
    if (!doors.hidden) { viewer.animationName = animation; viewer.pause(); viewer.currentTime = 0; }
  }
  doors.addEventListener('click', () => {
    if (!viewer || doors.hidden) return;
    const opening = doors.getAttribute('aria-pressed') !== 'true';
    viewer.pause();
    if (doorFrame !== undefined) cancelAnimationFrame(doorFrame);
    const element = viewer, start = element.currentTime, target = opening ? element.duration : 0;
    const began = performance.now();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
    const step = (now: number) => {
      if (viewer !== element) return;
      const progress = duration ? Math.min(1, (now - began) / duration) : 1;
      element.currentTime = start + (target - start) * (progress * progress * (3 - 2 * progress));
      if (progress < 1) doorFrame = requestAnimationFrame(step);
    };
    doorFrame = requestAnimationFrame(step);
    doors.setAttribute('aria-pressed', String(opening)); doors.textContent = opening ? 'Cerrar puertas' : 'Abrir puertas';
  });

  function message(value = '') { status.textContent = value; status.hidden = !value; }
  function resetViewer() {
    revision++;
    window.clearTimeout(timeout);
    if (doorFrame !== undefined) cancelAnimationFrame(doorFrame);
    viewer?.removeAttribute('src');
    viewer?.remove();
    viewer = undefined;
    doors.hidden = true;
    host.replaceChildren(); host.hidden = true; help.hidden = true;
    message();
    button.setAttribute('aria-pressed', 'false'); button.removeAttribute('aria-busy');
    button.firstChild!.textContent = 'Ver 360° ';
    if (closeActiveViewer === resetViewer) closeActiveViewer = undefined;
  }
  function selectPhoto(index: number) {
    resetViewer(); message(); selectedPhoto = index;
    gallery.hidden = index === 0;
    galleryImage.onload = null; galleryImage.onerror = null;
    if (index > 0 && product) {
      const source = sources[index];
      const expected = new URL(source, location.href).href;
      galleryImage.alt = `${product.name}, vista ${index + 1}`;
      message('Cargando fotografía…');
      galleryImage.onload = () => { if (galleryImage.currentSrc === expected) message(); };
      galleryImage.onerror = () => { if (galleryImage.currentSrc === expected) { gallery.hidden = true; message('No se pudo cargar esta vista. Puedes seguir consultando la foto principal.'); } };
      galleryImage.src = source;
      if (galleryImage.complete && galleryImage.naturalWidth) message();
    } else galleryImage.removeAttribute('src');
    photos.querySelectorAll<HTMLButtonElement>('button').forEach((photo, position) => photo.setAttribute('aria-pressed', String(position === index)));
  }
  async function showModel() {
    if (!product) return;
    const model = modelUrl(selectedVariant?.model3d || product.model3d || '');
    if (!model) return;
    if (button.getAttribute('aria-pressed') === 'true') { selectPhoto(selectedPhoto); return; }
    closeActiveViewer?.(); resetViewer(); closeActiveViewer = resetViewer;
    galleryImage.onload = null; galleryImage.onerror = null;
    const request = revision;
    button.setAttribute('aria-pressed', 'true'); button.setAttribute('aria-busy', 'true');
    button.firstChild!.textContent = 'Cargando 360° ';
    message('Preparando vista 360°…');
    function failed() {
      if (request !== revision) return;
      resetViewer(); message('No se pudo abrir la vista 360°. La fotografía sigue disponible; pulsa Ver 360° para reintentar.');
    }
    timeout = window.setTimeout(failed, 45000);
    try {
      await loadViewer();
      if (request !== revision || !product) return;
      const element = document.createElement('model-viewer');
      viewer = element;
      element.setAttribute('alt', `Modelo 3D de ${product.name}. Usa las flechas para girar y + o − para acercar o alejar.`);
      element.setAttribute('camera-controls', '');
      element.setAttribute('touch-action', 'pan-y');
      element.setAttribute('loading', 'eager');
      element.setAttribute('reveal', 'auto');
      element.setAttribute('shadow-intensity', '1');
      element.setAttribute('shadow-softness', '0.8');
      element.setAttribute('environment-image', 'neutral');
      element.setAttribute('interaction-prompt', 'none');
      element.setAttribute('camera-orbit', '35deg 72deg auto');
      element.setAttribute('min-camera-orbit', 'auto 10deg auto');
      element.setAttribute('max-camera-orbit', 'auto 90deg auto');
      const poster = imageUrl(product.modelPoster || product.image);
      if (poster) element.setAttribute('poster', withBase(poster));
      element.addEventListener('load', () => {
        if (request !== revision) return;
        window.clearTimeout(timeout); message(); button.removeAttribute('aria-busy');
        button.firstChild!.textContent = 'Volver a foto ';
        help.hidden = false;
        configureViewer();
        photos.querySelectorAll('button').forEach(photo => photo.setAttribute('aria-pressed', 'false'));
        element.focus();
      }, { once: true });
      element.addEventListener('error', event => { console.warn('INOX 360: model loading failed.', event instanceof CustomEvent ? event.detail?.type : event.type); failed(); }, { once: true });
      host.append(element); host.hidden = false;
      element.src = withBase(model);
    } catch (error) { console.warn('INOX 360: viewer initialization failed.', error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error'); failed(); }
  }
  function update(next: MediaProduct | null) {
    resetViewer(); message(); product = next; selectedPhoto = 0;
    galleryImage.onload = null; galleryImage.onerror = null; galleryImage.removeAttribute('src'); gallery.hidden = true;
    sources = next ? [...new Set([next.image, ...(next.gallery || [])].map(imageUrl).filter(Boolean).map(value => withBase(value)))].slice(0, 9) : [];
    const variantSelect = document.querySelector<HTMLSelectElement>('[data-product-variant]');
    selectedVariant = next?.variants?.find(item => item.id === variantSelect?.value);
    const model = next ? modelUrl(selectedVariant?.model3d || next.model3d || '') : '';
    button.hidden = !model; toolbar.hidden = !model && sources.length < 2;
    photos.replaceChildren();
    if (!toolbar.hidden) sources.forEach((_source, index) => {
      const photo = document.createElement('button');
      photo.type = 'button'; photo.className = 'product-view-button'; photo.textContent = index === 0 ? 'Foto principal' : `Vista ${index + 1}`;
      photo.setAttribute('aria-pressed', String(index === 0));
      photo.addEventListener('click', () => selectPhoto(index)); photos.append(photo);
    });
  }
  button.addEventListener('click', () => { void showModel(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && viewer) { selectPhoto(selectedPhoto); button.focus(); } });
  document.addEventListener('inox:product-updated', event => {
    update((event as CustomEvent<{ product: MediaProduct | null }>).detail.product);
  });
  document.addEventListener('inox:configuration-updated', event => {
    const detail = (event as CustomEvent<{ productId: string; variant?: typeof selectedVariant }>).detail;
    if (!product || product.id !== detail.productId) return;
    const wasOpen = !!viewer;
    const oldModel = modelUrl(selectedVariant?.model3d || product.model3d || '');
    selectedVariant = detail.variant;
    const nextModel = modelUrl(selectedVariant?.model3d || product.model3d || '');
    button.hidden = !nextModel; toolbar.hidden = !nextModel && sources.length < 2;
    if (oldModel !== nextModel) { resetViewer(); if (wasOpen && nextModel) void showModel(); }
    else configureViewer();
  });
  window.addEventListener('pagehide', resetViewer);
  try { update(JSON.parse(root.dataset.currentProduct ?? root.dataset.initialProduct ?? 'null')); }
  catch { update(null); }
});
