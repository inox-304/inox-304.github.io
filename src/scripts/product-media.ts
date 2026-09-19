import { safeImage, safeModel, type CmsProduct } from '../lib/cms';
import { withBase } from '../lib/paths';
import type { ModelViewerElement } from '@google/model-viewer';

type MediaProduct = Pick<CmsProduct, 'name' | 'image'> & Partial<Pick<CmsProduct, 'id' | 'gallery' | 'model3d' | 'modelPoster'>>;
let viewerModule: Promise<typeof import('@google/model-viewer')> | undefined;
let closeActiveViewer: (() => void) | undefined;

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

  function message(value = '') { status.textContent = value; status.hidden = !value; }
  function resetViewer() {
    revision++;
    window.clearTimeout(timeout);
    viewer?.removeAttribute('src');
    viewer?.remove();
    viewer = undefined;
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
    const model = safeModel(product.model3d || '');
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
      const poster = safeImage(product.modelPoster || product.image);
      if (poster) element.setAttribute('poster', withBase(poster));
      element.addEventListener('load', () => {
        if (request !== revision) return;
        window.clearTimeout(timeout); message(); button.removeAttribute('aria-busy');
        button.firstChild!.textContent = 'Volver a foto ';
        help.hidden = false;
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
    sources = next ? [...new Set([next.image, ...(next.gallery || [])].map(safeImage).filter(Boolean).map(value => withBase(value)))].slice(0, 9) : [];
    const model = next ? safeModel(next.model3d || '') : '';
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
  window.addEventListener('pagehide', resetViewer);
  try { update(JSON.parse(root.dataset.currentProduct ?? root.dataset.initialProduct ?? 'null')); }
  catch { update(null); }
});
