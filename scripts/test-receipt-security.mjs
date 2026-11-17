import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { inspectReceiptImage, checkReceiptImage } from '../backend/static/inox/receipt-image.js';
import { createReceiptTesseract } from '../backend/static/inox/receipt-tesseract.js';

const originalGlobals = new Map(['Worker', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const workers = [];
class FakeWorker {
  constructor(url) { this.url = url; this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(data, status = 'resolve') {
    const message = this.messages.at(-1);
    this.onmessage({ data: { jobId: message.jobId, action: message.action, status, data } });
  }
}
before(() => {
  globalThis.Worker = FakeWorker;
  globalThis.location = { href: 'https://panel.example/admin/finanzas/comprobante/nuevo/', origin: 'https://panel.example' };
});
after(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
const options = () => ({ workerUrl: '/admin-static/worker.min.js', coreUrl: '/admin-static/core/', languageUrl: '/admin-static/lang' });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function initialized() {
  const creating = createReceiptTesseract(options());
  const worker = workers.at(-1);
  for (const action of ['load', 'loadLanguage', 'initialize', 'setParameters']) {
    assert.equal(worker.messages.at(-1).action, action);
    worker.reply({});
    await tick();
  }
  return { worker, engine: await creating };
}

test('Tesseract cancellation terminates workers during every initialization phase', async () => {
  for (let phase = 0; phase < 4; phase++) {
    const controller = new AbortController();
    const creating = createReceiptTesseract({ ...options(), signal: controller.signal });
    const worker = workers.at(-1);
    for (let completed = 0; completed < phase; completed++) { worker.reply({}); await tick(); }
    const rejected = assert.rejects(creating, { name: 'AbortError' });
    controller.abort();
    await rejected;
    assert.equal(worker.terminated, true);
    worker.reply({});
    assert.equal(worker.messages.length, phase + 1, 'Late replies do not restart work.');
  }
});

test('Tesseract model and script failures close the native worker and permit a clean retry', async () => {
  for (const fail of [worker => worker.reply('Synthetic language failure', 'reject'),
    worker => worker.onerror({ message: 'Synthetic script failure' }), worker => worker.onmessageerror({})]) {
    const creating = createReceiptTesseract(options());
    const worker = workers.at(-1);
    const rejected = assert.rejects(creating);
    fail(worker);
    await rejected;
    assert.equal(worker.terminated, true);
  }
  const { worker, engine } = await initialized();
  const messages = worker.messages;
  assert.equal(messages[0].payload.options.lstmOnly, true);
  assert.equal(messages[1].payload.options.cacheMethod, 'none');
  assert.deepEqual(messages[1].payload.langs, ['spa', 'eng']);
  assert.equal(messages[2].payload.oem, 1);
  await engine.terminate();
  assert.equal(worker.terminated, true);
});

test('Tesseract has no network-capable external worker/model path', async () => {
  for (const key of ['workerUrl', 'coreUrl', 'languageUrl']) {
    const count = workers.length;
    await assert.rejects(createReceiptTesseract({ ...options(), [key]: 'https://external.example/resource' }));
    assert.equal(workers.length, count);
  }
});

test('Tesseract cancellation rejects active recognition and resource bounds apply before encoding', async () => {
  const { worker, engine } = await initialized();
  await assert.rejects(engine.recognize({ width: 10000, height: 10000, toBlob() { assert.fail('Must not encode huge image'); } }));
  const recognition = engine.recognize({ width: 200, height: 100,
    toBlob(callback) { callback(new Blob([new Uint8Array([1, 2, 3])])); } });
  await tick();
  assert.equal(worker.messages.at(-1).action, 'recognize');
  assert.deepEqual(worker.messages.at(-1).payload.output, { text: true });
  const rejected = assert.rejects(recognition, { name: 'AbortError' });
  await engine.terminate();
  await rejected;
  assert.equal(worker.terminated, true);
});

test('Tesseract returns only bounded plain recognition data', async () => {
  const { worker, engine } = await initialized();
  const canvas = { width: 200, height: 100, toBlob(callback) { callback(new Blob(['synthetic'])); } };
  const recognized = engine.recognize(canvas);
  await tick();
  worker.reply({ text: '<script>synthetic</script> TOTAL S/ 25.00', confidence: 80 });
  assert.equal((await recognized).confidence, 80);
  const excessive = engine.recognize(canvas);
  const rejected = assert.rejects(excessive, /límite/);
  await tick();
  worker.reply({ text: 'x'.repeat(60001), confidence: 90 });
  await rejected;
  await engine.terminate();
});

// Structural fixtures are deliberately not decoded: this checks the preflight
// dimensions only. Browser/Pillow validation still checks actual image bytes.
const u32 = value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const chunk = (name, data) => [...u32(data.length), ...Buffer.from(name), ...data, 0, 0, 0, 0];
const png = (width, height, extra = []) => new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  ...chunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
  ...extra, ...chunk('IDAT', [1]), ...chunk('IEND', []),
]);
const jpeg = (width, height, marker = 192) => new Uint8Array([
  255, 216, 255, marker, 0, 17, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255,
  3, 1, 17, 0, 2, 17, 1, 3, 17, 1,
  255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 1, 255, 217,
]);

test('PNG/JPEG dimensions are bounded before pixel decoding, including progressive JPEG', () => {
  for (const [bytes, type] of [[png(4000, 6000), 'image/png'], [jpeg(4000, 6000), 'image/jpeg'], [jpeg(4000, 6000, 194), 'image/jpeg']]) {
    assert.deepEqual(inspectReceiptImage(bytes, type), { width: 4000, height: 6000 });
  }
  for (const [bytes, type] of [[png(10000, 10000), 'image/png'], [jpeg(10000, 10000), 'image/jpeg'], [png(0, 1), 'image/png']]) {
    assert.throws(() => inspectReceiptImage(bytes, type));
  }
});

test('Malformed, misleading and animated image headers fail closed', () => {
  for (const bytes of [png(1, 1).subarray(0, 29), png(1, 1, chunk('acTL', new Array(8).fill(0))),
    png(1, 1, [...u32(0xffffffff), ...Buffer.from('IDAT'), 0, 0, 0, 0]),
    png(1, 1, chunk('IHDR', new Array(13).fill(0)))]) {
    assert.throws(() => inspectReceiptImage(bytes, 'image/png'));
  }
  for (const bytes of [jpeg(1, 1).subarray(0, 15), jpeg(1, 1, 195), new Uint8Array([255, 216, 255, 224, 255, 255])]) {
    assert.throws(() => inspectReceiptImage(bytes, 'image/jpeg'));
  }
  assert.throws(() => inspectReceiptImage(png(1, 1), 'image/jpeg'));
  assert.throws(() => inspectReceiptImage(jpeg(1, 1), 'image/png'));
});

test('The form rejects a tiny compressed oversized PNG before creating an image or decoding pixels', async () => {
  const source = await readFile(new URL('../backend/static/inox/receipt-ocr.js', import.meta.url), 'utf8');
  const choose = source.slice(source.indexOf('  async function choosePhoto() {'), source.indexOf("  fileInput.addEventListener('change', choosePhoto);"));
  const bytes = png(10000, 10000);
  let decoded = 0;
  let error = '';
  const context = {
    discardImage() {}, clearSuggestions() {}, invalidateReview() {}, checkReceiptImage,
    fileInput: { files: [{ type: 'image/png', size: bytes.length, name: 'synthetic.png', arrayBuffer: async () => bytes.buffer }], value: 'test' },
    job: 0, angle: 0, imageUrl: '', originalImage: null,
    URL: { createObjectURL() { assert.fail('No image URL before validating dimensions'); } },
    Image: class { naturalWidth = 10000; naturalHeight = 10000; async decode() { decoded++; } },
    announce(message) { error = message; },
  };
  vm.runInNewContext(choose + '; globalThis.run = choosePhoto;', context);
  await context.run();
  assert.equal(decoded, 0);
  assert.equal(context.fileInput.value, '');
  assert.match(error, /24 megapíxeles/);
});
