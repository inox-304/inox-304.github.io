import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { moduleCells, parseCooktopConfig, validateCooktopSelection, type CooktopConfig, type CooktopSelection } from '../lib/cooktop-config.ts';

export type CooktopScene = {
  update(config: CooktopConfig, selection: CooktopSelection): void;
  setDoors(open: boolean): void;
  readonly hasDoors: boolean;
  focus(): void;
  dispose(): void;
};
type SceneOptions = { onPick: (anchor: number) => void; onError?: (error: Error) => void };
export type CooktopSurface = { minX: number; maxX: number; minZ: number; maxZ: number; y: number };
type TemplateName = 'BurnerGas' | 'BurnerElectric' | 'Wok' | 'Griddle' | 'Grill';
export type CooktopRenderPart = { moduleId: string; anchor: number; cells: number[]; template: TemplateName; x: number; y: number; z: number; scaleX: number; scaleZ: number };
const templateNames: TemplateName[] = ['BurnerGas', 'BurnerElectric', 'Wok', 'Griddle', 'Grill'];
const unavailable = 'Este modelo no admite la configuración 3D solicitada. Usa los controles de distribución.';

export function readCooktopSurface(metadata: unknown): CooktopSurface {
  if (!metadata || typeof metadata !== 'object' || (metadata as { version?: unknown }).version !== 1) throw new Error(unavailable);
  const surface = (metadata as { surface?: CooktopSurface }).surface;
  if (!surface || !['minX', 'maxX', 'minZ', 'maxZ', 'y'].every(key => typeof surface[key as keyof CooktopSurface] === 'number' && Number.isFinite(surface[key as keyof CooktopSurface]))
    || surface.maxX <= surface.minX || surface.maxZ <= surface.minZ) throw new Error(unavailable);
  return { minX: surface.minX, maxX: surface.maxX, minZ: surface.minZ, maxZ: surface.maxZ, y: surface.y };
}

/** Plan actual replacement meshes; occupied cells never retain their base burner. */
export function planCooktopParts(input: CooktopConfig, selection: CooktopSelection, surface: CooktopSurface): CooktopRenderPart[] {
  surface = readCooktopSurface({ version: 1, surface });
  const config = parseCooktopConfig(input);
  if (!config) throw new Error(unavailable);
  const state = validateCooktopSelection(config, selection);
  const layout = config.layouts.find(item => item.id === state.layoutId)!;
  const cellWidth = (surface.maxX - surface.minX) / layout.columns;
  const cellDepth = (surface.maxZ - surface.minZ) / layout.rows;
  const occupied = new Set<number>();
  const part = (moduleId: string, anchor: number): CooktopRenderPart => {
    const module = config.modules.find(item => item.id === moduleId)!;
    const template = module.kind === 'burner' ? (state.energy === 'gas' ? 'BurnerGas' : 'BurnerElectric')
      : module.kind === 'wok' ? 'Wok' : module.kind === 'griddle' ? 'Griddle' : module.kind === 'grill' ? 'Grill' : null;
    if (!template) throw new Error(`La pieza «${module.name}» no dispone de una representación 3D compatible.`);
    const cells = moduleCells(layout, module, anchor);
    const round = module.kind === 'burner' || module.kind === 'wok';
    // A round burner must not become an ellipse; height remains native to the GLB.
    const scale = Math.min(cellWidth * module.width, cellDepth * module.height);
    return { moduleId, anchor, cells, template,
      x: surface.minX + (anchor % layout.columns + module.width / 2) * cellWidth,
      y: surface.y, z: surface.minZ + (Math.floor(anchor / layout.columns) + module.height / 2) * cellDepth,
      scaleX: round ? scale : cellWidth * module.width, scaleZ: round ? scale : cellDepth * module.height };
  };
  const parts = state.placements.map(placement => {
    const result = part(placement.moduleId, placement.anchor);
    result.cells.forEach(cell => occupied.add(cell));
    return result;
  });
  for (let anchor = 0; anchor < layout.rows * layout.columns; anchor++) {
    if (!occupied.has(anchor)) parts.push(part(config.defaultModuleId, anchor));
  }
  return parts;
}

/** Release shared GLTF resources once, including textures and decoded bitmaps. */
export function disposeCooktopResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  materials.forEach(material => {
    Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
    material.dispose();
  });
  const images = new Set<{ close?: () => void }>();
  textures.forEach(texture => { if (texture.image && typeof texture.image === 'object') images.add(texture.image); texture.dispose(); });
  images.forEach(image => { if (typeof image.close === 'function') image.close(); });
  geometries.forEach(geometry => geometry.dispose());
}

export async function createCooktopScene(host: HTMLElement, assetUrl: string, options: SceneOptions): Promise<CooktopScene> {
  const message = host.ownerDocument.createElement('p');
  message.className = 'cooktop-scene-message'; message.setAttribute('role', 'status'); message.hidden = true;
  message.style.color = '#fff'; message.style.padding = '1rem';
  host.append(message);
  let root: THREE.Group | undefined, renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined, environment: THREE.WebGLRenderTarget | undefined, floor: THREE.Mesh | undefined;
  let mixer: THREE.AnimationMixer | undefined, shadow: THREE.DirectionalLightShadow | undefined;
  let frame = 0, disposed = false, errorVisible = false, contextLost = false, renderCount = 0;
  let detachControlEvents = () => {};
  const listeners: [EventTarget, string, EventListener][] = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => { target.addEventListener(type, handler); listeners.push([target, type, handler]); };
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect(); detachControlEvents(); controls?.dispose();
    listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler));
    if (root) { mixer?.stopAllAction(); mixer?.uncacheRoot(root); disposeCooktopResources(root); }
    if (floor) disposeCooktopResources(floor);
    environment?.dispose(); shadow?.dispose();
    renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); message.remove();
    delete host.dataset.cooktopSceneState; delete host.dataset.cooktopRenderCount;
    delete host.dataset.cooktopBurnerCount; delete host.dataset.cooktopModuleCount;
  }
  function report(error: unknown) {
    const safe = error instanceof Error ? error : new Error(unavailable);
    errorVisible = true;
    if (renderer) { renderer.domElement.hidden = true; renderer.domElement.style.display = 'none'; }
    message.textContent = safe.message; message.hidden = false; host.dataset.cooktopSceneState = 'error';
    options.onError?.(safe);
  }
  try {
    const url = new URL(assetUrl, host.ownerDocument.baseURI);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(unavailable);
    const gltf = await new GLTFLoader().loadAsync(url.href);
    root = gltf.scene;
    const surface = readCooktopSurface(root.userData.cooktop);
    const chassis = root.getObjectByName('CooktopChassis'), bank = root.getObjectByName('CooktopTemplates');
    if (!chassis || !bank) throw new Error(unavailable);
    const templates = new Map<TemplateName, THREE.Object3D>();
    for (const name of templateNames) {
      const matches: THREE.Object3D[] = [];
      bank.traverse(object => { if (object.name === name) matches.push(object); });
      if (matches.length !== 1 || new THREE.Box3().setFromObject(matches[0]).isEmpty()) throw new Error(unavailable);
      templates.set(name, matches[0]);
    }
    bank.visible = false;
    root.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    const partsRoot = new THREE.Group(); partsRoot.name = 'CooktopSelectedModules'; root.add(partsRoot);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff); scene.add(root);
    const bounds = new THREE.Box3().setFromObject(chassis), size = bounds.getSize(new THREE.Vector3()), target = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 100) throw new Error(unavailable);
    const camera = new THREE.PerspectiveCamera(35, 1, Math.max(0.001, radius / 100), radius * 50);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Vista 3D de la distribución de cocina. Arrastra o usa las flechas para girar; usa la rueda o + y − para acercar y alejar. Selecciona las piezas con los controles de distribución.');
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; canvas.style.touchAction = 'none';
    host.append(canvas);
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    try { environment = pmrem.fromScene(room, 0.04); scene.environment = environment.texture; scene.environmentIntensity = 1.15; }
    finally { room.dispose(); pmrem.dispose(); }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9ba6b0, 1.2));
    const key = new THREE.DirectionalLight(0xfff9ee, 2.6);
    shadow = key.shadow;
    key.position.copy(target).add(new THREE.Vector3(radius * 2, radius * 3, radius * 2)); key.target.position.copy(target);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0003;
    Object.assign(key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 10 });
    key.shadow.camera.updateProjectionMatrix(); scene.add(key, key.target);
    floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 12, radius * 12), new THREE.ShadowMaterial({ color: 0x546575, opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(target.x, bounds.min.y - radius * 0.003, target.z); floor.receiveShadow = true; scene.add(floor);
    controls = new OrbitControls(camera, canvas); controls.target.copy(target);
    controls.enableDamping = false; controls.enablePan = false; controls.minPolarAngle = 0.12; controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = radius * 0.65; controls.maxDistance = radius * 8;
    const doorClips = gltf.animations.filter(clip => /^Abrir[_ -]puertas$/i.test(clip.name) && Number.isFinite(clip.duration) && clip.duration > 0);
    mixer = new THREE.AnimationMixer(root);
    const doorActions = doorClips.map(clip => { const action = mixer!.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); return action; });
    let doorProgress = 0, transition: { from: number; to: number; start: number; duration: number } | undefined;
    let activeLayout: { columns: number; rows: number } | undefined;
    function invalidate() { if (!disposed && !frame) frame = requestAnimationFrame(draw); }
    function draw(now: number) {
      frame = 0;
      if (disposed) return;
      if (transition) {
        const progress = transition.duration ? Math.min(1, (now - transition.start) / transition.duration) : 1;
        doorProgress = transition.from + (transition.to - transition.from) * (progress * progress * (3 - 2 * progress));
        doorActions.forEach(action => { action.paused = false; action.time = Math.max(0, action.getClip().duration - 0.00001) * doorProgress; });
        mixer!.update(0);
        if (progress >= 1) transition = undefined;
      }
      if (!errorVisible && host.clientWidth > 0 && host.clientHeight > 0) {
        renderer!.render(scene, camera); host.dataset.cooktopRenderCount = String(++renderCount);
      }
      if (transition) invalidate();
    }
    controls.addEventListener('change', invalidate);
    detachControlEvents = () => controls?.removeEventListener('change', invalidate);
    listen(canvas, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (disposed || contextLost || errorVisible || host.ownerDocument.activeElement !== canvas || key.altKey || key.ctrlKey || key.metaKey) return;
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
      offset.radius = THREE.MathUtils.clamp(offset.radius, orbit.minDistance, orbit.maxDistance);
      offset.makeSafe();
      camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(offset));
      orbit.update();
      invalidate();
    });
    let framed = false;
    const resize = () => {
      if (disposed) return;
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer!.setSize(width, height, false);
      if (!framed) {
        const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect) * 0.72;
        camera.position.copy(target).add(new THREE.Vector3(1.15, 0.95, 1.55).normalize().multiplyScalar(distance));
        controls!.maxDistance = Math.max(radius * 8, distance * 2); controls!.update(); framed = true;
      }
      invalidate();
    };
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let press: { id: number; x: number; y: number; dragged: boolean } | undefined;
    const pointers = new Set<number>();
    listen(canvas, 'pointerdown', event => {
      const pointerEvent = event as PointerEvent; pointers.add(pointerEvent.pointerId);
      if (pointers.size > 1) { if (press) press.dragged = true; return; }
      if (pointerEvent.button === 0) press = { id: pointerEvent.pointerId, x: pointerEvent.clientX, y: pointerEvent.clientY, dragged: false };
    });
    listen(canvas, 'pointermove', event => {
      const pointerEvent = event as PointerEvent;
      if (press?.id === pointerEvent.pointerId && Math.hypot(pointerEvent.clientX - press.x, pointerEvent.clientY - press.y) > 5) press.dragged = true;
    });
    listen(canvas, 'pointercancel', event => { pointers.delete((event as PointerEvent).pointerId); press = undefined; });
    listen(canvas, 'pointerup', event => {
      const pointerEvent = event as PointerEvent, start = press; pointers.delete(pointerEvent.pointerId);
      if (start?.id !== pointerEvent.pointerId) return;
      press = undefined;
      if (start.dragged || errorVisible || !activeLayout || Math.hypot(pointerEvent.clientX - start.x, pointerEvent.clientY - start.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.set((pointerEvent.clientX - rect.left) / rect.width * 2 - 1, -(pointerEvent.clientY - rect.top) / rect.height * 2 + 1);
      scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(partsRoot.children, true)[0];
      if (!hit) return;
      const point = root!.worldToLocal(hit.point.clone());
      if (point.x < surface.minX || point.x > surface.maxX || point.z < surface.minZ || point.z > surface.maxZ) return;
      const column = Math.min(activeLayout.columns - 1, Math.floor((point.x - surface.minX) / (surface.maxX - surface.minX) * activeLayout.columns));
      const row = Math.min(activeLayout.rows - 1, Math.floor((point.z - surface.minZ) / (surface.maxZ - surface.minZ) * activeLayout.rows));
      options.onPick(row * activeLayout.columns + column);
    });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault(); contextLost = true; transition = undefined;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      partsRoot.clear(); activeLayout = undefined;
      host.dataset.cooktopBurnerCount = '0'; host.dataset.cooktopModuleCount = '0';
      report(new Error('Se perdió el contexto 3D. Cierra la vista y vuelve a abrirla.'));
    });
    host.dataset.cooktopSceneState = 'ready';
    return {
      get hasDoors() { return doorActions.length > 0; },
      focus() { if (!disposed) canvas.focus(); },
      update(config, selection) {
        if (disposed || contextLost) return;
        try {
          const parts = planCooktopParts(config, selection, surface);
          const next = parts.map(part => {
            const instance = templates.get(part.template)!.clone(true); instance.visible = true;
            instance.position.set(part.x, part.y, part.z); instance.scale.set(part.scaleX, 1, part.scaleZ);
            instance.userData.cooktopAnchor = part.anchor; instance.userData.cooktopCells = [...part.cells];
            return instance;
          });
          partsRoot.clear(); partsRoot.add(...next);
          activeLayout = config.layouts.find(layout => layout.id === selection.layoutId);
          errorVisible = false; message.hidden = true; message.textContent = ''; canvas.hidden = false; canvas.style.display = 'block';
          host.dataset.cooktopSceneState = 'ready';
          host.dataset.cooktopBurnerCount = String(parts.filter(part => part.template === 'BurnerGas' || part.template === 'BurnerElectric').length);
          host.dataset.cooktopModuleCount = String(parts.length);
          invalidate();
        } catch (error) {
          partsRoot.clear(); activeLayout = undefined;
          host.dataset.cooktopBurnerCount = '0'; host.dataset.cooktopModuleCount = '0'; report(error);
        }
      },
      setDoors(open) {
        if (disposed || contextLost || !doorActions.length || (!transition && doorProgress === (open ? 1 : 0))) return;
        transition = { from: doorProgress, to: open ? 1 : 0, start: performance.now(), duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420 };
        invalidate();
      },
      dispose,
    };
  } catch {
    dispose();
    const error = new Error('No se pudo abrir el modelo 3D configurable. Usa los controles de distribución.');
    options.onError?.(error);
    throw error;
  }
}
