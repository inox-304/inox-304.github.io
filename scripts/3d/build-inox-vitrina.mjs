/** INOX P20 / CÓD-VRC-1 — visual reconstruction from the supplied catalog photo.
 * IMPORTANT: physical dimensions are unavailable. Width=1 is a visual normalization,
 * not a one-meter product or a fabrication/installation measurement.
 * See docs/modelos-3d/inox-vitrina.md. Rebuild: node scripts/3d/build-inox-vitrina.mjs
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

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }).catch(error => this.onerror?.(error));
  }
};
const model = new THREE.Group();
model.name = 'INOX_P20_VRC1_reconstruccion_visual';
model.userData = {
  productCode: 'P20', referenceCode: 'CÓD-VRC-1', revision: '1.0',
  dimensionsVerified: false, scale: 'VISUAL_NORMALIZED_WIDTH_1_NOT_PHYSICAL_DIMENSIONS',
  disclaimer: 'Reconstrucción aproximada de fotografía frontal. Dimensiones físicas no disponibles. No usar para medir espacios, fabricación o realidad aumentada a escala.',
  reference: 'INOX304_datos_y_catalogo.pdf, página 13; foto local public/images/products/vitrina-refrigerada.webp',
};
const steel = new THREE.MeshStandardMaterial({ name: 'Acero_inoxidable_satinado', color: 0xc5cbd0, metalness: 0.94, roughness: 0.31 });
const shiny = new THREE.MeshStandardMaterial({ name: 'Acero_cantos_y_bandejas', color: 0xd2d7db, metalness: 0.97, roughness: 0.21 });
const interior = new THREE.MeshStandardMaterial({ name: 'Acero_interior', color: 0xb8c2c9, metalness: 0.91, roughness: 0.36 });
const frame = new THREE.MeshStandardMaterial({ name: 'Marco_negro', color: 0x0b1117, metalness: 0.30, roughness: 0.27 });
const shadow = new THREE.MeshStandardMaterial({ name: 'Fondo_ventilacion', color: 0x111820, metalness: 0.15, roughness: 0.57 });
const glass = new THREE.MeshPhysicalMaterial({ name: 'Cristal_claro', color: 0xe3eff6, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.085, depthWrite: false, clearcoat: 0.70, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
const buckets = new Map();

function add(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const transform = new THREE.Object3D(); transform.position.set(...position); transform.rotation.set(...rotation); transform.updateMatrix();
  geometry.applyMatrix4(transform.matrix);
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  geo.deleteAttribute('uv');
  if (!buckets.has(material.uuid)) buckets.set(material.uuid, { material, geometries: [], parts: [] });
  buckets.get(material.uuid).geometries.push(geo); buckets.get(material.uuid).parts.push(name);
}
function box(name, size, position, material = steel, radius = 0.0015, rotation = [0, 0, 0]) {
  add(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(v => v / 2))), material, name, position, rotation);
}
function roundedRect(w, h, r, cx = 0, cy = 0) {
  const shape = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2;
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}
function perforatedPanel(name, w, h, rows, position, rotation = [0, 0, 0], material = steel) {
  const shape = roundedRect(w, h, 0.0015);
  for (const row of rows) for (let i = 0; i < row.count; i++) {
    const x = THREE.MathUtils.lerp(row.start, row.end, i / (row.count - 1));
    if (row.excludeCenter && Math.abs(x) < row.excludeCenter) continue;
    shape.holes.push(roundedRect(row.slotWidth, row.slotHeight * (i % 2 ? 0.72 : 1), row.slotWidth / 2, x, row.y));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.0018, bevelEnabled: false, curveSegments: 4 });
  add(geo, material, name, position, rotation);
}
function rod(name, points, radius, material = frame, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  add(new THREE.TubeGeometry(curve, segments, radius, 8, false), material, name);
}

// Lower cabinet follows the visible front silhouette; the unobserved rear is plain.
box('Base_cuerpo', [0.900, 0.175, 0.510], [0, 0.1125, -0.015], steel, 0.006);
box('Sombra_interior_base', [0.865, 0.160, 0.485], [0, 0.113, -0.015], shadow, 0.003);
// The separate perforated front is the foremost surface, with real openings.
perforatedPanel('Frente_ventilado', 0.900, 0.175, [
  { count: 45, start: -0.280, end: 0.280, y: 0.044, slotWidth: 0.004, slotHeight: 0.022 },
  { count: 45, start: -0.280, end: 0.280, y: -0.030, slotWidth: 0.004, slotHeight: 0.022, excludeCenter: 0.105 },
], [0, 0.1125, 0.242]);
// Hide the original uninterrupted front behind the dark vent inset without adding a visible mechanism.
box('Fondo_negro_ranuras_frontales', [0.590, 0.112, 0.002], [0, 0.119, 0.241], shadow, 0.001);
box('Fascia_superior_continua', [1.000, 0.059, 0.552], [0, 0.2295, -0.005], steel, 0.002);
box('Pliegue_inferior_fascia', [0.986, 0.016, 0.545], [0, 0.193, -0.007], interior, 0.001);
for (const x of [-0.414, 0.414]) for (const z of [-0.230, 0.220]) {
  box('Apoyo_inferior_discreto', [0.024, 0.020, 0.028], [x, 0.010, z], shadow, 0.004);
  box('Union_apoyo', [0.020, 0.010, 0.023], [x, 0.022, z], steel, 0.002);
}

// Open display well and its four shallow stainless trays, clearly visible in the photo.
box('Fondo_cubeta_exhibicion', [0.928, 0.004, 0.490], [0, 0.268, -0.001], interior, 0.001);
box('Pared_lateral_izquierda_cubeta', [0.003, 0.165, 0.458], [-0.462, 0.349, -0.010], interior, 0.001);
box('Pared_lateral_derecha_cubeta', [0.003, 0.165, 0.458], [0.462, 0.349, -0.010], interior, 0.001);
box('Pared_fondo_cubeta', [0.924, 0.192, 0.003], [0, 0.368, -0.238], interior, 0.001);
box('Remate_inferior_fondo', [0.915, 0.008, 0.012], [0, 0.275, -0.232], shiny, 0.001);
for (let i = 0; i < 4; i++) {
  const x = (i - 1.5) * 0.225;
  box('Bandeja_exhibicion_fondo', [0.220, 0.002, 0.388], [x, 0.273, 0.011], shiny, 0.001);
  for (const side of [-1, 1]) box('Bandeja_borde_lateral', [0.0025, 0.006, 0.388], [x + side * 0.109, 0.276, 0.011], shiny, 0.001);
  for (const z of [-0.182, 0.204]) box('Bandeja_borde_transversal', [0.219, 0.006, 0.0025], [x, 0.276, z], shiny, 0.001);
}
perforatedPanel('Rejilla_retorno_frontal', 0.910, 0.031, [
  { count: 73, start: -0.436, end: 0.436, y: 0, slotWidth: 0.004, slotHeight: 0.022 },
], [0, 0.282, 0.228], [-Math.PI / 2, 0, 0], shiny);
box('Sombra_rejilla_frontal', [0.905, 0.002, 0.030], [0, 0.280, 0.228], shadow, 0.001);
perforatedPanel('Rejilla_retorno_posterior', 0.910, 0.041, [
  { count: 73, start: -0.436, end: 0.436, y: 0, slotWidth: 0.004, slotHeight: 0.025 },
], [0, 0.440, -0.235], [0, 0, 0], shiny);
box('Sombra_rejilla_posterior', [0.905, 0.040, 0.002], [0, 0.440, -0.236], shadow, 0.001);

// Approximate side profile from the curved front photograph; no physical dimensions are claimed.
const sideCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.259, 0.278), new THREE.Vector3(0, 0.365, 0.276),
  new THREE.Vector3(0, 0.495, 0.235), new THREE.Vector3(0, 0.610, 0.155),
  new THREE.Vector3(0, 0.686, 0.055), new THREE.Vector3(0, 0.700, -0.025),
]);
const profile = sideCurve.getPoints(42);
const frontPositions = [], frontIndices = [];
for (const p of profile) { frontPositions.push(-0.485, p.y, p.z, 0.485, p.y, p.z); }
for (let i = 0; i < profile.length - 1; i++) { const a = i * 2; frontIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
const frontGlass = new THREE.BufferGeometry(); frontGlass.setAttribute('position', new THREE.Float32BufferAttribute(frontPositions, 3)); frontGlass.setIndex(frontIndices); frontGlass.computeVertexNormals();
add(frontGlass, glass, 'Cristal_curvo_frontal');
for (const side of [-1, 1]) {
  const x = side * 0.491;
  rod('Marco_lateral_curvo', profile.map(p => [x, p.y, p.z]), 0.0085, frame, 64);
  box('Marco_posterior_lateral', [0.014, 0.439, 0.014], [x, 0.480, -0.266], frame, 0.0015);
  box('Marco_lateral_inferior', [0.015, 0.015, 0.548], [x, 0.259, 0.005], frame, 0.0015);
  // Side pane spans the visible curved frame and the straight rear edge.
  const outline = new THREE.Shape();
  outline.moveTo(-profile[0].z, profile[0].y);
  for (const p of profile.slice(1)) outline.lineTo(-p.z, p.y);
  outline.lineTo(0.266, 0.700); outline.lineTo(0.266, 0.259); outline.closePath();
  const sideGlass = new THREE.ShapeGeometry(outline, 40); sideGlass.rotateY(Math.PI / 2);
  add(sideGlass, glass, 'Cristal_lateral', [side * 0.486, 0, 0]);
}
box('Travesano_frontal_inferior', [1.000, 0.018, 0.018], [0, 0.259, 0.279], frame, 0.0015);
box('Travesano_superior_curva', [0.999, 0.014, 0.014], [0, 0.700, -0.025], frame, 0.0015);
box('Travesano_superior_trasero', [0.999, 0.014, 0.014], [0, 0.700, -0.266], frame, 0.0015);
box('Cristal_superior', [0.968, 0.002, 0.236], [0, 0.700, -0.145], glass, 0.0005);
// Two upper rear panes and their central joint are visible through the front in the reference.
box('Cristal_posterior_izquierdo', [0.478, 0.231, 0.002], [-0.243, 0.5805, -0.266], glass, 0.0005);
box('Cristal_posterior_derecho', [0.478, 0.231, 0.002], [0.243, 0.5805, -0.266], glass, 0.0005);
box('Union_central_cristales', [0.008, 0.235, 0.010], [0, 0.5825, -0.263], frame, 0.001);
box('Carril_inferior_posterior', [0.973, 0.009, 0.012], [0, 0.4645, -0.264], shiny, 0.001);

// Observed front lettering, authored as geometry rather than baked image highlights.
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));
const letters = new TextGeometry('INOX304', { font, size: 0.028, depth: 0.0003, curveSegments: 5, bevelEnabled: false });
letters.computeBoundingBox(); const textWidth = letters.boundingBox.max.x - letters.boundingBox.min.x;
add(letters, frame, 'Rotulo_INOX304', [-textWidth / 2, 0.071, 0.2442]);

for (const { material, geometries, parts } of buckets.values()) {
  const geometry = mergeGeometries(geometries, false);
  if (!geometry) throw new Error(`Could not merge ${material.name}`);
  const mesh = new THREE.Mesh(geometry, material); mesh.name = material.name; mesh.userData.parts = parts; model.add(mesh);
}
model.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
model.userData.visualEnvelopeNormalized = size.toArray();
const bytes = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true }));
const report = inspectGlb(bytes);
if (report.errors.length || report.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(report));
const output = path.resolve('public/models/inox/vitrina-refrigerada-v1.glb');
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes);
console.log(JSON.stringify({ output, bytes: bytes.length, triangles: report.triangles, meshes: model.children.length, dimensionsVerified: false, visualEnvelopeNormalized: size.toArray(), animations: [], externalResources: false }, null, 2));
