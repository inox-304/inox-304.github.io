import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCooktopConfig,initialCooktopSelection,placeCooktopModule,previewCooktopPlacement,validateCooktopSelection,cooktopSummary,cooktopQuoteSummary,moduleCells} from '../src/lib/cooktop-config.ts';
const source=JSON.parse(readFileSync(new URL('./fixtures/cooktop.json',import.meta.url),'utf8'));
const config=parseCooktopConfig(source);
const fresh=()=>initialCooktopSelection(config);

function kitchenRules() {
 const value=structuredClone(source);
 value.kitchen={family:'central',ovens:['electric','gas','none'],structures:['open','cabinet'],supports:['feet','wheels'],materials:[{id:'steel304',name:'304 mate 1.2 mm',steel:'304 MATE',thicknessMm:1.2}],dimensions:{widthMm:{min:1200,max:1800,step:100},depthMm:{min:600,max:900,step:50},heightMm:{min:800,max:1000,step:10}}};
 return value;
}

test('kitchen extension keeps oven independent from surface and includes exact options in the quote',()=>{
 const rules=parseCooktopConfig(kitchenRules()), initial=initialCooktopSelection(rules);
 assert.equal(initial.energy,'gas'); assert.equal(initial.kitchen.oven,'electric');
 const selected=placeCooktopModule(rules,{...initial,kitchen:{...initial.kitchen,structure:'cabinet',support:'wheels',widthMm:1500}},'plate',0);
 assert.equal(selected.kitchen.widthMm,1500);
 const quote=cooktopQuoteSummary(rules,selected);
 for(const phrase of ['superficie Gas','Horno: eléctrico','con gabinete','ruedas','acero 304 MATE','1.2 mm','1500 × 600 × 800 mm']) assert.ok(quote.includes(phrase),phrase);
});

test('kitchen options reject forged materials, foreign choices, unaligned dimensions and missing selections',()=>{
 const rules=parseCooktopConfig(kitchenRules()), initial=initialCooktopSelection(rules);
 for(const patch of [{oven:'steam'},{structure:'other'},{support:'tracks'},{materialId:'unapproved'},{widthMm:1250},{depthMm:950},{heightMm:true}]) assert.throws(()=>validateCooktopSelection(rules,{...initial,kitchen:{...initial.kitchen,...patch}}));
 assert.throws(()=>validateCooktopSelection(rules,{layoutId:initial.layoutId,energy:initial.energy,placements:[]}));
 assert.throws(()=>validateCooktopSelection(config,{...fresh(),kitchen:initial.kitchen}));
});

test('unconfirmed structure, support, measurements and materials are null and cannot be invented',()=>{
 const source=kitchenRules(); Object.assign(source.kitchen,{structures:[],supports:[],materials:[],dimensions:null});
 const rules=parseCooktopConfig(source), initial=initialCooktopSelection(rules);
 assert.deepEqual(initial.kitchen,{oven:'electric',structure:null,support:null,materialId:null,widthMm:null,depthMm:null,heightMm:null});
 for(const patch of [{structure:'open'},{support:'feet'},{materialId:'steel304'},{widthMm:1200}]) assert.throws(()=>validateCooktopSelection(rules,{...initial,kitchen:{...initial.kitchen,...patch}}));
 assert.doesNotMatch(cooktopQuoteSummary(rules,initial),/Cubierta:|Medidas solicitadas|Estructura:|Apoyos:/);
});

test('kitchen schemas reject unknown keys, duplicate materials and invalid thickness/ranges',()=>{
 for(const mutate of [v=>v.kitchen.other=true,v=>v.kitchen.family='juice',v=>v.kitchen.ovens.push('gas'),v=>v.kitchen.materials.push(v.kitchen.materials[0]),v=>v.kitchen.materials[0].thicknessMm=true,v=>v.kitchen.materials[0].thicknessMm=Infinity,v=>v.kitchen.materials[0].thicknessMm=0,v=>v.kitchen.materials[0].thicknessMm=21,v=>v.kitchen.dimensions.widthMm.step=0,v=>v.kitchen.dimensions.widthMm.max=1100,v=>delete v.kitchen.dimensions.depthMm]) {
  const bad=kitchenRules();mutate(bad);assert.throws(()=>parseCooktopConfig(bad));
 }
});

test('fryer is validated as a distinct authorized module and still obeys occupancy rules',()=>{
 const value=kitchenRules(); value.modules[2].kind='fryer';value.modules[2].name='Freidora';
 const rules=parseCooktopConfig(value), initial=initialCooktopSelection(rules);
 const state=placeCooktopModule(rules,initial,'plate',0);
 assert.equal(cooktopSummary(rules,state).burners,4);
 assert.match(cooktopQuoteSummary(rules,state),/Freidora: posiciones 1, 4/);
 assert.throws(()=>validateCooktopSelection(rules,{...state,placements:[...state.placements,{moduleId:'wok',anchor:3}]}),/superponerse/);
});

test('preview accepts either half of a two-position module without silently replacing neighbors',()=>{
 const preview=previewCooktopPlacement(config,fresh(),'plate',3);
 assert.equal(preview.anchor,0);assert.deepEqual(preview.cells,[0,3]);
 assert.equal(cooktopSummary(config,preview.selection).burners,4);
 const removed=previewCooktopPlacement(config,preview.selection,'burner',3);
 assert.deepEqual(removed.cells,[0,3]);assert.deepEqual(removed.selection.placements,[]);
 const blocked=placeCooktopModule(config,fresh(),'wok',0);
 assert.throws(()=>previewCooktopPlacement(config,blocked,'plate',3));
 assert.deepEqual(blocked.placements,[{moduleId:'wok',anchor:0}]);
});
test('empty config does not offer invented options',()=>{for(const value of [undefined,null,{}]) assert.equal(parseCooktopConfig(value),null);});

test('the four owner-requested families expose only their corresponding capacities and modules',()=>{
 const families=JSON.parse(readFileSync(new URL('./fixtures/kitchen-families.json',import.meta.url),'utf8'));
 for(const [family,capacities] of Object.entries({linear:[1,2,3,4,5],central:[4,6,8,10],builtin:[2,4,6],home:[4]})) {
  const rules=parseCooktopConfig(families[family]);
  assert.deepEqual(rules.layouts.map(l=>l.rows*l.columns),capacities);
  assert.equal(rules.kitchen.family,family);
  for(const layout of rules.layouts) assert.equal(cooktopSummary(rules,{...initialCooktopSelection(rules),layoutId:layout.id}).burners,layout.rows*layout.columns);
  assert.deepEqual(rules.kitchen.materials,[]); assert.equal(rules.kitchen.dimensions,null);
 }
 assert.deepEqual(families.home.modules.map(m=>m.kind),['burner']);
 assert.deepEqual(families.home.kitchen.ovens,['electric','gas','none']);
 assert.deepEqual(families.linear.modules.map(m=>m.kind),['burner','wok']);
 assert.deepEqual(families.builtin.modules.map(m=>m.kind),['burner','wok']);
 assert.deepEqual(families.central.modules.map(m=>m.kind),['burner','wok','griddle','grill','fryer']);
});

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

