/** Photo-based visual reconstructions, not manufacturer CAD. See docs/modelos-3d/ilumi-vacio.md. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onload?.({target:this}); this.onloadend?.({target:this}); }).catch(error => this.onerror?.(error)); }
};
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));
const models = [
  { sku:'VM-300T', width:.460, depth:.390, height:.400, sealLength:.300, sealWidth:.008, compact:true },
  { sku:'VM-400T', width:.540, depth:.490, height:.450, sealLength:.400, sealWidth:.010, compact:false },
  { sku:'VM-500T', width:.650, depth:.575, height:.480, sealLength:.500, sealWidth:.010, compact:false },
];

function roundRect(w,h,r,cx=0,cy=0) {
  const s=new THREE.Shape(), x=cx-w/2,y=cy-h/2;
  s.moveTo(x+r,y); s.lineTo(x+w-r,y); s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r); s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h); s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r); s.quadraticCurveTo(x,y,x+r,y); return s;
}

for (const cfg of models) {
  const {width:w,depth:d,height:h,compact}=cfg;
  const root=new THREE.Group(); root.name=`ILUMI_${cfg.sku.replace('-','_')}`;
  root.userData={units:'meters',nominalDimensions:{width:w,depth:d,height:h},description:'Reconstrucción visual aproximada desde fotografías y dimensiones de ILUMI. No es CAD de fabricación; interior de cámara y herrajes aproximados.',revision:'1.0',orientation:'Y up; front +Z'};
  const steel=new THREE.MeshStandardMaterial({name:'Acero_satinado',color:0xb7bdc3,metalness:.88,roughness:.31});
  const polished=new THREE.MeshStandardMaterial({name:'Acero_cantos_y_herrajes',color:0xcbd0d7,metalness:.95,roughness:.2});
  const inside=new THREE.MeshStandardMaterial({name:'Cuba_acero',color:0xaab2bc,metalness:.83,roughness:.37,side:THREE.DoubleSide});
  const black=new THREE.MeshStandardMaterial({name:'Juntas_y_panel',color:0x101820,roughness:.39,metalness:.05});
  const shadow=new THREE.MeshStandardMaterial({name:'Recesos',color:0x182027,roughness:.8,metalness:.1});
  const white=new THREE.MeshStandardMaterial({name:'Escala_y_marca',color:0xebeff3,roughness:.55});
  const red=new THREE.MeshStandardMaterial({name:'LED_y_escala_roja',color:0xdb3534,roughness:.42,emissive:0x4c0909,emissiveIntensity:.55});
  const blue=new THREE.MeshStandardMaterial({name:'Teclas',color:compact?0x327eac:0x42babd,roughness:.48});
  const gold=new THREE.MeshStandardMaterial({name:'Banda_sellado',color:0xb39862,metalness:.35,roughness:.5});
  const glass=new THREE.MeshPhysicalMaterial({name:'Tapa_transparente',color:0xe5effb,transparent:true,opacity:.10,depthWrite:false,roughness:.12,clearcoat:.8,side:THREE.DoubleSide});
  const glassEdge=new THREE.MeshPhysicalMaterial({name:'Bordes_tapa',color:0xdce6f3,transparent:true,opacity:.36,depthWrite:false,roughness:.15,clearcoat:.7});
  const groups=new Map();
  function add(geo,mat,name,pos=[0,0,0],rot=[0,0,0],parent=root) {
    const mesh=new THREE.Mesh(geo,mat); mesh.name=name;mesh.position.set(...pos);mesh.rotation.set(...rot);
    if(parent===root) {
      mesh.updateMatrix();geo.applyMatrix4(mesh.matrix); const g=geo.index?geo.toNonIndexed():geo;g.deleteAttribute('uv');
      if(!groups.has(mat.uuid))groups.set(mat.uuid,{mat,geos:[],names:[]});groups.get(mat.uuid).geos.push(g);groups.get(mat.uuid).names.push(name);
    } else parent.add(mesh);
    return mesh;
  }
  function box(name,size,pos,mat=steel,r=.002,parent=root) { return add(new RoundedBoxGeometry(...size,2,Math.min(r,...size.map(v=>v/2))),mat,name,pos,[0,0,0],parent); }
  function cyl(name,radius,length,pos,mat=polished,rot=[0,0,0],parent=root) {return add(new THREE.CylinderGeometry(radius,radius,length,32),mat,name,pos,rot,parent);}
  function text(name,content,size,pos,mat=white,parent=root) {const geo=new TextGeometry(content,{font,size,depth:.00015,curveSegments:3,bevelEnabled:false});geo.computeBoundingBox();geo.translate(-(geo.boundingBox.max.x-geo.boundingBox.min.x)/2,0,0);return add(geo,mat,name,pos,[0,0,0],parent);}
  function frame(name,width,depth,thick,rim,y,z,mat,parent=root) {
    const s=roundRect(width,depth,.009);s.holes.push(roundRect(width-2*rim,depth-2*rim,.006));
    const geo=new THREE.ExtrudeGeometry(s,{depth:thick,bevelEnabled:false,curveSegments:5});geo.rotateX(-Math.PI/2);return add(geo,mat,name,[0,y,z],[0,0,0],parent);
  }
  const foot=.018, top=h-.025, bodyTop=top-.012, bodyBottom=foot;
  // Hollow chamber; the front/back and side skins leave the bowl visibly recessed.
  box('Panel_frontal',[w-.008,bodyTop-bodyBottom,.006],[0,(bodyTop+bodyBottom)/2,d/2-.022]);
  box('Panel_trasero_sin_detalles_no_documentados',[w-.008,bodyTop-bodyBottom,.006],[0,(bodyTop+bodyBottom)/2,-d/2+.006]);
  for(const sign of [-1,1])box('Costado',[.006,bodyTop-bodyBottom,d-.032],[sign*(w/2-.007),(bodyTop+bodyBottom)/2,-.010]);
  box('Base_inferior',[w-.012,.007,d-.012],[0,foot,0]);
  for(const x of [-w*.38,w*.38])for(const z of [-d*.37,d*.37])cyl('Pata',.016,foot,[x,foot/2,z],black);
  frame('Borde_superior_continuo',w,d,.012,.021,bodyTop,0,polished);
  const chamberFloor=top-h*.155,cw=w-.052,cd=d-.052;
  box('Fondo_camara',[cw,.005,cd],[0,chamberFloor,0],inside,.012);
  box('Cuba_frente',[cw,top-chamberFloor,.004],[0,(top+chamberFloor)/2,cd/2],inside);
  box('Cuba_fondo',[cw,top-chamberFloor,.004],[0,(top+chamberFloor)/2,-cd/2],inside);
  for(const sign of [-1,1])box('Cuba_lateral',[.004,top-chamberFloor,cd],[sign*cw/2,(top+chamberFloor)/2,0],inside);
  // Sealing length/width are stated in the sheet; placement, height and supports remain visual estimates.
  const railX=compact?[0]:[-cw*.39,cw*.39];
  for(const x of railX) {
    const size=compact?[cfg.sealLength,.012,cfg.sealWidth]:[cfg.sealWidth,.012,cfg.sealLength];
    const position=compact?[0,top-.027,cd*.35]:[x,top-.027,0];
    box('Barra_de_sellado',size,position,gold,.001);
    for(const end of [-1,1])box('Soporte_barra',[.013,.027,.018],compact?[end*(cfg.sealLength/2-.012),top-.041,cd*.35]:[x,top-.041,end*(cfg.sealLength/2-.012)],polished);
  }
  cyl('Puerto_camara',.013,.003,[0,top-.040,-cd/2+.004],polished,[Math.PI/2,0,0]);
  cyl('Rejilla_puerto',.009,.003,[0,top-.040,-cd/2+.006],shadow,[Math.PI/2,0,0]);
  for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)if(i*i+j*j<7)cyl('Perforacion_puerto',.001,.003,[i*.003,top-.04+j*.003,-cd/2+.008],black,[Math.PI/2,0,0]);
  // Visible left-side ventilation pattern from official photos of the 400T/500T.
  if(!compact) {
    const side=new THREE.Shape();const sw=d*.7,sh=h*.58;
    side.moveTo(-sw/2,-sh/2);side.lineTo(sw/2,-sh/2);side.lineTo(sw/2,sh/2);side.lineTo(-sw/2,sh/2);side.closePath();
    for(let row=0;row<8;row++)for(let col=0;col<7;col++) {
      if((row<5&&Math.abs(col-3)>2)||(row>=5&&col===3))continue;
      const hole=roundRect(sw*.07,.003,.001,(col-3)*sw*.095,(row-3.5)*sh*.075);
      side.holes.push(hole);
    }
    const geo=new THREE.ExtrudeGeometry(side,{depth:.002,bevelEnabled:false,curveSegments:2});geo.rotateY(-Math.PI/2);
    add(geo,steel,'Panel_ventilacion_perforado',[-w/2+.003,h*.4,0]);
    box('Interior_oscuro_ventilacion',[.002,sh,sw],[-w/2+.004,h*.4,0],shadow);
    for(const y of [h*.14,h*.68])for(const z of [-d*.32,d*.32])cyl('Tornillo_lateral',.003,.002,[-w/2+.001,y,z],polished,[0,0,Math.PI/2]);
  }
  // Front control panel: three red readouts/right gauge on 300T; centre readout/left gauge on larger units.
  const pW=w*.81,pH=h*.37,pY=compact?h*.38:h*.49,pZ=d/2-.019;
  box('Panel_borde',[pW,pH,.007],[0,pY,pZ],black,.006);
  box('Panel_marco_fino',[pW*.94,pH*.86,.001],[0,pY,pZ+.004],polished,.002);
  box('Panel_impreso',[pW*.92,pH*.82,.001],[0,pY,pZ+.005],black,.001);
  const gx=compact?pW*.32:-pW*.31, gy=pY+.008, gr=Math.min(.034,h*.074);
  cyl('Bisel_manometro',gr+.004,.004,[gx,gy,pZ+.008],polished,[Math.PI/2,0,0]);
  cyl('Esfera_manometro',gr,.005,[gx,gy,pZ+.010],white,[Math.PI/2,0,0]);
  for(let t=0;t<25;t++) {
    const a=Math.PI*.18+t*Math.PI*1.55/24,rad=gr*.83;
    box('Marca_escala',[.001, t%4===0?.006:.003,.0007],[gx+Math.cos(a)*rad,gy+Math.sin(a)*rad,pZ+.014],t>15?red:shadow,.0001);
  }
  const needle=new THREE.Shape();needle.moveTo(-.001,0);needle.lineTo(0,gr*.67);needle.lineTo(.001,0);needle.closePath();
  const needleGeo=new THREE.ExtrudeGeometry(needle,{depth:.0008,bevelEnabled:false});needleGeo.rotateZ(.72);
  add(needleGeo,shadow,'Aguja_manometro',[gx,gy,pZ+.016]);
  cyl('Eje_manometro',.003,.001,[gx,gy,pZ+.017],black,[Math.PI/2,0,0]);
  const centers=compact?[-pW*.31,-pW*.12,pW*.07]:[0];
  for(const x of centers) {
    box('Pantalla_digital',[pW*(compact?.15:.22),pH*.24,.001],[x,pY+pH*.15,pZ+.008],shadow,.001);
    text('Lectura_referencial','00',pH*.15,[x,pY+pH*.08,pZ+.010],red);
  }
  const keys=compact?7:4;
  for(let i=0;i<keys;i++) {
    const x=compact?-pW*.34+i*pW*.076:-pW*.11+i*pW*.09;
    box('Boton_control',[pW*.055,pH*.14,.002],[x,pY-pH*.17,pZ+.008],blue,.001);
    text('Icono_boton',i%2?'+':'-',pH*.08,[x,pY-pH*.195,pZ+.010],white);
  }
  if(!compact) for(let i=0;i<3;i++)cyl('Indicador_estado',.003,.002,[pW*.24+i*.013,pY+.028,pZ+.009],red,[Math.PI/2,0,0]);
  for(const x of [-pW*.47,pW*.47])for(const y of [-pH*.42,pH*.42])cyl('Tornillo_panel',.003,.002,[x,pY+y,pZ+.009],polished,[Math.PI/2,0,0]);
  const badgeY=compact?h*.10:h*.76;
  box('Placa_ilumi',[.068,.026,.002],[0,badgeY,pZ+.002],white,.0006);
  box('Placa_ilumi_negra',[.064,.022,.002],[0,badgeY,pZ+.003],black,.0003);
  text('Marca_ilumi','ilumi',.017,[0,badgeY-.007,pZ+.0045]);
  for(const x of [-w*.45,w*.45])cyl('Tornillo_frontal',.003,.003,[x,foot+.018,pZ+.003],polished,[Math.PI/2,0,0]);
  // The lid pivots around the rear edge as evidenced by the open-lid photograph.
  const lid=new THREE.Group();lid.name='Tapa_bisagra';lid.position.set(0,top,-d/2+.015);root.add(lid);
  const lidDepth=d-.020,lidCenter=lidDepth/2-.005;
  frame('Marco_tapa',w-.006,lidDepth,.010,.012,.001,lidCenter,glassEdge,lid);
  frame('Junta_perimetral',w-.025,lidDepth-.018,.002,.004,-.001,lidCenter,black,lid);
  box('Ventana_tapa',[w-.038,.007,lidDepth-.030],[0,.014,lidCenter],glass,.003,lid);
  // Raised moulded centre of the transparent cover.
  frame('Relieve_tapa',w*.74,lidDepth*.70,.005,.003,.018,lidCenter,glassEdge,lid);
  box('Corona_tapa',[w*.74,.004,lidDepth*.70],[0,.023,lidCenter],glass,.002,lid);
  for(const x of [-w*.33,w*.33]) {
    cyl('Eje_bisagra',.006,.037,[x,top,-d/2+.013],polished,[0,0,Math.PI/2]);
    box('Base_bisagra',[.030,.014,.030],[x,top-.010,-d/2+.025],polished);
  }
  if(compact) {
    box('Asa_frontal',[w*.88,.005,.009],[0,top-.049,d/2-.008],polished);
    for(const x of [-w*.34,w*.34])box('Protector_asa',[.042,.009,.012],[x,top-.049,d/2-.008],blue);
  }
  for(const {mat,geos,names} of groups.values()) {const geo=mergeGeometries(geos,false);const mesh=new THREE.Mesh(geo,mat);mesh.name=mat.name;mesh.userData.parts=names;root.add(mesh);}
  root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3());
  if(Math.abs(size.x-w)>.001||Math.abs(size.y-h)>.001||Math.abs(size.z-d)>.001)throw new Error(`${cfg.sku}: extents ${size.toArray()}`);
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI*.45).toArray();
  const clip=new THREE.AnimationClip('Abrir_tapa_bisagra',1.2,[new THREE.QuaternionKeyframeTrack('Tapa_bisagra.quaternion',[0,1,1.2],[0,0,0,1,...q,...q])]);
  const buffer=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,animations:[clip]}));
  const report=inspectGlb(buffer);if(report.errors.length||report.warnings.length)throw new Error(JSON.stringify(report));
  const output=`public/models/ilumi/${cfg.sku.toLowerCase()}-v1.glb`;
  await fs.writeFile(output,buffer);
  console.log(JSON.stringify({sku:cfg.sku,output,bytes:buffer.length,triangles:report.triangles,extents:size.toArray(),animation:clip.name}));
}
