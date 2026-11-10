/* Private receipt reader: photos stay in memory until the ordinary form POST. */
const root = document.querySelector('[data-receipt-reader]');

if (root) {
  const find = (name) => root.querySelector(`[data-receipt-${name}]`);
  const form = find('form');
  const fileInput = form.elements.document;
  const reviewed = form.elements.reviewed;
  const image = find('image');
  const status = find('status');
  const readButton = find('read');
  const cancelButton = find('cancel');
  const progress = find('progress');
  const saveButton = find('save');
  const fields = ['amount', 'currency', 'occurred_on', 'reference', 'description'];
  const edited = new Set(fields.filter((key) => form.elements[key].value));
  const proposed = new Map();
  let imageUrl = '';
  let originalImage = null;
  let angle = 0;
  let ready = false;
  let worker = null;
  let workerPromise = null;
  let libraryPromise = null;
  let job = 0;
  let engineGeneration = 0;
  let busy = false;
  let dirty = false;
  let submitting = false;
  let timeout;

  // All OCR assets must be served by this same panel, even if configuration is wrong.
  function assetUrl(value) {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Invalid local OCR asset');
    }
    return url.href;
  }
  function announce(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
  }
  function setBusy(value) {
    busy = value;
    readButton.disabled = value || !ready;
    readButton.textContent = value ? 'Leyendo…' : 'Volver a leer foto';
    cancelButton.hidden = !value;
    progress.hidden = !value;
    find('rotate').disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  function invalidateReview() {
    reviewed.checked = false;
    dirty = true;
  }
  function clearSuggestions() {
    for (const key of fields) {
      const field = form.elements[key];
      if (proposed.has(key) && !edited.has(key) && field.value === proposed.get(key)) field.value = '';
      field.classList.remove('receipt-suggested');
      field.closest('.fin-field').querySelector('.receipt-evidence')?.remove();
    }
    proposed.clear();
    find('warnings').replaceChildren();
    find('warnings').hidden = true;
    find('text').textContent = '';
    find('text-section').hidden = true;
  }
  function stop() {
    job += 1;
    engineGeneration += 1;
    clearTimeout(timeout);
    const old = worker;
    worker = null;
    workerPromise = null;
    if (old) old.terminate().catch(() => {});
    setBusy(false);
  }
  function discardImage() {
    stop();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = '';
    originalImage = null;
    ready = false;
    image.removeAttribute('src');
    find('large-image').removeAttribute('src');
    find('preview').hidden = true;
    readButton.disabled = true;
    readButton.textContent = 'Leer foto';
  }
  function loadLibrary() {
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = assetUrl(root.dataset.libraryUrl);
      script.async = true;
      script.onload = () => globalThis.Tesseract?.createWorker ? resolve(globalThis.Tesseract) : reject(new Error('Reader unavailable'));
      script.onerror = () => { script.remove(); libraryPromise = null; reject(new Error('Reader load failed')); };
      document.head.append(script);
    });
    return libraryPromise;
  }
  async function getWorker(token) {
    if (worker) return worker;
    if (!workerPromise) workerPromise = (async () => {
      const generation = engineGeneration;
      const library = await loadLibrary();
      if (token !== job) return null;
      const created = await library.createWorker(['spa', 'eng'], 1, {
        workerPath: assetUrl(root.dataset.workerUrl),
        corePath: new URL('./', assetUrl(root.dataset.coreUrl)).href,
        langPath: new URL('./', assetUrl(root.dataset.languageUrl)).href.replace(/\/$/, ''),
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger(message) {
          if (!busy || generation !== engineGeneration) return;
          const recognition = message.status === 'recognizing text';
          progress.value = recognition ? 35 + Math.round((message.progress || 0) * 60) : Math.min(30, progress.value + 2);
          announce(recognition ? 'Leyendo tu comprobante… puedes cancelar en cualquier momento.' : 'Preparando el lector. La primera vez puede tardar; la foto permanece en tu dispositivo.');
        },
        errorHandler() { /* A bounded timeout/recognize rejection restores the manual form. */ },
      });
      if (token !== job) { await created.terminate(); return null; }
      await created.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
      if (token !== job) { await created.terminate(); return null; }
      worker = created;
      return created;
    })();
    return workerPromise;
  }
  function canvasForPhoto() {
    const source = originalImage;
    const scale = Math.min(1, 2400 / Math.max(source.naturalWidth, source.naturalHeight));
    const width = Math.round(source.naturalWidth * scale);
    const height = Math.round(source.naturalHeight * scale);
    const swapped = angle % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = swapped ? height : width;
    canvas.height = swapped ? width : height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
    return canvas;
  }
  function showWarnings(items) {
    const list = find('warnings');
    list.replaceChildren();
    for (const message of items) {
      const li = document.createElement('li');
      li.textContent = message;
      list.append(li);
    }
    list.hidden = !items.length;
  }
  function showSuggestions(parsed, lowQuality) {
    const messages = [...parsed.warnings];
    if ([...edited].some((key) => form.elements[key].value)) messages.push('Los campos que escribiste se conservaron. Compáralos también con esta foto.');
    if (lowQuality) messages.unshift('La lectura tiene poca claridad. No completamos campos automáticamente; comprueba la foto y escribe los datos.');
    let count = 0;
    for (const key of fields) {
      const value = parsed.suggestions[key];
      if (!value || lowQuality) continue;
      const field = form.elements[key];
      const note = document.createElement('span');
      note.className = 'receipt-evidence';
      const source = String(parsed.evidence[key] || '').slice(0, 180);
      note.textContent = `Detectado en la foto: ${source || value}`;
      const accept = () => {
        field.value = value;
        edited.delete(key);
        field.classList.add('receipt-suggested');
        proposed.set(key, value);
        invalidateReview();
      };
      if (!edited.has(key) && !field.value) { accept(); count += 1; }
      else if (field.value !== value) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Usar sugerencia: ${String(value).slice(0, 100)}`;
        button.addEventListener('click', () => { accept(); button.remove(); field.focus(); });
        note.append(button);
      }
      field.closest('.fin-field').append(note);
    }
    showWarnings(messages);
    return count;
  }
  async function readPhoto() {
    if (!ready || busy) return;
    const token = ++job;
    invalidateReview();
    clearSuggestions();
    setBusy(true);
    progress.value = 0;
    announce('Preparando la lectura privada de tu foto…');
    timeout = setTimeout(() => {
      if (token !== job) return;
      stop();
      announce('La lectura tardó demasiado. Puedes volver a intentarlo con una foto más nítida o completar los campos manualmente.', 'error');
    }, 150000);
    try {
      const [reader, parser] = await Promise.all([getWorker(token), import(assetUrl(root.dataset.parserUrl))]);
      if (!reader || token !== job) return;
      const { data } = await reader.recognize(canvasForPhoto(), {}, { text: true });
      if (token !== job) return;
      const text = String(data.text || '');
      // Parse the whole result: truncating first could hide a second total or
      // invoice. The parser refuses oversized documents rather than guessing.
      find('text').textContent = text.slice(0, 60000);
      find('text-section').hidden = !text;
      const parsed = parser.parseReceiptText(text);
      const count = showSuggestions(parsed, !Number.isFinite(data.confidence) || data.confidence < 60);
      progress.value = 100;
      announce(count ? `Lectura lista: ${count} ${count === 1 ? 'dato sugerido' : 'datos sugeridos'}. Revisa cada campo comparándolo con la foto.` : 'Lectura terminada. No hay datos seguros para completar automáticamente; revisa el texto y completa los campos.', count ? 'success' : '');
    } catch {
      if (token === job) {
        announce('No pudimos leer esta foto. Tus datos siguen aquí: completa el registro a mano o vuelve a intentar la lectura.', 'error');
        stop();
      }
    } finally {
      if (token === job) { clearTimeout(timeout); setBusy(false); }
    }
  }
  async function choosePhoto() {
    discardImage();
    clearSuggestions();
    invalidateReview();
    angle = 0;
    const file = fileInput.files[0];
    if (!file) { announce('Selecciona una foto para empezar.'); return; }
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
      fileInput.value = '';
      announce('Elige una imagen JPG o PNG de hasta 10 MB. Para PDF, utiliza el registro manual.', 'error');
      return;
    }
    const token = job;
    imageUrl = URL.createObjectURL(file);
    const selected = new Image();
    selected.src = imageUrl;
    try {
      await selected.decode();
      if (token !== job) return;
      if (selected.naturalWidth * selected.naturalHeight > 24000000) throw new Error('Photo too large');
      originalImage = selected;
      image.src = imageUrl;
      find('preview').hidden = false;
      find('filename').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB · Original conservado`;
      ready = true;
      readButton.disabled = false;
      await readPhoto();
    } catch {
      if (token !== job) return;
      discardImage();
      fileInput.value = '';
      announce('No se pudo abrir la imagen o supera los 24 megapíxeles. Prueba con una foto más pequeña y nítida.', 'error');
    }
  }
  fileInput.addEventListener('change', choosePhoto);
  readButton.addEventListener('click', readPhoto);
  cancelButton.addEventListener('click', () => { stop(); announce('Lectura cancelada. Puedes completar los datos manualmente o volver a leer la foto.'); });
  find('clear').addEventListener('click', () => { fileInput.value = ''; discardImage(); clearSuggestions(); invalidateReview(); announce('Foto retirada. Selecciona otro comprobante.'); });
  find('rotate').addEventListener('click', () => {
    if (!ready) return;
    angle = (angle + 90) % 360;
    image.src = canvasForPhoto().toDataURL('image/jpeg', 0.85);
    invalidateReview();
    announce('Vista girada. Pulsa «Volver a leer foto» para repetir la lectura. Se guardará el archivo original.');
  });
  const dialog = find('dialog');
  find('zoom').addEventListener('click', () => { find('large-image').src = image.src; dialog.showModal(); });
  find('close').addEventListener('click', () => dialog.close());
  const drop = find('drop');
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    if (event.dataTransfer.files.length !== 1) { announce('Elige un solo comprobante por registro.', 'error'); return; }
    fileInput.files = event.dataTransfer.files;
    choosePhoto();
  });
  for (const key of fields) form.elements[key].addEventListener('input', () => {
    edited.add(key);
    form.elements[key].classList.remove('receipt-suggested');
  });
  form.addEventListener('input', (event) => { if (event.target !== reviewed) invalidateReview(); });
  const destination = find('destination');
  function toggleDestination() {
    destination.hidden = form.elements.kind.value !== 'transfer';
    if (destination.hidden) form.elements.destination_account.value = '';
  }
  form.elements.kind.addEventListener('change', toggleDestination);
  toggleDestination();
  find('company').addEventListener('change', (event) => {
    if (dirty && !window.confirm('Cambiar de empresa descarta esta foto y los datos que aún no guardaste. ¿Continuar?')) {
      event.target.value = event.target.querySelector('[selected]')?.value || '';
      return;
    }
    dirty = false;
    find('company-form').submit();
  });
  form.addEventListener('submit', (event) => {
    if (busy) {
      event.preventDefault();
      announce('Espera a que termine la lectura o cancélala antes de revisar y guardar.', 'error');
      return;
    }
    if (submitting) { event.preventDefault(); return; }
    submitting = true;
    dirty = false;
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando borrador…';
    stop();
  });
  window.addEventListener('beforeunload', (event) => { if (dirty && !submitting) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', discardImage);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      submitting = false;
      saveButton.disabled = !form.elements.account.options.length || form.elements.account.options.length < 2;
      saveButton.textContent = 'Guardar para revisión →';
      reviewed.checked = false;
      fileInput.value = '';
      form.elements.idempotency_key.value = crypto.randomUUID();
      clearSuggestions();
      announce('Vuelve a seleccionar la foto y revisa los datos antes de guardar.');
    }
  });
}
