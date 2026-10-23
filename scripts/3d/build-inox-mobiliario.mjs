/** Owner-photo visual reconstructions. No manufacturing dimensions/BOM. See docs/modelos-3d/inox-mobiliario.md. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result=result;this.onload?.({target:this});this.onloadend?.({target:this}); }).catch(error=>this.onerror?.(error)); }
};

// Outer dimensions are illustrative proportions, NOT product specifications.
const models = [
  {id:'P23',slug:'lavatorio-con-repisas-superiores',kind:'cupboard',w:1.40,d:.65,h:.88,referencePage:15},
  {id:'P24',slug:'lavatorio-de-1-poza',kind:'single',w:1.20,d:.65,h:.85,referencePage:15,verifiedBasin:[.50,.50,.32]},
  {id:'P25',slug:'lavatorio-de-2-pozas-escurridores',kind:'drainer',w:1.50,d:.65,h:.85,referencePage:16},
  {id:'P26',slug:'lavadero-de-2-pozas-con-descanso',kind:'double',w:1.50,d:.65,h:.85,referencePage:16},
  {id:'P27',slug:'estante-de-5-niveles',kind:'rack',w:1.20,d:.48,h:1.80,referencePage:17},
  {id:'P28',slug:'mesa-central-de-trabajo',kind:'table',w:1.20,d:.65,h:.85,referencePage:17},
  {id:'P29',slug:'estacion-bartender-profesional',kind:'bar',w:1.40,d:.70,h:.92,referencePage:18},
];

function rectShape(w,d,r,x=0,z=0) {
  const s=new THREE.Shape();const l=x-w/2,b=z-d/2;
  s.moveTo(l+r,b);s.lineTo(l+w-r,b);s.quadraticCurveTo(l+w,b,l+w,b+r);
  s.lineTo(l+w,b+d-r);s.quadraticCurveTo(l+w,b+d,l+w-r,b+d);
  s.lineTo(l+r,b+d);s.quadraticCurveTo(l,b+d,l,b+d-r);
  s.lineTo(l,b+r);s.quadraticCurveTo(l,b,l+r,b);return s;
}
function ringPoints(w,d,r,segments=8) {
  const p=[];
  for(const [cx,cz,start] of [[w/2-r,d/2-r,0],[-w/2+r,d/2-r,90],[-w/2+r,-d/2+r,180],[w/2-r,-d/2+r,270]]) {
    for(let i=0;i<=segments;i++){const a=(start+i*90/segments)*Math.PI/180;p.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r]);}
  }
  return p;
}

// This revision intentionally writes only the two approved interactive replacements.
// Existing v1 files and the other five catalogue models are preserved.
for(const cfg of models.filter(model=>['P23','P29'].includes(model.id))) {
  const {w,d,h}=cfg;
  const root=new THREE.Group();root.name=`INOX304_${cfg.id}`;
  root.userData={
    productId:cfg.id,revision:'2.0',units:'meters',orientation:'Y up; front +Z',
    reconstruction:'Visualización 3D aproximada a partir de las fotografías del catálogo del propietario.',
    scaleStatus:'Las dimensiones exteriores son ilustrativas; no son medidas comerciales ni de fabricación.',
    illustrativeOuterScale:{width:w,depth:d,counterOrRackHeight:h},
    verifiedDimensions:cfg.verifiedBasin?{basinWidth:.50,basinDepth:.50,basinHeight:.32}:{},
    source:{document:'INOX304_catalogo_FINAL.pdf',page:cfg.referencePage,photo:`/images/products/${cfg.slug}.${['P27','P28','P29'].includes(cfg.id)?'jpg':'webp'}`},
    manufacturingUse:false,
    articulation:'Apertura ilustrativa de puertas; recorrido, bisagras e interior no documentados como diseño de fabricación. Cajones fijos.',
  };
  const mats={
    steel:new THREE.MeshStandardMaterial({name:'Acero_satinado',color:0xb2bbc2,metalness:.94,roughness:.31}),
    top:new THREE.MeshStandardMaterial({name:'Superficies_acero',color:0xc0c8ce,metalness:.94,roughness:.29}),
    edge:new THREE.MeshStandardMaterial({name:'Cantos_y_tubos',color:0xcbd2d7,metalness:.98,roughness:.24}),
    basin:new THREE.MeshStandardMaterial({name:'Interior_pozas',color:0x9ea8b2,metalness:.90,roughness:.35,side:THREE.DoubleSide}),
    black:new THREE.MeshStandardMaterial({name:'Pies_y_juntas',color:0x161b22,roughness:.70,metalness:.05}),
    drain:new THREE.MeshStandardMaterial({name:'Orificios_desague',color:0x292f36,roughness:.50,metalness:.30}),
    pipe:new THREE.MeshStandardMaterial({name:'Tubo_visible_fotografia',color:0xe8ebee,roughness:.55,metalness:0}),
  };
  const groups=new Map();let parent=root;const tracks=[];
  function add(geo,mat,name,pos=[0,0,0],rot=[0,0,0]) {
    const mesh=new THREE.Mesh(geo,mat);mesh.position.set(...pos);
    if(parent!==root)mesh.position.sub(parent.position);
    mesh.rotation.set(...rot);mesh.updateMatrix();geo.applyMatrix4(mesh.matrix);
    const g=geo.index?geo.toNonIndexed():geo;g.deleteAttribute('uv');
    const key=`${parent.uuid}:${mat.uuid}`;
    if(!groups.has(key))groups.set(key,{parent,mat,geos:[],names:[]});
    groups.get(key).geos.push(g);groups.get(key).names.push(name);
  }
  function movingDoor(name,hinge,angleDegrees,build) {
    const group=new THREE.Group();group.name=name;group.position.set(...hinge);
    group.userData={openingApproximate:true,closedByDefault:true,openingDegrees:angleDegrees};root.add(group);
    parent=group;build();parent=root;
    const axis=new THREE.Vector3(0,1,0),values=[];
    for(const fraction of [0,.08,.5,.92,1])values.push(...new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.degToRad(angleDegrees)*fraction).toArray());
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,[0,.2,.6,1,1.2],values));
  }
  function box(name,size,pos,mat=mats.steel,r=.002) {add(new RoundedBoxGeometry(...size,2,Math.min(r,...size.map(v=>v/2))),mat,name,pos);}
  function cyl(name,r,length,pos,mat=mats.edge,rot=[0,0,0]) {add(new THREE.CylinderGeometry(r,r,length,24),mat,name,pos,rot);}
  function bar(name,a,b,r=.012,mat=mats.edge) {
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);
    const geo=new THREE.CylinderGeometry(r,r,delta.length(),20);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    add(geo,mat,name,av.add(bv).multiplyScalar(.5).toArray());
  }
  function slab(name,width,depth,y,x=0,z=0,thick=.022,mat=mats.top,r=.004,holes=[]) {
    const s=rectShape(width,depth,r);for(const q of holes)s.holes.push(rectShape(q.w,q.d,q.r??.004,q.x-x,-(q.z-z)));
    const geo=new THREE.ExtrudeGeometry(s,{depth:thick,bevelEnabled:false,curveSegments:8});geo.rotateX(-Math.PI/2);
    add(geo,mat,name,[x,y-thick,z]);
  }
  function legs({square=false,offset=.055,top=h-.04,foot=.035}={}) {
    for(const x of [-w/2+offset,w/2-offset])for(const z of [-d/2+offset,d/2-offset]) {
      if(square){box('Pata_tubo_rectangular',[.038,top-foot,.038],[x,(top+foot)/2,z],mats.edge,.0015);box('Pie_antideslizante',[.039,foot,.039],[x,foot/2,z],mats.black,.003);}
      else {cyl('Pata_tubular',.024,top-foot,[x,(top+foot)/2,z]);cyl('Pie_antideslizante',.023,foot,[x,foot/2,z],mats.black);}
    }
  }
  function shelf(y,{width=w-.085,depth=d-.085,x=0,z=0,thick=.022}={}) {
    slab('Repisa_plana',width,depth,y,x,z,thick,mats.top,.002);
    box('Canto_frontal_repisa',[width,thick,.009],[x,y-thick/2,z+depth/2],mats.edge);
  }
  function basin(x,z,top,width,depth,height,r=.025,includeDrain=true) {
    // Inner opening and depth of P24 alone follow the owner's 50×50×32 cm specification.
    const bottomW=width-.055,bottomD=depth-.055;
    const a=ringPoints(width,depth,r),b=ringPoints(bottomW,bottomD,Math.max(.004,r-.007));
    const positions=[],indices=[];
    for(const [xx,zz] of a)positions.push(xx,0,zz);
    for(const [xx,zz] of b)positions.push(xx,-height,zz);
    for(let i=0;i<a.length;i++){const j=(i+1)%a.length;indices.push(i,j,a.length+j,i,a.length+j,a.length+i);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    add(geo,mats.basin,'Paredes_poza',[x,top,z]);
    slab('Fondo_poza',bottomW,bottomD,top-height,x,z,.003,mats.basin,Math.max(.004,r-.007));
    if(includeDrain){
      cyl('Desague_aro',.023,.002,[x,top-height+.002,z],mats.edge);
      cyl('Desague_hueco',.016,.002,[x,top-height+.0033,z],mats.drain);
      for(let i=-1;i<=1;i++)bar('Rejilla_desague',[x-.012,top-height+.0045,z+i*.007],[x+.012,top-height+.0045,z+i*.007],.0012);
    }
  }
  function counter(holes=[]) {
    slab('Cubierta_con_aberturas',w,d,h,0,0,.027,mats.top,.007,holes);
    box('Faldon_frontal',[w-.007,.038,.014],[0,h-.024,d/2-.007],mats.edge,.004);
    for(const s of [-1,1])box('Faldon_lateral',[.012,.036,d-.015],[s*(w/2-.006),h-.024,0],mats.edge,.003);
  }
  function backsplash(height) {
    box('Respaldo_antisalpicaduras',[w-.025,height,.022],[0,h+height/2,-d/2+.014],mats.steel,.003);
    box('Canto_respaldo',[w-.023,.012,.025],[0,h+height-.006,-d/2+.014],mats.edge,.003);
  }
  function handle(x,y,z,{horizontal=false,length=.125}={}) {
    const span=length/2;
    if(horizontal){
      bar('Asa_horizontal',[x-span,y,z+.025],[x+span,y,z+.025],.005);
      for(const dx of [-span,span])bar('Soporte_asa',[x+dx,y,z],[x+dx,y,z+.025],.005);
    }else{
      bar('Asa_vertical',[x,y-span,z+.025],[x,y+span,z+.025],.005);
      for(const dy of [-span,span])bar('Soporte_asa',[x,y+dy,z],[x,y+dy,z+.025],.005);
    }
  }
  function cabinetShell({bottom=.07,top=h-.026,left=-w/2,right=w/2,front=d/2-.015,back=-d/2+.010}={}) {
    const width=right-left,depth=front-back;
    box('Costado_gabinete',[.017,top-bottom,depth],[left+.0085,(top+bottom)/2,(front+back)/2],mats.steel);
    box('Costado_gabinete',[.017,top-bottom,depth],[right-.0085,(top+bottom)/2,(front+back)/2],mats.steel);
    box('Trasera_gabinete',[width,top-bottom,.012],[(left+right)/2,(top+bottom)/2,back],mats.steel);
    slab('Base_gabinete',width,depth,bottom+.024,(left+right)/2,(front+back)/2,.024,mats.top,.002);
  }
  function smallFaucet(x,z) {
    cyl('Base_grifo',.023,.025,[x,h+.0125,z]);cyl('Columna_grifo',.014,.205,[x,h+.11,z]);
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,h+.20,z),new THREE.Vector3(x,h+.21,z+.10),new THREE.Vector3(x,h+.20,z+.15),new THREE.Vector3(x,h+.16,z+.16)]);
    add(new THREE.TubeGeometry(curve,18,.010,12,false),mats.edge,'Canal_grifo');
    for(const dx of [-.095,.095]){
      cyl('Base_mando',.023,.035,[x+dx,h+.0175,z]);
      bar('Mando_griferia',[x+dx,h+.037,z],[x+dx+(dx<0?-.035:.035),h+.075,z],.009,mats.black);
    }
  }

  if(cfg.kind==='cupboard') {
    const bx=-.345,bz=.015,bw=.56,bd=.47;
    counter([{x:bx,z:bz,w:bw,d:bd,r:.030}]);basin(bx,bz,h,bw,bd,.27,.030);
    cabinetShell();box('Zocalo_retraido',[w-.080,.070,d-.075],[0,.035,-.017],mats.steel);
    const front=d/2-.010,doorBottom=.075,doorTop=.660;
    for(let i=0;i<4;i++){
      const x=-w/2+(i+.5)*w/4,width=w/4-.010,leftHinge=i%2===0;
      movingDoor(`P23_puerta_${i+1}`,[x+(leftHinge?-width/2:width/2),(doorTop+doorBottom)/2,front+.012],leftHinge?-85:85,()=>{
        box('Hoja_gabinete',[width,doorTop-doorBottom,.018],[x,(doorTop+doorBottom)/2,front],mats.steel,.002);
        box('Cara_interior_puerta',[width-.020,doorTop-doorBottom-.020,.004],[x,(doorTop+doorBottom)/2,front-.010],mats.steel,.001);
        handle(x+(leftHinge?.113:-.113),.56,front+.010);
      });
    }
    box('Faldon_fijo_bajo_poza',[w/2-.008,h-.046-doorTop,.018],[-w/4,(h-.046+doorTop)/2,front],mats.steel,.002);
    for(const x of [w/8,3*w/8]){
      box('Frente_cajon_cerrado',[w/4-.007,h-.046-doorTop,.018],[x,(h-.046+doorTop)/2,front],mats.steel,.002);
      handle(x,.744,front+.010,{horizontal:true,length:.090});
    }
    backsplash(.43);smallFaucet(bx,-d/2+.069);
    const rear=-d/2+.008,shelfDepth=.34,shelfCenter=rear+shelfDepth/2;
    for(const x of [-w/2+.025,0,w/2-.025])box('Montante_repisas',[.029,1.28,.029],[x,1.46,rear],mats.edge,.002);
    for(const y of [1.30,1.68,2.06]){
      shelf(y,{width:w,depth:shelfDepth,x:0,z:shelfCenter,thick:.027});
      for(const x of [-w/2+.025,0,w/2-.025]){
        const tri=new THREE.Shape();tri.moveTo(0,0);tri.lineTo(-shelfDepth+.015,0);tri.lineTo(0,-.10);tri.closePath();
        const geo=new THREE.ExtrudeGeometry(tri,{depth:.011,bevelEnabled:false});geo.rotateY(Math.PI/2);
        add(geo,mats.edge,'Escuadra_repisa',[x-.0055,y-.028,rear]);
        cyl('Tornillo_soporte',.004,.003,[x,y-.055,rear+.018],mats.drain,[Math.PI/2,0,0]);
      }
    }
  } else if(cfg.kind==='table') {
    counter();legs({offset:.055,top:h-.027,foot:.025});shelf(.19,{width:w-.085,depth:d-.085,thick:.025});
    for(const s of [-1,1])box('Refuerzo_bajo_cubierta',[.022,.035,d-.09],[s*(w/2-.055),h-.055,0],mats.steel);
  } else if(cfg.kind==='rack') {
    legs({square:true,offset:.020,top:h,foot:.027});
    const levels=[.15,.55,.95,1.35,1.75];
    for(const y of levels) {
      shelf(y,{width:w-.025,depth:d-.025,thick:.033});
      // Low rear/side retaining rails visible on the upper part of the source photograph.
      if(y>=1.35){
        const railHeight=y>1.7?.045:.065;
        bar('Baranda_posterior',[-w/2+.026,y+railHeight,-d/2+.026],[w/2-.026,y+railHeight,-d/2+.026],.005);
        for(const x of [-w/2+.026,w/2-.026])bar('Baranda_lateral',[x,y+railHeight,-d/2+.026],[x,y+railHeight,d/2-.026],.005);
        bar('Soporte_central_baranda',[0,y,-d/2+.026],[0,y+railHeight,-d/2+.026],.004);
      }
    }
  } else if(cfg.kind==='single') {
    const bx=-.292,bz=.009,bw=.50,bd=.50,bh=.32;
    const drainboard={x:.285,z:.009,w:.50,d:.50,r:.022};
    counter([{x:bx,z:bz,w:bw,d:bd,r:.025},drainboard]);
    basin(bx,bz,h,bw,bd,bh,.025);
    // Flat inset drainer, without invented corrugations absent from the supplied photograph.
    slab('Escurridor_derecho',drainboard.w,drainboard.d,h-.009,drainboard.x,drainboard.z,.013,mats.top,.022);
    backsplash(.145);legs({offset:.055,top:h-.032,foot:.030});
    shelf(.18,{thick:.026});
    for(const z of [-d/2+.055,d/2-.055])bar('Travesano_largo',[-w/2+.055,.465,z],[w/2-.055,.465,z],.014);
    for(const x of [-w/2+.055,w/2-.055])for(const y of [.18,.465])cyl('Union_tubular',.027,.045,[x,y-.018,d/2-.055]);
    // Visible vertical waste pipe is only a visual detail, not a plumbing installation design.
    cyl('Tubo_bajo_poza',.019,h-bh-.18,[bx,(h-bh+.18)/2,bz],mats.pipe);
    cyl('Paso_desague_repisa',.024,.003,[bx,.183,bz],mats.drain);
    // Faucet is pictured but not described as an included accessory; its geometry is illustrative.
    const fx=bx,fz=-d/2+.068;
    cyl('Base_griferia',.027,.012,[fx,h+.006,fz]);
    cyl('Cuerpo_grifo',.018,.16,[fx,h+.087,fz]);
    const curve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(fx,h+.155,fz),new THREE.Vector3(fx,h+.28,fz),
      new THREE.Vector3(fx,h+.32,fz+.075),new THREE.Vector3(fx,h+.28,fz+.16),
      new THREE.Vector3(fx,h+.24,fz+.17),
    ]);
    add(new THREE.TubeGeometry(curve,30,.011,12,false),mats.edge,'Cuello_grifo');
    cyl('Mando_grifo',.017,.027,[fx+.025,h+.10,fz],mats.edge,[0,0,Math.PI/2]);
    bar('Palanca_grifo',[fx+.04,h+.10,fz],[fx+.04,h+.145,fz-.014],.005);
  } else if(cfg.kind==='double'||cfg.kind==='drainer') {
    const wells=[{x:-.485,z:.012,w:.425,d:.50,r:.004},{x:-.015,z:.012,w:.425,d:.50,r:.004}];
    counter(wells);for(const q of wells)basin(q.x,q.z,h,q.w,q.d,.30,.004);
    backsplash(cfg.kind==='drainer'?.80:.095);legs({square:true,offset:.052,top:h-.036,foot:.040});
    shelf(.405,{width:.52,depth:d-.090,x:.445,thick:.025});
    for(const z of [-d/2+.052,d/2-.052])bar('Travesano_inferior',[-w/2+.052,.16,z],[w/2-.052,.16,z],.012);
    for(const x of [-w/2+.052,w/2-.052])bar('Travesano_lateral',[x,.16,-d/2+.052],[x,.16,d/2-.052],.012);
    if(cfg.kind==='drainer'){
      const back=-d/2+.030,sd=.25,sz=back+sd/2;
      for(const x of [-w/2+.018,w/2-.018])box('Costado_escurridor_vertical',[.015,.80,sd],[x,h+.40,sz],mats.steel,.004);
      for(const y of [1.39,1.61])shelf(y,{width:w-.026,depth:sd,x:0,z:sz,thick:.023});
      // Raised plate loops, cup supports and utensil holes follow the visible distinct rack layout.
      for(let i=0;i<34;i++){
        const x=-.670+i*.031;
        const curve=new THREE.CatmullRomCurve3([
          new THREE.Vector3(x,1.39,back+.025),new THREE.Vector3(x,1.49,back+.06),
          new THREE.Vector3(x,1.49,back+.14),new THREE.Vector3(x,1.39,back+.21),
        ]);
        add(new THREE.TubeGeometry(curve,12,.0038,8,false),mats.edge,'Separador_platos');
      }
      for(const x of [.49,.61]){
        cyl('Aro_utensilios',.040,.003,[x,1.393,sz],mats.edge);
        cyl('Hueco_utensilios',.033,.003,[x,1.395,sz],mats.drain);
      }
      for(const y of [1.01,1.20])for(const x of [-.62,-.54,-.46,-.29,-.20,-.11,-.02,.23,.32,.41]){
        const curve=new THREE.CatmullRomCurve3([
          new THREE.Vector3(x-.018,y,back+.005),new THREE.Vector3(x-.018,y-.018,back+.12),
          new THREE.Vector3(x+.018,y-.018,back+.12),new THREE.Vector3(x+.018,y,back+.005),
        ]);
        add(new THREE.TubeGeometry(curve,12,.004,8,false),mats.black,'Soporte_vasos');
      }
    }
  } else if(cfg.kind==='bar') {
    const divide=.10,left=-w/2,right=w/2,front=d/2-.014;
    cabinetShell({bottom:.09,top:h-.027});
    for(const x of [-w/2+.045,w/2-.045])for(const z of [-d/2+.045,d/2-.045])cyl('Pata_corta',.022,.090,[x,.045,z]);
    box('Division_almacenamiento',[.020,h-.117,d-.024],[divide,(h-.027+.09)/2,0],mats.steel);
    // Open lower left bay and closed right cabinet, matching the owner's photograph.
    slab('Repisa_inferior_bar',divide-left-.024,d-.030,.125,(divide+left)/2,0,.025,mats.top,.002);
    box('Frente_superior_hueco_abierto',[divide-left-.020,.105,.018],[(divide+left)/2,.57,front],mats.steel);
    const doorWidth=(right-divide-.038)/2;
    for(let i=0;i<2;i++){
      const x=divide+.016+doorWidth*(i+.5)+i*.003,leftHinge=i===0;
      movingDoor(`P29_puerta_${i+1}`,[x+(leftHinge?-doorWidth/2:doorWidth/2),.450,front+.012],leftHinge?-100:100,()=>{
        box('Hoja_bar',[doorWidth,.690,.018],[x,.450,front],mats.steel,.002);
        box('Cara_interior_puerta',[doorWidth-.020,.670,.004],[x,.450,front-.010],mats.steel,.001);
        box('Labio_agarre_superior',[doorWidth-.008,.008,.025],[x,.791,front-.007],mats.edge,.001);
      });
    }
    box('Tirador_embutido_bar',[right-divide-.025,.019,.014],[(right+divide)/2,.813,front-.006],mats.drain,.002);
    // Full work surface on the right; left side has four rear pans and two recessed areas.
    slab('Mesa_derecha_bar',right-divide,d,h,(right+divide)/2,0,.030,mats.top,.004);
    const rearBins=[];
    for(let i=0;i<4;i++)rearBins.push({x:left+.105+i*.185,z:-.235,w:.165,d:.125,r:.014});
    const cold={x:-.425,z:-.002,w:.490,d:.250,r:.008},condiments={x:-.035,z:-.002,w:.235,d:.250,r:.008};
    slab('Cubierta_modulo_bar',divide-left,d-.165,h,(divide+left)/2,-.0825,.026,mats.top,.004,[...rearBins,cold,condiments]);
    for(const q of rearBins)basin(q.x,q.z,h,q.w,q.d,.060,.014,false);
    basin(cold.x,cold.z,h,cold.w,cold.d,.160,.008,false);basin(condiments.x,condiments.z,h,condiments.w,condiments.d,.110,.008,false);
    // Empty front bottle rail: bottles, food and removable tools are not modelled as included equipment.
    slab('Fondo_portabotellas',divide-left-.022,.170,.655,(divide+left)/2,.253,.016,mats.top,.002);
    box('Frente_portabotellas',[divide-left-.015,.155,.013],[(divide+left)/2,.7225,.337],mats.steel,.002);
    for(const x of [left+.010,divide-.010])box('Costado_portabotellas',[.014,.155,.170],[x,.7225,.253],mats.steel,.002);
    backsplash(.080);
  }

  for(const {parent,mat,geos,names} of groups.values()) {
    const geo=mergeVertices(mergeGeometries(geos,false),1e-6);const mesh=new THREE.Mesh(geo,mat);mesh.name=`${parent.name}_${mat.name}`;mesh.userData.parts=names;parent.add(mesh);
  }
  root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3());
  for(const axis of ['x','y','z'])if(!Number.isFinite(size[axis])||size[axis]<=0)throw new Error(`${cfg.id}: invalid bounds`);
  if(bounds.min.y<-.001)throw new Error(`${cfg.id}: geometry below floor`);
  const animations=[new THREE.AnimationClip('Abrir_puertas',1.2,tracks)];
  const buffer=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,animations}));
  const report=inspectGlb(buffer);if(report.errors.length||report.warnings.length)throw new Error(JSON.stringify(report));
  const output=`public/models/inox/${cfg.slug}-v2.glb`;await fs.mkdir('public/models/inox',{recursive:true});await fs.writeFile(output,buffer);
  console.log(JSON.stringify({id:cfg.id,output,bytes:buffer.length,triangles:report.triangles,extentsIllustrative:size.toArray(),animations:['Abrir_puertas']}));
}
