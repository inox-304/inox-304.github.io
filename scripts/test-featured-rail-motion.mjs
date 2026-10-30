import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const script = ts.transpileModule(readFileSync('src/scripts/featured-rail.ts','utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(reduced = false) {
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
  const viewport = {...emitter(),scrollLeft:0,scrollWidth:3000,clientWidth:900,scrollBy({left}){this.scrollLeft+=left;}};
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

test('keyboard focus on controls, manual pause, hidden tabs and offscreen sections suspend movement',()=>{
  const h=setup();h.advance(1000);
  h.doc.activeElement=h.pause;h.root.emit('focusin');const focusedAt=h.viewport.scrollLeft;h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt);
  h.doc.activeElement=null;h.root.emit('focusout');h.pause.emit('click');h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt);
  h.doc.hidden=true;h.doc.emit('visibilitychange');h.doc.hidden=false;h.doc.emit('visibilitychange');h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt,'tab restore preserves manual pause');
  h.pause.emit('click');h.setIntersection(false);h.advance(1000);assert.equal(h.viewport.scrollLeft,focusedAt);
  h.setIntersection(true);h.advance(1000);assert.ok(h.viewport.scrollLeft>focusedAt);
});

test('reduced motion and bfcache restoration require explicit resumption',()=>{
  const h=setup(true);h.advance(1000);assert.equal(h.viewport.scrollLeft,0);assert.equal(h.pause.attrs['aria-pressed'],'true');
  h.pause.emit('click');h.advance(1000);assert.ok(h.viewport.scrollLeft>0);
  h.win.emit('pagehide');const old=h.viewport.scrollLeft;h.win.emit('pageshow',{persisted:true});h.advance(1000);assert.equal(h.viewport.scrollLeft,old);assert.equal(h.pause.attrs['aria-pressed'],'true');
});

test('long manual swipes rebase the actual cards once without creating duplicates',()=>{
  const h=setup();h.viewport.emit('pointerdown');h.viewport.scrollLeft=1600;h.doc.emit('pointerup');h.advance(1200);
  assert.equal(h.track.children.length,10);assert.equal(h.track.children[0].id,5);
  assert.ok(h.viewport.scrollLeft>=100 && h.viewport.scrollLeft<130);
});
