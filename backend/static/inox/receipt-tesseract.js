// Minimal transport for the pinned Tesseract 7 worker. Keeping the native
// handle from construction lets cancellation also stop WASM/language loading.
export async function createReceiptTesseract({ workerUrl, coreUrl, languageUrl, signal, onProgress = () => {} }) {
  const cancelled = () => new DOMException('Lectura cancelada.', 'AbortError');
  if (signal?.aborted) throw cancelled();
  function local(value) {
    const url = new URL(value, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('El lector requiere recursos del mismo sitio.');
    }
    return url.href;
  }
  const paths = { worker: local(workerUrl), core: local(coreUrl), language: local(languageUrl) };
  const nativeWorker = new Worker(paths.worker, { name: 'inox-receipt-tesseract' });
  const pending = new Map();
  let requestId = 0;
  let stopped = false;
  let recognizing = false;
  const terminate = (error = cancelled()) => {
    if (stopped) return;
    stopped = true;
    nativeWorker.terminate();
    signal?.removeEventListener('abort', abort);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const abort = () => terminate();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) terminate();
  nativeWorker.onerror = () => terminate(new Error('No se pudo iniciar el lector alternativo.'));
  nativeWorker.onmessageerror = () => terminate(new Error('No se pudo recuperar la lectura.'));
  nativeWorker.onmessage = ({ data }) => {
    if (stopped) return;
    const entry = pending.get(data?.jobId);
    if (!entry || data.action !== entry.action) return;
    if (data.status === 'progress') { onProgress(data.data || {}); return; }
    if (data.status === 'reject') { terminate(new Error('El lector alternativo no pudo completar la lectura.')); return; }
    if (data.status !== 'resolve') return;
    pending.delete(data.jobId);
    entry.resolve(data.data);
  };
  const request = (action, payload, transfer = []) => new Promise((resolve, reject) => {
    if (stopped) { reject(cancelled()); return; }
    const jobId = `receipt-${++requestId}`;
    pending.set(jobId, { action, resolve, reject });
    try { nativeWorker.postMessage({ workerId: 'receipt', jobId, action, payload }, transfer); }
    catch (error) { terminate(error); }
  });
  try {
    await request('load', { options: { lstmOnly: true, corePath: paths.core, logging: false } });
    await request('loadLanguage', { langs: ['spa', 'eng'], options: {
      langPath: paths.language, cacheMethod: 'none', gzip: true, lstmOnly: true,
    } });
    await request('initialize', { langs: ['spa', 'eng'], oem: 1, config: {} });
    await request('setParameters', { params: { tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' } });
  } catch (error) { terminate(error); throw error; }
  return {
    async recognize(canvas) {
      if (stopped) throw cancelled();
      if (recognizing) throw new Error('Ya hay una lectura en curso.');
      if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)
        || canvas.width <= 0 || canvas.height <= 0 || canvas.width * canvas.height > 8000000) {
        throw new Error('La imagen preparada es demasiado grande o no es válida.');
      }
      recognizing = true;
      try {
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value
          ? resolve(value) : reject(new Error('No se pudo preparar la imagen.')), 'image/png'));
        if (stopped) throw cancelled();
        // The canvas is bounded above; do not send an unexpected encoder result.
        if (blob.size > 32 * 1024 * 1024) throw new Error('La imagen preparada es demasiado grande.');
        const image = new Uint8Array(await blob.arrayBuffer());
        if (stopped) throw cancelled();
        const result = await request('recognize', { image, options: {}, output: { text: true } }, [image.buffer]);
        if (typeof result?.text !== 'string' || result.text.length > 60000) throw new Error('El resultado OCR excede el límite de lectura.');
        return result;
      } finally { recognizing = false; }
    },
    async terminate() { terminate(); },
  };
}
