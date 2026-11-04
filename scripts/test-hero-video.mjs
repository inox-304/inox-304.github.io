import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const script = ts.transpileModule(readFileSync('src/scripts/hero-video.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ width = 1280, reduced = false, saveData = false } = {}) {
  const emitter = () => {
    const handlers = new Map();
    return { addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }, emit(name, event = {}) { handlers.get(name)?.forEach(fn => fn(event)); } };
  };
  const source = { ...emitter(), src: '', removeAttribute(name) { if (name === 'src') this.src = ''; } };
  const requests = [];
  const video = {
    ...emitter(), dataset: { srcDesktop: '/desktop.mp4', posterDesktop: '/desktop.jpg', srcTablet: '/tablet.mp4', posterTablet: '/tablet.jpg', srcMobile: '/mobile.mp4', posterMobile: '/mobile.jpg' },
    paused: true, duration: NaN, currentTime: 0, poster: '', rejectPlay: false,
    querySelector() { return source; },
    load() { if (source.src) requests.push(source.src); this.currentTime = 0; this.duration = NaN; this.pause(); },
    pause() { this.paused = true; this.emit('pause'); },
    play() { if (this.rejectPlay) return Promise.reject(new Error('Autoplay blocked')); this.paused = false; this.emit('play'); return Promise.resolve(); },
  };
  const label = { textContent: '' }, icon = { textContent: '' };
  const toggle = { ...emitter(), attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, querySelector(selector) { return selector === '[data-video-label]' ? label : icon; } };
  const motion = { ...emitter(), matches: reduced };
  const mobile = { ...emitter(), matches: width <= 600 };
  const tablet = { ...emitter(), matches: width <= 1100 };
  const doc = { ...emitter(), hidden: false, querySelector(selector) { return selector === '#hero-video' ? video : toggle; } };
  const win = { ...emitter(), matchMedia(query) { return query.includes('reduce') ? motion : query.includes('600px') ? mobile : tablet; } };
  runInNewContext(script, { document: doc, window: win, navigator: { connection: { saveData } } });
  const metadata = duration => { video.duration = duration; video.emit('loadedmetadata'); };
  function resize(nextWidth) {
    const wasMobile = mobile.matches, wasTablet = tablet.matches;
    mobile.matches = nextWidth <= 600; tablet.matches = nextWidth <= 1100;
    if (wasMobile !== mobile.matches) mobile.emit('change');
    if (wasTablet !== tablet.matches) tablet.emit('change');
  }
  return { video, source, requests, toggle, doc, win, motion, resize, metadata, label };
}

test('each viewport initially downloads only its matching video and chooses its poster', () => {
  for (const [width, family] of [[390, 'mobile'], [768, 'tablet'], [1024, 'tablet'], [1280, 'desktop']]) {
    const h = setup({ width });
    assert.deepEqual(h.requests, [`/${family}.mp4`]);
    assert.equal(h.video.poster, `/${family}.jpg`);
    assert.equal(h.video.dataset.heroMedia, family);
  }
});

test('reduced motion and data saving show the correct poster without a video request', () => {
  for (const preference of [{ reduced: true }, { saveData: true }]) {
    const h = setup({ width: 390, ...preference });
    assert.deepEqual(h.requests, []);
    assert.equal(h.video.poster, '/mobile.jpg');
    h.resize(768);
    assert.equal(h.video.poster, '/tablet.jpg');
    assert.deepEqual(h.requests, []);
    h.toggle.emit('click');
    assert.deepEqual(h.requests, ['/tablet.mp4']);
    assert.equal(h.video.paused, false);
  }
});

test('crossing a breakpoint keeps relative progress and does not reload within one family', () => {
  const h = setup(); h.metadata(10); h.video.currentTime = 4;
  h.resize(1024); h.metadata(5);
  assert.equal(h.video.currentTime, 2);
  assert.equal(h.video.paused, false);
  h.resize(768);
  assert.deepEqual(h.requests, ['/desktop.mp4', '/tablet.mp4']);
  h.resize(390); h.metadata(8);
  assert.equal(h.video.currentTime, 3.2);
  assert.deepEqual(h.requests, ['/desktop.mp4', '/tablet.mp4', '/mobile.mp4']);
});

test('a manually paused resize defers the new download until play and retains position', () => {
  const h = setup(); h.metadata(10); h.video.currentTime = 6;
  h.toggle.emit('click'); h.resize(390);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.poster, '/mobile.jpg');
  assert.deepEqual(h.requests, ['/desktop.mp4']);
  h.doc.hidden = true; h.doc.emit('visibilitychange');
  h.doc.hidden = false; h.doc.emit('visibilitychange'); h.win.emit('pageshow');
  assert.deepEqual(h.requests, ['/desktop.mp4']);
  h.toggle.emit('click'); h.metadata(5);
  assert.equal(h.video.currentTime, 3);
  assert.equal(h.video.paused, false);
});

test('hidden tabs suspend playback and return without downloading the asset again', () => {
  const h = setup({ width: 768 });
  h.doc.hidden = true; h.doc.emit('visibilitychange');
  assert.equal(h.video.paused, true);
  h.doc.hidden = false; h.doc.emit('visibilitychange');
  assert.equal(h.video.paused, false);
  assert.deepEqual(h.requests, ['/tablet.mp4']);
});

test('enabling reduced motion stops animation and resize cannot restart it', () => {
  const h = setup(); h.motion.matches = true; h.motion.emit('change'); h.resize(390);
  assert.equal(h.video.paused, true);
  assert.deepEqual(h.requests, ['/desktop.mp4']);
  h.toggle.emit('click');
  assert.equal(h.video.paused, false);
});

test('failed media can be retried explicitly without falling back to an unwanted desktop download', () => {
  const h = setup({ width: 390 }); h.video.pause(); h.source.emit('error');
  h.toggle.emit('click');
  assert.deepEqual(h.requests, ['/mobile.mp4', '/mobile.mp4']);
  assert.equal(h.video.paused, false);
});

test('the play button also resumes a video paused by the browser itself', () => {
  const h = setup({ width: 390 }); h.video.pause();
  assert.equal(h.toggle.attrs['aria-label'], 'Reproducir video de presentación');
  h.toggle.emit('click');
  assert.equal(h.video.paused, false);
  assert.deepEqual(h.requests, ['/mobile.mp4']);
});
