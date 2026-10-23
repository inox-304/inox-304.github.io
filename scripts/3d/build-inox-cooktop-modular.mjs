/** Modular presentation geometry. Run with a product ID, or omit it for P02-P05.
 * The existing kitchen GLBs/catalog records are preserved. See the asset contract
 * in docs/modelos-3d/cooktop-modular.md before using these component libraries. */
import fs from 'node:fs/promises';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { kitchenSpecs, createKitchenScene } from './build-inox-cocinas.mjs';
import { inspectGlb } from '../lib/model-budget.mjs';

function roundedShape(w,h,r){const p=new T.Shape(),x=-w/2,y=-h/2;p.moveTo(x+r,y);p.lineTo(x+w-r,y);p.quadraticCurveTo(x+w,y,x+w,y+r);p.lineTo(x+w,y+h-r);p.quadraticCurveTo(x+w,y+h,x+w-r,y+h);p.lineTo(x+r,y+h);p.quadraticCurveTo(x,y+h,x,y+h-r);p.lineTo(x,y+r);p.quadraticCurveTo(x,y,x+r,y);return p;}

// Template geometry uses a 340 mm visual source unit, then normalizes only X/Z.
// This unit is a reconstruction convention, not a commercial measurement.
const UNIT=.34;
function makeTemplate(name,kind,materials,draw){
 const group=new T.Group();group.name=name;
 group.userData={kind,footprint:{width:1,height:1},baseY:0,dimensionsVerified:false,visualOnly:true};
 const buckets=new Map();
 const add=(geometry,material,x=0,y=0,z=0,rotation)=>{
  let g=geometry.index?geometry.toNonIndexed():geometry;g.deleteAttribute('uv');
  if(rotation)g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation)));
  g.translate(x,y,z);if(!buckets.has(material))buckets.set(material,[]);buckets.get(material).push(g);
 };
 const box=(w,h,d,x,y,z,m=materials.steel,r=.002)=>add(r?new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)):new T.BoxGeometry(w,h,d),m,x,y,z);
 const cyl=(r,h,x,y,z,m=materials.dark)=>add(new T.CylinderGeometry(r,r,h,48),m,x,y,z);
 const torus=(r,t,x,y,z,m=materials.dark)=>add(new T.TorusGeometry(r,t,8,64),m,x,y,z,[Math.PI/2,0,0]);
 const rim=()=>{const shape=roundedShape(UNIT,UNIT,.005);shape.holes.push(roundedShape(UNIT-.018,UNIT-.018,.003));add(new T.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:false,curveSegments:8}),materials.edge,0,.018,0,[Math.PI/2,0,0]);box(UNIT-.018,.005,UNIT-.018,0,.012,0,materials.dark,0);};
 const gas=(supports=true)=>{
  rim();cyl(UNIT*.235,.009,0,.024,0,materials.edge);cyl(UNIT*.135,.013,0,.03,0);torus(UNIT*.16,.006,0,.036,0);
  for(let i=0;i<28;i++){const a=i*Math.PI*2/28;cyl(.0018,.003,Math.cos(a)*UNIT*.147,.041,Math.sin(a)*UNIT*.147,materials.edge);}
  if(supports)for(let i=0;i<8;i++){const a=i*Math.PI/4,rad=UNIT*.32;add(new T.BoxGeometry(UNIT*.25,.027,.022),materials.dark,Math.cos(a)*rad,.046,Math.sin(a)*rad,[0,-a,0]);}
 };
 draw({add,box,cyl,torus,rim,gas});
 for(const[material,geometries]of buckets){const geometry=mergeGeometries(geometries);geometry.scale(1/UNIT,1,1/UNIT);const mesh=new T.Mesh(geometry,material);mesh.name=name+'_'+material.name;group.add(mesh);}
 group.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(group);
 // Bake the support plane into the geometry, so every template root is identity.
 for(const mesh of group.children)mesh.geometry.translate(0,-bounds.min.y,0);
 group.userData.visualHeight=bounds.max.y-bounds.min.y;
 return group;
}

function createTemplates(materials){
 const bank=new T.Group();bank.name='CooktopTemplates';
 bank.userData={componentLibrary:true,hideBeforeRendering:true,templateAxis:'Y up; X/Z normalized; front +Z'};
 bank.add(makeTemplate('BurnerGas','burner',materials,({gas})=>gas()));
 bank.add(makeTemplate('BurnerElectric','burner',materials,({rim,cyl,torus})=>{
  rim();cyl(.119,.01,0,.029,0);cyl(.112,.005,0,.036,0);
  for(const r of [.026,.043,.060,.077,.094,.108])torus(r,.0018,0,.039,0,materials.edge);
 }));
 bank.add(makeTemplate('Wok','wok',materials,({gas,add,box,torus})=>{
  gas(false);
  for(const x of[-.093,.093])for(const z of[-.093,.093])box(.024,.045,.024,x,.043,z,materials.dark);
  const profile=[[.082,.041],[.092,.041],[.132,.092],[.132,.101],[.121,.101],[.121,.096],[.082,.049],[.082,.041]].map(([x,y])=>new T.Vector2(x,y));
  add(new T.LatheGeometry(profile,80),materials.dark);torus(.126,.005,0,.100,0,materials.dark);
  for(let i=0;i<4;i++){const a=i*Math.PI/2;add(new RoundedBoxGeometry(.038,.013,.024,2,.003),materials.dark,Math.cos(a)*.121,.105,Math.sin(a)*.121,[0,-a,0]);}
 }));
 bank.add(makeTemplate('Griddle','griddle',materials,({box})=>{
  box(UNIT,.014,UNIT,0,.007,0,materials.edge,.003);
  for(const x of[-UNIT/2+.006,UNIT/2-.006])box(.012,.032,UNIT,x,.021,0);
  for(const z of[-UNIT/2+.006,UNIT/2-.006])box(UNIT,.032,.012,0,.021,z);
 }));
 bank.add(makeTemplate('Grill','grill',materials,({box})=>{
  box(UNIT,.008,UNIT,0,.004,0,materials.dark,.003);
  for(const x of[-UNIT/2+.009,UNIT/2-.009])box(.018,.027,UNIT,x,.021,0,materials.dark);
  for(const z of[-UNIT/2+.009,UNIT/2-.009])box(UNIT,.027,.018,0,.021,z,materials.dark);
  for(let i=0;i<13;i++)box(.011,.019,UNIT-.034,-.141+i*.0235,.032,0,materials.dark,.003);
 }));
 return bank;
}

const requested=process.argv[2];
if(requested&&!kitchenSpecs.some(spec=>spec.id===requested))throw Error('Unknown modular kitchen');
for(const spec of kitchenSpecs.filter(spec=>!requested||spec.id===requested)){
 const {root:chassis,animations,materials,surface}=createKitchenScene(spec,{includeSurface:false});
 chassis.name='CooktopChassis';chassis.userData.sourceProductId=spec.id;
 const scene=new T.Scene();scene.name='INOX_Modular_'+spec.id;
 scene.userData={
  description:'Component library for an illustrative kitchen configurator; hide CooktopTemplates and instantiate approved modules before displaying.',
  sourceProductId:spec.id,dimensionsVerified:false,units:'meters',orientation:'Y up; front +Z; row 0 at minZ; columns increase with X',
  sourceImage:chassis.userData.sourceImage,
  cooktop:{version:1,surface,templates:{burnerGas:'BurnerGas',burnerElectric:'BurnerElectric',wok:'Wok',griddle:'Griddle',grill:'Grill'}},
 };
 scene.add(chassis,createTemplates(materials));
 const bytes=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true,animations}));
 const report=inspectGlb(bytes);if(report.errors.length)throw Error(report.errors.join(';'));
 const output=`public/models/inox/cooktop-${spec.id.toLowerCase()}-v1.glb`;
 await fs.mkdir('public/models/inox',{recursive:true});await fs.writeFile(output,bytes);
 console.log(JSON.stringify({id:spec.id,output,bytes:bytes.length,triangles:report.triangles,animations:animations.map(clip=>clip.name),surface,warnings:report.warnings}));
}
