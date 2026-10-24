import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inspectGlb } from '../lib/model-budget.mjs';
const manifest = JSON.parse(await fs.readFile('scripts/3d/multiuso-config-manifest.json', 'utf8'));
const load = async file => { const bytes = await fs.readFile(file); return { bytes, gltf: await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '') }; };
const original = await load('public/models/inox/horno-multiuso-v2.glb'), originalFixed = original.gltf.scene.getObjectByName('Fijo_Acero_pulido');
assert.equal(manifest.length, 8); let total = 0;
for (const item of manifest) {
  const { bytes, gltf } = await load(`public${item.model3d}`), root = gltf.scene, budget = inspectGlb(bytes); total += bytes.length;
  assert.deepEqual(budget.errors, []); assert.deepEqual(budget.warnings, []);
  assert.equal(item.poster, item.model3d.replace('/models/inox/', '/images/products/').replace('.glb', '.webp'));
  assert.ok((await fs.stat(`public${item.poster}`)).size > 1000);
  assert.equal(root.userData.sourceSha256, crypto.createHash('sha256').update(original.bytes).digest('hex'));
  assert.equal(root.userData.removedSourceRackTriangles, 4032); assert.equal(root.userData.manufacturingUse, false); assert.equal(root.userData.dimensionsVerified, false);
  const fixed = root.getObjectByName('Fijo_Acero_pulido');
  assert.equal((originalFixed.geometry.index.count - fixed.geometry.index.count) / 3, 4032);
  assert.equal(fixed.userData.parts.filter(part => /Varilla_rejilla|Marco_rejilla/.test(part)).length, 0);
  const trays = []; root.traverse(node => { if (node.userData.countAsTray) trays.push(node); });
  assert.equal(trays.length, item.capacity); assert.equal(new Set(trays.map(node => node.name)).size, item.capacity);
  root.updateMatrixWorld(true);
  const boxes = trays.map(tray => new T.Box3().setFromObject(tray));
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(boxes[i].min.x > -.42 && boxes[i].max.x < .42); assert.ok(boxes[i].max.z < .32 && boxes[i].min.z > -.33);
    if (i > 0) assert.ok(boxes[i - 1].max.y < boxes[i].min.y);
  }
  const fan = root.getObjectByName('Ventilador_conveccion'); assert.equal(Boolean(fan), item.mode === 'conveccion');
  if (fan) {
    assert.equal(fan.children.filter(child => child.name.startsWith('Aspa_')).length, 5);
    const fanBox = new T.Box3().setFromObject(fan); assert.ok(boxes.every(box => box.min.z > fanBox.max.z));
  }
  const door = root.getObjectByName('Puerta_horno_multiuso'), sourceDoor = original.gltf.scene.getObjectByName('Puerta_horno_multiuso');
  assert.deepEqual(door.position.toArray(), sourceDoor.position.toArray());
  assert.equal(gltf.animations[0].name, 'Abrir_puertas');
  for (let i = 0; i < gltf.animations[0].tracks.length; i++) {
    assert.deepEqual([...gltf.animations[0].tracks[i].times], [...original.gltf.animations[0].tracks[i].times]);
    assert.deepEqual([...gltf.animations[0].tracks[i].values], [...original.gltf.animations[0].tracks[i].values]);
  }
  const mixer = new T.AnimationMixer(root), action = mixer.clipAction(gltf.animations[0]); action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  mixer.setTime(1.35); assert.ok(door.quaternion.angleTo(new T.Quaternion()) > 1.7); mixer.setTime(0); assert.ok(door.quaternion.angleTo(new T.Quaternion()) < 1e-6);
}
console.log(JSON.stringify({ passed: manifest.length, totalBytes: total, checks: ['source four racks removed', 'exact tray counts', 'fan only for convection', 'tray and fan clearances', 'source door animation', 'budget'] }));
