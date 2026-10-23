/** Photo-based visual reconstructions, not workshop CAD. See docs/modelos-3d/inox-hornos-parrillas.md. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries,mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onload?.({target:this});this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}};

// All exterior sizes below are an illustrative scene scale, never commercial dimensions.
const models=[
 {id:'P01',slug:'cocina-semiindustrial-4-hornillas-horno-electrico',kind:'cooker',w:.76,d:.68,h:.90,page:3},
 {id:'P06',slug:'horno-multiuso',kind:'multi',w:.86,d:.68,h:1.75,page:5},
 {id:'P07',slug:'horno-ecologico-para-pollo-a-la-brasa',kind:'eco',w:.94,d:.76,h:1.72,page:6},
 {id:'P08',slug:'horno-pollero-ecologico',kind:'rotisserie',w:.94,d:.70,h:1.65,page:6},
 {id:'P09',slug:'parrilla-premium-plancha-y-parrilla-a-carbon',kind:'grillHalf',w:1.20,d:.65,h:1.04,page:7},
 {id:'P10',slug:'parrilla-grande',kind:'grillFull',w:1.20,d:.65,h:1.02,page:7},
 {id:'P11',slug:'caja-china-grande',kind:'china',w:1.12,d:.65,h:1.20,page:8},
];
function rect(w,h,r,cx=0,cy=0){const s=new THREE.Shape(),x=cx-w/2,y=cy-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}

// v1 is an immutable photographic pose. This generator now writes only the five
// articulated v2 files; the two grills have no door and remain byte-for-byte v1.
for(const cfg of models.filter(model=>!['grillHalf','grillFull'].includes(model.kind))){
 const {w,d,h}=cfg,front=d/2;
 const root=new THREE.Group();root.name=`INOX304_${cfg.id}`;
 root.userData={productId:cfg.id,revision:'2.0',units:'meters',orientation:'Y up; front +Z',source:{document:'INOX304_catalogo_FINAL.pdf',page:cfg.page,photo:`/images/products/${cfg.slug}.webp`},description:'Visualización 3D aproximada a partir de fotografías; no es CAD de fabricación.',scaleStatus:'Dimensiones exteriores ilustrativas, no especificaciones comerciales.',illustrativeEnvelope:{width:w,depth:d,height:h},manufacturingUse:false,pose:'Puertas interactivas cerradas al cargar; recorrido visual aproximado, no validado para fabricación.',openingLimitations:cfg.kind==='eco'?'La compuerta superior permanece en la pose elevada de la fotografía: no se conoce su mecanismo. Solo se articulan las dos puertas inferiores.':'Bisagras y recorridos ilustrativos; no simulan funcionamiento del equipo.'};
 const m={
  steel:new THREE.MeshStandardMaterial({name:'Acero_satinado',color:0xb9bfc5,metalness:.86,roughness:.31}),
  edge:new THREE.MeshStandardMaterial({name:'Acero_pulido',color:0xccd1d6,metalness:.92,roughness:.26}),
  inner:new THREE.MeshStandardMaterial({name:'Interior_acero',color:0x7e8a95,metalness:.65,roughness:.40,side:THREE.DoubleSide}),
  dark:new THREE.MeshStandardMaterial({name:'Cavidades_y_fundicion',color:0x1a2027,metalness:.40,roughness:.62}),
  rubber:new THREE.MeshStandardMaterial({name:'Mandos_y_goma',color:0x0d151d,metalness:.12,roughness:.55}),
  white:new THREE.MeshStandardMaterial({name:'Escala_clara',color:0xe6e9eb,metalness:.12,roughness:.45}),
  orange:new THREE.MeshStandardMaterial({name:'Ruedas_naranjas',color:0xef6b18,metalness:.06,roughness:.57}),
  brick:new THREE.MeshStandardMaterial({name:'Refractario_referencial',color:0xa38b5c,metalness:0,roughness:.97}),
  greyBrick:new THREE.MeshStandardMaterial({name:'Refractario_gris',color:0x8e8a81,metalness:0,roughness:.97}),
  red:new THREE.MeshStandardMaterial({name:'Piloto_rojo',color:0xce2c42,roughness:.40}),
  green:new THREE.MeshStandardMaterial({name:'Piloto_verde',color:0x2ab44e,roughness:.40}),
  blue:new THREE.MeshStandardMaterial({name:'Placa_control_azul',color:0x172653,metalness:.12,roughness:.43}),
  wood:new THREE.MeshStandardMaterial({name:'Empunadura_madera',color:0xcda360,metalness:0,roughness:.6}),
  glass:new THREE.MeshPhysicalMaterial({name:'Visor_vidrio',color:cfg.kind==='china'?0x263d48:0x92a9b7,roughness:.11,metalness:.03,transparent:true,opacity:cfg.kind==='china'?.68:.23,depthWrite:false,side:THREE.DoubleSide}),
 };
 const parts=new Map(),tracks=[],articulations=[];let transform=new THREE.Matrix4(),target=root;
 function add(g,mat,name,pos=[0,0,0],rot=[0,0,0]){
  const mesh=new THREE.Mesh(g,mat);mesh.position.set(...pos);mesh.rotation.set(...rot);mesh.updateMatrix();g.applyMatrix4(transform.clone().multiply(mesh.matrix));const geo=g.index?g.toNonIndexed():g;geo.deleteAttribute('uv');
  const key=`${target.uuid}:${mat.uuid}`;
  if(!parts.has(key))parts.set(key,{mat,target,geos:[],names:[]});parts.get(key).geos.push(geo);parts.get(key).names.push(name);
 }
 function within(pos,rot,fn){const before=transform;const mat=new THREE.Matrix4().compose(new THREE.Vector3(...pos),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),new THREE.Vector3(1,1,1));transform=before.clone().multiply(mat);fn();transform=before;}
 function moving(name,pivot,axis,angle,fn){
  const group=new THREE.Group();group.name=name;group.position.set(...pivot);group.userData={purpose:'Puerta o tapa completa',movement:'Recorrido ilustrativo',closedByDefault:true};root.add(group);
  const previousTarget=target,previousTransform=transform;target=group;transform=new THREE.Matrix4();fn();target=previousTarget;transform=previousTransform;
  const q0=new THREE.Quaternion(),q1=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis),angle);
  tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,[0,.10,1.10,1.35],[...q0.toArray(),...q0.toArray(),...q1.toArray(),...q1.toArray()]));
  articulations.push({node:name,pivot,angleDegrees:angle*180/Math.PI});
 }
 function box(name,size,pos,mat=m.steel,r=.002){add(new RoundedBoxGeometry(...size,2,Math.min(r,...size.map(v=>v/2))),mat,name,pos);}
 function cyl(name,r,len,pos,mat=m.edge,rot=[0,0,0]){add(new THREE.CylinderGeometry(r,r,len,24),mat,name,pos,rot);}
 function bar(name,a,b,r=.006,mat=m.edge){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),dir=bv.clone().sub(av),geo=new THREE.CylinderGeometry(r,r,dir.length(),12);geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize()));add(geo,mat,name,av.add(bv).multiplyScalar(.5).toArray());}
 function pane(name,width,height,depth,pos,mat=m.steel,holes=[],r=.004){const s=rect(width,height,r);for(const q of holes)s.holes.push(rect(q.w,q.h,q.r??.003,q.x??0,q.y??0));add(new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:7}),mat,name,pos);}
 function deck(name,width,depth,y,x=0,z=0,mat=m.steel,holes=[],thick=.014){within([x,y-thick,z],[-Math.PI/2,0,0],()=>pane(name,width,depth,thick,[0,0,0],mat,holes,.003));}
 function handle(x,y,z,len=.16,vertical=false){if(vertical){bar('Asa',[x,y-len/2,z+.027],[x,y+len/2,z+.027]);for(const dy of [-len/2,len/2])bar('Soporte_asa',[x,y+dy,z],[x,y+dy,z+.027]);}else{bar('Asa',[x-len/2,y,z+.027],[x+len/2,y,z+.027]);for(const dx of [-len/2,len/2])bar('Soporte_asa',[x+dx,y,z],[x+dx,y,z+.027]);}}
 function knob(x,y,z,r=.027){cyl('Base_mando',r+.004,.006,[x,y,z],m.edge,[Math.PI/2,0,0]);cyl('Mando',r,.029,[x,y,z+.015],m.rubber,[Math.PI/2,0,0]);cyl('Cara_mando',r*.80,.003,[x,y,z+.031],m.edge,[Math.PI/2,0,0]);box('Marca_mando',[.003,.010,.002],[x,y+r*.48,z+.033],m.dark,.0005);}
 function wheel(x,z,{orange=true,r=.047}={}){const yy=r;cyl('Rueda',r,.028,[x,yy,z],orange?m.orange:m.rubber,[0,0,Math.PI/2]);cyl('Centro_rueda',r*.67,.033,[x,yy,z],m.edge,[0,0,Math.PI/2]);for(const dx of [-.022,.022])box('Horquilla_rueda',[.007,r*1.45,.040],[x+dx,r*1.65,z],m.edge);cyl('Eje_giratorio',.018,.022,[x,r*2.30,z],m.edge);}
 function wheels(opts={}){for(const x of [-w/2+.052,w/2-.052])for(const z of [-d/2+.052,d/2-.052])wheel(x,z,opts);}
 function shell(bottom,top,{bodyW=w,centerX=0,back=-d/2,sideFront=front}={}){const height=top-bottom,mid=(top+bottom)/2;for(const s of [-1,1])box('Costado',[.018,height,sideFront-back],[centerX+s*(bodyW/2-.009),mid,(sideFront+back)/2],m.steel);box('Trasera_sin_detalles_ocultos',[bodyW,height,.015],[centerX,mid,back+.0075],m.steel);deck('Fondo',bodyW-.020,sideFront-back-.020,bottom,centerX,(sideFront+back)/2,m.inner);}
 function wireRack(width,depth,y,x=0,z=0,count=18){for(let i=0;i<count;i++){const xx=x-width/2+i*width/(count-1);bar('Varilla_rejilla',[xx,y,z-depth/2],[xx,y,z+depth/2],.0028);}for(const zz of [-depth/2,depth/2])bar('Marco_rejilla',[x-width/2,y,z+zz],[x+width/2,y,z+zz],.004);}
 function frame(width,depth,y,x=0,z=0,mat=m.edge){deck('Marco_abierto',width,depth,y,x,z,mat,[{w:width-.025,h:depth-.025}],.012);}
 function stand(bottom,top,{orange=true,slots=true}={}){wheels({orange});for(const x of [-w/2+.032,w/2-.032])for(const z of [-d/2+.032,d/2-.032])box('Pata_estructura',[.032,top-bottom,.032],[x,(top+bottom)/2,z],m.steel);const holes=slots?[{w:.060,h:d*.66,x:-w*.14},{w:.060,h:d*.66,x:w*.14}]:[];deck('Repisa_inferior',w-.030,d-.030,bottom+.035,0,0,m.steel,holes,.020);}
 function gauge(x,y,z,r=.025){cyl('Bisel_termometro',r,.006,[x,y,z],m.edge,[Math.PI/2,0,0]);cyl('Esfera_termometro',r*.85,.007,[x,y,z+.002],m.white,[Math.PI/2,0,0]);bar('Aguja_indicador',[x,y,z+.007],[x+r*.45,y+r*.50,z+.007],.001,m.red);}
 function grate(width,depth,y,x=0,z=0,{half=false}={}){
  frame(width,depth,y,x,z);
  const areaW=half?width*.50:width,count=Math.floor(areaW/.030);
  for(let i=0;i<count;i++){
   const xx=x-width/2+.014+(i+.5)*(areaW-.028)/count;
   for(const sign of [-1,1])within([xx+sign*.006,y+.005,z],[0,0,sign*.65],()=>box('Canal_parrilla',[.016,.0025,depth-.022],[0,0,0],m.edge,.0005));
  }
  if(half)deck('Plancha_lisa',width*.50-.008,depth-.022,y+.009,x+width*.25,z,m.edge,[],.005);
 }
 function brickBack(width,low,high,z,{grey=false}={}){const rows=3,cols=8,bh=(high-low)/rows,bw=width/cols;for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)box('Ladrillo_refractario',[bw-.002,bh-.002,.019],[-width/2+(i+.5)*bw,low+(j+.5)*bh,z],grey?m.greyBrick:m.brick,.0005);}

 if(cfg.kind==='cooker'){
  shell(.035,h-.040);deck('Cubierta_hornillas',w,d,h-.025,0,0,m.edge);
  for(const x of [-.174,.174])for(const z of [-.153,.153]){
   box('Bandeja_hornilla',[.303,.010,.270],[x,h-.017,z],m.dark);
   // Four-inch burner diameter appears in the owner-supplied product specification.
   cyl('Quemador_4_pulgadas',.0508,.017,[x,h-.002,z],m.dark);
   for(let i=0;i<24;i++){const a=i*Math.PI*2/24;cyl('Puerto_quemador',.0018,.001,[x+Math.cos(a)*.044,h+.007,z+Math.sin(a)*.044],m.rubber);}
   for(let i=0;i<8;i++)within([x,h+.018,z],[0,i*Math.PI/4,0],()=>box('Brazo_parrilla_fundida',[.021,.030,.080],[0,0,.095],m.dark,.003));
  }
  for(const x of [-.230,-.077,.077,.230])knob(x,.752,front+.002,.033);
  box('Franja_mandos',[w-.080,.125,.022],[0,.754,front-.015],m.edge);
  const ovenX=-.043,ovenW=.545,ovenLow=.105,ovenTop=.650;
  box('Camara_oscura',[ovenW,ovenTop-ovenLow,.012],[ovenX,(ovenTop+ovenLow)/2,-d/2+.030],m.dark);
  for(const x of [ovenX-ovenW/2,ovenX+ovenW/2])box('Pared_interior_horno',[.008,ovenTop-ovenLow,d-.050],[x,(ovenTop+ovenLow)/2,0],m.dark);
  deck('Suelo_horno',ovenW,d-.050,ovenLow,ovenX,0,m.dark);deck('Techo_horno',ovenW,d-.050,ovenTop,ovenX,0,m.dark);
  for(const yy of [.230,.420])wireRack(ovenW-.045,d-.090,yy,ovenX,0,17);
  for(const yy of [.53,.42,.31,.20])knob(.305,yy,front+.003,.024);
  cyl('Piloto_horno',.006,.003,[.305,.146,front+.007],m.red,[Math.PI/2,0,0]);
  pane('Marco_horno',w-.066,.572,.018,[0,.377,front-.004],m.edge,[{w:ovenW,h:ovenTop-ovenLow,x:ovenX,y:.0005}],.003);
  moving('Puerta_horno',[ovenX,ovenLow,front+.016],[1,0,0],Math.PI*.49,()=>{
   pane('Hoja_horno',ovenW+.023,.535,.026,[0,.2675,0],m.edge,[{w:ovenW-.075,h:.420}],.008);
   box('Vidrio_puerta',[ovenW-.080,.417,.004],[0,.2675,.027],m.glass,.005);handle(0,.488,.032,ovenW-.070);
  });
  for(const x of [-w*.40,w*.40])for(const z of [-d*.37,d*.37])cyl('Apoyo',.023,.035,[x,.0175,z],m.rubber);
 } else if(cfg.kind==='multi'){
  const bw=.86,bx=0,px=.49,base=.64,top=1.75;
  stand(.125,base,{orange:true});shell(base,top,{bodyW:bw,centerX:bx});
  deck('Techo_horno',bw,d,top,bx,0,m.steel);
  const dh=.825,dy=1.175,windowW=.270,windowH=.575;
  moving('Puerta_horno_multiuso',[bx-(bw-.045)/2,dy,front],[0,1,0],-Math.PI*.57,()=>{
   pane('Hoja_horno_con_visor',bw-.045,dh,.026,[(bw-.045)/2,0,0],m.steel,[{w:windowW,h:windowH,r:.040}],.006);
   box('Vidrio_visor',[windowW-.003,windowH-.003,.004],[(bw-.045)/2,0,.029],m.glass,.016);
   handle(bw*.35+(bw-.045)/2,1.09-dy,.030,.15,true);
  });
  for(const yy of [.845,1.045,1.245,1.445])wireRack(bw-.075,d-.090,yy,bx,0,19);
  for(const yy of [.800,1.565])box('Bisagra_exterior',[.041,.027,.029],[bx-bw*.43,yy,front+.025],m.edge,.004);
  box('Frente_superior',[bw+.006,.170,.045],[bx,1.665,front+.007],m.steel,.008);
  box('Cajon_inferior',[bw-.040,.125,.027],[bx,.708,front+.005],m.steel,.005);handle(bx+.075,.705,front+.024,.055,true);
  box('Panel_mandos_lateral',[.140,.650,.140],[px,1.310,front-.045],m.steel,.005);
  gauge(px,1.562,front+.032,.026);
  for(const yy of [1.425,1.310,1.195]){box('Placa_mando',[.079,.078,.003],[px,yy,front+.026],m.blue);knob(px,yy,front+.032,.023);}
  box('Interruptor_inferior',[.025,.034,.010],[px,1.080,front+.034],m.white);
 } else if(cfg.kind==='eco'||cfg.kind==='rotisserie'){
  const eco=cfg.kind==='eco',floor=.75,chamberTop=eco?1.50:1.48,bodyTop=eco?1.66:1.47;
  wheels({orange:eco,r:eco?.047:.035});shell(.115,bodyTop);deck('Techo',w,d,bodyTop,0,0,m.steel);
  box('Piso_asador',[w-.075,.020,d-.060],[0,floor,0],m.inner);
  if(!eco)brickBack(w-.140,floor+.075,chamberTop-.025,-d/2+.034);
  else box('Interior_trasero',[w-.075,chamberTop-floor,.010],[0,(chamberTop+floor)/2,-d/2+.026],m.dark);
  box('Panel_superior',[w-.045,eco?.20:.19,.060],[0,bodyTop-.075,front+.010],m.steel,.005);
  const radius=eco?.185:.210,cy=eco?1.100:1.100,cz=eco?.025:.005;
  for(const side of [-1,1]){
   cyl('Disco_asador',eco?.025:radius,.014,[side*(w/2-.085),cy,cz],eco?m.dark:m.edge,[0,0,Math.PI/2]);
   if(eco)for(let k=0;k<6;k++){const a=k*Math.PI/3;bar('Brazo_soporte_asador',[side*(w/2-.076),cy,cz],[side*(w/2-.076),cy+Math.sin(a)*radius,cz+Math.cos(a)*radius],.012,m.dark);}
  }
  const count=eco?6:6;
  for(let k=0;k<count;k++){
   const a=k*Math.PI*2/count,yy=cy+Math.sin(a)*radius*.92,zz=cz+Math.cos(a)*radius*.92;
   bar('Espada_asador',[-w/2+.078,yy,zz],[w/2-.078,yy,zz],.006,m.edge);
   if(!eco)box('Canal_visible_espada',[w-.165,.018,.025],[0,yy-.013,zz],m.edge,.002);
  }
  wireRack(w-.100,d-.070,floor+.035,0,0,20);
  if(eco){
   const shutterW=w-.185;
   pane('Compuerta_en_posicion_elevada',shutterW,.290,.020,[.035,1.400,front+.014],m.steel,[{w:shutterW-.155,h:.155,r:.030,y:.020}],.004);
   box('Vidrio_compuerta',[shutterW-.156,.153,.004],[.035,1.420,front+.036],m.glass,.020);handle(.035,1.294,front+.038,shutterW-.105);
   for(const x of [-w/2+.082,w/2-.032])box('Guia_visible',[.022,.685,.023],[x,1.116,front+.033],m.edge);
   box('Frente_cajon',[w-.085,.170,.025],[.020,.655,front+.012],m.steel);
   deck('Techo_gabinete_inferior',w-.065,d-.055,.565,0,0,m.inner);
   for(const side of [-1,1]){
    const doorW=(w-.100)/2,pivotX=.020;
    // Handles are on the outer edges in the source photo. Each leaf pivots at
    // the shared centre edge; the exact hinge hardware is not inferred.
    moving(`Puerta_inferior_${side<0?'izquierda':'derecha'}`,[pivotX,.375,front+.012],[0,1,0],-side*Math.PI*.44,()=>{
     pane('Hoja_inferior',doorW,.370,.018,[side*doorW/2,0,0],m.steel,Array.from({length:7},(_,i)=>({w:.014,h:.014,r:.007,x:-side*.045,y:(i-3)*.035})),.003);
     handle(side*(w-.155)/2,.010,.021,.105,true);
    });
   }
   box('Consola_izquierda',[.110,.440,.090],[-w/2+.040,1.280,front+.019],m.steel,.003);
   for(const [yy,mat] of [[1.460,m.red],[1.180,m.red],[1.110,m.green]])cyl('Boton_consola',.012,.016,[-w/2+.040,yy,front+.073],mat,[Math.PI/2,0,0]);
   box('Indicador_digital',[.043,.025,.006],[-w/2+.040,1.245,front+.067],m.dark);
   box('Salida_superior',[.250,.060,.220],[0,1.69,-.070],m.steel);
   box('Registro_lateral',[.020,.40,.25],[-w/2-.009,.96,-.06],m.steel);within([-w/2-.023,.99,-.06],[0,-Math.PI/2,0],()=>handle(0,0,0,.12,true));
  }else{
   for(const x of [-w/2+.025,w/2-.025])cyl('Columnas_cilindricas',.042,.98,[x,1.16,front-.015],m.edge);
   box('Salida_superior',[.205,.055,.185],[0,1.500,-.075],m.steel);
   const panelLow=.095,panelTop=.74;
   pane('Frontal_base',w-.040,panelTop-panelLow,.020,[0,(panelTop+panelLow)/2,front],m.steel,[{w:.335,h:.360,x:.2425,y:.325-(panelTop+panelLow)/2},{w:.335,h:.350,x:-.230,y:.330-(panelTop+panelLow)/2}],.002);
   moving('Puerta_inferior_izquierda',[-.0575,.150,front+.021],[0,1,0],Math.PI*.56,()=>box('Hoja_izquierda',[.345,.360,.018],[-.1725,.180,0],m.steel));
   knob(-.295,.625,front+.026,.020);box('Interruptor_rojo',[.025,.025,.010],[-.232,.625,front+.022],m.red);cyl('Piloto_verde',.015,.010,[-.182,.625,front+.023],m.green,[Math.PI/2,0,0]);
   // Only the visible front pulley, belt and motor silhouette are shown; no hidden drive train is inferred.
   const pX=.260,pY=.430,pZ=front-.075;
   add(new THREE.TorusGeometry(.080,.007,8,40),m.edge,'Polea_visible',[pX,pY,pZ]);
   cyl('Centro_polea',.014,.020,[pX,pY,pZ],m.edge,[Math.PI/2,0,0]);
   for(let k=0;k<6;k++){const a=k*Math.PI/3;bar('Radio_polea',[pX,pY,pZ],[pX+Math.cos(a)*.075,pY+Math.sin(a)*.075,pZ],.004);}
   cyl('Motor_visible',.046,.090,[.120,.260,pZ-.012],m.inner,[Math.PI/2,0,0]);
   add(new THREE.TorusGeometry(.022,.004,8,24),m.edge,'Polea_motor',[.120,.260,pZ+.040]);
   bar('Correa_visible',[pX-.067,pY+.045,pZ+.012],[.102,.275,pZ+.044],.004,m.rubber);
   bar('Correa_visible',[pX+.067,pY-.045,pZ+.012],[.138,.245,pZ+.044],.004,m.rubber);
   moving('Puerta_inferior_derecha',[.410,.145,front+.022],[0,1,0],Math.PI*.63,()=>box('Hoja_derecha',[.335,.360,.018],[-.1675,.180,0],m.steel));
  }
 }else if(cfg.kind==='grillHalf'||cfg.kind==='grillFull'){
  const half=cfg.kind==='grillHalf',bodyLow=.43,bodyTop=.72,cookTop=.960;
  stand(.130,bodyLow,{orange:!half});shell(bodyLow,bodyTop);deck('Fondo_brasero',w-.065,d-.070,bodyLow+.070,0,0,m.dark);
  box('Frente_brasero',[w-.025,bodyTop-bodyLow,.021],[0,(bodyTop+bodyLow)/2,front],m.steel);frame(w,d,bodyTop+.012);
  for(const x of [-w/2+.050,w/2-.050])box('Refractario_lateral',[.030,.190,d-.110],[x,.615,0],half?m.greyBrick:m.brick,.002);
  brickBack(w-.110,.520,.710,-d/2+.052,{grey:half});
  for(const z of [-d*.18,d*.18])bar('Barra_visible_brasero',[-w/2+.095,.530,z],[w/2-.095,.530,z],.009,m.dark);
  grate(w-.020,d-.025,cookTop,0,0,{half});
  box('Respaldo_parrilla',[w-.080,.110,.016],[0,cookTop+.055,-d/2+.014],m.edge);
  for(const x of [-w/2+.025,w/2-.025]){
   box('Montante_elevacion_visible',[.023,.320,.025],[x,.870,-d/2+.045],m.steel);
   within([x,cookTop+.020,0],[0,Math.PI/2,0],()=>handle(0,0,0,.170));
  }
  box('Canal_frontal_recogida',[w-.010,.027,.034],[0,cookTop-.012,front+.008],m.edge);
  if(half){knob(.380,.512,front+.018,.025);knob(.485,.512,front+.018,.025);}
  else{box('Placa_mando',[.085,.074,.004],[.450,.512,front+.015],m.blue);knob(.450,.512,front+.022,.027);}
  // The external crank is visible. Its hidden linkage and actual travel are intentionally not inferred.
  bar('Eje_manivela',[w/2,.61,.12],[w/2+.075,.61,.12],.009);
  bar('Brazo_manivela',[w/2+.075,.61,.12],[w/2+.075,.51,.22],.006);
  bar('Empunadura_manivela',[w/2+.075,.51,.22],[w/2+.145,.51,.22],.012,half?m.edge:m.wood);
 }else if(cfg.kind==='china'){
  const base=.12,bodyTop=.70;
  wheels({orange:true});shell(base,bodyTop);deck('Fondo_camara',w-.060,d-.050,base+.025,0,0,m.inner);
  moving('Puerta_frontal_caja',[0,base,front],[1,0,0],Math.PI*.44,()=>{
   pane('Hoja_frontal_con_visor',w-.040,bodyTop-base,.025,[0,(bodyTop-base)/2,0],m.steel,[{w:w*.60,h:.255,r:.025,y:-.055}],.003);
   box('Vidrio_frontal',[w*.60-.002,.253,.005],[0,(bodyTop-base)/2-.055,.028],m.glass,.014);
   handle(0,.570-base,.031,.130,true);
  });frame(w,d,bodyTop+.012);
  // Raised charcoal tray and half grill/half plancha preserve the photographed presentation.
  const trayY=.765,trayD=d-.100,trayW=w-.120;
  deck('Fondo_bandeja_superior',trayW,trayD,trayY,0,0,m.inner);
  for(const x of [-trayW/2,trayW/2])box('Costado_bandeja',[.012,.075,trayD],[x,trayY+.0375,0],m.steel);
  for(const z of [-trayD/2,trayD/2])box('Frente_bandeja',[trayW,.075,.012],[0,trayY+.0375,z],m.steel);
  grate(trayW-.012,trayD-.010,.930,0,0,{half:true});
  for(const x of [-trayW/2+.007,trayW/2-.007])bar('Soporte_visible_parrilla',[x,.840,-trayD/2+.020],[x,.930,-trayD/2+.020],.007);
  for(const x of [-w/2-.055,w/2+.055]){
   bar('Asa_lateral',[x,.704,-d*.30],[x,.704,d*.30],.010);
   for(const z of [-d*.30,d*.30])bar('Soporte_asa_lateral',[Math.sign(x)*w/2,.704,z],[x,.704,z],.010);
  }
  // The hollow cover clears the raised grill when closed. Its envelope and
  // angular travel are illustrative; no struts or hidden mechanism are added.
  moving('Tapa_ahumadora',[0,bodyTop+.025,-d/2+.009],[1,0,0],-Math.PI*.56,()=>{
   const lidD=d+.012,lidH=.250;
   box('Cubierta_tapa',[w-.025,.025,lidD],[0,lidH,lidD/2-.007],m.steel,.007);
   for(const x of [-w/2+.020,w/2-.020])box('Costado_tapa',[.018,lidH,lidD],[x,lidH/2,lidD/2-.007],m.steel,.003);
   box('Labio_frontal_tapa',[w-.025,lidH,.018],[0,lidH/2,lidD-.014],m.edge,.004);
   box('Labio_trasero_tapa',[w-.025,lidH,.018],[0,lidH/2,-.007],m.steel,.004);
  });
  bar('Eje_manivela_caja',[w/2,.795,.060],[w/2+.065,.795,.060],.008);
  bar('Manivela_caja',[w/2+.065,.795,.060],[w/2+.065,.700,.200],.006);bar('Mango_manivela',[w/2+.065,.700,.200],[w/2+.125,.700,.200],.010);
 }

 for(const {mat,target:parent,geos,names} of parts.values()){const geo=mergeVertices(mergeGeometries(geos,false),1e-6),mesh=new THREE.Mesh(geo,mat);mesh.name=`${parent===root?'Fijo':parent.name}_${mat.name}`;mesh.userData.parts=names;parent.add(mesh);}
 root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3());
 if(bounds.min.y<-.002||!size.toArray().every(v=>Number.isFinite(v)&&v>0))throw new Error(`${cfg.id}: invalid floor/bounds ${bounds.min.y}`);
 root.userData.articulations=articulations;
 const animations=[new THREE.AnimationClip('Abrir_puertas',1.35,tracks)];
 const bytes=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,animations})),report=inspectGlb(bytes);
 if(report.errors.length||report.warnings.length)throw new Error(JSON.stringify(report));
 const output=`public/models/inox/${cfg.slug}-v2.glb`;await fs.mkdir('public/models/inox',{recursive:true});await fs.writeFile(output,bytes);
 console.log(JSON.stringify({id:cfg.id,output,bytes:bytes.length,triangles:report.triangles,illustrativeExtents:size.toArray(),animations:animations.map(a=>a.name),articulations}));
}
