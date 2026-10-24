import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls as ActualOrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CART_MODULE_NODES, createCartSceneGraph, disposeCartResources } from '../src/lib/cart-scene-graph.ts';

const ids = Object.keys(CART_MODULE_NODES);
async function model() {
  const bytes = readFileSync(new URL('../public/models/inox/modulo-de-comida-4-en-1-configurable-v1.glb', import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

test('all 16 equipment selections replace real meshes with restored steel covers while preserving the cart', async () => {
  const asset = await model(), root = asset.scene, chassis = root.getObjectByName('CartChassis');
  const chassisState = []; chassis.traverse(node => chassisState.push([node.uuid, node.visible, node.position.toArray(), node.scale.toArray()]));
  for (const [, cover] of Object.values(CART_MODULE_NODES)) assert.deepEqual(root.getObjectByName(cover).scale.toArray(), [0, 0, 0]);
  const graph = createCartSceneGraph(root);
  for (let mask = 0; mask < 16; mask++) {
    const selection = ids.filter((_, i) => mask & (1 << i));
    assert.deepEqual(graph.update(selection), selection);
    for (const [id, [part, cover]] of Object.entries(CART_MODULE_NODES)) {
      const module = root.getObjectByName(part), blank = root.getObjectByName(cover);
      assert.equal(module.visible, selection.includes(id)); assert.equal(blank.visible, !selection.includes(id));
      assert.deepEqual(blank.scale.toArray(), [1, 1, 1]);
      assert.ok(!new THREE.Box3().setFromObject(blank).isEmpty());
    }
    const after = []; chassis.traverse(node => after.push([node.uuid, node.visible, node.position.toArray(), node.scale.toArray()]));
    assert.deepEqual(after, chassisState);
  }
  const state = graph.included; state.push('freidora'); assert.deepEqual(graph.included, ids);
  disposeCartResources(root);
});

test('unsupported and duplicate choices fail atomically without altering the last valid selection', async () => {
  const asset = await model(), graph = createCartSceneGraph(asset.scene); graph.update(['plancha']);
  for (const invalid of [['wok'], ['plancha', 'plancha'], ['__proto__'], null, {}, ['freidora', 1]]) {
    assert.throws(() => graph.update(invalid)); assert.deepEqual(graph.included, ['plancha']);
    assert.equal(asset.scene.getObjectByName('Griddle').visible, true); assert.equal(asset.scene.getObjectByName('Fryer').visible, false);
  }
  disposeCartResources(asset.scene);
});

test('model contracts reject foreign products, ambiguous names, empty meshes and forged mappings', async () => {
  const mutations = [
    root => { root.userData.cart.productId = 'P04'; },
    root => { root.userData.cart.version = 2; },
    root => { root.userData.cart.modules[0].id = 'wok'; },
    root => { root.userData.cart.modules[0].node = 'CartChassis'; },
    root => { root.userData.cart.modules[0] = root.userData.cart.modules[1]; },
    root => { const copy = new THREE.Group(); copy.name = 'Fryer'; root.add(copy); },
    root => { root.getObjectByName('Fryer').clear(); },
    root => { root.getObjectByName('FryerCover').userData.restScale = [100, 1, 1]; },
    root => { root.add(root.getObjectByName('Fryer')); },
  ];
  for (const mutate of mutations) { const { scene } = await model(); mutate(scene); assert.throws(() => createCartSceneGraph(scene)); disposeCartResources(scene); }
});

test('shared GLTF resources and decoded textures are released once', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const counts = { geometry: 0, material: 0, texture: 0, image: 0 };
  texture.image = { close() { counts.image++; } }; const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => counts.geometry++); material.addEventListener('dispose', () => counts.material++); texture.addEventListener('dispose', () => counts.texture++);
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)); disposeCartResources(root);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, image: 1 });
});

const source = ts.transpileModule(readFileSync(new URL('../src/scripts/cart-scene.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.subject = { createCartScene };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function fixture() {
  const asset = await model(), frames = new Map(), renders = [], errors = [];
  let serial = 0, renderer, observer, orbit;
  class Element {
    constructor(tag) { this.tagName = tag; this.dataset = {}; this.style = {}; this.children = []; this.events = new Map(); this.clientWidth = 640; this.clientHeight = 480; this.hidden = false; this.ownerDocument = document; }
    append(child) { this.children.push(child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute() {}
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
    emit(type, data = {}) { this.events.get(type)?.forEach(fn => fn({ type, preventDefault() {}, ...data })); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
    getRootNode() { return document; }
    focus() { document.activeElement = this; }
  }
  const document = { baseURI: 'https://inox.example/', createElement: tag => new Element(tag), activeElement: null, events: new Map(),
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); },
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); } };
  const host = new Element('div');
  class Renderer {
    constructor() { renderer = this; this.domElement = new Element('canvas'); this.shadowMap = {}; this.disposed = 0; this.lost = 0; }
    setPixelRatio() {} setSize() {}
    render(scene, camera) { camera.updateMatrixWorld(); renders.push({ scene, camera, position: camera.position.clone() }); }
    dispose() { this.disposed++; } forceContextLoss() { this.lost++; }
  }
  class Controls extends ActualOrbitControls { constructor(camera, canvas) { super(camera, canvas); orbit = this; } }
  class Environment extends THREE.Scene { dispose() {} }
  class PMREM { fromScene() { return { texture: new THREE.Texture(), dispose() {} }; } dispose() {} }
  class Observer { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } }
  const context = {
    THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM }, GLTFLoader: class { async loadAsync() { return asset; } },
    OrbitControls: Controls, RoomEnvironment: Environment, ResizeObserver: Observer, URL, Map, Set,
    window: { devicePixelRatio: 1 }, createCartSceneGraph, disposeCartResources,
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
  };
  runInNewContext(source, context);
  const controller = await context.subject.createCartScene(host, '/models/cart.glb', { onError: error => errors.push(error) });
  function draw() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); }
  return { controller, host, asset, frames, renders, errors, draw, renderer, observer, orbit, document };
}

test('live module switches preserve camera and zoom, coalesce rapid input, and stop rendering while idle', async () => {
  const f = await fixture(); f.draw(); assert.equal(f.frames.size, 0);
  const camera = f.renders.at(-1).camera, position = camera.position.clone(), target = f.orbit.target.clone();
  f.controller.update(['plancha']); f.controller.update(['freidora']); f.controller.update(['conservadora', 'plancha']);
  assert.equal(f.frames.size, 1); f.draw(); assert.equal(f.frames.size, 0);
  assert.ok(camera.position.equals(position)); assert.ok(f.orbit.target.equals(target));
  assert.equal(f.asset.scene.getObjectByName('Fryer').visible, false); assert.equal(f.asset.scene.getObjectByName('Warmer').visible, true);
  assert.equal(f.host.dataset.cartIncluded, 'conservadora,plancha');
  assert.equal(f.document.activeElement, null); f.controller.dispose();
});

test('invalid selections show an error instead of stale 3D and a valid retry recovers', async () => {
  const f = await fixture(); f.controller.update(['wok']); f.draw();
  assert.equal(f.host.dataset.cartSceneState, 'error'); assert.equal(f.renderer.domElement.hidden, true); assert.equal(f.renderer.domElement.style.display, 'none'); assert.equal(f.errors.length, 1);
  f.controller.update([]); f.draw(); assert.equal(f.host.dataset.cartSceneState, 'ready'); assert.equal(f.renderer.domElement.hidden, false); assert.equal(f.renderer.domElement.style.display, 'block');
  assert.equal(f.asset.scene.getObjectByName('GriddleCover').visible, true); f.controller.dispose();
});

test('roof inspection never removes the vertical posts or alters equipment and camera', async () => {
  const f = await fixture(); f.controller.update(['plancha']); f.draw();
  const camera = f.renders.at(-1).camera, position = camera.position.clone();
  const canopy = f.asset.scene.getObjectByName('CartCanopy'), chassis = f.asset.scene.getObjectByName('CartChassis');
  f.controller.setCanopyVisible(false); f.draw();
  assert.equal(canopy.visible, false); assert.equal(chassis.visible, true);
  assert.equal(f.host.dataset.cartIncluded, 'plancha'); assert.ok(camera.position.equals(position));
  f.controller.update(['freidora']); assert.equal(canopy.visible, false);
  f.controller.setCanopyVisible(true); f.draw(); assert.equal(canopy.visible, true); assert.equal(f.host.dataset.cartIncluded, 'freidora');
  f.controller.dispose();
});

test('worktop inspection frames the actual equipment closely and remains fixed while selecting pieces', async () => {
  const f = await fixture(); f.draw(); const camera = f.renders.at(-1).camera;
  const fullDistance = camera.position.distanceTo(f.orbit.target);
  const worktop = new THREE.Box3().setFromObject(f.asset.scene.getObjectByName('CartModules'));
  worktop.union(new THREE.Box3().setFromObject(f.asset.scene.getObjectByName('CartCovers')));
  f.controller.setCanopyVisible(false); f.controller.setView('top'); f.draw();
  assert.ok(camera.position.distanceTo(f.orbit.target) < fullDistance * 0.7, 'equipment inspection must be significantly closer than the whole cart');
  assert.ok(f.orbit.target.distanceTo(worktop.getCenter(new THREE.Vector3())) < 0.000001, `${f.orbit.target.toArray()} vs ${worktop.getCenter(new THREE.Vector3()).toArray()}`);
  const points = [];
  for (const x of [worktop.min.x, worktop.max.x]) for (const y of [worktop.min.y, worktop.max.y]) for (const z of [worktop.min.z, worktop.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera));
  const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
  assert.ok(width > 1.4 && width < 1.95, `stations should occupy most of the viewport without clipping (${width})`);
  const floor = f.renders.at(-1).scene.children.find(node => node.material instanceof THREE.ShadowMaterial);
  assert.equal(floor.visible, false, 'cast shadows on the floor must not obscure the worktop');
  const position = camera.position.clone(), lookAt = f.orbit.target.clone();
  f.controller.update(['plancha']); f.draw(); assert.ok(camera.position.equals(position)); assert.ok(f.orbit.target.equals(lookAt));
  f.controller.setView('perspective'); f.draw(); assert.equal(floor.visible, true); assert.ok(camera.position.distanceTo(f.orbit.target) > fullDistance * 0.99);
  f.controller.dispose();
});

test('views and focused keyboard controls work without capturing browser shortcuts', async () => {
  const f = await fixture(); f.draw(); const canvas = f.renderer.domElement, camera = f.renders.at(-1).camera;
  f.controller.setView('front'); f.draw(); assert.equal(f.host.dataset.cartView, 'front'); assert.equal(f.document.activeElement, null);
  let prevented = false; const key = (name, modifiers = {}) => { prevented = false; canvas.emit('keydown', { key: name, ...modifiers, preventDefault() { prevented = true; } }); return prevented; };
  assert.equal(key('ArrowLeft'), false); f.controller.focus(); const before = camera.position.clone();
  assert.equal(key('ArrowLeft'), true); assert.equal(camera.position.equals(before), false);
  let distance = camera.position.distanceTo(f.orbit.target); assert.equal(key('+'), true); assert.ok(camera.position.distanceTo(f.orbit.target) < distance);
  for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) assert.equal(key('+', modifiers), false);
  assert.equal(key('Tab'), false); f.draw(); assert.equal(f.frames.size, 0); f.controller.dispose();
});

test('context loss stops rendering until recreation; disposal releases listeners, observer and GPU once', async () => {
  const f = await fixture(); f.controller.update(['plancha']); assert.equal(f.frames.size, 1);
  f.renderer.domElement.emit('webglcontextlost'); assert.equal(f.frames.size, 0); assert.equal(f.host.dataset.cartSceneState, 'error');
  f.controller.update(ids); f.controller.setView('front'); assert.equal(f.frames.size, 0);
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.renderer.disposed, 1); assert.equal(f.renderer.lost, 1); assert.equal(f.observer.disconnected, true); assert.equal(f.host.children.length, 0);
  assert.equal([...f.renderer.domElement.events.values()].every(listeners => listeners.size === 0), true);
  assert.equal([...f.document.events.values()].every(listeners => listeners.size === 0), true);
  assert.equal(f.orbit._listeners.change.length, 0); assert.deepEqual(f.host.dataset, {});
});
