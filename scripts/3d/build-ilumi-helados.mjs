/** Approximate manufacturer-photo reconstructions, not ILUMI CAD. See docs/modelos-3d/ilumi-helados.md. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {TextGeometry} from 'three/addons/geometries/TextGeometry.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {inspectGlb} from '../lib/model-budget.mjs';
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onload?.({target:this});this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}};
const font=new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json',import.meta.url),'utf8')));
const configs=[
 {sku:'MHA-16S',w:.500,d:.650,h:.800,kind:'artisan',small:true,floor:false},
 {sku:'MHA-20S',w:.535,d:.535,h:.840,kind:'artisan',small:false,floor:false},
 {sku:'MHA-20',w:.535,d:.535,h:1.370,kind:'artisan',small:false,floor:true},
 {sku:'MHS-25',w:.540,d:.575,h:1.370,kind:'soft',floor:true,pc:false,metalHeader:true},
 {sku:'MHS-25PC',w:.540,d:.735,h:1.430,kind:'soft',floor:true,pc:true},
 {sku:'MHS-30S',w:.540,d:.615,h:.780,kind:'soft',floor:false,pc:false},
 {sku:'MHS-30PC',w:.540,d:.735,h:1.430,kind:'soft',floor:true,pc:true},
];
function rect(w,h,r,cx=0,cy=0){const s=new THREE.Shape(),x=cx-w/2,y=cy-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}

for(const cfg of configs){
 const {w,d,h}=cfg,pc=cfg.pc,soft=cfg.kind==='soft',floor=cfg.floor;
 const root=new THREE.Group();root.name=`ILUMI_${cfg.sku.replace('-','_')}`;
 root.userData={sku:cfg.sku,revision:'1.0',units:'meters',orientation:'Y up; front +Z',nominalDimensions:{width:w,depth:d,height:h},description:'Visualización 3D aproximada a partir de fotografías y ficha de ILUMI. No es CAD de fabricación.',accuracy:'La envolvente se escala a las medidas de producto publicadas. Piezas, accesorios y distribución interna son aproximados; no usar para instalación ni fabricación.',foodIncluded:false,manufacturingUse:false};
 const m={
  steel:new THREE.MeshStandardMaterial({name:'Acero_satinado',color:0xbcc4cb,metalness:.80,roughness:.32}),
  edge:new THREE.MeshStandardMaterial({name:'Acero_pulido',color:0xd4dce3,metalness:.88,roughness:.22}),
  inside:new THREE.MeshStandardMaterial({name:'Interior_cilindro',color:0x647581,metalness:.72,roughness:.39,side:THREE.DoubleSide}),
  black:new THREE.MeshStandardMaterial({name:'Panel_y_mandos',color:0x111820,metalness:.08,roughness:.43}),
  dark:new THREE.MeshStandardMaterial({name:'Aberturas',color:0x202831,metalness:.12,roughness:.73}),
  white:new THREE.MeshStandardMaterial({name:'Plastico_claro',color:0xe9ebed,metalness:.04,roughness:.46}),
  blue:new THREE.MeshStandardMaterial({name:'Botones_azules',color:0x2c76ab,roughness:.43}),
  green:new THREE.MeshStandardMaterial({name:'Pantalla_y_boton_verde',color:0x78c5ab,roughness:.55}),
  red:new THREE.MeshStandardMaterial({name:'Boton_rojo_y_boquillas',color:0xb73340,roughness:.45}),
  wheel:new THREE.MeshStandardMaterial({name:'Ruedas',color:pc?0x62343b:0x242b2d,roughness:.73}),
  clear:new THREE.MeshPhysicalMaterial({name:'Acrilico_transparente',color:0xdae6ed,transparent:true,opacity:.14,depthWrite:false,roughness:.12,clearcoat:.8,side:THREE.DoubleSide}),
  rim:new THREE.MeshPhysicalMaterial({name:'Bordes_acrilico',color:0xdce6eb,transparent:true,opacity:.43,depthWrite:false,roughness:.15,clearcoat:.8}),
 };
 const groups=new Map();
 function add(geo,mat,name,pos=[0,0,0],rot=[0,0,0]){const mesh=new THREE.Mesh(geo,mat);mesh.position.set(...pos);mesh.rotation.set(...rot);mesh.updateMatrix();geo.applyMatrix4(mesh.matrix);const g=geo.index?geo.toNonIndexed():geo;g.deleteAttribute('uv');if(!groups.has(mat.uuid))groups.set(mat.uuid,{mat,geos:[],names:[]});groups.get(mat.uuid).geos.push(g);groups.get(mat.uuid).names.push(name);}
 function box(name,size,pos,mat=m.steel,r=.002){add(new RoundedBoxGeometry(...size,2,Math.min(r,...size.map(v=>v/2))),mat,name,pos);}
 function cyl(name,r,len,pos,mat=m.edge,rot=[0,0,0],open=false){add(new THREE.CylinderGeometry(r,r,len,32,1,open),mat,name,pos,rot);}
 function bar(name,a,b,r=.006,mat=m.edge){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av),geo=new THREE.CylinderGeometry(r,r,v.length(),16);geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize()));add(geo,mat,name,av.add(bv).multiplyScalar(.5).toArray());}
 function brand(x,y,z,size=.020){const tw=size*2.5;box('Placa_marca',[tw+.012,size*1.35,.002],[x,y+size*.32,z],m.black,.001);const g=new TextGeometry('ilumi',{font,size,depth:.00015,curveSegments:3,bevelEnabled:false});g.computeBoundingBox();g.translate(-(g.boundingBox.max.x-g.boundingBox.min.x)/2,0,0);add(g,m.white,'Marca_ilumi',[x,y,z+.0016]);}
 function star(x,y,z,mat=m.black){const s=new THREE.Shape();for(let i=0;i<20;i++){const a=i*Math.PI/10,r=i%4<2?.019:.013;const xx=Math.cos(a)*r,yy=Math.sin(a)*r;if(i===0)s.moveTo(xx,yy);else s.lineTo(xx,yy);}s.closePath();add(new THREE.ExtrudeGeometry(s,{depth:.015,bevelEnabled:true,bevelThickness:.0015,bevelSize:.0015,bevelSegments:1}),mat,'Cierre_estrella',[x,y,z]);cyl('Centro_cierre',.004,.002,[x,y,z+.018],m.dark,[Math.PI/2,0,0]);}
 function sideVent(x,y,z,width,height,cols,rows){const shape=rect(width,height,.002);for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)shape.holes.push(rect(width/(cols+1)*.66,height/(rows+1)*.28,.0007,(col-(cols-1)/2)*width/(cols+.5),(row-(rows-1)/2)*height/(rows+.5)));const side=x>0?1:-1;box('Fondo_ventilacion',[.002,height,width],[x-side*.002,y,z],m.dark);add(new THREE.ExtrudeGeometry(shape,{depth:.001,bevelEnabled:false,curveSegments:2}),m.steel,'Rejilla_lateral_perforada',[x,y,z],[0,side*Math.PI/2,0]);}
 function tray(width,depth,x,y,z,{holes=false}={}){box('Base_bandeja',[width,.018,depth],[x,y,z],m.black,.004);box('Superficie_bandeja',[width-.012,.002,depth-.012],[x,y+.010,z],m.edge,.003);if(holes)for(const dx of [-width*.26,0,width*.26])cyl('Orificio_bandeja',.016,.002,[x+dx,y+.012,z],m.dark);for(const zz of [-depth/2,depth/2])box('Borde_bandeja',[width,.010,.005],[x,y+.012,z+zz],m.black);}
 function wheelAt(x,z,r=.035){cyl('Rueda',r,.023,[x,r,z],m.wheel,[0,0,Math.PI/2]);cyl('Centro_rueda',r*.65,.027,[x,r,z],m.edge,[0,0,Math.PI/2]);for(const dx of [-.019,.019])box('Horquilla_rueda',[.006,.055,.030],[x+dx,.070,z],m.edge);cyl('Eje_rueda',.013,.020,[x,.097,z]);}
 function cupHolder(x,z,bottom,length,r=.031){cyl('Portaconos_vacio',r,length,[x,bottom+length/2,z],m.clear,[0,0,0],true);cyl('Tapa_portaconos',r+.002,.010,[x,bottom+length+.004,z],m.white);cyl('Aro_portaconos',r+.003,.020,[x,bottom+.014,z],m.white,[0,0,0],true);const anchor=Math.max(-.17,Math.min(.17,x));if(Math.abs(x-anchor)>.001)bar('Soporte_portaconos',[x,bottom+.040,z],[anchor,bottom+.040,z],.009,m.white);}
 function display(x,y,z,{pc=false,vertical=false}={}){const ww=pc?.235:vertical?.038:.095,hh=pc?.085:vertical?.115:.065;box('Control_digital',[ww,hh,.003],[x,y,z],vertical?m.white:m.black,.003);box('Pantalla',[ww*(vertical?.70:.58),hh*(vertical?.23:.42),.002],[x,y+hh*.17,z+.003],pc?m.blue:m.green,.001);for(let i=0;i<(vertical?3:4);i++)cyl('Tecla_control',.0055,.003,[x+(vertical?0:(i-1.5)*ww*.19),y+(vertical?-.003-i*.024:-hh*.25),z+.004],[m.green,m.red,m.blue,m.blue][i], [Math.PI/2,0,0]);}

 // Reserve the front projection for the cylinder, taps or tray. Nominal bounds are applied after modelling.
 const bodyW=pc?w-.075:w,bodyTop=soft?(pc?h-.230:floor?h-.200:h-.145):h;
 const bottom=floor?.108:(soft?.018:.026),bodyFront=d/2-.105,back=-d/2;
 box('Cuerpo_principal',[bodyW,bodyTop-bottom,bodyFront-back],[0,(bodyTop+bottom)/2,(bodyFront+back)/2],m.steel,.005);
 // Lift the separate skin 2 mm above the body face to avoid coplanar depth artifacts.
 box('Cubierta',[bodyW+.006,.014,bodyFront-back+.008],[0,bodyTop-.005,(bodyFront+back)/2],m.edge,.003);
 for(const x of [-bodyW/2+.040,bodyW/2-.040])for(const z of [back+.040,bodyFront-.040]){
  if(floor)wheelAt(x,z);else cyl('Tope_base',.017,bottom,[x,bottom/2,z],m.black);
 }
 for(const x of [-bodyW/2+.014,bodyW/2-.014])box('Union_panel_frontal',[.0015,bodyTop-bottom-.035,.001],[x,(bodyTop+bottom)/2,bodyFront+.003],m.dark,.0002);

 if(!soft){
  const radius=cfg.small?.165:.170,cy=floor?h-.310:h-.295,face=bodyFront+.043;
  const panelTop=bodyTop-.095,panelBottom=cy-radius-.060;
  box('Panel_cilindro',[bodyW-.055,panelTop-panelBottom,.004],[0,(panelTop+panelBottom)/2,bodyFront+.005],m.edge,.002);
  // Empty front chamber; visible cover and external fittings only, no food or hidden agitator design.
  cyl('Fondo_cilindro_vacio',radius*.86,.010,[0,cy,bodyFront+.012],m.inside,[Math.PI/2,0,0]);
  cyl('Pared_cilindro',radius,.060,[0,cy,bodyFront+.035],m.edge,[Math.PI/2,0,0],true);
  cyl('Tapa_acrilica',radius*.99,.009,[0,cy,face+.029],m.clear,[Math.PI/2,0,0]);
  add(new THREE.TorusGeometry(radius,.007,10,64),m.rim,'Aro_tapa',[0,cy,face+.036]);
  add(new THREE.TorusGeometry(radius*.86,.0035,8,64),m.rim,'Aro_interior_tapa',[0,cy,face+.041]);
  for(const xx of [-radius*.73,radius*.73])for(const yy of [-radius*.69,radius*.69])star(xx,cy+yy,face+.038,cfg.small?m.white:m.black);
  // Transparent feed funnel, open at the top, as shown in the manufacturer's front photograph.
  add(new THREE.CylinderGeometry(.105,.038,.125,40,1,true),m.clear,'Tolva_de_carga',[0,cy+radius*.92,face+.031]);
  add(new THREE.TorusGeometry(.105,.003,8,40),m.rim,'Borde_tolva',[0,cy+radius*.92+.0625,face+.031],[Math.PI/2,0,0]);
  box('Soporte_salida',[.095,.046,.060],[0,cy-radius*.80,face+.039],cfg.small?m.clear:m.white,.006);
  cyl('Salida_producto_vacia',.027,.040,[0,cy-radius-.010,face+.052],m.rim,[0,0,0],true);
  if(cfg.small){
   box('Panel_superior_negro',[bodyW-.012,.075,.015],[0,h-.041,bodyFront+.010],m.black,.007);
   display(0,h-.043,bodyFront+.021);brand(-bodyW*.34,h-.125,bodyFront+.012,.017);
   const c=new THREE.CatmullRomCurve3([new THREE.Vector3(-.145,cy-.19,bodyFront+.007),new THREE.Vector3(-.09,.16,bodyFront+.008),new THREE.Vector3(.09,.16,bodyFront+.008),new THREE.Vector3(.145,cy-.19,bodyFront+.007)]);
   add(new THREE.TubeGeometry(c,24,.002,8,false),m.edge,'Relieve_frontal_curvo');
  }else{
   display(floor?-bodyW*.35:bodyW*.35,cy+.050,bodyFront+.017,{vertical:true});brand(-bodyW*.28,bodyTop-.077,bodyFront+.010,.026);
   box('Repisa_salida',[.200,.016,.088],[0,cy-radius-.045,face+.035],m.white,.005);
  }
  if(floor){
   tray(bodyW*.76,.175,0,.680,bodyFront+.065);
   // Empty removable receiving container, shown without the ice cream from the photo.
   box('Fondo_recipiente',[.300,.010,.145],[0,.705,bodyFront+.060],m.edge,.005);
   for(const x of [-.150,.150])box('Costado_recipiente',[.005,.105,.145],[x,.7575,bodyFront+.060],m.edge,.003);
   for(const zz of [bodyFront-.0125,bodyFront+.1325])box('Frente_recipiente',[.300,.105,.005],[0,.7575,zz],m.edge,.003);
  }
  sideVent((floor?1:-1)*(bodyW/2+.002),bottom+(bodyTop-bottom)*.23,(back+bodyFront)/2,(bodyFront-back)*.77,(bodyTop-bottom)*.28,7,floor?20:13);
  if(cfg.small)sideVent(-bodyW/2-.002,h*.68,(back+bodyFront)/2,(bodyFront-back)*.55,.075,3,4);
 }else{
  const headY=pc?bodyTop-.185:floor?bodyTop-.195:bodyTop-.200;
  const headZ=bodyFront+.043,headW=.310,headH=.120;
  box('Cabecera',[bodyW+.005,.135,.030],[0,bodyTop-.077,bodyFront+.018],cfg.metalHeader?m.edge:m.black,.007);
  display(pc?0:bodyW*.29,bodyTop-.074,bodyFront+.037,{pc});
  box('Borde_cabezal',[headW+.018,headH+.016,.048],[0,headY,headZ],m.edge,.013);
  box('Cabezal_dispensador',[headW,headH,.040],[0,headY,headZ+.027],cfg.metalHeader?m.white:m.black,.011);
  for(const x of [-headW/2+.013,headW/2-.013])for(const yy of [-headH*.39,headH*.39])star(x,headY+yy,headZ+.050);
  for(const x of [-.081,0,.081]){
   const pts=[new THREE.Vector3(x,headY+.035,headZ+.050),new THREE.Vector3(x,headY+.065,headZ+.075),new THREE.Vector3(x,headY+.165,headZ+.105)];
   add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),12,.007,10,false),m.edge,'Palanca_sin_animacion');
   bar('Empunadura_palanca',[x,headY+.125,headZ+.095],[x,headY+.205,headZ+.120],.011,pc?m.black:m.edge);
   cyl('Boquilla_salida',.015,.022,[x,headY-headH/2-.008,headZ+.038],pc?m.red:m.black,[0,0,0],true);
  }
  const trayY=pc?.590:floor?.555:.070;
  tray(bodyW*.82,.130,0,trayY,bodyFront+.058,{holes:true});
  if(pc){
   brand(0,headY-.015,headZ+.050,.018);
   // Curved raised front panel visible on both PC photos; it is not a functional part diagram.
   const s=new THREE.Shape();s.moveTo(-.155,0);s.bezierCurveTo(-.175,-.035,-.130,-.065,-.155,-.095);s.bezierCurveTo(-.160,-.160,-.095,-.225,-.085,-.265);s.lineTo(.085,-.265);s.bezierCurveTo(.095,-.225,.160,-.160,.155,-.095);s.bezierCurveTo(.130,-.065,.175,-.035,.155,0);s.quadraticCurveTo(0,-.025,-.155,0);
   add(new THREE.ExtrudeGeometry(s,{depth:.009,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:2,curveSegments:12}),m.edge,'Relieve_curvo_PC',[0,headY-.095,bodyFront+.009]);
   // Empty cone tubes; no cones are baked into the model.
   cupHolder(-bodyW/2-.030,bodyFront-.090,bodyTop-.060,.285,.038);
   cupHolder(-bodyW/2-.030,bodyFront-.185,bodyTop-.060,.115,.038);
  }else{
   brand(-bodyW*.29,headY-.135,bodyFront+.010,.022);
   const count=cfg.metalHeader?2:1;
   for(let i=0;i<count;i++)cupHolder(bodyW*.30+i*.062,back+.130,bodyTop-.020,floor?.210:.150,.026);
   // The photographs have commercial ice-cream stickers here. They are deliberately not invented as textures.
   box('Panel_frontal_sin_grafica_promocional',[bodyW-.065,Math.max(.18,trayY-bottom-.025),.003],[0,(trayY+bottom)/2-.012,bodyFront+.004],m.steel,.003);
  }
  // Two closed top hopper covers, visible in the supplied photographs.
  for(const x of [-bodyW*.22,bodyW*.22]){
   box('Tapa_tolva_superior',[bodyW*.38,.012,(bodyFront-back)*.45],[x,bodyTop+.005,(back+bodyFront)/2-.040],m.black,.007);
   bar('Asa_tapa',[x-.025,bodyTop+.024,(back+bodyFront)/2-.040],[x+.025,bodyTop+.024,(back+bodyFront)/2-.040],.007,m.edge);
  }
  const ventH=floor?.34:bodyTop*.62;
  sideVent(-bodyW/2-.002,bottom+ventH/2+.040,(back+bodyFront)/2,(bodyFront-back)*.77,ventH,7,floor?21:25);
  if(floor)sideVent(-bodyW/2-.002,.650,(back+bodyFront)/2,(bodyFront-back)*.45,.095,4,5);
 }

 for(const {mat,geos,names} of groups.values()){const geo=mergeVertices(mergeGeometries(geos,false),1e-6),mesh=new THREE.Mesh(geo,mat);mesh.name=mat.name;mesh.userData.parts=names;root.add(mesh);}
 root.updateMatrixWorld(true);let bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3());
 // Scale the photographed accessory envelope to the product dimensions (never packaging dimensions).
 // This does not make the estimated components dimensionally exact.
 const scale=new THREE.Vector3(w/size.x,h/size.y,d/size.z),centre=bounds.getCenter(new THREE.Vector3());
 const matrix=new THREE.Matrix4().makeScale(scale.x,scale.y,scale.z).multiply(new THREE.Matrix4().makeTranslation(-centre.x,-bounds.min.y,-centre.z));
 root.traverse(o=>{if(o.isMesh)o.geometry.applyMatrix4(matrix);});root.updateMatrixWorld(true);
 bounds=new THREE.Box3().setFromObject(root);size=bounds.getSize(new THREE.Vector3());
 if(Math.abs(size.x-w)>.00001||Math.abs(size.y-h)>.00001||Math.abs(size.z-d)>.00001)throw Error(`${cfg.sku}: nominal envelope mismatch`);
 const buffer=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true})),report=inspectGlb(buffer);
 if(report.errors.length||report.warnings.length)throw Error(JSON.stringify(report));
 const output=`public/models/ilumi/${cfg.sku.toLowerCase()}-v1.glb`;await fs.writeFile(output,buffer);
 console.log(JSON.stringify({sku:cfg.sku,output,bytes:buffer.length,triangles:report.triangles,nominalEnvelope:size.toArray(),animations:0}));
}
