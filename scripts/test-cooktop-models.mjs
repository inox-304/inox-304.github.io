import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { kitchenSpecs } from './3d/build-inox-cocinas.mjs';
import { inspectGlb } from './lib/model-budget.mjs';

const load=async path=>{const bytes=await fs.readFile(path);const report=inspectGlb(bytes);assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);return {gltf:await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''),report};};
function lowerSurfacePoints(root,yLimit){
 root.updateMatrixWorld(true);const points=[];const point=new T.Vector3();
 root.traverse(node=>{if(!node.isMesh)return;const p=node.geometry.getAttribute('position');for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld);if(point.y<yLimit)points.push(point.toArray().map(n=>n.toFixed(6)).join(','));}});
 return points.sort();
}
const reports=[];
for(const spec of kitchenSpecs){
 const {gltf,report}=await load(`public/models/inox/cooktop-${spec.id.toLowerCase()}-v1.glb`);
 const scene=gltf.scene,config=scene.userData.cooktop,bank=scene.getObjectByName('CooktopTemplates'),chassis=scene.getObjectByName('CooktopChassis');
 assert(config&&config.version===1);assert(bank&&chassis);assert.equal(bank.children.length,5);assert.equal(chassis.userData.dimensionsVerified,false);
 assert(config.surface.minX<config.surface.maxX&&config.surface.minZ<config.surface.maxZ&&config.surface.y>0);
 scene.traverse(node=>{if(node.isMesh)for(const attribute of Object.values(node.geometry.attributes))for(const value of attribute.array)assert(Number.isFinite(value));});
 for(const name of Object.values(config.templates)){
  const template=bank.getObjectByName(name);assert(template&&template.parent===bank);
  assert.deepEqual(template.position.toArray(),[0,0,0]);assert.deepEqual(template.scale.toArray(),[1,1,1]);
  const box=new T.Box3().setFromObject(template),size=box.getSize(new T.Vector3());
  assert(Math.abs(box.min.y)<1e-6,`${name}: support plane`);
  assert(size.x<=1.0001&&size.z<=1.0001&&size.y>0&&size.y<.2,`${name}: visual bounds`);
  assert(Math.abs((box.min.x+box.max.x)/2)<1e-6&&Math.abs((box.min.z+box.max.z)/2)<1e-6);
 }
 const {gltf:legacy}=await load(`public/models/inox/${spec.slug}-${spec.open?'v1':'v2'}.glb`);
 // All geometry below the deck is exactly preserved from the existing asset.
 assert.deepEqual(lowerSurfacePoints(chassis,config.surface.y-.060),lowerSurfacePoints(legacy.scene,config.surface.y-.060),`${spec.id}: chassis changed`);
 assert.equal(gltf.animations.length,spec.open?0:1);
 if(!spec.open){
  const door=scene.getObjectByName('Puerta_horno_'+spec.id),oldDoor=legacy.scene.getObjectByName('Puerta_horno_'+spec.id);
  assert(door&&oldDoor);assert.deepEqual(door.position.toArray(),oldDoor.position.toArray());
  assert.equal(gltf.animations[0].name,'Abrir_puertas');
  assert.deepEqual([...gltf.animations[0].tracks[0].times],[...legacy.animations[0].tracks[0].times]);
  assert.deepEqual([...gltf.animations[0].tracks[0].values],[...legacy.animations[0].tracks[0].values]);
  const mixer=new T.AnimationMixer(scene),action=mixer.clipAction(gltf.animations[0]);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(1.2);
  assert(door.quaternion.angleTo(new T.Quaternion())>1);mixer.setTime(0);assert(door.quaternion.angleTo(new T.Quaternion())<1e-6);
 }
 // A real composition replaces two burners with one plate and one with a wok.
 // No base burner meshes exist in CooktopChassis; instances live separately.
 const layout=spec.open?{rows:1,columns:3}:{rows:2,columns:3};
 const surface=config.surface,cw=(surface.maxX-surface.minX)/layout.columns,cd=(surface.maxZ-surface.minZ)/layout.rows;
 const active=new T.Group();active.name='TestActiveModules';scene.add(active);bank.visible=false;
 const place=(key,anchor,width=1,height=1)=>{
  const clone=bank.getObjectByName(config.templates[key]).clone(true);clone.visible=true;const row=Math.floor(anchor/layout.columns),col=anchor%layout.columns;
  clone.position.set(surface.minX+(col+width/2)*cw,surface.y,surface.minZ+(row+height/2)*cd);
  const uniform=key==='burnerGas'||key==='burnerElectric'||key==='wok';clone.scale.set(uniform?Math.min(cw,cd):cw*width,1,uniform?Math.min(cw,cd):cd*height);active.add(clone);
  const bounds=new T.Box3().setFromObject(clone);assert(bounds.min.x>=surface.minX-1e-5&&bounds.max.x<=surface.maxX+1e-5);assert(bounds.min.z>=surface.minZ-1e-5&&bounds.max.z<=surface.maxZ+1e-5);return clone;
 };
 if(spec.open){place('griddle',0);place('wok',1);place('burnerGas',2);}
 else{place('griddle',0,1,2);place('wok',4);for(const anchor of[1,2,5])place('burnerGas',anchor);}
 assert.equal(active.children.filter(node=>node.name==='Griddle').length,1);assert.equal(active.children.filter(node=>node.name==='Wok').length,1);
 const plate=active.children.find(node=>node.name==='Griddle'),wok=active.children.find(node=>node.name==='Wok');
 const height=node=>new T.Box3().setFromObject(node).getSize(new T.Vector3()).y;assert(height(wok)>height(plate)*2);
 reports.push({id:spec.id,bytes:report.bytes,triangles:report.triangles,templates:bank.children.length,doorPreserved:!spec.open,chassisMatchesLegacy:true});
}
console.log(JSON.stringify({passed:reports.length,assets:reports}));
