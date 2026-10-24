(() => {
  'use strict';

  const form = document.getElementById('product_form');
  const flow = document.getElementById('inox-product-flow');
  if (!form || !flow) return;

  const steps = [
    { id: 'details', title: 'Datos del equipo', description: 'Ponle un nombre, elige su línea y describe qué lo hace diferente.' },
    { id: 'media', title: 'Fotos y archivos', description: 'Selecciona los archivos que tengas listos. Puedes añadir o reemplazar los demás más adelante.' },
    { id: 'variants', title: 'Variaciones', description: 'Prepara capacidades, tamaños o versiones completas de este equipo. Cada opción puede cambiar su foto, modelo 3D y ficha. Activa solo las opciones revisadas.' },
    { id: 'additionals', title: 'Adicionales', description: 'Añade las opciones que el cliente puede solicitar con este equipo. Cada una puede tener su tarifa por unidad o medida, o quedar a cotizar. Los costos internos son privados; la ubicación en el modelo 3D se definirá con tus diseños.' },
    { id: 'configurator', title: 'Configurador', description: 'Define las posiciones, energías y módulos compatibles de esta cocina. Puedes conservarlo deshabilitado para revisarlo antes de ofrecerlo.' },
    { id: 'cart', title: 'Personalización del carrito', description: 'Aprueba qué módulos compatibles se pueden incluir o retirar. Define su selección inicial y revisa el modelo antes de habilitarlo.' },
    { id: 'pricing', title: 'Precio', description: 'Define cómo se cobra este equipo y si mostrarás su precio al público.' },
    { id: 'review', title: 'Revisar y guardar', description: 'Revisa lo que has preparado y decide si lo conservas como borrador o lo publicas.' },
  ].filter(step => !['configurator', 'cart'].includes(step.id) || form.querySelector(`.inox-step-${step.id}`));
  const sections = [];
  const seen = new Set();
  form.querySelectorAll('.inox-step').forEach(section => {
    const step = steps.find(item => section.classList.contains(`inox-step-${item.id}`));
    const container = section.closest('.inline-group') || section;
    if (!step || seen.has(container)) return;
    seen.add(container);
    container.dataset.inoxStep = step.id;
    sections.push(container);
  });
  // Keep the standard form intact if its fieldsets have not been configured.
  if (!sections.some(section => section.dataset.inoxStep === 'details')) return;

  const heading = document.getElementById('inox-current-step');
  const description = document.getElementById('inox-step-description');
  const progress = document.getElementById('inox-step-progress');
  const actions = document.getElementById('inox-step-actions');
  const previous = document.getElementById('inox-step-previous');
  const next = document.getElementById('inox-step-next');
  const showAll = document.getElementById('inox-show-all');
  const navButtons = [...flow.querySelectorAll('[data-inox-go-step]')];
  navButtons.forEach(button => { const number = button.querySelector('span'); if (number) number.textContent = String(steps.findIndex(step => step.id === button.dataset.inoxGoStep) + 1); });
  flow.style.setProperty('--inox-step-count', String(steps.length));
  let currentIndex = 0;
  let allVisible = false;

  const revealDetails = element => {
    let parent = element.parentElement;
    while (parent && parent !== form) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
  };

  function showStep(index, { focus = false, showEverything = false } = {}) {
    currentIndex = Math.max(0, Math.min(steps.length - 1, index));
    allVisible = showEverything;
    const step = steps[currentIndex];
    sections.forEach(section => {
      section.hidden = !allVisible && section.dataset.inoxStep !== step.id;
    });
    navButtons.forEach(button => {
      if (!allVisible && button.dataset.inoxGoStep === step.id) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    heading.textContent = allVisible ? 'Todos los apartados' : step.title;
    description.textContent = allVisible ? 'Edita libremente y usa los botones de guardar cuando hayas terminado.' : step.description;
    progress.textContent = allVisible ? 'Vista completa' : `Paso ${currentIndex + 1} de ${steps.length}`;
    showAll.setAttribute('aria-pressed', String(allVisible));
    showAll.textContent = allVisible ? 'Volver a los pasos' : 'Ver todo';
    previous.hidden = currentIndex === 0 || allVisible;
    next.hidden = currentIndex === steps.length - 1 || allVisible;
    actions.hidden = allVisible;
    updateSummary();
    if (focus) heading.focus();
  }

  navButtons.forEach(button => button.addEventListener('click', () => {
    showStep(steps.findIndex(step => step.id === button.dataset.inoxGoStep), { focus: true });
  }));
  previous.addEventListener('click', () => showStep(currentIndex - 1, { focus: true }));
  next.addEventListener('click', () => showStep(currentIndex + 1, { focus: true }));
  showAll.addEventListener('click', () => showStep(currentIndex, { focus: true, showEverything: !allVisible }));

  const namedInput = name => form.elements.namedItem(name);
  const valueOf = name => {
    const input = namedInput(name);
    return input && typeof input.value === 'string' ? input.value.trim() : '';
  };
  const mediaFields = [
    { key: 'image', input: 'image_upload', asset: 'image_asset', url: 'image', image: true },
    { key: 'technical', input: 'technical_upload', asset: 'technical_asset', url: 'technical_sheet' },
    { key: 'model', input: 'model_upload', asset: 'model_asset', url: 'model_3d' },
    { key: 'poster', input: 'poster_upload', asset: 'poster_asset', url: 'model_poster', image: true },
  ];
  const uploadCards = new Map();

  function mediaState(field) {
    const input = namedInput(field.input);
    const file = input && input.files && input.files[0];
    if (file) return { text: `Seleccionado: ${file.name}`, state: 'selected', file };
    const asset = valueOf(field.asset);
    const url = valueOf(field.url);
    if (asset || url) {
      const initial = uploadCards.get(input);
      const changed = initial && (asset !== initial.initialAsset || url !== initial.initialUrl);
      return { text: changed ? 'Elegido · pendiente de guardar' : 'Guardado', state: changed ? 'selected' : 'saved' };
    }
    return { text: 'Pendiente · puedes añadirlo después', state: 'pending' };
  }

  function addUploadCard(input, field) {
    if (uploadCards.has(input) || input.closest('.empty-form')) return;
    const row = input.closest('.form-row');
    if (!row) return;
    row.classList.add('inox-upload-card');
    const status = document.createElement('p');
    status.className = 'inox-upload-status';
    status.setAttribute('role', 'status');
    const preview = field.image ? document.createElement('img') : null;
    if (preview) {
      preview.className = 'inox-upload-preview';
      preview.alt = 'Vista previa del archivo seleccionado, todavía sin guardar';
      preview.hidden = true;
      row.append(preview);
    }
    row.append(status);
    uploadCards.set(input, {
      field, row, status, preview, objectUrl: null, file: null,
      initialAsset: valueOf(field.asset), initialUrl: valueOf(field.url),
    });
  }

  function enhanceUploads() {
    mediaFields.forEach(field => {
      const input = namedInput(field.input);
      if (input instanceof HTMLInputElement && input.type === 'file') addUploadCard(input, field);
    });
    form.querySelectorAll('input[type="file"][name$="-upload"]').forEach(input => {
      const prefix = input.name.slice(0, -'upload'.length);
      addUploadCard(input, { input: input.name, asset: `${prefix}asset`, url: `${prefix}url`, image: true });
    });
    form.querySelectorAll('input[type="file"][name^="variants-"][name$="-image_upload"]').forEach(input => {
      const prefix = input.name.slice(0, -'image_upload'.length);
      addUploadCard(input, { input: input.name, asset: `${prefix}image_asset`, url: '', image: true });
    });
    updateUploadCards();
  }

  function updateUploadCards() {
    uploadCards.forEach((card, input) => {
      if (!form.contains(input)) {
        if (card.objectUrl) URL.revokeObjectURL(card.objectUrl);
        uploadCards.delete(input);
        return;
      }
      // Django renumbers remaining inline controls when a new row is removed.
      if (input.name.endsWith('-upload')) {
        const prefix = input.name.slice(0, -'upload'.length);
        card.field = { ...card.field, input: input.name, asset: `${prefix}asset`, url: `${prefix}url` };
      } else if (input.name.startsWith('variants-') && input.name.endsWith('-image_upload')) {
        const prefix = input.name.slice(0, -'image_upload'.length);
        card.field = { ...card.field, input: input.name, asset: `${prefix}image_asset`, url: '' };
      }
      const status = mediaState(card.field);
      if (card.status.textContent !== status.text) card.status.textContent = status.text;
      card.row.dataset.uploadState = status.state;
      const nextFile = status.file || null;
      if (card.preview && nextFile !== card.file) {
        if (card.objectUrl) URL.revokeObjectURL(card.objectUrl);
        card.objectUrl = null;
        card.preview.hidden = true;
        card.preview.removeAttribute('src');
        card.file = nextFile;
        // Preview only selected raster images, never external URLs or SVG files.
        if (nextFile && /^image\/(jpeg|png|webp|avif)$/.test(nextFile.type) && nextFile.size <= 8 * 1024 * 1024) {
          card.objectUrl = URL.createObjectURL(nextFile);
          card.preview.onload = () => { card.preview.hidden = false; };
          card.preview.onerror = () => { card.preview.hidden = true; };
          card.preview.src = card.objectUrl;
        }
      }
    });
  }

  const setSummary = (key, text) => {
    const target = form.querySelector(`[data-inox-summary="${key}"]`);
    if (target) target.textContent = text;
  };
  function countInlineRows(prefixName, fieldName) {
    return [...form.querySelectorAll(`input[name^="${prefixName}-"][name$="-${fieldName}"]`)].filter(input => {
      if (input.closest('.empty-form') || !input.value.trim()) return false;
      const prefix = input.name.slice(0, -(fieldName.length));
      return !namedInput(`${prefix}DELETE`)?.checked;
    }).length;
  }
  function updateSummary() {
    setSummary('name', valueOf('name') || 'Sin nombre');
    const category = namedInput('category');
    setSummary('category', category && category.value ? category.selectedOptions?.[0]?.textContent || category.value : 'Por elegir');
    mediaFields.forEach(field => setSummary(field.key, mediaState(field).text));
    const variants = countInlineRows('variants', 'name');
    setSummary('variants', variants ? `${variants} ${variants === 1 ? 'variación' : 'variaciones'}` : 'Sin variaciones');
    const additionals = countInlineRows('additionals', 'name');
    setSummary('additionals', additionals ? `${additionals} ${additionals === 1 ? 'adicional preparado' : 'adicionales preparados'}` : 'Sin adicionales');
    try {
      const config = JSON.parse(valueOf('cooktop_config') || '{}');
      setSummary('configurator', config.kind === 'cooktop' ? `${config.enabled ? 'Habilitado' : 'Borrador deshabilitado'} · ${config.layouts.length} distribución(es)` : 'Sin configurador');
    } catch { setSummary('configurator', 'Revisa la configuración antes de guardar'); }
    const cartModules = [...form.querySelectorAll('input[name^="cart_config-"][name$="-allowed"]')].filter(input => input.checked).length;
    setSummary('cart', cartModules ? `${namedInput('cart_config-enabled')?.checked ? 'Habilitado' : 'Borrador deshabilitado'} · ${cartModules} módulo(s)` : 'Sin personalización del carrito');
    const gallery = [...uploadCards.entries()].filter(([input, card]) => {
      if (!input.name.endsWith('-upload')) return false;
      const prefix = input.name.slice(0, -'upload'.length);
      return form.contains(input) && !namedInput(`${prefix}DELETE`)?.checked && mediaState(card.field).state !== 'pending';
    }).length;
    setSummary('gallery', gallery ? `${gallery} ${gallery === 1 ? 'foto' : 'fotos'}` : 'Sin fotos adicionales');
    const published = namedInput('is_published')?.checked;
    const active = namedInput('is_active')?.checked;
    setSummary('publication', published && active ? 'Visible en el catálogo al guardar' : published ? 'Oculto: equipo inactivo' : 'Borrador · no se mostrará en el catálogo');
  }

  form.addEventListener('change', () => { updateUploadCards(); updateSummary(); });
  form.addEventListener('input', updateSummary);
  document.addEventListener('formset:added', () => { enhanceUploads(); updateSummary(); });
  document.addEventListener('formset:removed', () => { updateUploadCards(); updateSummary(); });
  window.addEventListener('pagehide', () => {
    uploadCards.forEach(card => { if (card.objectUrl) URL.revokeObjectURL(card.objectUrl); });
  });

  // A browser validation error must never target a field inside a hidden step.
  form.addEventListener('invalid', event => {
    const section = event.target.closest('[data-inox-step]');
    if (!section) return;
    showStep(steps.findIndex(step => step.id === section.dataset.inoxStep));
    revealDetails(event.target);
  }, true);

  const errors = sections.filter(section => section.querySelector('.errorlist, .errors'));
  errors.forEach(section => {
    section.querySelectorAll('.errorlist, .errors').forEach(revealDetails);
    const button = navButtons.find(item => item.dataset.inoxGoStep === section.dataset.inoxStep);
    if (button) {
      button.classList.add('inox-step-has-errors');
      button.setAttribute('aria-label', `${steps.find(step => step.id === section.dataset.inoxStep).title}: hay errores que corregir`);
    }
  });

  enhanceUploads();
  flow.hidden = false;
  form.classList.add('inox-editor-enhanced');
  const firstError = errors[0];
  showStep(firstError ? steps.findIndex(step => step.id === firstError.dataset.inoxStep) : 0);
})();
