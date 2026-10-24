import * as THREE from 'three';

export const CART_MODULE_NODES = {
  broastera: ['Broaster', 'BroasterCover'],
  freidora: ['Fryer', 'FryerCover'],
  conservadora: ['Warmer', 'WarmerCover'],
  plancha: ['Griddle', 'GriddleCover'],
} as const;
export type CartModuleId = keyof typeof CART_MODULE_NODES;
export type CartSceneGraph = { update(included: readonly string[]): CartModuleId[]; readonly included: CartModuleId[] };
const incompatible = 'Este archivo no contiene las piezas necesarias para personalizar el carrito en 3D.';
const ids = Object.keys(CART_MODULE_NODES) as CartModuleId[];

function uniqueNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const found: THREE.Object3D[] = [];
  root.traverse(object => { if (object.name === name) found.push(object); });
  if (found.length !== 1) throw new Error(incompatible);
  return found[0];
}

function hasGeometry(root: THREE.Object3D): boolean {
  let vertices = 0;
  root.traverse(object => {
    if (object instanceof THREE.Mesh) vertices += object.geometry.getAttribute('position')?.count || 0;
  });
  return vertices >= 3;
}

/** Bind only the four authored pieces. Labels from the CMS can never select arbitrary nodes. */
export function createCartSceneGraph(root: THREE.Object3D): CartSceneGraph {
  const metadata = root.userData.cart;
  if (!metadata || metadata.version !== 1 || metadata.productId !== 'P15' || !Array.isArray(metadata.modules)
    || metadata.modules.length !== ids.length || metadata.coverDefaultScale !== 'zero-until-configured') throw new Error(incompatible);
  const chassis = uniqueNode(root, 'CartChassis');
  const canopy = uniqueNode(root, 'CartCanopy');
  const modules = uniqueNode(root, 'CartModules');
  const covers = uniqueNode(root, 'CartCovers');
  if (chassis.parent !== root || canopy.parent !== chassis || modules.parent !== root || covers.parent !== root || !hasGeometry(chassis)) throw new Error(incompatible);
  const known = new Set<string>();
  const bindings = metadata.modules.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error(incompatible);
    const item = entry as { id: string; node: string; coverNode: string };
    if (!Object.hasOwn(CART_MODULE_NODES, item.id) || known.has(item.id)) throw new Error(incompatible);
    known.add(item.id);
    const id = item.id as CartModuleId;
    if (item.node !== CART_MODULE_NODES[id][0] || item.coverNode !== CART_MODULE_NODES[id][1]) throw new Error(incompatible);
    const module = uniqueNode(root, item.node), cover = uniqueNode(root, item.coverNode);
    if (module.parent !== modules || cover.parent !== covers || !hasGeometry(module) || !hasGeometry(cover)
      || JSON.stringify(cover.userData.restScale) !== '[1,1,1]') throw new Error(incompatible);
    return { id, module, cover };
  }) as { id: CartModuleId; module: THREE.Object3D; cover: THREE.Object3D }[];
  let selected: CartModuleId[] = [];
  const graph: CartSceneGraph = {
    get included() { return [...selected]; },
    update(included) {
      if (!Array.isArray(included) || included.length > ids.length || new Set(included).size !== included.length
        || included.some(id => typeof id !== 'string' || !Object.hasOwn(CART_MODULE_NODES, id))) {
        throw new Error('La selección contiene una pieza que este carrito no admite.');
      }
      const selection = new Set(included);
      // Validate the entire selection first; a rejected update leaves the last valid geometry intact.
      for (const { id, module, cover } of bindings) {
        module.visible = selection.has(id);
        cover.scale.set(1, 1, 1);
        cover.visible = !module.visible;
      }
      selected = ids.filter(id => selection.has(id));
      root.updateMatrixWorld(true);
      return [...selected];
    },
  };
  graph.update(ids);
  return graph;
}

/** GLTF pieces share resources; dispose each resource and decoded image only once. */
export function disposeCartResources(root: THREE.Object3D): void {
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
