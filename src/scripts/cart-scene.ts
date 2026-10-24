import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCartSceneGraph, disposeCartResources } from '../lib/cart-scene-graph.ts';

export type CartView = 'top' | 'front' | 'perspective';
export type CartScene = { update(included: readonly string[]): void; setView(view: CartView): void; setCanopyVisible(visible: boolean): void; focus(): void; dispose(): void };
type CartSceneOptions = { onError?: (error: Error) => void };

/** One authored cart, one renderer: selecting equipment changes its actual meshes in place. */
export async function createCartScene(host: HTMLElement, assetUrl: string, options: CartSceneOptions = {}): Promise<CartScene> {
  let root: THREE.Group | undefined, renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined, environment: THREE.WebGLRenderTarget | undefined, floor: THREE.Mesh | undefined;
  let shadow: THREE.DirectionalLightShadow | undefined;
  let frame = 0, disposed = false, contextLost = false, renderCount = 0, failed = false;
  let detachControls = () => {};
  const listeners: [EventTarget, string, EventListener][] = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => { target.addEventListener(type, handler); listeners.push([target, type, handler]); };
  const message = host.ownerDocument.createElement('p');
  message.className = 'cart-scene-message'; message.setAttribute('role', 'status'); message.hidden = true;
  message.style.cssText = 'color:#173753;padding:1rem;background:white;'; host.append(message);
  function report(error: unknown) {
    const safe = error instanceof Error ? error : new Error('No se pudo representar la selección del carrito.');
    failed = true;
    if (renderer) { renderer.domElement.hidden = true; renderer.domElement.style.display = 'none'; }
    message.textContent = safe.message; message.hidden = false; host.dataset.cartSceneState = 'error';
    options.onError?.(safe);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect(); detachControls(); controls?.dispose();
    listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler));
    if (root) disposeCartResources(root);
    if (floor) disposeCartResources(floor);
    environment?.dispose(); shadow?.dispose();
    renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); message.remove();
    for (const key of ['cartSceneState', 'cartRenderCount', 'cartIncluded', 'cartView', 'cartCanopyVisible']) delete host.dataset[key];
  }
  try {
    const url = new URL(assetUrl, host.ownerDocument.baseURI);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('La dirección del modelo 3D no es válida.');
    const gltf = await new GLTFLoader().loadAsync(url.href);
    root = gltf.scene;
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
    canvas.setAttribute('aria-label', 'Carrito salchipapero 3D. Arrastra o usa las flechas para girar; rueda o + y − para acercar. Elige el equipamiento con las casillas de personalización.');
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
    function invalidate() { if (!disposed && !contextLost && !frame) frame = requestAnimationFrame(draw); }
    function draw() {
      frame = 0;
      if (!disposed && !contextLost && !failed && host.clientWidth > 0 && host.clientHeight > 0) {
        renderer!.render(scene, camera); host.dataset.cartRenderCount = String(++renderCount);
      }
    }
    controls.addEventListener('change', invalidate); detachControls = () => controls?.removeEventListener('change', invalidate);
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
      if (disposed || contextLost) return;
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer!.setSize(width, height, false);
      if (!framed) { frameModel('perspective'); framed = true; }
      invalidate();
    };
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    listen(canvas, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (disposed || contextLost || failed || host.ownerDocument.activeElement !== canvas || key.altKey || key.ctrlKey || key.metaKey) return;
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
      event.preventDefault(); contextLost = true;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      report(new Error('Se perdió la vista 3D. Vuelve a la foto y abre Ver 360° para recuperarla; tu selección se conserva.'));
    });
    host.dataset.cartSceneState = 'ready'; host.dataset.cartIncluded = graph.included.join(','); host.dataset.cartCanopyVisible = 'true';
    return {
      update(included) {
        if (disposed || contextLost) return;
        try {
          const selected = graph.update(included);
          failed = false; message.hidden = true; canvas.hidden = false; canvas.style.display = 'block';
          host.dataset.cartSceneState = 'ready'; host.dataset.cartIncluded = selected.join(','); invalidate();
        } catch (error) { report(error); }
      },
      setView(view) {
        if (disposed || contextLost || failed || !['top', 'front', 'perspective'].includes(view)) return;
        frameModel(view); invalidate();
      },
      setCanopyVisible(visible) {
        if (disposed || contextLost || typeof visible !== 'boolean') return;
        // Inspection only: no configuration, component selection or camera mutation.
        canopy.visible = visible; host.dataset.cartCanopyVisible = String(visible); invalidate();
      },
      focus() { if (!disposed) canvas.focus(); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
