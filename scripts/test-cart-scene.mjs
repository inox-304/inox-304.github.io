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
async function model(version = 1) {
  const bytes = readFileSync(new URL(`../public/models/inox/modulo-de-comida-4-en-1-configurable-v${version}.glb`, import.meta.url));
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

const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(tail => [value, ...tail])) : [[]];
const near = (a, b, label = '') => assert.ok(Math.abs(a - b) < 0.000001, `${label}: ${a} != ${b}`);

test('all 384 movable layouts preserve equipment size and align independent decks without overlaps or drift', async () => {
  const { scene } = await model(2), graph = createCartSceneGraph(scene), metadata = scene.userData.cart;
  assert.equal(graph.canReorder, true);
  const chassis = scene.getObjectByName('CartChassis');
  const snapshot = node => { const list = []; node.traverse(part => list.push([part.uuid, part.position.toArray(), part.scale.toArray(), part.visible, part.geometry?.uuid])); return list; };
  const chassisBefore = snapshot(chassis), resources = [];
  scene.traverse(node => { if (node.isMesh) resources.push([node, node.geometry, node.material, node.scale.toArray()]); });
  const dimensions = Object.fromEntries(metadata.modules.map(entry => [entry.id, new THREE.Box3().setFromObject(scene.getObjectByName(entry.node)).getSize(new THREE.Vector3())]));
  for (const order of permutations(ids)) for (let mask = 0; mask < 16; mask++) {
    const included = ids.filter((_, index) => mask & (1 << index));
    graph.update(included, order); assert.deepEqual(graph.order, order);
    let right = metadata.layout.minX;
    for (const station of graph.stations) {
      const entry = metadata.modules.find(item => item.id === station.id);
      const deck = new THREE.Box3().setFromObject(scene.getObjectByName(entry.deckNode));
      near(deck.min.x, right, 'adjacent deck edge'); right = deck.max.x;
      near(deck.max.x - deck.min.x, station.width, 'deck width');
      for (const key of ['node', 'coverNode']) {
        const node = scene.getObjectByName(entry[key]), bounds = new THREE.Box3().setFromObject(node);
        assert.ok(bounds.min.x >= deck.min.x - 0.000001 && bounds.max.x <= deck.max.x + 0.000001, `${entry.id} ${key} must stay inside its station`);
        assert.equal(graph.positionForObject(node.children[0]), station.index);
        if (key === 'node') {
          const size = bounds.getSize(new THREE.Vector3()); near(size.x, dimensions[entry.id].x); near(size.y, dimensions[entry.id].y); near(size.z, dimensions[entry.id].z);
          assert.equal(node.visible, included.includes(entry.id));
        } else assert.equal(node.visible, !included.includes(entry.id));
      }
    }
    near(right, metadata.layout.maxX, 'countertop right edge');
    assert.deepEqual(snapshot(chassis), chassisBefore);
  }
  for (const [mesh, geometry, material, scale] of resources) { assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.deepEqual(mesh.scale.toArray(), scale); }
  graph.update(ids, ids); metadata.modules.forEach(entry => near(scene.getObjectByName(entry.node).position.x, 0, 'return to authored position'));
  assert.equal(graph.positionForObject(chassis.children[0]), null);
  const copy = graph.stations; copy[0].centerX = 999; assert.notEqual(graph.stations[0].centerX, 999);
  disposeCartResources(scene);
});

test('the real fryer opening moves with the fryer and leaves steel at the previous position', async () => {
  const { scene } = await model(2), graph = createCartSceneGraph(scene), decks = scene.getObjectByName('CartDecks');
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const deckHit = x => { scene.updateMatrixWorld(true); ray.set(new THREE.Vector3(x, 2, .02), down); return ray.intersectObject(decks, true); };
  const authoredFryerCenter = -.138;
  for (const order of permutations(ids)) {
    graph.update(ids, order);
    const fryer = scene.getObjectByName('Fryer'), cutout = scene.getObjectByName('FryerDeck');
    near(fryer.position.x, cutout.position.x, 'cutout and equipment travel together');
    assert.equal(deckHit(authoredFryerCenter + fryer.position.x).length, 0, 'no solid deck may cover the well');
  }
  graph.update(ids, [...ids].reverse());
  assert.ok(deckHit(authoredFryerCenter).length > 0, 'previous fryer position becomes an intact other station');
  graph.update([], [...ids].reverse());
  ray.set(new THREE.Vector3(authoredFryerCenter + scene.getObjectByName('Fryer').position.x, 2, .02), down);
  assert.ok(ray.intersectObject(scene.getObjectByName('FryerCover'), true).length > 0, 'omitting the fryer closes its relocated well');
  disposeCartResources(scene);
});

test('invalid orders are atomic and only the versioned segmented deck contract can move stations', async () => {
  const { scene } = await model(2), graph = createCartSceneGraph(scene), order = [...ids].reverse(); graph.update(['freidora'], order);
  const positions = scene.userData.cart.modules.map(entry => scene.getObjectByName(entry.node).position.toArray());
  for (const invalid of [null, {}, [], ids.slice(1), [...ids, 'wok'], ['plancha', 'plancha', 'freidora', 'broastera'], ['__proto__', ...ids.slice(1)]]) {
    assert.throws(() => graph.update([], invalid)); assert.deepEqual(graph.order, order); assert.deepEqual(graph.included, ['freidora']);
    assert.deepEqual(scene.userData.cart.modules.map(entry => scene.getObjectByName(entry.node).position.toArray()), positions);
  }
  const legacy = await model(); const legacyGraph = createCartSceneGraph(legacy.scene);
  assert.equal(legacyGraph.canReorder, false); assert.throws(() => legacyGraph.update(ids, order));
  disposeCartResources(scene); disposeCartResources(legacy.scene);
  for (const mutate of [
    root => { root.userData.cart.layout.minX = -100; },
    root => { root.userData.cart.modules[0].width = .99; },
    root => { root.userData.cart.modules[1].deckNode = 'BroasterDeck'; },
    root => { root.getObjectByName('FryerDeck').clear(); },
    root => { root.getObjectByName('CartChassis').add(root.getObjectByName('FryerDeck')); },
  ]) { const { scene } = await model(2); mutate(scene); assert.throws(() => createCartSceneGraph(scene)); disposeCartResources(scene); }
});

const source = ts.transpileModule(readFileSync(new URL('../src/scripts/cart-scene.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.subject = { createCartScene };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function fixture(version = 1) {
  const asset = await model(version), frames = new Map(), renders = [], errors = [], picks = [], moves = [], renderers = [], queuedLoads = [];
  let serial = 0, renderer, observer, orbit;
  class Element {
    constructor(tag) { this.tagName = tag; this.dataset = {}; this.style = {}; this.children = []; this.events = new Map(); this.capture = new Map(); this.pointerCaptures = new Set(); this.clientWidth = 640; this.clientHeight = 480; this.hidden = false; this.ownerDocument = document; }
    append(child) { this.children.push(child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute() {}
    addEventListener(type, fn, options) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); this.capture.set(fn, options === true || options?.capture === true); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); this.capture.delete(fn); }
    emit(type, data = {}) { let stopped = false, bubble = true; const event = { type, preventDefault() {}, stopPropagation() { bubble = false; }, stopImmediatePropagation() { stopped = true; bubble = false; }, ...data }; for (const fn of [...this.events.get(type) || []].sort((a, b) => Number(this.capture.get(b)) - Number(this.capture.get(a)))) { fn(event); if (stopped) break; } if (bubble) document.events.get(type)?.forEach(fn => fn(event)); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
    getRootNode() { return document; }
    setPointerCapture(id) { this.pointerCaptures.add(id); } releasePointerCapture(id) { this.pointerCaptures.delete(id); }
    focus() { document.activeElement = this; }
  }
  const document = { baseURI: 'https://inox.example/', createElement: tag => new Element(tag), activeElement: null, events: new Map(),
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); },
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); } };
  const host = new Element('div');
  class Renderer {
    constructor() { renderer = this; renderers.push(this); this.domElement = new Element('canvas'); this.shadowMap = {}; this.disposed = 0; this.lost = 0; }
    setPixelRatio() {} setSize() {}
    render(scene, camera) { camera.updateMatrixWorld(); renders.push({ scene, camera, position: camera.position.clone() }); }
    dispose() { this.disposed++; } forceContextLoss() { this.lost++; }
  }
  class Controls extends ActualOrbitControls { constructor(camera, canvas) { super(camera, canvas); orbit = this; } }
  class Environment extends THREE.Scene { dispose() {} }
  class PMREM { fromScene() { return { texture: new THREE.Texture(), dispose() {} }; } dispose() {} }
  class Observer { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } }
  const context = {
    THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM }, GLTFLoader: class { async loadAsync() { const load = queuedLoads.shift(); return load ? load() : asset; } },
    OrbitControls: Controls, RoomEnvironment: Environment, ResizeObserver: Observer, URL, Map, Set,
    window: { devicePixelRatio: 1 }, CART_MODULE_NODES, createCartSceneGraph, disposeCartResources,
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
  };
  runInNewContext(source, context);
  const callbacks = { onError: error => errors.push(error), onPickPosition: position => picks.push(position), onMoveModule: (id, position) => moves.push({ id, position }) };
  const controller = await context.subject.createCartScene(host, '/models/cart.glb', callbacks);
  function draw() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); }
  function createScene(load) { queuedLoads.push(load); return context.subject.createCartScene(host, '/models/cart.glb', callbacks); }
  return { controller, host, asset, frames, renders, errors, picks, moves, draw, renderer, renderers, observer, orbit, document, createScene };
}

function pointPointer(f, x, z = .02, pointerType = 'mouse', y = .84) {
  const camera = f.renders.at(-1).camera, point = new THREE.Vector3(x, y, z).project(camera);
  const clientX = (point.x + 1) * 320, clientY = (1 - point.y) * 240;
  return { button: 0, buttons: 1, pointerId: 1, pointerType, isPrimary: true, clientX, clientY, pageX: clientX, pageY: clientY };
}
function modulePointer(f, id, pointerType = 'mouse') {
  const module = f.asset.scene.userData.cart.modules.find(item => item.id === id), node = f.asset.scene.getObjectByName(module.node);
  return pointPointer(f, module.centerX + node.position.x, .02, pointerType);
}
async function dragFixture() {
  const f = await fixture(2); f.controller.setCanopyVisible(false); f.controller.setView('top'); f.draw(); return f;
}

test('mouse and touch drags lift each included module without changing selection, then emit one atomic swap', async () => {
  for (const [index, id] of ids.entries()) {
    const f = await dragFixture(), canvas = f.renderer.domElement, camera = f.renders.at(-1).camera;
    const cameraBefore = camera.position.clone(), orderBefore = f.host.dataset.cartOrder;
    const pointerType = index % 2 ? 'touch' : 'mouse', start = modulePointer(f, id, pointerType), destination = modulePointer(f, ids[(index + 1) % 4], pointerType);
    canvas.emit('pointermove', start); assert.equal(canvas.style.cursor, 'grab', `${id} must indicate dragging`);
    canvas.emit('pointerdown', start); assert.equal(f.orbit.enabled, false); assert.equal(canvas.pointerCaptures.has(1), true);
    canvas.emit('pointermove', destination); f.draw();
    const ghost = f.renders.at(-1).scene.getObjectByName('CartDragPreview'), source = f.asset.scene.getObjectByName(CART_MODULE_NODES[id][0]);
    assert.ok(ghost, `${id} must move visibly under the pointer`); assert.equal(source.visible, false);
    assert.notEqual(ghost.position.x, source.position.x); assert.equal(f.host.dataset.cartDragModule, id);
    assert.equal(f.host.dataset.cartDropPosition, String((index + 1) % 4)); assert.equal(f.host.dataset.cartOrder, orderBefore); assert.deepEqual(f.moves, []);
    assert.ok(camera.position.equals(cameraBefore), 'equipment dragging must never orbit the camera');
    const materialDisposals = []; ghost.traverse(object => { if (object instanceof THREE.Mesh) { const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => { const count = { value: 0 }; material.addEventListener('dispose', () => count.value++); materialDisposals.push(count); }); } });
    canvas.emit('pointerup', { ...destination, buttons: 0 }); f.draw();
    assert.deepEqual(f.moves, [{ id, position: (index + 1) % 4 }]); assert.deepEqual(f.picks, []); assert.equal(source.visible, true);
    assert.equal(f.renders.at(-1).scene.getObjectByName('CartDragPreview'), undefined); assert.equal(f.orbit.enabled, true); assert.equal(canvas.pointerCaptures.size, 0);
    assert.equal(f.host.dataset.cartDragModule, undefined); assert.equal(f.host.dataset.cartDropPosition, undefined);
    assert.ok(materialDisposals.length > 0 && materialDisposals.every(count => count.value === 1));
    assert.equal(f.host.dataset.cartOrder, orderBefore, 'the UI, not the preview, owns the committed selection');
    const next = [...ids]; [next[index], next[(index + 1) % 4]] = [next[(index + 1) % 4], next[index]];
    f.controller.update(ids, next); f.draw(); assert.equal(f.host.dataset.cartOrder, next.join(',')); assert.ok(camera.position.equals(cameraBefore));
    f.controller.dispose();
  }
});

test('dropping a module into an omitted station uses its current reordered position', async () => {
  const f = await dragFixture(), order = ['plancha', 'broastera', 'freidora', 'conservadora'];
  f.controller.update(['freidora', 'plancha'], order); f.draw();
  const canvas = f.renderer.domElement, start = modulePointer(f, 'freidora'), destination = modulePointer(f, 'broastera');
  canvas.emit('pointerdown', start); canvas.emit('pointermove', destination); canvas.emit('pointerup', { ...destination, buttons: 0 });
  assert.deepEqual(f.moves, [{ id: 'freidora', position: 1 }]); assert.equal(f.host.dataset.cartOrder, order.join(','));
  assert.equal(f.host.dataset.cartIncluded, 'freidora,plancha'); f.controller.dispose();
});

test('Escape, cancel, lost capture, blur, second finger and dropping outside cancel previews without a swap', async () => {
  const cases = ['escape', 'cancel', 'lostcapture', 'blur', 'secondfinger', 'outside', 'outsideworktop', 'sameposition', 'releasedmouse'];
  for (const reason of cases) {
    const f = await dragFixture(), canvas = f.renderer.domElement, start = modulePointer(f, 'plancha'), destination = modulePointer(f, 'broastera');
    canvas.emit('pointerdown', start); canvas.emit('pointermove', destination);
    assert.equal(f.asset.scene.getObjectByName('Griddle').visible, false);
    if (reason === 'escape') {
      let prevented = false, stopped = false;
      canvas.emit('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
      assert.equal(prevented, true); assert.equal(stopped, true, 'Escape must not close the parent gallery while cancelling a drag');
    } else if (reason === 'cancel') canvas.emit('pointercancel', start);
    else if (reason === 'lostcapture') canvas.emit('lostpointercapture', start);
    else if (reason === 'blur') canvas.emit('blur');
    else if (reason === 'secondfinger') canvas.emit('pointerdown', { ...destination, pointerId: 2, pointerType: 'touch', isPrimary: false });
    else if (reason === 'outside') canvas.emit('pointerup', { ...destination, buttons: 0, clientX: -50 });
    else if (reason === 'outsideworktop') canvas.emit('pointerup', { ...pointPointer(f, 0, .45), buttons: 0 });
    else if (reason === 'sameposition') canvas.emit('pointerup', { ...start, buttons: 0 });
    else canvas.emit('pointermove', { ...destination, buttons: 0 });
    canvas.emit('pointerup', { ...destination, buttons: 0 }); f.draw();
    assert.deepEqual(f.moves, [], reason); assert.deepEqual(f.picks, [], reason); assert.equal(f.host.dataset.cartOrder, ids.join(','));
    assert.equal(f.asset.scene.getObjectByName('Griddle').visible, true); assert.equal(f.renders.at(-1).scene.getObjectByName('CartDragPreview'), undefined);
    assert.equal(f.orbit.enabled, true); assert.equal(canvas.pointerCaptures.size, 0); assert.equal(f.host.dataset.cartDragModule, undefined);
    f.controller.dispose();
  }
});

test('background and omitted worktops orbit normally; taps still select and the roof blocks grabbing', async () => {
  const f = await dragFixture(), canvas = f.renderer.domElement, camera = f.renders.at(-1).camera;
  const start = modulePointer(f, 'plancha'); canvas.emit('pointerdown', start); canvas.emit('pointerup', { ...start, buttons: 0 });
  assert.deepEqual(f.picks, [3]); assert.deepEqual(f.moves, []); assert.equal(f.orbit.enabled, true);
  f.controller.update([]); f.draw(); const before = camera.position.clone(), cover = modulePointer(f, 'freidora');
  canvas.emit('pointerdown', cover); assert.equal(f.orbit.enabled, true);
  canvas.emit('pointermove', { ...cover, clientX: cover.clientX + 50, pageX: cover.pageX + 50 }); canvas.emit('pointerup', { ...cover, buttons: 0, clientX: cover.clientX + 50 }); f.draw();
  assert.equal(camera.position.equals(before), false, 'a worktop drag must retain the camera orbit gesture');
  assert.deepEqual(f.moves, []); assert.equal(f.host.dataset.cartDragModule, undefined);
  f.controller.update(ids); f.controller.setCanopyVisible(true); f.controller.setView('top'); f.draw();
  const underRoof = modulePointer(f, 'plancha'); canvas.emit('pointerdown', underRoof); assert.equal(f.orbit.enabled, true);
  canvas.emit('pointerup', { ...underRoof, buttons: 0 }); assert.deepEqual(f.moves, []); assert.deepEqual(f.picks, [3]); f.controller.dispose();
});

test('external changes, context loss and disposal cancel active drag resources without committing', async () => {
  for (const change of ['update', 'view', 'roof', 'context', 'dispose']) {
    const f = await dragFixture(), canvas = f.renderer.domElement;
    canvas.emit('pointerdown', modulePointer(f, 'plancha')); canvas.emit('pointermove', modulePointer(f, 'broastera'));
    let sourceDisposed = 0; f.asset.scene.getObjectByName('Griddle').children[0].geometry.addEventListener('dispose', () => sourceDisposed++);
    if (change === 'update') f.controller.update(['freidora']);
    else if (change === 'view') f.controller.setView('front');
    else if (change === 'roof') f.controller.setCanopyVisible(true);
    else if (change === 'context') canvas.emit('webglcontextlost');
    else f.controller.dispose();
    assert.deepEqual(f.moves, []); assert.equal(canvas.pointerCaptures.size, 0); assert.equal(f.orbit.enabled, true);
    assert.equal(f.host.dataset.cartDragModule, undefined); assert.equal(sourceDisposed, change === 'dispose' ? 1 : 0, 'ghost cleanup must not dispose shared GLTF geometry');
    if (change === 'update') assert.equal(f.asset.scene.getObjectByName('Griddle').visible, false);
    else assert.equal(f.asset.scene.getObjectByName('Griddle').visible, true);
    f.controller.dispose();
  }
});

test('replaced scene callbacks and disposal cannot alter the state or renderer of its replacement', async () => {
  const f = await fixture(2), replacement = await model(2), newer = await f.createScene(async () => replacement);
  const order = ['plancha', 'freidora', 'conservadora', 'broastera'];
  newer.update(['plancha'], order); newer.setActivePosition(0); f.draw();
  const state = { ...f.host.dataset }, currentCanvas = f.renderers.at(-1).domElement, renders = f.renders.length;
  f.controller.update(['wok']); f.controller.setView('front'); f.controller.setActivePosition(3); f.controller.setCanopyVisible(false); f.controller.focus();
  f.renderer.domElement.emit('webglcontextlost'); f.observer.callback(); f.draw();
  assert.deepEqual(f.host.dataset, state); assert.equal(f.errors.length, 0); assert.equal(f.document.activeElement, null); assert.equal(f.renders.length, renders);
  f.controller.dispose();
  assert.deepEqual(f.host.dataset, state); assert.deepEqual(f.host.children.filter(child => child.tagName === 'canvas'), [currentCanvas]);
  assert.equal(f.renderers.at(-1).disposed, 0); newer.update(ids, order); f.draw(); assert.equal(f.host.dataset.cartSceneState, 'ready');
  newer.dispose(); assert.deepEqual(f.host.dataset, {});
});

test('disposing an old active drag never removes the replacement scene state or resources', async () => {
  const f = await dragFixture(), canvas = f.renderer.domElement;
  canvas.emit('pointerdown', modulePointer(f, 'plancha')); canvas.emit('pointermove', modulePointer(f, 'broastera'));
  const replacement = await model(2), newer = await f.createScene(async () => replacement), order = [...ids].reverse();
  newer.update(['freidora'], order); newer.setActivePosition(2); f.draw();
  const state = { ...f.host.dataset }, newCanvas = f.renderers.at(-1).domElement, newRenderer = f.renderers.at(-1);
  canvas.emit('pointerup', { ...modulePointer(f, 'broastera'), buttons: 0 });
  assert.deepEqual(f.moves, []); assert.deepEqual(f.host.dataset, state);
  f.controller.dispose();
  assert.deepEqual(f.host.dataset, state); assert.equal(newRenderer.disposed, 0);
  assert.deepEqual(f.host.children.filter(child => child.tagName === 'canvas'), [newCanvas]);
  newer.dispose(); assert.deepEqual(f.host.dataset, {});
});

test('a GLTF request finishing after a newer scene is ready is discarded before creating a renderer or publishing state', async () => {
  const f = await fixture(2); f.controller.dispose();
  const olderAsset = await model(2), newerAsset = await model(2);
  let release; const delayed = new Promise(resolve => { release = resolve; });
  const older = f.createScene(() => delayed), rejection = assert.rejects(older, error => error.name === 'AbortError');
  const newer = await f.createScene(async () => newerAsset), order = [...ids].reverse();
  newer.update(['freidora'], order); newer.setActivePosition(2); f.draw();
  const state = { ...f.host.dataset }, rendererCount = f.renderers.length, currentCanvas = f.renderers.at(-1).domElement;
  let disposedGeometry = 0; olderAsset.scene.getObjectByName('Fryer').children[0].geometry.addEventListener('dispose', () => disposedGeometry++);
  release(olderAsset); await rejection; f.draw();
  assert.equal(f.renderers.length, rendererCount, 'late load must not create a WebGL renderer'); assert.equal(disposedGeometry, 1, 'late GLTF resources must be released');
  assert.deepEqual(f.host.dataset, state); assert.equal(f.errors.length, 0);
  assert.deepEqual(f.host.children.filter(child => child.tagName === 'canvas'), [currentCanvas]);
  assert.equal(f.host.children.length, 3, 'only the current canvas, message and drag hint remain');
  newer.update(ids, order); f.draw(); assert.equal(f.host.dataset.cartSceneState, 'ready'); newer.dispose();
});

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

test('reordering keeps the camera and inspection state while showing temporary, correctly sized station guides', async () => {
  const f = await fixture(2); f.controller.setCanopyVisible(false); f.controller.setView('top'); f.draw();
  const { camera, scene } = f.renders.at(-1), position = camera.position.clone(), target = f.orbit.target.clone();
  const guides = scene.getObjectByName('CartPositionGuides'); assert.equal(guides.visible, false);
  f.controller.setActivePosition(0); f.draw(); assert.equal(guides.visible, true);
  const geometryDisposals = Array(4).fill(0), materialDisposals = Array(4).fill(0);
  guides.children.forEach((line, i) => { line.geometry.addEventListener('dispose', () => geometryDisposals[i]++); line.material.addEventListener('dispose', () => materialDisposals[i]++); });
  const order = ['plancha', 'conservadora', 'broastera', 'freidora'];
  f.controller.update(ids, order); f.controller.setActivePosition(2); f.controller.update(['plancha'], order);
  assert.equal(f.frames.size, 1); f.draw(); assert.equal(f.frames.size, 0);
  assert.ok(camera.position.equals(position)); assert.ok(f.orbit.target.equals(target));
  assert.equal(f.asset.scene.getObjectByName('CartCanopy').visible, false);
  assert.equal(f.host.dataset.cartOrder, order.join(',')); assert.equal(f.host.dataset.cartActivePosition, '2');
  let left = f.asset.scene.userData.cart.layout.minX;
  order.forEach((id, index) => {
    const module = f.asset.scene.userData.cart.modules.find(item => item.id === id), line = guides.children[index];
    near(line.position.x, left + module.width / 2); left += module.width;
    const size = new THREE.Box3().setFromObject(line).getSize(new THREE.Vector3()); near(size.x, module.width - .006);
    assert.equal(line.material.opacity, index === 2 ? 1 : .4);
  });
  f.controller.setActivePosition(4); assert.equal(f.host.dataset.cartActivePosition, '2');
  f.controller.setActivePosition(null); f.draw(); assert.equal(guides.visible, false);
  f.controller.dispose(); f.controller.dispose(); assert.deepEqual(geometryDisposals, [1, 1, 1, 1]); assert.deepEqual(materialDisposals, [1, 1, 1, 1]);
});

test('picking visible 3D stations follows their reordered positions and ignores orbit drags and roof occlusion', async () => {
  const f = await fixture(2); const order = ['plancha', 'broastera', 'conservadora', 'freidora'];
  f.controller.update([], order); f.controller.setCanopyVisible(false); f.controller.setView('top'); f.draw();
  const canvas = f.renderer.domElement, camera = f.renders.at(-1).camera;
  const clickStation = (id, drag = 0) => {
    const entry = f.asset.scene.userData.cart.modules.find(item => item.id === id), node = f.asset.scene.getObjectByName(entry.coverNode);
    const point = new THREE.Vector3(entry.centerX + node.position.x, .795, .005).project(camera);
    const pointer = { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: (point.x + 1) * 320, clientY: (1 - point.y) * 240 };
    canvas.emit('pointerdown', pointer); canvas.emit('pointerup', { ...pointer, buttons: 0, clientX: pointer.clientX + drag });
  };
  order.forEach(id => clickStation(id)); assert.deepEqual(f.picks, [0, 1, 2, 3]);
  clickStation('plancha', 12); assert.equal(f.picks.length, 4);
  f.controller.setCanopyVisible(true); f.draw(); clickStation('conservadora'); assert.equal(f.picks.length, 4, 'roof must occlude the workstation');
  f.controller.setCanopyVisible(false); f.draw(); clickStation('conservadora'); assert.equal(f.picks.at(-1), 2);
  f.controller.dispose(); assert.equal([...canvas.events.values()].every(listeners => listeners.size === 0), true);
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
