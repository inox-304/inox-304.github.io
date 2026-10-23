/**
 * ILUMI DJ-181 — reconstruction for visual product inspection, not manufacturing.
 * Source photos and dimensional evidence are documented in docs/modelos-3d/ilumi-dj-181.md.
 * Run from the repository root: node scripts/3d/build-ilumi-dj181.mjs
 * Geometry is authored here; no remotely loaded assets or manufacturer CAD are implied.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

// GLTFExporter uses the browser FileReader interface even for an untextured GLB.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch(error => this.onerror?.(error));
  }
};

const output = path.resolve('public/models/ilumi/dj-181-v1.glb');
const model = new THREE.Group();
model.name = 'ILUMI_DJ181_18L';
model.userData = {
  description: 'Reconstrucción visual del dispensador ILUMI DJ-181 a partir de fotografías. Las formas secundarias son aproximadas; no es un plano de fabricación.',
  units: 'meters',
  nominalDimensions: { width: 0.25, depth: 0.386, height: 0.728 },
  capacityLiters: 18,
  revision: '1.0',
  orientation: 'Y up; front +Z',
};

const brushed = new THREE.MeshStandardMaterial({ name: 'Acero_inoxidable_satinado', color: 0xb5bcc3, metalness: 0.9, roughness: 0.29 });
const polished = new THREE.MeshStandardMaterial({ name: 'Acero_cantos_y_grifo', color: 0xc3c8cf, metalness: 0.97, roughness: 0.18 });
const darkSteel = new THREE.MeshStandardMaterial({ name: 'Interior_ventilacion', color: 0x242b30, metalness: 0.5, roughness: 0.48 });
const black = new THREE.MeshStandardMaterial({ name: 'Bandeja_ABS_negra', color: 0x141820, metalness: 0.05, roughness: 0.28 });
const rubber = new THREE.MeshStandardMaterial({ name: 'Patas_goma', color: 0x11151b, metalness: 0, roughness: 0.8 });
const seal = new THREE.MeshStandardMaterial({ name: 'Junta_tolva', color: 0x9ba6b2, metalness: 0.1, roughness: 0.57 });
const white = new THREE.MeshStandardMaterial({ name: 'Etiqueta_blanca', color: 0xeff3f4, metalness: 0, roughness: 0.6 });
const label = new THREE.MeshStandardMaterial({ name: 'Etiqueta_negra', color: 0x080b0d, metalness: 0.05, roughness: 0.45 });
// Alpha blending is deliberate here: nested transmissive shells in model-viewer
// omit the other transparent objects from the refraction buffer. A faint PBR
// surface keeps the empty tank and its circulation tube visibly transparent.
const glass = new THREE.MeshPhysicalMaterial({
  name: 'Policarbonato_transparente', color: 0xe8f0fc, metalness: 0, roughness: 0.12,
  transparent: true, opacity: 0.10, depthWrite: false,
  clearcoat: 0.75, clearcoatRoughness: 0.09, side: THREE.DoubleSide,
});
const glassEdge = new THREE.MeshPhysicalMaterial({
  name: 'Policarbonato_bordes_moldeados', color: 0xe1ebfa, metalness: 0, roughness: 0.15,
  transparent: true, opacity: 0.29, depthWrite: false,
  clearcoat: 0.65, clearcoatRoughness: 0.12,
});
const tubeMaterial = new THREE.MeshPhysicalMaterial({
  name: 'Tubo_circulacion_translucido', color: 0xe4ebf5, metalness: 0, roughness: 0.2,
  transparent: true, opacity: 0.72, depthWrite: false,
});
const buckets = new Map();

function add(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0], parent = model, merge = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (merge && parent === model) {
    mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);
    const nonindexed = geometry.index ? geometry.toNonIndexed() : geometry;
    nonindexed.deleteAttribute('uv');
    const key = material.uuid;
    if (!buckets.has(key)) buckets.set(key, { material, geometries: [], names: [] });
    buckets.get(key).geometries.push(nonindexed);
    buckets.get(key).names.push(name);
  } else parent.add(mesh);
  return mesh;
}
function box(name, size, position, material = brushed, radius = 0.001, parent = model) {
  const geometry = new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n / 2)));
  return add(geometry, material, name, position, [0, 0, 0], parent, parent === model);
}
function cylinder(name, radiusTop, radiusBottom, height, position, material = polished, rotation = [0, 0, 0], segments = 32) {
  return add(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material, name, position, rotation);
}
function ringPoints(width, depth, radius, segments = 10) {
  const points = [];
  // Counter-clockwise as seen from above (XZ plane).
  for (let corner = 0; corner < 4; corner++) {
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
    const cz = (corner < 2 ? 1 : -1) * (depth / 2 - radius);
    for (let i = 0; i <= segments; i++) {
      const angle = corner * Math.PI / 2 + i / segments * Math.PI / 2;
      points.push([cx + radius * Math.cos(angle), cz + radius * Math.sin(angle)]);
    }
  }
  return points;
}
function roundRect(width, height, radius, cx = 0, cy = 0) {
  const shape = new THREE.Shape();
  const x = cx - width / 2, y = cy - height / 2, r = Math.min(radius, width / 2, height / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y); shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r); shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}
function loftRing(name, levels, material, wall = 0.0025, parent = model) {
  const vertices = [], indices = [];
  const rings = levels.map(({ w, d, r, y, z = -0.027 }) => ({ points: ringPoints(w, d, r), y, z }));
  const n = rings[0].points.length;
  // Outer and inner walls, with a connected rim and bottom.
  for (const inner of [false, true]) for (const level of levels) {
    for (const [x, z] of ringPoints(level.w - (inner ? 2 * wall : 0), level.d - (inner ? 2 * wall : 0), level.r - (inner ? wall : 0))) {
      vertices.push(x, level.y, z + (level.z ?? -0.027));
    }
  }
  const offset = levels.length * n;
  for (let layer = 0; layer < levels.length - 1; layer++) for (let j = 0; j < n; j++) {
    const next = (j + 1) % n;
    const a = layer * n + j, b = layer * n + next, c = (layer + 1) * n + next, d = (layer + 1) * n + j;
    indices.push(a, d, b, b, d, c);
    indices.push(offset + a, offset + b, offset + d, offset + b, offset + c, offset + d);
  }
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    const a = (levels.length - 1) * n + j, b = (levels.length - 1) * n + k;
    indices.push(a, offset + a, b, b, offset + a, offset + b);
    indices.push(j, k, offset + j, k, offset + k, offset + j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return add(geometry, material, name, [0, 0, 0], [0, 0, 0], parent, parent === model);
}
function flatRoundPanel(name, width, depth, radius, thickness, y, z, material, parent = model) {
  const geometry = new THREE.ExtrudeGeometry(roundRect(width, depth, radius), {
    depth: thickness, bevelEnabled: false, curveSegments: 12,
  });
  geometry.rotateX(-Math.PI / 2);
  return add(geometry, material, name, [0, y, z], [0, 0, 0], parent, parent === model);
}

// Four feet lift the housing clear of the work surface.
for (const x of [-0.108, 0.108]) for (const z of [-0.166, 0.087]) {
  cylinder('Pata_antideslizante', 0.009, 0.01, 0.009, [x, 0.0045, z], rubber, [0, 0, 0], 24);
  cylinder('Apoyo_metalico', 0.0075, 0.008, 0.013, [x, 0.0155, z], polished, [0, 0, 0], 24);
}

// Hollow housing: vents have actual openings, rather than lines painted on a box.
box('Panel_frontal_satinado', [0.233, 0.315, 0.0025], [0, 0.1835, 0.112], brushed, 0.001);
box('Panel_trasero_sin_detalles_no_documentados', [0.232, 0.318, 0.002], [0, 0.185, -0.192], brushed, 0.001);
box('Chapa_inferior', [0.246, 0.003, 0.305], [0, 0.0235, -0.039], darkSteel, 0.001);
box('Placa_superior', [0.247, 0.007, 0.307], [0, 0.3505, -0.039], polished, 0.002);
box('Sombra_interior', [0.211, 0.295, 0.266], [0, 0.183, -0.04], darkSteel, 0.004);
for (const x of [-0.12, 0.12]) {
  box('Montante_frontal', [0.01, 0.334, 0.014], [x, 0.189, 0.108], polished, 0.002);
  box('Montante_trasero', [0.009, 0.334, 0.012], [x, 0.189, -0.186], brushed, 0.002);
}
for (const side of [-1, 1]) {
  const sideShape = roundRect(0.298, 0.324, 0.004);
  for (let row = 0; row < 16; row++) for (let col = 0; col < 3; col++) {
    const y = -0.138 + row * 0.0175;
    const z = -0.092 + col * 0.087;
    // Reserve the upper front corner for the two observed operating switches.
    if (row > 12 && col === 2) continue;
    sideShape.holes.push(roundRect(0.071, 0.0057, 0.0015, z, y));
  }
  const geo = new THREE.ExtrudeGeometry(sideShape, { depth: 0.0015, bevelEnabled: false, curveSegments: 4 });
  geo.rotateY(side * Math.PI / 2);
  add(geo, brushed, 'Chapa_lateral_perforada', [side * 0.122, 0.188, -0.039]);
  for (const y of [0.043, 0.333]) for (const z of [-0.17, 0.09]) {
    cylinder('Tornillo_chapa', 0.0026, 0.0026, 0.0016, [side * 0.124, y, z], polished, [0, 0, Math.PI / 2], 16);
  }
}
// Narrow front fascia and folded metal edges match the reference silhouette.
box('Faja_frontal_superior', [0.22, 0.014, 0.004], [0, 0.313, 0.115], darkSteel, 0.001);
box('Labio_frontal_superior', [0.232, 0.009, 0.006], [0, 0.337, 0.117], brushed, 0.001);
box('Zocalo_frontal', [0.216, 0.01, 0.004], [0, 0.065, 0.115], polished, 0.001);

// Two modest rocker controls, as described in the technical sheet.
for (const [z, y] of [[0.065, 0.298], [0.028, 0.298]]) {
  box('Marco_interruptor', [0.002, 0.018, 0.012], [0.124, y, z], black, 0.001);
  box('Interruptor_basculante', [0.0022, 0.013, 0.008], [0.1239, y + 0.001, z], darkSteel, 0.001);
}

// Empty transparent 18 L container with softly tapered, rounded rectangular sides.
loftRing('Junta_base_tolva', [
  { w: 0.217, d: 0.278, r: 0.029, y: 0.353 },
  { w: 0.217, d: 0.278, r: 0.029, y: 0.359 },
], seal, 0.005);
flatRoundPanel('Fondo_transparente_tolva', 0.21, 0.27, 0.026, 0.0035, 0.358, -0.027, glassEdge);
loftRing('Tolva_vacia_18L', [
  { w: 0.208, d: 0.267, r: 0.028, y: 0.360 },
  { w: 0.211, d: 0.272, r: 0.029, y: 0.372 },
  { w: 0.235, d: 0.303, r: 0.036, y: 0.690 },
  { w: 0.235, d: 0.303, r: 0.036, y: 0.704 },
], glass, 0.0023);
loftRing('Borde_superior_moldeado', [
  { w: 0.238, d: 0.307, r: 0.037, y: 0.697 },
  { w: 0.238, d: 0.307, r: 0.037, y: 0.705 },
], glassEdge, 0.0035);
loftRing('Nervadura_base_tolva', [
  { w: 0.213, d: 0.273, r: 0.029, y: 0.364 },
  { w: 0.214, d: 0.274, r: 0.029, y: 0.370 },
], glassEdge, 0.003);

// Only the circulation tube visible in the reference is represented internally.
cylinder('Tubo_central_circulacion', 0.008, 0.009, 0.301, [0, 0.5125, -0.04], tubeMaterial, [0, 0, 0], 28);
cylinder('Base_tubo_circulacion', 0.017, 0.025, 0.019, [0, 0.3695, -0.04], tubeMaterial, [0, 0, 0], 32);
cylinder('Difusor_superior', 0.025, 0.017, 0.011, [0, 0.666, -0.04], tubeMaterial, [0, 0, 0], 32);
for (let i = 0; i < 6; i++) {
  const angle = i * Math.PI / 3;
  box('Nervio_difusor', [0.004, 0.004, 0.025], [Math.sin(angle) * 0.009, 0.674, -0.04 + Math.cos(angle) * 0.009], tubeMaterial, 0.001);
}

// Removable lid. Animation illustrates removal for cleaning; it is not a hinge.
// The last frame stays open so the catalog's reversible control can close it.
const lid = new THREE.Group();
lid.name = 'Tapa_extraible';
model.add(lid);
loftRing('Faldon_tapa', [
  { w: 0.244, d: 0.313, r: 0.038, y: 0.702 },
  { w: 0.244, d: 0.313, r: 0.038, y: 0.711 },
], glassEdge, 0.003, lid);
loftRing('Borde_abombado_tapa', [
  { w: 0.242, d: 0.311, r: 0.038, y: 0.710 },
  { w: 0.226, d: 0.292, r: 0.041, y: 0.7245 },
], glass, 0.0025, lid);
flatRoundPanel('Plano_superior_tapa', 0.226, 0.292, 0.041, 0.0035, 0.7245, -0.027, glass, lid);

// Stainless steel dispensing valve and push paddle.
cylinder('Cuerpo_valvula_vertical', 0.014, 0.014, 0.064, [0, 0.370, 0.126], polished, [0, 0, 0], 40);
cylinder('Tapon_valvula', 0.0148, 0.0148, 0.004, [0, 0.404, 0.126], brushed, [0, 0, 0], 40);
cylinder('Union_salida_tolva', 0.0125, 0.0125, 0.037, [0, 0.360, 0.112], polished, [Math.PI / 2, 0, 0], 32);
box('Carcasa_grifo', [0.079, 0.041, 0.024], [0, 0.3445, 0.139], brushed, 0.004);
cylinder('Boquilla_salida', 0.009, 0.008, 0.022, [0, 0.313, 0.138], polished, [0, 0, 0], 32);
cylinder('Interior_boquilla', 0.0055, 0.0055, 0.0008, [0, 0.3015, 0.138], darkSteel, [0, 0, 0], 28);
box('Soporte_pulsador', [0.023, 0.02, 0.01], [0, 0.312, 0.153], polished, 0.001);
box('Paleta_push', [0.047, 0.052, 0.004], [0, 0.283, 0.157], brushed, 0.002);
box('Labio_paleta_push', [0.047, 0.024, 0.003], [0, 0.247, 0.160], brushed, 0.002);
// A restrained mechanical seam remains visible at the paddle joint.
box('Union_paleta', [0.045, 0.0015, 0.001], [0, 0.258, 0.1618], darkSteel, 0.0003);

// Black removable drip tray: hollow basin, raised lip and an open slotted grate.
loftRing('Cuba_bandeja_goteo', [
  { w: 0.188, d: 0.102, r: 0.019, y: 0.013, z: 0.1395 },
  { w: 0.202, d: 0.107, r: 0.020, y: 0.064, z: 0.1395 },
], black, 0.0035);
flatRoundPanel('Fondo_bandeja', 0.188, 0.102, 0.019, 0.003, 0.013, 0.1395, black);
loftRing('Labio_bandeja', [
  { w: 0.207, d: 0.107, r: 0.019, y: 0.063, z: 0.1395 },
  { w: 0.207, d: 0.107, r: 0.019, y: 0.067, z: 0.1395 },
], black, 0.0035);
const grateShape = roundRect(0.195, 0.093, 0.014);
for (let i = 0; i < 9; i++) {
  const x = (i - 4) * 0.0189;
  for (const z of [-0.023, 0.023]) grateShape.holes.push(roundRect(0.012, 0.035, 0.004, x, z));
}
const grate = new THREE.ExtrudeGeometry(grateShape, { depth: 0.0028, bevelEnabled: false, curveSegments: 5 });
grate.rotateX(-Math.PI / 2);
add(grate, black, 'Rejilla_desmontable_abierta', [0, 0.0627, 0.1395]);

// Manufacturer word mark is geometric, so the GLB needs no network or bitmap textures.
box('Placa_marca_borde', [0.068, 0.026, 0.001], [-0.052, 0.096, 0.114], white, 0.0006);
box('Placa_marca_fondo', [0.064, 0.022, 0.001], [-0.052, 0.096, 0.1147], label, 0.0004);
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));
const letters = new TextGeometry('ilumi', { font, size: 0.0173, depth: 0.0002, curveSegments: 5, bevelEnabled: false });
letters.computeBoundingBox();
const letterWidth = letters.boundingBox.max.x - letters.boundingBox.min.x;
add(letters, white, 'Marca_ilumi', [-0.052 - letterWidth / 2, 0.0895, 0.1153]);

// Merge rigid pieces with the same material to keep mobile draw calls low.
for (const { material, geometries, names } of buckets.values()) {
  const geometry = mergeGeometries(geometries, false);
  if (!geometry) throw new Error(`Cannot merge ${material.name}`);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = material.name;
  mesh.userData.parts = names;
  model.add(mesh);
}
model.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(model);
const size = bounds.getSize(new THREE.Vector3());
if (Math.abs(size.x - 0.25) > 0.002 || Math.abs(size.y - 0.728) > 0.001 || Math.abs(size.z - 0.386) > 0.002) {
  throw new Error(`Unexpected model dimensions: ${size.toArray().join(', ')}`);
}
const clip = new THREE.AnimationClip('Abrir_tapa', 1.2, [
  new THREE.VectorKeyframeTrack('Tapa_extraible.position', [0, 1.0, 1.2], [0, 0, 0, 0, 0.095, 0, 0, 0.095, 0]),
]);
const exporter = new GLTFExporter();
const arrayBuffer = await exporter.parseAsync(model, { binary: true, animations: [clip], onlyVisible: true });
const buffer = Buffer.from(arrayBuffer);
const report = inspectGlb(buffer);
if (report.errors.length || report.warnings.length) throw new Error(JSON.stringify(report));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, buffer);
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
console.log(JSON.stringify({ output, bytes: report.bytes, triangles: report.triangles, meshes: gltf.meshes.length, materials: gltf.materials.length, dimensionsMeters: size.toArray(), animations: gltf.animations.map(a => a.name), externalResources: false }, null, 2));
