import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CART_MODULE_NODES, createCartSceneGraph, disposeCartResources, type CartModuleId } from '../lib/cart-scene-graph.ts';

export type CartView = 'top' | 'front' | 'perspective';
export type CartScene = { update(included: readonly string[], order?: readonly string[]): void; setActivePosition(position: number | null): void; setView(view: CartView): void; setCanopyVisible(visible: boolean): void; focus(): void; dispose(): void };
type CartSceneOptions = { onError?: (error: Error) => void; onPickPosition?: (position: number) => void; onMoveModule?: (moduleId: CartModuleId, position: number) => void };
// A retry may finish before an older GLTF request. Only the newest instance may
// render into this host, publish state, or remove its shared state on cleanup.
const hostOwners = new WeakMap<HTMLElement, object>();

/** One authored cart, one renderer: selecting equipment changes its actual meshes in place. */
export async function createCartScene(host: HTMLElement, assetUrl: string, options: CartSceneOptions = {}): Promise<CartScene> {
  const owner = {}; hostOwners.set(host, owner);
  const ownsHost = () => hostOwners.get(host) === owner;
  let root: THREE.Group | undefined, renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined, environment: THREE.WebGLRenderTarget | undefined, floor: THREE.Mesh | undefined;
  let shadow: THREE.DirectionalLightShadow | undefined;
  let guides: THREE.Group | undefined;
  let frame = 0, disposed = false, contextLost = false, renderCount = 0, failed = false;
  let detachControls = () => {};
  let cancelDrag = () => {};
  const listeners: [EventTarget, string, EventListener, boolean][] = [];
  const listen = (target: EventTarget, type: string, handler: EventListener, capture = false) => { target.addEventListener(type, handler, capture); listeners.push([target, type, handler, capture]); };
  const message = host.ownerDocument.createElement('p');
  message.className = 'cart-scene-message'; message.setAttribute('role', 'status'); message.hidden = true;
  message.style.cssText = 'color:#173753;padding:1rem;background:white;'; host.append(message);
  function report(error: unknown) {
    if (disposed || !ownsHost()) return;
    cancelDrag();
    const safe = error instanceof Error ? error : new Error('No se pudo representar la selección del carrito.');
    failed = true;
    if (renderer) { renderer.domElement.hidden = true; renderer.domElement.style.display = 'none'; }
    message.textContent = safe.message; message.hidden = false; host.dataset.cartSceneState = 'error';
    options.onError?.(safe);
  }
  function dispose() {
    if (disposed) return;
    cancelDrag();
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect(); detachControls(); controls?.dispose();
    listeners.forEach(([target, type, handler, capture]) => target.removeEventListener(type, handler, capture));
    if (root) disposeCartResources(root);
    if (floor) disposeCartResources(floor);
    if (guides) {
      guides.traverse(object => { if (object instanceof THREE.LineSegments) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
      guides.removeFromParent();
    }
    environment?.dispose(); shadow?.dispose();
    renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); message.remove();
    if (ownsHost()) {
      for (const key of ['cartSceneState', 'cartRenderCount', 'cartIncluded', 'cartOrder', 'cartView', 'cartCanopyVisible', 'cartActivePosition', 'cartDragModule', 'cartDropPosition']) delete host.dataset[key];
      hostOwners.delete(host);
    }
  }
  try {
    const url = new URL(assetUrl, host.ownerDocument.baseURI);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('La dirección del modelo 3D no es válida.');
    const gltf = await new GLTFLoader().loadAsync(url.href);
    root = gltf.scene;
    if (!ownsHost()) {
      const cancelled = new Error('Esta carga 3D fue reemplazada por una más reciente.'); cancelled.name = 'AbortError'; throw cancelled;
    }
    const graph = createCartSceneGraph(root);
    const canopy = root.getObjectByName('CartCanopy')!;
    root.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff); scene.add(root);
    const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3()), target = bounds.getCenter(new THREE.Vector3());
    // Inspect the authored work stations, not the much taller canopy and its posts.
    // Cache all four stations so selecting equipment never reframes the camera.
    const worktopBounds = new THREE.Box3().setFromObject(root.getObjectByName('CartModules')!);
    worktopBounds.union(new THREE.Box3().setFromObject(root.getObjectByName('CartCovers')!));
    const worktopSize = worktopBounds.getSize(new THREE.Vector3()), worktopTarget = worktopBounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 100 || !target.toArray().every(Number.isFinite)) throw new Error('El modelo del carrito tiene medidas incompatibles.');
    const camera = new THREE.PerspectiveCamera(35, 1, Math.max(0.001, radius / 100), radius * 50);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.78;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Carrito salchipapero 3D. Arrastra un equipo hasta otra posición para intercambiarlos. Arrastra el fondo o usa las flechas para girar; rueda o + y − para acercar. Escape cancela el arrastre. También puedes usar los controles de posiciones.');
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;'; host.append(canvas);
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    try { environment = pmrem.fromScene(room, 0.04); scene.environment = environment.texture; scene.environmentIntensity = 0.62; }
    finally { room.dispose(); pmrem.dispose(); }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8795a1, 0.45));
    const key = new THREE.DirectionalLight(0xfff9ee, 1.8); shadow = key.shadow;
    key.position.copy(target).add(new THREE.Vector3(radius * 2, radius * 3, radius * 2)); key.target.position.copy(target);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0003;
    Object.assign(key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 10 });
    key.shadow.camera.updateProjectionMatrix(); scene.add(key, key.target);
    floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 12, radius * 12), new THREE.ShadowMaterial({ color: 0x546575, opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(target.x, bounds.min.y - radius * 0.003, target.z); floor.receiveShadow = true; scene.add(floor);
    controls = new OrbitControls(camera, canvas); controls.target.copy(target);
    controls.enableDamping = false; controls.enablePan = false; controls.minPolarAngle = 0.01; controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = radius * 0.6; controls.maxDistance = radius * 8;
    function invalidate() { if (!disposed && ownsHost() && !contextLost && !frame) frame = requestAnimationFrame(draw); }
    function draw() {
      frame = 0;
      if (!disposed && ownsHost() && !contextLost && !failed && host.clientWidth > 0 && host.clientHeight > 0) {
        renderer!.render(scene, camera); host.dataset.cartRenderCount = String(++renderCount);
      }
    }
    controls.addEventListener('change', invalidate); detachControls = () => controls?.removeEventListener('change', invalidate);
    guides = new THREE.Group(); guides.name = 'CartPositionGuides'; guides.visible = false; scene.add(guides);
    const outlines = graph.stations.map(station => {
      const box = new THREE.BoxGeometry(station.width - .006, .004, .560);
      const geometry = new THREE.EdgesGeometry(box); box.dispose();
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x23779b, transparent: true, opacity: .55, depthTest: false }));
      line.renderOrder = 10; guides!.add(line); return line;
    });
    type Drag = { id: number; moduleId: CartModuleId; module: THREE.Object3D; source: number; x: number; y: number; plane: THREE.Plane; anchor: THREE.Vector3; origin: THREE.Vector3; target: number | null; moved: boolean; orbitEnabled: boolean; ghost?: THREE.Object3D; materials: THREE.Material[] };
    let activePosition: number | null = null, drag: Drag | null = null;
    const dragHint = host.ownerDocument.createElement('p'); dragHint.className = 'cart-drag-status'; dragHint.hidden = true;
    dragHint.setAttribute('role', 'status'); dragHint.setAttribute('aria-live', 'polite');
    dragHint.style.cssText = 'position:absolute;z-index:2;bottom:12px;left:12px;right:12px;margin:0;padding:9px 12px;border:1px solid #bed6e3;border-radius:9px;background:#ffffffed;color:#123f56;font-size:12px;line-height:1.4;text-align:center;pointer-events:none;';
    host.append(dragHint);
    const updateGuides = () => {
      graph.stations.forEach((station, index) => {
        const line = outlines[index], width = station.width - .006;
        // Geometry retains its authored width; scale only the inspection outline.
        const originalWidth = (line.geometry.boundingBox || (line.geometry.computeBoundingBox(), line.geometry.boundingBox))!.getSize(new THREE.Vector3()).x;
        line.scale.x = width / originalWidth; line.position.set(station.centerX, .795, 0);
        const highlighted = drag?.moved ? index === drag.target : index === activePosition;
        line.material.color.set(highlighted ? (drag?.moved ? 0x147d5c : 0x006ba0) : 0x5d879e); line.material.opacity = highlighted ? 1 : .4;
      });
      guides!.visible = (activePosition !== null || !!drag?.moved) && graph.canReorder;
    };
    updateGuides();
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number; id: number } | null = null;
    const interactive = () => !disposed && ownsHost() && !failed && !contextLost && graph.canReorder;
    const rayAt = (pointer: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || pointer.clientX < rect.left || pointer.clientX > rect.left + rect.width || pointer.clientY < rect.top || pointer.clientY > rect.top + rect.height) return false;
      camera.updateMatrixWorld(); root!.updateMatrixWorld(true);
      raycaster.setFromCamera(new THREE.Vector2((pointer.clientX - rect.left) / rect.width * 2 - 1, -(pointer.clientY - rect.top) / rect.height * 2 + 1), camera);
      return true;
    };
    const visibleHit = () => raycaster.intersectObject(root!, true).find(hit => {
        let node: THREE.Object3D | null = hit.object;
        while (node) { if (!node.visible) return false; node = node.parent; }
        return true;
      });
    const movable = (hit?: THREE.Intersection) => {
      if (!hit || !options.onMoveModule) return null;
      const position = graph.positionForObject(hit.object); if (position === null) return null;
      const id = graph.order[position]; if (!graph.included.includes(id)) return null;
      const module = root!.getObjectByName(CART_MODULE_NODES[id][0])!;
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== module) node = node.parent;
      return node === module ? { id, module, position } : null;
    };
    const endDrag = () => {
      const previous = drag; drag = null; down = null;
      if (previous) {
        previous.module.visible = graph.included.includes(previous.moduleId);
        previous.ghost?.removeFromParent(); previous.materials.forEach(material => material.dispose());
        controls!.enabled = previous.orbitEnabled;
        try { canvas.releasePointerCapture(previous.id); } catch { /* Capture can already be lost. */ }
      }
      dragHint.hidden = true; canvas.style.cursor = '';
      if (ownsHost()) { delete host.dataset.cartDragModule; delete host.dataset.cartDropPosition; }
      updateGuides(); invalidate(); return previous;
    };
    cancelDrag = () => { endDrag(); };
    const previewDrag = (pointer: PointerEvent) => {
      if (!drag) return;
      const point = rayAt(pointer) ? raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3()) : null;
      drag.target = null;
      if (point) {
        // The equipment slides along the countertop; moving outside it is not a drop.
        if (point.x >= -.6075 && point.x <= .6075 && point.z >= -.3275 && point.z <= .3275) {
          drag.target = graph.stations.find(station => point.x >= station.centerX - station.width / 2 && point.x <= station.centerX + station.width / 2)?.index ?? null;
        }
        if (drag.ghost) { drag.ghost.position.copy(drag.origin); drag.ghost.position.x += point.x - drag.anchor.x; drag.ghost.position.y += .055; }
      }
      const nextHint = drag.target === null ? 'Fuera de la encimera · suelta para cancelar' : drag.target === drag.source ? 'Arrastra hacia otra posición · Esc para cancelar' : `Suelta en la posición ${drag.target + 1} para intercambiar · Esc para cancelar`;
      if (dragHint.textContent !== nextHint) dragHint.textContent = nextHint;
      dragHint.hidden = false; host.dataset.cartDropPosition = drag.target === null ? '' : String(drag.target);
      updateGuides(); invalidate();
    };
    // Capture runs before OrbitControls: equipment drags and camera orbits must not start together.
    listen(canvas, 'pointerdown', event => {
      const pointer = event as PointerEvent;
      if (!interactive()) return;
      if (drag) { cancelDrag(); event.preventDefault(); event.stopImmediatePropagation(); return; }
      down = pointer.button === 0 && pointer.isPrimary !== false ? { x: pointer.clientX, y: pointer.clientY, id: pointer.pointerId } : null;
      if (!down || !rayAt(pointer)) return;
      const hit = visibleHit(), item = movable(hit);
      // Roof, chassis and empty work surfaces remain ordinary orbit targets.
      if (!item || !hit) return;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
      const anchor = raycaster.ray.intersectPlane(plane, new THREE.Vector3()); if (!anchor) return;
      drag = { id: pointer.pointerId, moduleId: item.id, module: item.module, source: item.position, x: pointer.clientX, y: pointer.clientY, plane, anchor, origin: item.module.getWorldPosition(new THREE.Vector3()), target: item.position, moved: false, orbitEnabled: controls!.enabled, materials: [] };
      controls!.enabled = false; canvas.focus(); canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(pointer.pointerId); } catch { cancelDrag(); }
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    listen(canvas, 'pointermove', event => {
      const pointer = event as PointerEvent;
      if (!interactive()) return;
      if (!drag) { canvas.style.cursor = rayAt(pointer) && movable(visibleHit()) ? 'grab' : ''; return; }
      if (pointer.pointerId !== drag.id) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (pointer.pointerType === 'mouse' && pointer.buttons === 0) { cancelDrag(); return; }
      if (!drag.moved && Math.hypot(pointer.clientX - drag.x, pointer.clientY - drag.y) <= 6) return;
      if (!drag.moved) {
        drag.moved = true; drag.ghost = drag.module.clone(true); drag.ghost.name = 'CartDragPreview';
        drag.module.getWorldQuaternion(drag.ghost.quaternion); drag.module.getWorldScale(drag.ghost.scale);
        drag.ghost.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const clone = (material: THREE.Material) => { const copy = material.clone(); copy.transparent = true; copy.opacity = .72; copy.depthWrite = false; drag!.materials.push(copy); return copy; };
          object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
          object.castShadow = false; object.receiveShadow = false;
        });
        scene.add(drag.ghost); drag.module.visible = false; host.dataset.cartDragModule = drag.moduleId;
      }
      previewDrag(pointer);
    }, true);
    listen(canvas, 'pointerup', event => {
      const pointer = event as PointerEvent;
      if (drag && pointer.pointerId === drag.id) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!interactive()) { cancelDrag(); return; }
        if (drag.moved) previewDrag(pointer);
        const previous = endDrag();
        if (previous?.moved && previous.target !== null && previous.target !== previous.source) options.onMoveModule?.(previous.moduleId, previous.target);
        else if (previous && !previous.moved && Math.hypot(pointer.clientX - previous.x, pointer.clientY - previous.y) <= 6 && rayAt(pointer)) options.onPickPosition?.(previous.source);
        return;
      }
      const start = down; down = null;
      if (!start || pointer.pointerId !== start.id || Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) > 6 || !interactive() || !rayAt(pointer)) return;
      // The visible roof/chassis can occlude a station; never select through it.
      const hit = visibleHit(), position = hit ? graph.positionForObject(hit.object) : null;
      if (position !== null) options.onPickPosition?.(position);
    }, true);
    listen(canvas, 'pointercancel', () => cancelDrag(), true);
    listen(canvas, 'lostpointercapture', () => cancelDrag(), true);
    listen(canvas, 'blur', () => cancelDrag());
    // Disposal owns this hint; a stale instance may never remove a newer hint.
    const previousDetach = detachControls; detachControls = () => { previousDetach(); dragHint.remove(); };
    function frameModel(view: CartView) {
      const inspection = view === 'top';
      const lookAt = inspection ? worktopTarget : target;
      const distance = inspection
        ? Math.max(worktopSize.x / camera.aspect, worktopSize.z + worktopSize.y * 0.2) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.22
        : radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect) * 0.72;
      const direction = view === 'front' ? new THREE.Vector3(0, 0.25, 1) : inspection ? new THREE.Vector3(0, 1, 0.05) : new THREE.Vector3(1.15, 0.75, 1.65);
      camera.position.copy(lookAt).add(direction.normalize().multiplyScalar(distance)); controls!.target.copy(lookAt);
      controls!.minDistance = inspection ? Math.max(worktopSize.x, worktopSize.z) * 0.45 : radius * 0.6;
      // Floor shadows obscure the stations in plan view; retain them for the full cart views.
      floor!.visible = !inspection;
      controls!.maxDistance = Math.max(radius * 8, distance * 2); controls!.update(); host.dataset.cartView = view;
    }
    let framed = false;
    const resize = () => {
      if (disposed || !ownsHost() || contextLost) return;
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer!.setSize(width, height, false);
      if (!framed) { frameModel('perspective'); framed = true; }
      invalidate();
    };
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    listen(canvas, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (disposed || !ownsHost() || contextLost || failed || host.ownerDocument.activeElement !== canvas || key.altKey || key.ctrlKey || key.metaKey) return;
      if (drag) {
        if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); cancelDrag(); }
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key.key)) return;
      key.preventDefault();
      const orbit = controls!;
      const offset = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
      const turn = Math.PI / 24;
      if (key.key === 'ArrowLeft') offset.theta -= turn;
      else if (key.key === 'ArrowRight') offset.theta += turn;
      else if (key.key === 'ArrowUp') offset.phi -= turn;
      else if (key.key === 'ArrowDown') offset.phi += turn;
      else offset.radius *= key.key === '+' || key.key === '=' ? 1 / 1.12 : 1.12;
      offset.phi = THREE.MathUtils.clamp(offset.phi, orbit.minPolarAngle, orbit.maxPolarAngle);
      offset.radius = THREE.MathUtils.clamp(offset.radius, orbit.minDistance, orbit.maxDistance); offset.makeSafe();
      camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(offset)); orbit.update(); invalidate();
    });
    listen(canvas, 'webglcontextlost', event => {
      if (disposed || !ownsHost()) return;
      event.preventDefault(); contextLost = true;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      report(new Error('Se perdió la vista 3D. Vuelve a la foto y abre Ver 360° para recuperarla; tu selección se conserva.'));
    });
    host.dataset.cartSceneState = 'ready'; host.dataset.cartIncluded = graph.included.join(','); host.dataset.cartOrder = graph.order.join(','); host.dataset.cartCanopyVisible = 'true';
    delete host.dataset.cartDragModule; delete host.dataset.cartDropPosition; delete host.dataset.cartActivePosition;
    return {
      update(included, order) {
        if (disposed || !ownsHost() || contextLost) return;
        cancelDrag();
        try {
          const selected = graph.update(included, order); updateGuides();
          failed = false; message.hidden = true; canvas.hidden = false; canvas.style.display = 'block';
          host.dataset.cartSceneState = 'ready'; host.dataset.cartIncluded = selected.join(','); host.dataset.cartOrder = graph.order.join(','); invalidate();
        } catch (error) { report(error); }
      },
      setActivePosition(position) {
        if (disposed || !ownsHost() || contextLost || (position !== null && (!Number.isInteger(position) || position < 0 || position > 3))) return;
        activePosition = position; host.dataset.cartActivePosition = position === null ? '' : String(position); updateGuides(); invalidate();
      },
      setView(view) {
        if (disposed || !ownsHost() || contextLost || failed || !['top', 'front', 'perspective'].includes(view)) return;
        cancelDrag();
        frameModel(view); invalidate();
      },
      setCanopyVisible(visible) {
        if (disposed || !ownsHost() || contextLost || typeof visible !== 'boolean') return;
        cancelDrag();
        // Inspection only: no configuration, component selection or camera mutation.
        canopy.visible = visible; host.dataset.cartCanopyVisible = String(visible); invalidate();
      },
      focus() { if (!disposed && ownsHost()) canvas.focus(); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
