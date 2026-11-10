import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createReceiptPaddle } from './paddle-browser.mjs';

const previous = new Map(['Worker', 'location', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const workers = [];
const bitmaps = [];
class FakeWorker {
  constructor(url, options) { this.url = url; this.options = options; this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(payload, message = this.messages.at(-1)) {
    this.onmessage({ data: { kind: 'worker-transport-response', requestId: message.requestId, status: 'success', payload } });
  }
}
before(() => {
  globalThis.Worker = FakeWorker;
  globalThis.location = { origin: new URL(import.meta.url).origin };
  globalThis.createImageBitmap = async () => { const bitmap = { closed: false, close() { this.closed = true; } }; bitmaps.push(bitmap); return bitmap; };
});
after(() => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
test('abort during model initialization rejects promptly and terminates the worker', async () => {
  const control = new AbortController();
  const creating = createReceiptPaddle({ signal: control.signal });
  const worker = workers.at(-1);
  assert.equal(worker.messages[0].type, 'init');
  const rejected = assert.rejects(creating, { name: 'AbortError' });
  control.abort();
  await rejected;
  assert.equal(worker.terminated, true);
  worker.reply({}); // Late replies cannot revive a cancelled attempt.
});
test('CPU worker uses local pinned models and retains all recognition candidates', async () => {
  const creating = createReceiptPaddle();
  const worker = workers.at(-1);
  const options = worker.messages[0].payload.options;
  assert.equal(options.ortOptions.backend, 'wasm');
  assert.equal(options.ortOptions.numThreads, 1);
  assert.equal(options.ortOptions.disableWasmProxy, true);
  assert.match(options.pipelineConfig.assets.rec.url, /\/models\/PP-OCRv6_small_rec\.tar$/);
  assert.equal(options.pipelineConfig.runtimeDefaults.text_rec_score_thresh, 0);
  worker.reply({});
  const engine = await creating;
  const recognition = engine.recognize({ width: 500, height: 600 });
  await Promise.resolve();
  assert.equal(worker.messages.at(-1).type, 'predict');
  assert.equal(worker.messages.at(-1).payload.params.textRecScoreThresh, 0);
  worker.reply([{ image: { width: 500, height: 600 }, items: [{ text: 'TOTAL S/ 25.00', score: 0.7, poly: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }]);
  const result = await recognition;
  assert.equal(result.text, 'TOTAL S/ 25.00');
  assert.equal(result.confidence, 70);
  assert.equal(bitmaps.at(-1).closed, true);
  await engine.terminate();
  assert.equal(worker.terminated, true);
});
test('terminate interrupts inference and a fresh instance can retry', async () => {
  const creating = createReceiptPaddle();
  const worker = workers.at(-1);
  worker.reply({});
  const engine = await creating;
  const recognition = engine.recognize({ width: 500, height: 600 });
  await Promise.resolve();
  const rejected = assert.rejects(recognition, { name: 'AbortError' });
  await engine.terminate();
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(bitmaps.at(-1).closed, true);
  const retry = createReceiptPaddle();
  assert.notEqual(workers.at(-1), worker);
  workers.at(-1).reply({});
  await (await retry).terminate();
});
test('worker failures clean up initialization and reject for visible fallback', async () => {
  const creating = createReceiptPaddle();
  const worker = workers.at(-1);
  const rejected = assert.rejects(creating, /WASM unavailable/);
  worker.onerror({ message: 'WASM unavailable' });
  await rejected;
  assert.equal(worker.terminated, true);
});
