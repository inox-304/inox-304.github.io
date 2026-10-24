import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inspectGlb } from '../lib/model-budget.mjs';
const manifest = JSON.parse(await fs.readFile('scripts/3d/pollero-config-manifest.json', 'utf8'));
const load = async file => { const bytes = await fs.readFile(file); return { bytes, gltf: await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '') }; };
assert.equal(manifest.length, 16);
let total = 0;
for (const item of manifest) {
  const { bytes, gltf } = await load(`public${item.model3d}`), root = gltf.scene, report = inspectGlb(bytes);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); assert.ok(bytes.length < 8 * 1024 * 1024); total += bytes.length;
  assert.equal(item.poster, item.model3d.replace('/models/inox/', '/images/products/').replace('.glb', '.webp'));
  assert.ok((await fs.stat(`public${item.poster}`)).size > 1000);
  const loads = root.getObjectByName('Carga_pollos'); assert.equal(loads.children.length, 6);
  let birds = []; loads.traverse(node => { if (node.userData.countAsChicken) birds.push(node); });
  assert.equal(birds.length, item.capacity); assert.equal(new Set(birds.map(bird => bird.name)).size, item.capacity);
  assert.deepEqual(root.userData.configurableRoaster, { design: item.design, fuel: item.fuel, capacity: item.capacity, spitCount: 6, chickensPerSpit: item.capacity / 6 });
  assert.equal(root.userData.dimensionsVerified, false); assert.equal(root.userData.manufacturingUse, false);
  root.updateMatrixWorld(true);
  for (const spit of loads.children) {
    assert.equal(spit.children.length, item.capacity / 6);
    const bounds = spit.children.map(bird => new T.Box3().setFromObject(bird));
    for (let i = 1; i < bounds.length; i++) assert.ok(bounds[i - 1].max.x < bounds[i].min.x, 'Adjacent chickens must not intersect');
    for (const box of bounds) { assert.ok(box.min.x > -.39 && box.max.x < .39); assert.ok(box.min.y > .79 && box.max.y < 1.41); assert.ok(box.min.z > -.31 && box.max.z < .31); }
  }
  const fuels = root.getObjectByName(item.fuel === 'lena' ? 'Combustible_lena' : 'Combustible_carbon'); assert.ok(fuels);
  assert.equal(root.getObjectByName(item.fuel === 'lena' ? 'Combustible_carbon' : 'Combustible_lena'), undefined);
  const { bytes: sourceBytes, gltf: source } = await load(`public/models/inox/${root.userData.sourceGlb}`);
  assert.equal(crypto.createHash('sha256').update(sourceBytes).digest('hex'), root.userData.sourceSha256);
  const originalNodes = []; source.scene.traverse(node => { if (node !== source.scene) originalNodes.push(node); });
  for (const node of originalNodes) {
    const counterpart = root.getObjectByName(node.name); assert.ok(counterpart, `Preserved chassis node ${node.name}`);
    assert.deepEqual(counterpart.position.toArray(), node.position.toArray()); assert.deepEqual(counterpart.quaternion.toArray(), node.quaternion.toArray());
    if (node.isMesh) {
      assert.deepEqual([...counterpart.geometry.getAttribute('position').array], [...node.geometry.getAttribute('position').array]);
      assert.deepEqual([...counterpart.geometry.index.array], [...node.geometry.index.array]);
    }
  }
  assert.equal(gltf.animations[0].name, 'Abrir_puertas'); assert.equal(gltf.animations[0].tracks.length, source.animations[0].tracks.length);
  const mixer = new T.AnimationMixer(root), action = mixer.clipAction(gltf.animations[0]); action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const doors = ['Puerta_inferior_izquierda', 'Puerta_inferior_derecha'].map(name => root.getObjectByName(name));
  assert.ok(doors.every(Boolean)); mixer.setTime(1.35); assert.ok(doors.every(door => door.quaternion.angleTo(new T.Quaternion()) > 1));
  mixer.setTime(0); assert.ok(doors.every(door => door.quaternion.angleTo(new T.Quaternion()) < 1e-6));
}
assert.ok(total < 40 * 1024 * 1024);
console.log(JSON.stringify({ passed: manifest.length, totalBytes: total, checks: ['exact chicken counts', 'no adjacent food overlap', 'source chassis preserved', 'fuel choice', 'door clips', 'budget'] }));
