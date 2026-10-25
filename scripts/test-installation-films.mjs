import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/scripts/installation-films.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture() {
  const listeners = new Map(), timers = new Map();
  let timerId = 0, observerCallback;
  const document = { activeElement: null, hidden: false, addEventListener(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); } };
  const emitDocument = (type, target) => listeners.get(type)?.forEach(callback => callback({ target }));
  class Element {
    constructor() { this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.hidden = false; this.disabled = false; this.textContent = ''; }
    setAttribute(key, value) { this.attributes[key] = value; }
    hasAttribute(key) { return key in this.attributes; }
    addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
    emit(type) { if (type === 'play') emitDocument(type, this); this.listeners.get(type)?.forEach(callback => callback({ target: this })); }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) { this.focus(); this.emit('click'); } }
  }
  class Video extends Element {
    constructor() { super(); this.paused = true; this.hidden = true; this.controls = false; this.calls = []; this.loadCount = 0; this.parentElement = new Element(); this.error = null; }
    set src(value) { this.attributes.src = value; }
    get src() { return this.attributes.src; }
    load() { this.loadCount++; this.error = null; }
    play() { this.paused = false; this.emit('play'); return new Promise((resolve, reject) => this.calls.push({ resolve, reject })); }
    pause() { this.paused = true; this.emit('pause'); }
    settle(index = this.calls.length - 1) { this.emit('playing'); this.calls[index].resolve(); }
  }
  function card(id) {
    const node = new Element(), video = new Video(), button = new Element(), label = new Element(), status = new Element();
    node.dataset.filmState = 'idle'; video.dataset.videoSrc = `/media/${id}.mp4`;
    const selectors = { '[data-installation-video]': video, '[data-film-play]': button, '[data-film-play-label]': label, '[data-film-status]': status };
    node.querySelector = key => selectors[key];
    return { node, video, button, label, status };
  }
  const cards = [card('one'), card('two')], hero = new Video();
  document.querySelectorAll = selector => selector === 'video' ? [...cards.map(card => card.video), hero] : cards.map(card => card.node);
  class Observer { constructor(callback) { observerCallback = callback; } observe() {} }
  const window = { IntersectionObserver: Observer, addEventListener() {}, setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  runInNewContext(source, { document, window, IntersectionObserver: Observer, HTMLVideoElement: Video, MediaError: { MEDIA_ERR_ABORTED: 1 } });
  return { cards, hero, document, timers, intersect(card, visible) { observerCallback([{ target: card.video.parentElement, isIntersecting: visible }]); }, hide() { document.hidden = true; emitDocument('visibilitychange', document); } };
}

test('nothing requests video before user action; click loads and exposes native controls', async () => {
  const f = fixture(), [a] = f.cards;
  f.intersect(a, false);
  assert.equal(a.video.src, undefined); assert.equal(a.video.loadCount, 0); assert.equal(a.node.dataset.filmState, 'idle');
  a.button.click();
  assert.equal(a.video.src, '/media/one.mp4'); assert.equal(a.video.loadCount, 1); assert.equal(a.video.controls, true);
  assert.equal(a.node.dataset.filmState, 'loading'); assert.equal(a.button.disabled, true);
  a.video.settle(); await flush();
  assert.equal(a.node.dataset.filmState, 'playing'); assert.equal(a.button.hidden, true); assert.equal(f.document.activeElement, a.video);
});

test('a late first play cannot interrupt a newer selection or hide its controls', async () => {
  const f = fixture(), [a, b] = f.cards;
  a.button.click(); b.button.click();
  assert.equal(a.video.paused, true); assert.equal(a.node.dataset.filmState, 'paused');
  b.video.settle(); await flush();
  a.video.settle(); await flush();
  assert.equal(a.video.paused, true); assert.equal(b.video.paused, false);
  assert.equal(b.node.dataset.filmState, 'playing'); assert.equal(b.button.hidden, true);
});

test('a media error offers retry and an older rejected play cannot break the retry', async () => {
  const f = fixture(), [a] = f.cards;
  a.button.click(); a.video.error = { code: 3 }; a.video.emit('error');
  assert.equal(a.node.dataset.filmState, 'error'); assert.equal(a.button.hidden, false); assert.match(a.status.textContent, /conexión/);
  a.button.click();
  assert.equal(a.video.loadCount, 2); assert.equal(a.node.dataset.filmState, 'loading');
  a.video.calls[0].reject(new Error('older failure')); await flush();
  assert.equal(a.node.dataset.filmState, 'loading');
  a.video.settle(); await flush();
  assert.equal(a.node.dataset.filmState, 'playing'); assert.equal(a.status.textContent, '');
});

test('out of view and hidden document pause; native resume keeps the source', async () => {
  const f = fixture(), [a] = f.cards;
  a.button.click(); a.video.settle(); await flush();
  f.intersect(a, false); assert.equal(a.video.paused, true); assert.equal(a.node.dataset.filmState, 'paused');
  void a.video.play(); a.video.settle(); await flush();
  assert.equal(a.node.dataset.filmState, 'playing'); assert.equal(a.video.loadCount, 1);
  f.hide(); assert.equal(a.video.paused, true);
});

test('loading timeout can retry and late completion stays cancelled', async () => {
  const f = fixture(), [a] = f.cards;
  a.button.click(); [...f.timers.values()][0]();
  assert.equal(a.node.dataset.filmState, 'error'); assert.equal(a.button.disabled, false);
  a.video.settle(); await flush();
  assert.equal(a.node.dataset.filmState, 'error'); assert.equal(a.video.paused, true);
  a.button.click(); a.video.settle(); await flush();
  assert.equal(a.node.dataset.filmState, 'playing'); assert.equal(a.video.loadCount, 2);
});

test('starting a film pauses the hero and playing the hero pauses the film', async () => {
  const f = fixture(), [a] = f.cards;
  f.hero.paused = false; a.button.click();
  assert.equal(f.hero.paused, true);
  a.video.settle(); await flush();
  void f.hero.play();
  assert.equal(a.video.paused, true); assert.equal(f.hero.paused, false);
});
