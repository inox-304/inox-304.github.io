import { normalizePaddleResult } from './paddle-normalize.mjs';

// The published SDK's standalone worker includes OpenCV and ONNX Runtime.
// Speak the pinned 0.4.2 worker protocol directly to avoid initializing another
// OpenCV/WASM runtime on the UI thread. Upgrades must revalidate this contract.
export async function createReceiptPaddle({ onProgress = () => {}, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Lectura cancelada.', 'AbortError');
  if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') {
    throw new Error('Este navegador no admite el lector PaddleOCR.');
  }
  const base = new URL('./', import.meta.url);
  if (base.origin !== globalThis.location.origin) throw new Error('El lector requiere recursos del mismo sitio.');
  // A policy revision refreshes an older cached worker response without CSP.
  const worker = new Worker(new URL('paddle-worker.js?receipt-policy=1', base), { type: 'module', name: 'inox-receipt-paddle' });
  const pending = new Map();
  let requestId = 0;
  let stopped = false;
  let recognizing = false;
  const report = (status, progress) => { if (!stopped) onProgress({ status, progress }); };
  const terminate = (error = new DOMException('Lectura cancelada.', 'AbortError')) => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    signal?.removeEventListener('abort', abort);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const abort = () => terminate();
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = ({ data }) => {
    if (stopped || data?.kind !== 'worker-transport-response') return;
    const entry = pending.get(data.requestId);
    if (!entry) return;
    pending.delete(data.requestId);
    if (data.status === 'success') entry.resolve(data.payload);
    else entry.reject(new Error(data.error?.message || 'No se pudo leer el comprobante.'));
  };
  worker.onerror = event => terminate(new Error(event.message || 'No se pudo iniciar el lector.'));
  worker.onmessageerror = () => terminate(new Error('No se pudo recuperar el resultado del lector.'));
  const request = (type, payload, transfer = []) => new Promise((resolve, reject) => {
    if (stopped) return reject(new DOMException('Lectura cancelada.', 'AbortError'));
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ kind: 'worker-transport-request', type, requestId: id, payload }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
  try {
    report('Cargando el lector y los modelos de español…', 0.05);
    await request('init', { options: {
      pipelineConfig: {
        pipelineName: 'OCR', raw: {}, warnings: [], unsupportedFeatures: [],
        modelSelection: { textDetectionModelName: 'PP-OCRv6_small_det', textRecognitionModelName: 'PP-OCRv6_small_rec' },
        assets: {
          det: { url: new URL('models/PP-OCRv6_small_det.tar', base).href },
          rec: { url: new URL('models/PP-OCRv6_small_rec.tar', base).href },
        },
        // Keep every recognized string, including low-confidence candidates.
        runtimeDefaults: { text_det_limit_side_len: 1280, text_det_limit_type: 'max', text_det_max_side_limit: 2400, text_rec_score_thresh: 0 },
        pipelineBatchSize: 1, textDetectionBatchSize: 1, textRecognitionBatchSize: 1,
      },
      ortOptions: { backend: 'wasm', wasmPaths: new URL('runtime/', base).href, numThreads: 1, simd: true, proxy: false, disableWasmProxy: true },
    } });
    report('Lector listo.', 0.3);
  } catch (error) { terminate(error); throw error; }
  return {
    async recognize(canvas) {
      if (stopped) throw new DOMException('Lectura cancelada.', 'AbortError');
      if (recognizing) throw new Error('Ya hay una lectura en curso.');
      if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)
        || canvas.width <= 0 || canvas.height <= 0 || canvas.width * canvas.height > 8000000) {
        throw new Error('La imagen preparada es demasiado grande o no es válida.');
      }
      recognizing = true;
      let bitmap;
      try {
        report('Leyendo el comprobante…', 0.35);
        bitmap = await createImageBitmap(canvas);
        if (stopped) throw new DOMException('Lectura cancelada.', 'AbortError');
        const results = await request('predict', { sources: [{ kind: 'imageBitmap', imageBitmap: bitmap }], params: { textRecScoreThresh: 0 } }, [bitmap]);
        if (!Array.isArray(results) || results.length !== 1) throw new Error('El lector devolvió un resultado incompleto.');
        const result = normalizePaddleResult(results[0]);
        report('Lectura terminada. Revisa los datos.', 1);
        return result;
      } finally { bitmap?.close(); recognizing = false; }
    },
    async terminate() { terminate(); },
  };
}
