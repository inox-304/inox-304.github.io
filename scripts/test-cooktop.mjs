import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCooktopConfig,initialCooktopSelection,placeCooktopModule,validateCooktopSelection,cooktopSummary,cooktopQuoteSummary,moduleCells} from '../src/lib/cooktop-config.ts';
const source=JSON.parse(readFileSync(new URL('./fixtures/cooktop.json',import.meta.url),'utf8'));
const config=parseCooktopConfig(source);
const fresh=()=>initialCooktopSelection(config);
test('empty config does not offer invented options',()=>{for(const value of [undefined,null,{}]) assert.equal(parseCooktopConfig(value),null);});

function fiveColumnRules() {
 const value=structuredClone(source);
 value.layouts=[{id:'linear',name:'Lineal de 5',rows:1,columns:5},{id:'central',name:'Central de 10',rows:2,columns:5}];
 value.modules=[value.modules[0],value.modules[2]];
 Object.assign(value.modules[0],{maxQuantity:10,allowedLayouts:['linear','central'],anchors:{linear:[0,1,2,3,4],central:[0,1,2,3,4,5,6,7,8,9]}});
 Object.assign(value.modules[1],{width:5,height:1,allowedLayouts:['linear','central'],anchors:{linear:[0],central:[0,5]}});
 return value;
}

test('five columns support linear five and central ten, including an explicitly allowed full-width module',()=>{
 const value=parseCooktopConfig(fiveColumnRules());
 for(const [layoutId,total] of [['linear',5],['central',10]]) {
  const initial={...initialCooktopSelection(value),layoutId};
  assert.equal(cooktopSummary(value,initial).burners,total);
  const selected=placeCooktopModule(value,initial,'plate',0);
  assert.equal(cooktopSummary(value,selected).burners,total-5);
  assert.deepEqual(moduleCells(value.layouts.find(l=>l.id===layoutId),value.modules[1],0),[0,1,2,3,4]);
  assert.match(cooktopQuoteSummary(value,selected),/posiciones 1, 2, 3, 4, 5/);
 }
 assert.throws(()=>placeCooktopModule(value,initialCooktopSelection(value),'plate',1));
});

test('layouts still reject fifteen positions and dimensions beyond the supported limits',()=>{
 for(const mutate of [v=>v.layouts[1].rows=3,v=>v.layouts[0].columns=13,v=>v.layouts[0].rows=4,v=>v.modules[1].width=13]) {
  const bad=fiveColumnRules();mutate(bad);assert.throws(()=>parseCooktopConfig(bad));
 }
});
test('linear ten and twelve permit full-width modules while two by seven and three by five exceed total capacity',()=>{
 for(const [rows,columns] of [[1,10],[1,12],[2,7],[3,5]]) {
  const value=fiveColumnRules(), total=rows*columns;
  value.layouts=[{id:'linear',name:'Distribución de prueba',rows,columns}];
  Object.assign(value.modules[0],{maxQuantity:Math.min(total,12),allowedLayouts:['linear'],anchors:{linear:Array.from({length:total},(_,i)=>i)}});
  Object.assign(value.modules[1],{width:columns,height:1,allowedLayouts:['linear'],anchors:{linear:[0]}});
  if(total>12) { assert.throws(()=>parseCooktopConfig(value)); continue; }
  const parsed=parseCooktopConfig(value), initial=initialCooktopSelection(parsed);
  assert.equal(cooktopSummary(parsed,initial).burners,total);
  const selected=placeCooktopModule(parsed,initial,'plate',0);
  assert.equal(cooktopSummary(parsed,selected).burners,0);
  assert.deepEqual(moduleCells(parsed.layouts[0],parsed.modules[1],0),Array.from({length:columns},(_,i)=>i));
  assert.throws(()=>placeCooktopModule(parsed,initial,'plate',1));
 }
});
test('schema is strict and rejects unauthorized keys and incomplete base coverage',()=>{
 for(const mutate of [v=>v.privateCost=20,v=>v.layouts[0].rows=true,v=>v.modules[0].anchors.six.pop(),v=>v.modules[1].allowedLayouts.push('missing'),v=>v.modules[1].energies.push('steam'),v=>v.modules[2].anchors.six=[3],v=>v.modules.push(v.modules[1]),v=>v.defaultModuleId='wok']){
  const bad=structuredClone(source);mutate(bad);assert.throws(()=>parseCooktopConfig(bad));
 }
 assert.deepEqual(JSON.parse(JSON.stringify(parseCooktopConfig(source))),source);
});

test('legal special identifiers survive repeated parsing without prototype mutation',()=>{
 const value=JSON.parse(JSON.stringify(source).replaceAll('"six"','"__proto__"'));
 const parsed=parseCooktopConfig(value);
 assert.equal(Object.hasOwn(parsed.modules[0].anchors,'__proto__'),true);
 assert.deepEqual(parseCooktopConfig(parsed),parsed);
 assert.equal(cooktopSummary(parsed,initialCooktopSelection(parsed)).burners,6);
});

test('names allow Unicode characters but reject isolated surrogate code units',()=>{
 const value=structuredClone(source);value.layouts[0].name='🔥'.repeat(120);
 assert.equal(parseCooktopConfig(value).layouts[0].name,value.layouts[0].name);
 for(const name of ['🔥'.repeat(121),'test\ud800','\udfff']){value.layouts[0].name=name;assert.throws(()=>parseCooktopConfig(value));}
});
test('six-position example: left plancha replaces two burners, one wok leaves three common burners',()=>{
 let state=placeCooktopModule(config,fresh(),'plate',0);
 state=placeCooktopModule(config,state,'wok',2);
 assert.equal(cooktopSummary(config,state).burners,3);
 assert.equal(cooktopSummary(config,state).occupied,3);
 assert.deepEqual(moduleCells(config.layouts[0],config.modules[2],0),[0,3]);
 assert.match(cooktopQuoteSummary(config,state),/posiciones 1, 4/);
 assert.match(cooktopQuoteSummary(config,state),/3 hornillas comunes/);
 assert.equal(source.modules[2].anchors.six.length,1);
});
test('a module cannot overlap a neighbor or silently remove it',()=>{
 const state=placeCooktopModule(config,fresh(),'wok',3);
 assert.throws(()=>placeCooktopModule(config,state,'plate',0),/superponerse/);
 assert.deepEqual(state.placements,[{moduleId:'wok',anchor:3}]);
});
test('clicking a covered position removes the entire module and restores both burners',()=>{
 const state=placeCooktopModule(config,fresh(),'plate',0);
 const removed=placeCooktopModule(config,state,'burner',3);
 assert.equal(cooktopSummary(config,removed).burners,6);
 assert.deepEqual(removed.placements,[]);
});
test('bounds, row wrapping and owner-restricted anchors are rejected',()=>{
 for(const anchor of [-1,6,3,1]) assert.throws(()=>placeCooktopModule(config,fresh(),'plate',anchor));
 assert.deepEqual(moduleCells(config.layouts[0],{width:2,height:1},2),[]);
 assert.throws(()=>validateCooktopSelection(config,{...fresh(),placements:[{moduleId:'wok',anchor:1.5}]}));
});
test('power and layout compatibility are product-specific',()=>{
 assert.throws(()=>placeCooktopModule(config,{...fresh(),energy:'electric'},'wok',0),/energía/);
 assert.throws(()=>placeCooktopModule(config,{...fresh(),layoutId:'four'},'wok',0),/posición/);
 assert.throws(()=>placeCooktopModule(config,fresh(),'foreign-juice-part',0),/equipo/);
});
test('quantity and duplicate occupancy limits are enforced',()=>{
 const state=placeCooktopModule(config,fresh(),'wok',1);
 assert.throws(()=>placeCooktopModule(config,state,'wok',2),/Solo se permite/);
 assert.throws(()=>validateCooktopSelection(config,{...fresh(),placements:[{moduleId:'wok',anchor:1},{moduleId:'grill',anchor:1}]}));
});
test('malformed selections and unknown products cannot bypass validation',()=>{
 for(const value of [{...fresh(),private:true},{...fresh(),energy:'coal'},{...fresh(),placements:[{moduleId:'burner',anchor:0}]},{...fresh(),placements:[{moduleId:'wok',anchor:0,price:0}]}]) assert.throws(()=>validateCooktopSelection(config,value));
});
test('replacing a selected module preserves other compatible placements',()=>{
 let state=placeCooktopModule(config,fresh(),'plate',0);
 state=placeCooktopModule(config,state,'grill',1);
 state=placeCooktopModule(config,state,'wok',0);
 assert.deepEqual(state.placements,[{moduleId:'grill',anchor:1},{moduleId:'wok',anchor:0}]);
 assert.equal(cooktopSummary(config,state).burners,3);
});

