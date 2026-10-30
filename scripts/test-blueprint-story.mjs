import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('src/scripts/blueprint-story.ts', 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup() {
  let time=0,id=0; const frames=new Map();
  const events=()=>{const handlers=new Map();return {addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},emit(name,event={}){handlers.get(name)?.forEach(fn=>fn(event));}};};
  const view={style:{setProperty(){}}};
  const range={...events(),value:'50',setAttribute(){}};
  const toggle={...events(),textContent:'',attrs:{},setAttribute(name,value){this.attrs[name]=value;}};
  const root={querySelector(name){return {'[data-blueprint-view]':view,'[data-blueprint-range]':range,'[data-blueprint-toggle]':toggle}[name];}};
  const doc={...events(),hidden:false,querySelector(){return root;}};
  const win={...events(),matchMedia(){return {...events(),matches:false};}};
  let intersection;
  runInNewContext(source,{document:doc,window:win,navigator:{},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:handle=>frames.delete(handle),IntersectionObserver:class{constructor(fn){intersection=fn;}observe(){intersection([{isIntersecting:true}]);}}});
  function advance(ms){for(let elapsed=0;elapsed<ms;elapsed+=16){time+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time));}}
  return {range,toggle,doc,win,frames,advance,intersect:visible=>intersection([{isIntersecting:visible}])};
}

test('bfcache restoration preserves comparison and stays paused until an explicit replay',()=>{
  const h=setup();h.advance(1500);assert.ok(Number(h.range.value)>50);
  h.win.emit('pagehide');const saved=h.range.value;
  h.intersect(true);h.doc.emit('visibilitychange');h.advance(1000);
  assert.equal(h.range.value,saved,'late visibility callbacks cannot restart a suspended page');
  h.win.emit('pageshow',{persisted:true});h.advance(1000);
  assert.equal(h.range.value,saved);assert.equal(h.toggle.attrs['aria-pressed'],'false');assert.equal(h.frames.size,0);
  h.toggle.emit('click');h.advance(500);assert.notEqual(h.range.value,saved);assert.equal(h.toggle.attrs['aria-pressed'],'true');
});

test('ordinary page entry still animates; manual comparison remains paused on tab return',()=>{
  const h=setup();h.win.emit('pageshow',{persisted:false});h.advance(1000);assert.ok(Number(h.range.value)>50);
  h.range.value='27';h.range.emit('input');h.doc.hidden=true;h.doc.emit('visibilitychange');h.doc.hidden=false;h.doc.emit('visibilitychange');h.advance(1000);
  assert.equal(h.range.value,'27');assert.equal(h.toggle.attrs['aria-pressed'],'false');
});
