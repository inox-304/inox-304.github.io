import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inspectGlb } from './lib/model-budget.mjs';

const path = new URL('../public/models/inox/modulo-de-comida-4-en-1-configurable-v1.glb', import.meta.url);
const expected = [
  { id: 'broastera', node: 'Broaster', coverNode: 'BroasterCover' },
  { id: 'freidora', node: 'Fryer', coverNode: 'FryerCover' },
  { id: 'conservadora', node: 'Warmer', coverNode: 'WarmerCover' },
  { id: 'plancha', node: 'Griddle', coverNode: 'GriddleCover' },
];
async function asset() {
  const bytes = readFileSync(path);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
function visibleTriangles(root) {
  let count = 0;
  root.traverseVisible(object => {
    if (object.isMesh) count += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  return count;
}

test('cart GLB is self-contained and within the mobile model budget', () => {
  const report = inspectGlb(readFileSync(path));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.ok(report.bytes < 3 * 1024 * 1024);
  assert.ok(report.triangles < 50000);
  assert.deepEqual(inspectGlb(readFileSync(new URL('../public/models/inox/modulo-de-comida-4-en-1-v1.glb', import.meta.url))).errors, []);
});

test('four independent stations and neutral worktops survive GLB export', async () => {
  const { scene } = await asset();
  assert.equal(scene.userData.cart.productId, 'P15');
  assert.equal(scene.userData.cart.version, 1);
  assert.deepEqual(scene.userData.cart.modules, expected);
  assert.equal(scene.userData.dimensionsVerified, false);
  const chassis = scene.getObjectByName('CartChassis');
  assert.ok(chassis);
  const parts = [];
  chassis.traverse(child => parts.push(...(child.userData.parts || [])));
  assert.ok(parts.includes('Lona_rayada_toldo'));
  assert.ok(parts.includes('Poste_toldo'));
  assert.ok(parts.includes('Rueda'));
  const roof = scene.getObjectByName('CartCanopy');
  assert.ok(roof && roof.parent === chassis);
  assert.equal(roof.visible, true);
  const roofParts = roof.children.flatMap(child => child.userData.parts || []);
  assert.ok(roofParts.includes('Lona_rayada_toldo'));
  assert.equal(roofParts.includes('Poste_toldo'), false, 'view-only roof hiding keeps the vertical posts');
  let previousX = -Infinity;
  for (const item of expected) {
    const station = scene.getObjectByName(item.node), cover = scene.getObjectByName(item.coverNode);
    assert.ok(station && cover);
    assert.equal(station.parent.name, 'CartModules');
    assert.equal(cover.parent.name, 'CartCovers');
    assert.ok(visibleTriangles(station) > 0);
    assert.ok(visibleTriangles(cover) > 0);
    assert.deepEqual(cover.scale.toArray(), [0, 0, 0], 'ordinary GLB preview keeps the photographed four stations');
    assert.deepEqual(cover.userData.restScale, [1, 1, 1]);
    cover.scale.set(1, 1, 1);
    const box = new THREE.Box3().setFromObject(cover), center = box.getCenter(new THREE.Vector3());
    assert.ok(center.x > previousX, 'stations retain their photographed left-to-right order');
    assert.ok(box.min.y > .77 && box.max.y < .80, 'neutral insert is at the counter surface');
    previousX = center.x;
  }
});

test('every combination replaces stations with real worktop geometry and preserves the cart', async () => {
  const { scene } = await asset();
  const chassis = scene.getObjectByName('CartChassis');
  const initialChassis = visibleTriangles(chassis);
  const initialEnvelope = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  for (let mask = 0; mask < 16; mask++) {
    let expectedTriangles = initialChassis;
    for (let index = 0; index < expected.length; index++) {
      const item = expected[index], enabled = Boolean(mask & (1 << index));
      const station = scene.getObjectByName(item.node), cover = scene.getObjectByName(item.coverNode);
      station.visible = enabled;
      cover.scale.set(1, 1, 1); cover.visible = !enabled;
      expectedTriangles += visibleTriangles(enabled ? station : cover);
    }
    assert.equal(visibleTriangles(scene), expectedTriangles);
    assert.equal(chassis.visible, true);
    assert.equal(visibleTriangles(chassis), initialChassis);
    const envelope = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    assert.ok(envelope.distanceTo(initialEnvelope) < .00001, 'configuration does not resize the chassis/canopy');
  }
});

test('removing the fryer leaves a covering worktop instead of an unfilled cutout', async () => {
  const { scene } = await asset();
  const cover = scene.getObjectByName('FryerCover'); cover.scale.set(1, 1, 1);
  const bounds = new THREE.Box3().setFromObject(cover);
  assert.ok(bounds.min.x <= -.138 - .090 && bounds.max.x >= -.138 + .090);
  assert.ok(bounds.min.z <= .020 - .355 / 2 && bounds.max.z >= .020 + .355 / 2);
  assert.ok(bounds.max.y >= .777, 'insert closes the opening at deck height');
});
