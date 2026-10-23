/** Photo-based presentation meshes. Dimensions are illustrative, not fabrication drawings.
 * node scripts/3d/build-inox-cocinas.mjs [P02|P03|P04|P05]
 * See docs/modelos-3d/inox-cocinas.md for source photographs and limitations. */
import fs from 'node:fs/promises';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this});}).catch(error=>this.onerror?.(error));}};
const specs=[
 {id:'P02',slug:'cocina-industrial-de-3-hornillas',w:1.5,d:.57,h:.85,open:true,plain:true},
 {id:'P03',slug:'cocina-industrial-de-3-parrillas',w:1.5,d:.57,h:.85,open:true,plain:false},
 {id:'P04',slug:'cocina-industrial-4-hornillas-tipo-isla-plancha-ho',w:1.5,d:.85,h:.85,open:false,plain:false},
 {id:'P05',slug:'cocina-industrial-tipo-isla-4-parrillas-plancha-ho',w:1.5,d:.85,h:.85,open:false,plain:false},
];
const arg=process.argv[2];if(arg&&!specs.some(s=>s.id===arg))throw Error('Unknown kitchen');
function shape(w,h,r,cx=0,cy=0){let p=new T.Shape(),x=cx-w/2,y=cy-h/2;p.moveTo(x+r,y);p.lineTo(x+w-r,y);p.quadraticCurveTo(x+w,y,x+w,y+r);p.lineTo(x+w,y+h-r);p.quadraticCurveTo(x+w,y+h,x+w-r,y+h);p.lineTo(x+r,y+h);p.quadraticCurveTo(x,y+h,x,y+h-r);p.lineTo(x,y+r);p.quadraticCurveTo(x,y,x+r,y);return p;}
async function build(s){
 const root=new T.Group();root.name='INOX_'+s.id;root.userData={description:'Visualización aproximada de fotografía del catálogo. Proporciones ilustrativas; medidas finales a confirmar.',dimensionsVerified:false,units:'meters',scale:'illustrative, not a dimension specification',sourceImage:'/images/products/'+s.slug+(s.id==='P02'?'.jpg':'.webp'),orientation:'Y up, front +Z',mechanisms:'No unverified opening or operation is simulated.'};
 const mats={steel:new T.MeshStandardMaterial({name:'Acero_satinado',color:0xbac3c8,metalness:.88,roughness:.31}),edge:new T.MeshStandardMaterial({name:'Acero_bordes',color:0xdde2e4,metalness:.94,roughness:.2}),dark:new T.MeshStandardMaterial({name:'Hierro_fundido',color:0x171b1e,metalness:.47,roughness:.59}),rubber:new T.MeshStandardMaterial({name:'Patas_y_controles',color:0x090d11,roughness:.73}),blue:new T.MeshStandardMaterial({name:'Placas_azules',color:0x153e75,metalness:.22,roughness:.35}),glass:new T.MeshStandardMaterial({name:'Visor_horno',color:0x152029,metalness:.2,roughness:.19}),white:new T.MeshStandardMaterial({name:'Esfera_indicador',color:0xe5e8e5,roughness:.6})};
 const parts=new Map();const add=(g,m,x=0,y=0,z=0,rot)=>{if(g.index)g=g.toNonIndexed();g.deleteAttribute('uv');if(rot)g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rot)));g.translate(x,y,z);if(!parts.has(m))parts.set(m,[]);parts.get(m).push(g);};
 const box=(w,h,d,x,y,z,m=mats.steel,r=.003)=>add(r?new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)):new T.BoxGeometry(w,h,d),m,x,y,z);
 const cyl=(r,h,x,y,z,m=mats.edge,front=false)=>add(new T.CylinderGeometry(r,r,h,32),m,x,y,z,front?[Math.PI/2,0,0]:undefined);
 const torus=(r,t,x,y,z,m=mats.edge,flat=false)=>add(new T.TorusGeometry(r,t,6,40),m,x,y,z,flat?[Math.PI/2,0,0]:undefined);
 const plate=(w,h,holes,depth,x,y,z,m=mats.steel,rot)=>{const p=shape(w,h,.005);p.holes.push(...holes);add(new T.ExtrudeGeometry(p,{depth,bevelEnabled:false,curveSegments:6}),m,x,y,z,rot);};
 const front=s.d/2;const top=s.h-.045;
 // Folded top and the dark recessed wells are split to leave visible open burners.
 box(s.w,.042,s.d,0,top-.021,0,mats.steel,.009);
 box(s.w+.016,.026,.028,0,top+.003,front-.006,mats.edge,.009);
 box(.024,.021,s.d,-s.w/2+.009,top+.009,0,mats.edge);
 box(.024,.021,s.d,s.w/2-.009,top+.009,0,mats.edge);
 box(s.w,.021,.024,0,top+.009,-front+.01,mats.edge);
 function burner(x,z,size){
  const rim=shape(size,size,.005),hole=shape(size-.018,size-.018,.003);rim.holes.push(hole);
  add(new T.ExtrudeGeometry(rim,{depth:.012,bevelEnabled:false}),mats.edge,x,top+.018,z,[Math.PI/2,0,0]);
  box(size-.018,.005,size-.018,x,top+.012,z,mats.dark,0);
  cyl(size*.235,.009,x,top+.024,z,mats.edge);cyl(size*.135,.013,x,top+.03,z,mats.dark);
  torus(size*.16,.006,x,top+.036,z,mats.dark,true);
  for(let i=0;i<28;i++){const a=i*Math.PI*2/28;cyl(.0018,.003,x+Math.cos(a)*size*.147,top+.041,z+Math.sin(a)*size*.147,mats.edge);}
  // Eight pot supports, shortened around the real central burner opening.
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const rad=size*.32;
   add(new T.BoxGeometry(size*.25,.027,.022),mats.dark,x+Math.cos(a)*rad,top+.046,z+Math.sin(a)*rad,[0,-a,0]);}
 }
 function knob(x,y,blue=true){if(blue){box(.075,.079,.003,x,y,front+.002,mats.blue,.004);for(let a=-2;a<=2;a++)box(.002,.009,.002,x+a*.011,y+.025-Math.abs(a)*.004,front+.005,mats.white,0);}
  cyl(.019,.028,x,y,front+.024,mats.edge,true);cyl(.026,.013,x,y-.008,front+.044,mats.steel,true);torus(.026,.003,x,y-.008,front+.052,mats.edge);box(.003,.013,.002,x,y+.005,front+.053,mats.rubber,0);
 }
 if(s.open){
  [-s.w*.323,0,s.w*.323].forEach(x=>burner(x,0,s.d*.72));
  box(s.w,.09,.032,0,top-.075,front-.014);box(s.w-.085,.04,.032,0,top-.185,front-.014);
  if(s.plain)box(s.w-.085,.06,.008,0,top-.13,front-.03,mats.dark,0);
  for(const x of[-s.w/2+.032,s.w/2-.032])for(const z of[-front+.03,front-.03]){box(.048,top-.07,.048,x,(top-.07)/2+.028,z);box(.05,.034,.05,x,.017,z,mats.rubber,.003);}
  const shelfY=.175;
  if(s.plain)box(s.w-.08,.024,s.d-.06,0,shelfY,0);
  else {const holes=[];for(const x of[-.45,-.15,.15,.45])holes.push(shape(.032,s.d-.19,.004,x,0));
   plate(s.w-.08,s.d-.06,holes,.012,0,shelfY,0,mats.steel,[Math.PI/2,0,0]);}
  box(s.w-.07,.042,.025,0,shelfY-.014,front-.03);box(s.w-.07,.042,.025,0,shelfY-.014,-front+.03);
  for(const x of[-s.w*.323,0,s.w*.323])knob(x,top-.125,!s.plain);
  if(s.plain)for(const x of[-s.w*.323,0,s.w*.323])torus(.023,.006,x,top-.125,front+.012,mats.blue);
  else box(s.w,.10,.025,0,top+.07,-front+.012);
 }else{
  for(const x of[-s.w*.33,-s.w*.04])for(const z of[-s.d*.235,s.d*.235])burner(x,z,s.d*.40);
  // Flat plancha and its perforated separator are individually recognizable.
  const px=s.w*.328,pw=s.w*.28,pd=s.d*.85;box(pw,.014,pd,px,top+.021,0,mats.edge);
  for(const x of[px-pw/2,px+pw/2])box(.012,.032,pd,x,top+.035,0,mats.steel);
  for(const z of[-pd/2,pd/2])box(pw,.032,.012,px,top+.035,z,mats.steel);
  const sepX=px-pw/2-.019;
  for(const x of[sepX-.019,sepX+.019])box(.004,.078,pd,x,top+.059,0);
  for(const z of[-pd/2+.002,pd/2-.002])box(.042,.078,.004,sepX,top+.059,z);
  box(.034,.003,pd-.008,sepX,top+.026,0,mats.dark,0);
  const holes=[];for(let i=0;i<9;i++){const h=new T.Path();h.absarc(0,-pd*.43+i*pd*.108,.012,0,Math.PI*2,true);holes.push(h);}
  plate(.048,pd,holes,.004,sepX,top+.1,0,mats.edge,[Math.PI/2,0,0]);
  box(s.w,.092,.025,0,top-.071,front-.012);box(s.w,.048,.032,0,top-.132,front-.016);
  const ovenW=s.w*.65,ovenX=-s.w*.16,bodyH=top-.20;
  box(ovenW,bodyH,s.d-.025,ovenX,.075+bodyH/2,0); // concealed interior is deliberately not represented
  const doorW=ovenW-.07,doorH=bodyH-.05,dy=.085+doorH/2;
  const win=shape(doorW*.58,doorH*.37,.024,0,.015);
  plate(doorW,doorH,[win],.016,ovenX,dy,front+.004,mats.steel);
  box(doorW*.58-.004,doorH*.37-.004,.006,ovenX,dy+.015,front+.012,mats.glass,.019);
  box(doorW*.8,.027,.022,ovenX,dy+doorH*.40,front+.067,mats.edge,.005);
  for(const x of[ovenX-doorW*.39,ovenX+doorW*.39])box(.025,.025,.05,x,dy+doorH*.40,front+.042);
  box(.18,.068,.016,ovenX,dy-doorH*.32,front+.02);box(.008,.044,.016,ovenX-.07,dy-doorH*.32,front+.035,mats.edge);
  const shelfX=s.w*.348,sideW=s.w*.26;box(sideW,.026,s.d-.03,shelfX,.092,0);
  for(const z of[-front+.03,front-.03])box(.043,top-.13,.043,s.w/2-.025,(top-.13)/2+.056,z);
  for(const x of[-s.w/2+.06,ovenX+ovenW/2-.04,s.w/2-.03])for(const z of[-front+.05,front-.04]){cyl(.025,.047,x,.04,z);cyl(.025,.022,x,.012,z,mats.rubber);}
  [-s.w*.30,0,s.w*.32].forEach(x=>knob(x,top-.074));
  cyl(.035,.012,-s.w*.42,top-.075,front+.017,mats.edge,true);cyl(.028,.004,-s.w*.42,top-.075,front+.025,mats.white,true);add(new T.BoxGeometry(.003,.034,.002),mats.dark,-s.w*.42+.006,top-.069,front+.029,[0,0,-.45]);
  cyl(.034,.017,-s.w*.16,top-.075,front+.022,mats.rubber,true);torus(.034,.004,-s.w*.16,top-.075,front+.035,mats.edge);box(.006,.023,.009,-s.w*.16,top-.075,front+.04,mats.edge);
  box(.015,.024,.004,s.w*.13,dy+doorH*.36,front+.027,s.id==='P05'?new T.MeshStandardMaterial({name:'Interruptor_rojo',color:0xa41012,roughness:.5}):mats.rubber);
 }
 for(const[material,geometries]of parts){const mesh=new T.Mesh(mergeGeometries(geometries),material);mesh.name=material.name;root.add(mesh);}
 const bytes=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true}));const out='public/models/inox/'+s.slug+'-v1.glb';await fs.mkdir('public/models/inox',{recursive:true});await fs.writeFile(out,bytes);const info=inspectGlb(bytes);if(info.errors.length)throw Error(info.errors.join(';'));console.log(JSON.stringify({id:s.id,path:out,size:bytes.length,triangles:info.triangleCount??info.triangles,dimensionBasis:'illustrative',warnings:info.warnings}));
}
for(const spec of specs.filter(s=>!arg||arg===s.id))await build(spec);
