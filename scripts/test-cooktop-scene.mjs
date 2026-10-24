import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls as ActualOrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as rules from '../src/lib/cooktop-config.ts';
import { readCooktopSurface, planCooktopParts, disposeCooktopResources } from '../src/scripts/cooktop-scene.ts';
import { createKitchenGeometry, createFryerTemplate } from '../src/scripts/kitchen-geometry.ts';

const config = JSON.parse(readFileSync(new URL('./fixtures/cooktop.json', import.meta.url), 'utf8'));
const surface = { minX: -0.715, maxX: 0.715, minZ: -0.39, maxZ: 0.39, y: 0.819 };
const selected = (placements = [], energy = 'gas') => ({ layoutId: 'six', energy, placements });
const source = ts.transpileModule(readFileSync(new URL('../src/scripts/cooktop-scene.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.subject = { createCooktopScene };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('the plan replaces two left burners with one plate and another burner with a wok', () => {
  const parts = planCooktopParts(config, selected([{ moduleId: 'plate', anchor: 0 }, { moduleId: 'wok', anchor: 2 }]), surface);
  assert.equal(parts.length, 5);
  assert.equal(parts.filter(part => part.template === 'BurnerGas').length, 3);
  assert.deepEqual(parts.find(part => part.template === 'Griddle').cells, [0, 3]);
  assert.deepEqual(parts.filter(part => part.template === 'BurnerGas').map(part => part.anchor), [1, 4, 5]);
  const plate = parts.find(part => part.template === 'Griddle');
  assert.equal(plate.scaleZ, surface.maxZ - surface.minZ);
  assert.equal(plate.z, 0);
  const wok = parts.find(part => part.template === 'Wok');
  assert.equal(wok.scaleX, wok.scaleZ);
  assert.ok(wok.x > 0 && wok.z < 0, 'row zero is at the back, column two at the right');
  assert.equal(planCooktopParts(config, selected([], 'electric'), surface).every(part => part.template === 'BurnerElectric'), true);
});

test('invalid metadata, overlapping rules and unsupported selected modules fail closed', () => {
  for (const metadata of [null, {}, { version: 2, surface }, { version: 1, surface: { ...surface, y: NaN } }, { version: 1, surface: { ...surface, maxX: surface.minX } }]) {
    assert.throws(() => readCooktopSurface(metadata));
  }
  assert.throws(() => planCooktopParts(config, selected([{ moduleId: 'plate', anchor: 0 }, { moduleId: 'wok', anchor: 3 }]), surface));
  const other = structuredClone(config); other.modules[1].kind = 'other';
  assert.throws(() => planCooktopParts(other, selected([{ moduleId: 'wok', anchor: 1 }]), surface), /representación 3D/);
  assert.throws(() => planCooktopParts(config, selected(), { ...surface, minZ: Infinity }));
});

async function model(code) {
  const bytes = readFileSync(new URL(`../public/models/inox/cooktop-${code}-v1.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

test('all four published cooktop GLBs satisfy the renderer contract and preserve oven animations', async () => {
  for (const code of ['p02', 'p03', 'p04', 'p05']) {
    const asset = await model(code), metadata = readCooktopSurface(asset.scene.userData.cooktop);
    assert.ok(asset.scene.getObjectByName('CooktopChassis'));
    const bank = asset.scene.getObjectByName('CooktopTemplates'); assert.ok(bank);
    for (const name of ['BurnerGas', 'BurnerElectric', 'Wok', 'Griddle', 'Grill']) {
      const template = bank.getObjectByName(name); assert.ok(template, `${code}: ${name}`);
      const box = new THREE.Box3().setFromObject(template);
      assert.ok(!box.isEmpty() && box.min.y >= -0.00001);
    }
    assert.ok(metadata.y > 0);
    assert.equal(asset.animations.some(clip => clip.name === 'Abrir_puertas'), ['p04', 'p05'].includes(code));
    disposeCooktopResources(asset.scene);
  }
});

test('shared geometry, materials and texture bitmaps are released exactly once', () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const counts = { geometry: 0, material: 0, texture: 0, image: 0 };
  texture.image = { close() { counts.image++; } };
  const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => counts.geometry++); material.addEventListener('dispose', () => counts.material++); texture.addEventListener('dispose', () => counts.texture++);
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  disposeCooktopResources(group);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, image: 1 });
});

function kitchenConfig(family = 'central') {
  const configured = structuredClone(config);
  configured.kitchen = { family, ovens: ['none', 'gas', 'electric'], structures: ['open', 'cabinet'], supports: ['feet', 'wheels'],
    materials: [{ id: '304-12', name: 'Acero 304 mate 1,2 mm', steel: '304', thicknessMm: 1.2 }], dimensions: null };
  configured.modules.push({ id: 'fryer', name: 'Freidora', kind: 'fryer', width: 1, height: 2, energies: ['gas'], allowedLayouts: ['six'], maxQuantity: 2, anchors: { six: [0, 1, 2] } });
  return configured;
}

test('all four kitchen families have distinct chassis and confirmed dimensions control physical bounds', () => {
  const dimensions = [];
  for (const family of ['linear', 'central', 'builtin', 'home']) {
    const cfg = kitchenConfig(family), state = rules.initialCooktopSelection(cfg);
    const geometry = createKitchenGeometry(cfg, state), size = new THREE.Box3().setFromObject(geometry.root).getSize(new THREE.Vector3());
    assert.equal(geometry.root.userData.family, family); assert.equal(geometry.root.userData.dimensionsVerified, false);
    assert.equal(geometry.root.userData.steel, '304'); assert.equal(geometry.root.userData.thicknessMm, 1.2);
    if (family === 'builtin') { assert.ok(size.y < .25); assert.equal(geometry.root.getObjectByName('Pata'), undefined); }
    dimensions.push(size.toArray().map(value => value.toFixed(3)).join(',')); disposeCooktopResources(geometry.root);
  }
  assert.equal(new Set(dimensions).size, 4);
  const cfg = kitchenConfig(), state = rules.initialCooktopSelection(cfg);
  Object.assign(state.kitchen, { widthMm: 1800, depthMm: 900, heightMm: 950 });
  const built = createKitchenGeometry(cfg, state);
  assert.equal(built.root.userData.dimensionsVerified, true);
  assert.ok(Math.abs(built.surface.maxX - built.surface.minX - 1.73) < 1e-8);
  assert.ok(Math.abs(built.surface.maxZ - built.surface.minZ - .83) < 1e-8);
  disposeCooktopResources(built.root);
});

test('fryer has its own tank, basket and handle and replaces the complete occupied footprint', () => {
  const cfg = kitchenConfig(), state = rules.initialCooktopSelection(cfg); state.placements = [{ moduleId: 'fryer', anchor: 0 }];
  const planned = planCooktopParts(cfg, state, surface), fry = planned.find(part => part.template === 'Fryer');
  assert.deepEqual(fry.cells, [0, 3]); assert.equal(planned.filter(part => part.template === 'BurnerGas').length, 4);
  const template = createFryerTemplate(), bounds = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
  assert.ok(template.children.length > 50); assert.ok(bounds.x <= 1 && bounds.z <= 1 && bounds.y > .1);
  disposeCooktopResources(template);
});

async function fixture(code = 'p04', realControls = false) {
  const asset = await model(code), frames = new Map(), renders = [], errors = [], picks = [];
  let serial = 0, time = 0, renderer, observer, orbit;
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
  class Controls extends THREE.EventDispatcher {
    constructor(camera) { super(); orbit = this; this.camera = camera; this.target = new THREE.Vector3(); }
    update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(); this.dispatchEvent({ type: 'change' }); }
    dispose() { this.disposed = true; }
  }
  class RealControls extends ActualOrbitControls { constructor(camera, canvas) { super(camera, canvas); orbit = this; } }
  class Environment extends THREE.Scene { dispose() {} }
  class PMREM { fromScene() { return { texture: new THREE.Texture(), dispose() {} }; } dispose() {} }
  class Observer { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } }
  const context = {
    THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM }, GLTFLoader: class { async loadAsync() { return asset; } },
    OrbitControls: realControls ? RealControls : Controls, RoomEnvironment: Environment, ResizeObserver: Observer, URL, Map, Set,
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }, performance: { now: () => time },
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id), createKitchenGeometry, createFryerTemplate, ...rules,
  };
  runInNewContext(source, context);
  const controller = await context.subject.createCooktopScene(host, '/models/test.glb', { onPick: anchor => picks.push(anchor), onError: error => errors.push(error) });
  function draw(at = time) { time = at; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(at)); }
  return { controller, host, asset, frames, renders, errors, picks, draw, renderer, observer, orbit, document };
}

test('updates replace actual meshes, retain the camera and stop scheduling frames at rest', async () => {
  const f = await fixture();
  f.controller.update(config, selected()); f.draw();
  assert.equal(f.frames.size, 0); assert.equal(f.host.dataset.cooktopBurnerCount, '6');
  const camera = f.renders.at(-1).camera, position = camera.position.clone();
  f.controller.update(config, selected([{ moduleId: 'plate', anchor: 0 }, { moduleId: 'wok', anchor: 2 }])); f.draw();
  assert.equal(f.frames.size, 0); assert.ok(camera.position.equals(position));
  const parts = f.asset.scene.getObjectByName('CooktopSelectedModules');
  assert.equal(parts.children.length, 5); assert.equal(f.host.dataset.cooktopBurnerCount, '3');
  assert.equal(parts.children.filter(object => object.name === 'BurnerGas').length, 3);
  assert.equal(f.asset.scene.getObjectByName('CooktopTemplates').visible, false);
  const other = structuredClone(config); other.modules[1].kind = 'other';
  f.controller.update(other, selected([{ moduleId: 'wok', anchor: 1 }]));
  assert.equal(parts.children.length, 0); assert.equal(f.renderer.domElement.style.display, 'none'); assert.equal(f.errors.length, 1);
  f.controller.update(config, selected()); f.draw(); assert.equal(f.renderer.domElement.hidden, false);
  f.controller.focus(); assert.equal(f.document.activeElement, f.renderer.domElement);
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.frames.size, 0); assert.equal(f.renderer.disposed, 1); assert.equal(f.renderer.lost, 1);
  assert.equal(f.observer.disconnected, true); assert.equal(f.host.children.length, 0);
  assert.equal([...f.renderer.domElement.events.values()].every(listeners => listeners.size === 0), true);
});

test('door opening and closing animate original pivots without a permanent render loop', async () => {
  const f = await fixture(); f.controller.update(config, selected()); f.draw();
  assert.equal(f.controller.hasDoors, true);
  const pivot = f.asset.scene.getObjectByName('Puerta_horno_P04'); assert.ok(pivot);
  const closed = pivot.quaternion.clone();
  f.controller.setDoors(true); f.draw(210); assert.equal(f.frames.size, 1); f.draw(430);
  assert.equal(f.frames.size, 0); assert.equal(pivot.quaternion.equals(closed), false);
  f.controller.update(config, selected([{ moduleId: 'plate', anchor: 0 }])); f.draw(450);
  assert.equal(pivot.quaternion.equals(closed), false);
  f.controller.setDoors(false); f.draw(900);
  assert.ok(pivot.quaternion.angleTo(closed) < 0.00001); assert.equal(f.frames.size, 0);
  f.controller.dispose();
  const withoutDoors = await fixture('p02'); assert.equal(withoutDoors.controller.hasDoors, false); withoutDoors.controller.dispose();
});

test('parametric oven, cabinet and wheels genuinely replace geometry while module edits keep the camera', async () => {
  const f = await fixture(), cfg = kitchenConfig(), state = rules.initialCooktopSelection(cfg);
  f.controller.update(cfg, state); f.draw();
  assert.equal(f.asset.scene.getObjectByName('CooktopChassis').visible, false); assert.equal(f.controller.hasDoors, false);
  assert.equal(f.asset.scene.getObjectByName('Puerta_horno_configurable'), undefined);
  state.kitchen.oven = 'electric'; f.controller.update(cfg, state); f.draw();
  assert.equal(f.controller.hasDoors, true); assert.ok(f.asset.scene.getObjectByName('Horno_electrico'));
  let door = f.asset.scene.getObjectByName('Puerta_horno_configurable'); assert.ok(door);
  const camera = f.renders.at(-1).camera, position = camera.position.clone();
  f.controller.setDoors(true); f.draw(430); assert.ok(door.rotation.x > 1);
  state.placements = [{ moduleId: 'fryer', anchor: 0 }]; f.controller.update(cfg, state); f.draw();
  assert.equal(f.asset.scene.getObjectByName('Puerta_horno_configurable'), door);
  assert.ok(camera.position.equals(position)); assert.equal(f.frames.size, 0);
  const released = []; f.asset.scene.getObjectByName('CooktopParametricChassis').traverse(mesh => { if (mesh.isMesh) mesh.geometry.addEventListener('dispose', () => released.push(mesh.geometry)); });
  state.kitchen.oven = 'none'; state.kitchen.structure = 'cabinet'; state.kitchen.support = 'wheels';
  f.controller.update(cfg, state); f.draw(); assert.ok(released.length > 0);
  assert.equal(f.asset.scene.getObjectByName('Puerta_horno_configurable'), undefined);
  assert.ok(f.asset.scene.getObjectByName('Rueda')); assert.ok(f.controller.hasDoors);
  state.kitchen.structure = 'open'; f.controller.update(cfg, state); f.draw(); assert.equal(f.controller.hasDoors, false);
  f.controller.update(config, selected()); f.draw(); assert.equal(f.asset.scene.getObjectByName('CooktopChassis').visible, true);
  assert.equal(f.asset.scene.getObjectByName('CooktopParametricChassis'), undefined); f.controller.dispose();
});

test('placement previews only color reusable overlays and explicit camera views retain external focus', async () => {
  const f = await fixture(); f.controller.update(config, selected()); f.draw();
  const parts = f.asset.scene.getObjectByName('CooktopSelectedModules'), originals = [...parts.children];
  const camera = f.renders.at(-1).camera, originalPosition = camera.position.clone();
  const interaction = { anchor: 0, moduleId: 'plate', validCells: [0, 1, 2], previewCells: [0, 3] };
  f.controller.setInteraction(interaction); interaction.previewCells.push(5); f.draw();
  assert.deepEqual(parts.children, originals); assert.ok(camera.position.equals(originalPosition));
  const hints = f.asset.scene.getObjectByName('CooktopPlacementHints');
  assert.equal(hints.children[0].userData.hintState, 'preview'); assert.equal(hints.children[3].userData.hintState, 'preview');
  assert.equal(hints.children[2].userData.hintState, 'valid'); assert.equal(hints.children[5].visible, false);
  f.controller.setView('top'); f.draw(); assert.equal(f.host.dataset.cooktopView, 'top');
  assert.ok(camera.position.y > camera.position.z); assert.equal(f.document.activeElement, null);
  const point = new THREE.Vector3(-.4766667, surface.y + .006, .195).project(camera);
  const pointer = { pointerId: 1, button: 0, clientX: (point.x + 1) * 320, clientY: (1 - point.y) * 240 };
  f.renderer.domElement.emit('pointerdown', pointer); f.renderer.domElement.emit('pointerup', pointer);
  assert.deepEqual(f.picks, [], 'covered second row is not a valid anchor for an armed plate');
  f.controller.setInteraction(null); f.draw(); assert.equal(hints.visible, false);
  const resources = new Set(); hints.traverse(mesh => { if (mesh.isMesh) { resources.add(mesh.geometry); resources.add(mesh.material); } });
  const disposed = new Map(); resources.forEach(resource => resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) || 0) + 1)));
  f.controller.dispose(); assert.equal(disposed.size, resources.size); assert.ok([...disposed.values()].every(value => value === 1));
});

test('new layout and confirmed dimensions refit the chassis without resetting the orbit angle', async () => {
  const f = await fixture(), cfg = kitchenConfig(), state = rules.initialCooktopSelection(cfg);
  f.controller.update(cfg, state); f.controller.setView('front'); f.draw();
  const camera = f.renders.at(-1).camera;
  const direction = camera.position.clone().sub(f.orbit.target).normalize(), oldDistance = camera.position.distanceTo(f.orbit.target);
  const smaller = structuredClone(cfg);
  smaller.layouts[0].columns = 2;
  smaller.modules = smaller.modules.filter(module => module.kind === 'burner');
  smaller.modules[0].anchors.six = [0, 1, 2, 3];
  f.controller.update(smaller, rules.initialCooktopSelection(smaller)); f.draw();
  assert.ok(camera.position.distanceTo(f.orbit.target) < oldDistance);
  assert.ok(camera.position.clone().sub(f.orbit.target).normalize().distanceTo(direction) < 1e-8);
  cfg.kitchen.dimensions = { widthMm: { min: 1800, max: 2400, step: 100 }, depthMm: { min: 900, max: 1200, step: 100 }, heightMm: { min: 900, max: 1100, step: 100 } };
  const measured = rules.initialCooktopSelection(cfg); f.controller.update(cfg, measured); f.draw();
  const firstDistance = camera.position.distanceTo(f.orbit.target);
  measured.kitchen.widthMm = 2400; f.controller.update(cfg, measured); f.draw();
  assert.ok(camera.position.distanceTo(f.orbit.target) > firstDistance);
  assert.ok(camera.position.clone().sub(f.orbit.target).normalize().distanceTo(direction) < 1e-8);
  const fittedPosition = camera.position.clone(); measured.kitchen.oven = 'gas'; f.controller.update(cfg, measured); f.draw();
  assert.ok(camera.position.equals(fittedPosition)); f.controller.dispose();
});

test('ray picking selects a real module while drag and multi-touch gestures do not pick', async () => {
  const f = await fixture(); f.controller.update(config, selected()); f.draw();
  const camera = f.renders.at(-1).camera, point = new THREE.Vector3(-0.4766667, surface.y + 0.04, -0.195).project(camera);
  const x = (point.x + 1) * 320, y = (1 - point.y) * 240, canvas = f.renderer.domElement;
  const pointer = { pointerId: 1, button: 0, clientX: x, clientY: y };
  canvas.emit('pointerdown', pointer); canvas.emit('pointerup', pointer);
  assert.deepEqual(f.picks, [0]);
  canvas.emit('pointerdown', pointer); canvas.emit('pointermove', { ...pointer, clientX: x + 20 }); canvas.emit('pointerup', pointer);
  canvas.emit('pointerdown', pointer); canvas.emit('pointerdown', { ...pointer, pointerId: 2 }); canvas.emit('pointerup', { ...pointer, pointerId: 2 }); canvas.emit('pointerup', pointer);
  assert.deepEqual(f.picks, [0]); f.controller.dispose();
});

test('private drafts can render, but a lost WebGL context stays closed until the view is recreated', async () => {
  const f = await fixture(), draft = structuredClone(config); draft.enabled = false;
  f.controller.update(draft, selected()); f.draw(); assert.equal(f.host.dataset.cooktopBurnerCount, '6');
  f.controller.setDoors(true);
  f.renderer.domElement.emit('webglcontextlost');
  assert.equal(f.frames.size, 0); assert.equal(f.host.dataset.cooktopSceneState, 'error');
  f.controller.update(config, selected()); f.controller.setDoors(false);
  assert.equal(f.frames.size, 0); assert.equal(f.renderer.domElement.style.display, 'none');
  assert.equal(f.host.dataset.cooktopBurnerCount, '0'); f.controller.dispose();
});

test('focused canvas supports arrow orbit and bounded plus/minus zoom without intercepting browser shortcuts', async () => {
  const f = await fixture('p04', true); f.controller.update(config, selected()); f.draw();
  const camera = f.renders.at(-1).camera, canvas = f.renderer.domElement;
  const spherical = () => new THREE.Spherical().setFromVector3(camera.position.clone().sub(f.orbit.target));
  const key = (value, modifiers = {}) => {
    let prevented = false;
    canvas.emit('keydown', { key: value, ...modifiers, preventDefault() { prevented = true; } });
    return prevented;
  };
  const original = camera.position.clone();
  assert.equal(key('ArrowLeft'), false); assert.ok(camera.position.equals(original));
  f.controller.focus();
  for (const [name, axis, direction] of [['ArrowLeft', 'theta', -1], ['ArrowRight', 'theta', 1], ['ArrowUp', 'phi', -1], ['ArrowDown', 'phi', 1]]) {
    const before = spherical(); assert.equal(key(name), true);
    const after = spherical(); assert.ok((after[axis] - before[axis]) * direction > 0);
    assert.ok(Math.abs(before.radius - after.radius) < 0.000001);
  }
  let distance = spherical().radius;
  assert.equal(key('+'), true); assert.ok(spherical().radius < distance);
  distance = spherical().radius;
  assert.equal(key('-'), true); assert.ok(spherical().radius > distance);
  for (let i = 0; i < 150; i++) key('=');
  assert.ok(Math.abs(spherical().radius - f.orbit.minDistance) < 0.000001);
  for (let i = 0; i < 150; i++) key('_');
  assert.ok(Math.abs(spherical().radius - f.orbit.maxDistance) < 0.000001);
  for (let i = 0; i < 150; i++) key('ArrowUp');
  assert.ok(Math.abs(spherical().phi - f.orbit.minPolarAngle) < 0.000001);
  for (let i = 0; i < 150; i++) key('ArrowDown');
  assert.ok(Math.abs(spherical().phi - f.orbit.maxPolarAngle) < 0.000001);
  const beforeShortcut = camera.position.clone();
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(key('+', modifiers), false);
  assert.equal(key('Tab'), false); assert.equal(key('Escape'), false); assert.ok(camera.position.equals(beforeShortcut));
  assert.equal(f.frames.size, 1); f.draw(); assert.equal(f.frames.size, 0);
  f.controller.dispose();
  assert.equal(canvas.events.get('keydown').size, 0); assert.equal(f.orbit._listeners.change.length, 0);
  assert.equal([...f.document.events.values()].every(listeners => listeners.size === 0), true);
  assert.equal(key('ArrowLeft'), false); assert.ok(camera.position.equals(beforeShortcut)); assert.equal(f.frames.size, 0);
});
