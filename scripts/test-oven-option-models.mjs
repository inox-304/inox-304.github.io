import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ovenOptionSpecs, optionAssetStem, pizzaSourcePhoto } from './3d/build-inox-oven-options.mjs';
import { inspectGlb } from './lib/model-budget.mjs';

async function load(spec) {
  const bytes = readFileSync(new URL(`../public/models/inox/${optionAssetStem(spec)}.glb`, import.meta.url));
  const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  asset.scene.updateMatrixWorld(true); return { bytes, asset };
}
function collect(root, predicate) { const nodes = []; root.traverse(node => { if (predicate(node)) nodes.push(node); }); return nodes; }

test('all 18 option assets are self-contained, budgeted and explicitly illustrative without verified dimensions', async () => {
  assert.equal(ovenOptionSpecs.length, 18);
  for (const spec of ovenOptionSpecs) {
    const { bytes, asset } = await load(spec);
    assert.ok(bytes.length < 8 * 1024 * 1024);
    assert.deepEqual(inspectGlb(bytes).errors, []);
    for (const key of ['kind', 'capacity', 'energy']) assert.equal(asset.scene.userData[key], spec[key]);
    assert.equal(asset.scene.userData.visualOnly, true);
    assert.equal(asset.scene.userData.dimensionsVerified, false);
    assert.equal(asset.scene.userData.manufacturingUse, false);
    assert.equal(asset.scene.userData.sourcePhoto, spec.kind === 'pizza' ? pizzaSourcePhoto : null);
    const bounds = new T.Box3().setFromObject(asset.scene);
    assert.ok(!bounds.isEmpty() && bounds.min.y > -.001);
    assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite));
    assert.equal(collect(asset.scene, node => node.userData.role === 'tray').length, spec.capacity);
    assert.equal(collect(asset.scene, node => node.userData.role === 'energyControls').length, 1);
    assert.ok(asset.scene.getObjectByName(`Controles_${spec.energy}`));
    assert.equal(Boolean(asset.scene.getObjectByName('Cubierta_vidrio_opcional')), Boolean(spec.glass));
    if (spec.kind === 'tavola') assert.equal(asset.scene.userData.glassApproval, 'owner-confirmed');
  }
});

test('every tavola pan is actually open and reachable from above instead of covered by a solid counter', async () => {
  for (const spec of ovenOptionSpecs.filter(spec => spec.kind === 'tavola' && !spec.glass)) {
    const { asset } = await load(spec);
    const pans = collect(asset.scene, node => node.userData.role === 'tray');
    for (const pan of pans) {
      const center = pan.getWorldPosition(new T.Vector3());
      const ray = new T.Raycaster(new T.Vector3(center.x, 3, center.z), new T.Vector3(0, -1, 0));
      const hit = ray.intersectObject(asset.scene, true)[0];
      assert.ok(hit, `${optionAssetStem(spec)} ${pan.name}`);
      assert.equal(hit.object.parent, pan, `${pan.name} must not be blocked by the counter`);
    }
  }
});

test('both pizza variants preserve the photo-led vertical cabinet, two stacked wire racks and lower controls', async () => {
  for (const spec of ovenOptionSpecs.filter(spec => spec.kind === 'pizza')) {
    const { asset } = await load(spec);
    const size = new T.Box3().setFromObject(asset.scene).getSize(new T.Vector3());
    assert.ok(size.y > size.x * 1.2, 'The reference is a compact vertical cabinet, not the former horizontal oven on a tall stand');
    const racks = collect(asset.scene, node => node.userData.role === 'tray');
    assert.equal(racks.length, 2);
    racks.forEach(rack => assert.equal(rack.userData.type, 'wireRack'));
    const boxes = racks.map(rack => new T.Box3().setFromObject(rack));
    assert.ok(boxes[0].max.y < boxes[1].min.y);
    assert.ok(Math.abs(boxes[0].getCenter(new T.Vector3()).x - boxes[1].getCenter(new T.Vector3()).x) < .00001);
    const controls = new T.Box3().setFromObject(asset.scene.getObjectByName(`Controles_${spec.energy}`));
    assert.ok(controls.max.y < boxes[0].min.y, 'Controls belong below the chamber, not at one side');
    assert.equal(asset.scene.userData.sourceEnergy, 'gas');
    if (spec.energy === 'electric') assert.match(asset.scene.userData.energyDepiction, /not a photographed electric model/);
    const handle = asset.scene.getObjectByName('Pomo_derecho');
    assert.ok(handle.getWorldPosition(new T.Vector3()).x > .2, 'The photo shows the knob at the right of the closed glass door');
  }
});

test('both pizza variants have a complete side-swing glass door and handle that return closed', async () => {
  for (const spec of ovenOptionSpecs.filter(spec => spec.kind === 'pizza')) {
    const { asset } = await load(spec);
    assert.equal(asset.animations.length, 1);
    assert.equal(asset.animations[0].name, 'Abrir_puertas');
    const door = asset.scene.getObjectByName('Puerta_horno_pizza'); assert.ok(door);
    assert.ok(door.children.some(mesh => /Vidrio/.test(mesh.material?.name)));
    assert.equal(door.userData.openingIllustrative, true);
    const handle = asset.scene.getObjectByName('Pomo_derecho');
    const handleClosed = handle.getWorldPosition(new T.Vector3());
    const closed = door.quaternion.clone();
    const mixer = new T.AnimationMixer(asset.scene); const action = mixer.clipAction(asset.animations[0]);
    action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    mixer.setTime(1.1); assert.ok(door.quaternion.angleTo(closed) > 1.4);
    assert.ok(Math.abs(door.quaternion.x) < .00001 && Math.abs(door.quaternion.z) < .00001, 'Side-swing animation rotates on the vertical axis');
    assert.ok(handle.getWorldPosition(new T.Vector3()).distanceTo(handleClosed) > .5, 'The visible handle must move with its glass door');
    action.reset().play(); mixer.setTime(0); assert.ok(door.quaternion.angleTo(closed) < .00001);
    assert.ok(handle.getWorldPosition(new T.Vector3()).distanceTo(handleClosed) < .00001);
    const pans = collect(asset.scene, node => node.userData.role === 'tray');
    const boxes = pans.map(pan => new T.Box3().setFromObject(pan));
    assert.equal(boxes[0].intersectsBox(boxes[1]), false);
  }
});
