import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const script = ts.transpileModule(readFileSync('src/scripts/featured-rail.ts','utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(reduced = false, roundedScroll = false) {
  let clock = 0, frameId = 0;
  const frames = new Map();
  const emitter = () => {
    const handlers = new Map();
    return { addEventListener(name, fn) { if(!handlers.has(name)) handlers.set(name,[]); handlers.get(name).push(fn); }, emit(name,event={}) { handlers.get(name)?.forEach(fn=>fn(event)); } };
  };
  const control = () => ({...emitter(),attrs:{},disabled:false,setAttribute(name,value){this.attrs[name]=value;},querySelector(){return {textContent:''};}});
  const pause = control(), prev = control(), next = control();
  const track = {children:[],append(card){this.children.splice(this.children.indexOf(card),1);this.children.push(card);},prepend(card){this.children.splice(this.children.indexOf(card),1);this.children.unshift(card);},get firstElementChild(){return this.children[0];},get lastElementChild(){return this.children.at(-1);}};
  track.children = Array.from({length:10},(_,id)=>({id,get offsetLeft(){return track.children.indexOf(this)*300;}}));
  let scroll = 0;
  const viewport = {...emitter(),get scrollLeft(){return scroll;},set scrollLeft(value){scroll=roundedScroll?Math.round(value):value;},scrollWidth:3000,clientWidth:900,scrollBy({left}){this.scrollLeft+=left;},contains(element){return element===this || track.children.includes(element);}};
  const controls = {'[data-featured-viewport]':viewport,'[data-cms-products="home-featured"]':track,'[data-featured-pause]':pause,'[data-featured-prev]':prev,'[data-featured-next]':next};
  const root = {...emitter(),dataset:{},querySelector(name){return controls[name];},contains(element){return Object.values(controls).includes(element);}};
  const motion = {...emitter(),matches:reduced};
  const doc = {...emitter(),hidden:false,activeElement:null,querySelectorAll(){return [root];}};
  const win = {...emitter(),matchMedia(){return motion;}};
  let intersection;
  runInNewContext(script, {document:doc,window:win,performance:{now:()=>clock},queueMicrotask:fn=>fn(),requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}},IntersectionObserver:class{constructor(fn){intersection=fn;}observe(){intersection([{isIntersecting:true}]);}}});
  function advance(ms) { for(let elapsed=0;elapsed<ms;elapsed+=16){clock+=16;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(clock));} }
  return {track,viewport,root,pause,prev,next,doc,win,motion,advance,frames,setIntersection:visible=>intersection([{isIntersecting:visible}])};
}

test('continuous travel rotates real cards without multiplying links or jumping the scroll origin',()=>{
  const h=setup();h.advance(13000);
  assert.equal(h.track.children.length,10);
  assert.equal(new Set(h.track.children.map(card=>card.id)).size,10);
  assert.equal(h.track.children[0].id,1);
  assert.ok(h.viewport.scrollLeft>15 && h.viewport.scrollLeft<35);
  assert.equal(h.frames.size,1);
});

test('keyboard focus on a card pauses it while ordinary pointer hover keeps the showcase moving',()=>{
  const h=setup();h.advance(1000);
  h.root.emit('pointerenter',{pointerType:'mouse'});const enteredAt=h.viewport.scrollLeft;h.advance(1000);
  assert.ok(h.viewport.scrollLeft>enteredAt,'hover over the full section must not silently stop animation');
  h.doc.emit('keydown',{key:'Tab'});h.doc.activeElement=h.track.children[0];h.root.emit('focusin');
  const focusedAt=h.viewport.scrollLeft;h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt);
  h.doc.activeElement=null;h.root.emit('focusout');h.advance(1000);assert.ok(h.viewport.scrollLeft>focusedAt);
});

test('pause and resume work while their button remains focused',()=>{
  const h=setup();h.advance(1000);
  h.root.emit('pointerdown');h.doc.activeElement=h.pause;h.root.emit('focusin');h.pause.emit('click');
  const pausedAt=h.viewport.scrollLeft;h.advance(1000);assert.equal(h.viewport.scrollLeft,pausedAt);
  assert.equal(h.pause.attrs['aria-pressed'],'true');assert.equal(h.root.dataset.featuredMotion,'paused');
  h.pause.emit('click');h.advance(1000);
  assert.ok(h.viewport.scrollLeft>pausedAt,'explicit resume must work without moving the mouse or blurring the control');
  assert.equal(h.pause.attrs['aria-pressed'],'false');assert.equal(h.root.dataset.featuredMotion,'playing');
});

test('manual pause survives hidden tabs; offscreen sections resume when visible',()=>{
  const h=setup();h.advance(1000);
  const focusedAt=h.viewport.scrollLeft;h.pause.emit('click');h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt);
  h.doc.hidden=true;h.doc.emit('visibilitychange');h.doc.hidden=false;h.doc.emit('visibilitychange');h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt,'tab restore preserves manual pause');
  h.pause.emit('click');h.setIntersection(false);h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt);
  h.setIntersection(true);h.advance(1000);assert.ok(h.viewport.scrollLeft>focusedAt);
});

test('reduced motion starts paused and only an explicit resume enables animation',()=>{
  const h=setup(true);h.advance(1000);assert.equal(h.viewport.scrollLeft,0);assert.equal(h.pause.attrs['aria-pressed'],'true');
  h.pause.emit('click');h.advance(1000);assert.ok(h.viewport.scrollLeft>0);
  h.motion.matches=true;h.motion.emit('change');const pausedAt=h.viewport.scrollLeft;
  h.advance(1000);assert.equal(h.viewport.scrollLeft,pausedAt);assert.equal(h.pause.attrs['aria-pressed'],'true');
});

test('back navigation restores automatic motion and preserves a deliberate pause',()=>{
  const h=setup();h.advance(1000);h.win.emit('pagehide');const old=h.viewport.scrollLeft;
  h.advance(1000);assert.equal(h.viewport.scrollLeft,old);
  h.win.emit('pageshow',{persisted:true});h.advance(1000);assert.ok(h.viewport.scrollLeft>old);
  h.pause.emit('click');const pausedAt=h.viewport.scrollLeft;
  h.win.emit('pagehide');h.win.emit('pageshow',{persisted:true});h.advance(1000);
  assert.equal(h.viewport.scrollLeft,pausedAt);assert.equal(h.pause.attrs['aria-pressed'],'true');
});

test('long manual swipes rebase the actual cards once without creating duplicates',()=>{
  const h=setup();h.viewport.emit('pointerdown');h.viewport.scrollLeft=1600;h.doc.emit('pointerup');h.advance(1200);
  assert.equal(h.track.children.length,10);assert.equal(h.track.children[0].id,5);
  assert.ok(h.viewport.scrollLeft>=100 && h.viewport.scrollLeft<130);
});

test('a touch swipe resumes despite the viewport retaining pointer focus',()=>{
  const h=setup();h.advance(1000);h.viewport.emit('pointerdown');h.root.emit('pointerdown');
  h.doc.activeElement=h.viewport;h.root.emit('focusin');h.viewport.scrollLeft=120;
  h.advance(1000);assert.equal(h.viewport.scrollLeft,120);
  h.doc.emit('pointerup');h.advance(1600);assert.ok(h.viewport.scrollLeft>130);
});

test('fractional travel accumulates even when the browser rounds scrollLeft values',()=>{
  const h=setup(false,true);h.advance(1000);assert.ok(h.viewport.scrollLeft>=24);
  h.advance(12000);assert.equal(h.track.children[0].id,1);assert.equal(h.frames.size,1);
});

test('catalog replacement restarts measurement without losing manual pause or creating duplicate loops',()=>{
  const h=setup();h.advance(3000);h.doc.emit('inox:catalog-updated');h.advance(1000);
  assert.ok(h.viewport.scrollLeft>20 && h.viewport.scrollLeft<30);assert.equal(h.frames.size,1);
  h.pause.emit('click');h.doc.emit('inox:catalog-updated');h.advance(1000);
  assert.equal(h.viewport.scrollLeft,0);assert.equal(h.frames.size,0);assert.equal(h.pause.attrs['aria-pressed'],'true');
});

test('manual arrows work while focused and automatic movement resumes after the brief settling period',()=>{
  const h=setup();h.doc.activeElement=h.next;h.root.emit('focusin');h.next.emit('click');
  assert.equal(h.viewport.scrollLeft,300);h.advance(1500);
  assert.equal(h.track.children[0].id,1);assert.ok(h.viewport.scrollLeft>5 && h.viewport.scrollLeft<20);
  assert.equal(h.frames.size,1);
});
