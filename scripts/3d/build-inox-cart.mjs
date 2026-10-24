/** P15 configurable cart reconstructed from the existing catalogue photo.
 * Four visual stations retain their photographed positions. Neutral steel
 * inserts replace omitted stations; dimensions and fabrication are unverified.
 * Emits only a new P15 asset; never overwrites the original catalogue model.
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
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }).catch(e => this.onerror?.(e)); }
};
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));
const model = new THREE.Scene(); model.name = 'INOX_P15_Configurable';
const modules = [
  { id: 'broastera', node: 'Broaster', coverNode: 'BroasterCover' },
  { id: 'freidora', node: 'Fryer', coverNode: 'FryerCover' },
  { id: 'conservadora', node: 'Warmer', coverNode: 'WarmerCover' },
  { id: 'plancha', node: 'Griddle', coverNode: 'GriddleCover' },
];
model.userData = {
  productCode: 'P15', revision: 'configurable-1.0', dimensionsVerified: false,
  scale: 'NORMALIZED_VISUAL_SCALE_NOT_PHYSICAL_DIMENSIONS',
  description: 'Visualización aproximada para cotizar. No es un plano ni una receta de fabricación. Las estaciones desmarcadas se representan con una superficie de trabajo lisa.',
  reference: 'INOX304_datos_y_catalogo.pdf, página 10; public/images/products/modulo-de-comida-4-en-1.jpg',
  cart: { version: 1, productId: 'P15', modules, coverDefaultScale: 'zero-until-configured' },
};
const chassis = new THREE.Group(); chassis.name = 'CartChassis'; model.add(chassis);
const canopy = new THREE.Group(); canopy.name = 'CartCanopy'; chassis.add(canopy);
canopy.userData = { viewOnly: true, visibleByDefault: true };
const moduleBank = new THREE.Group(); moduleBank.name = 'CartModules'; model.add(moduleBank);
const coverBank = new THREE.Group(); coverBank.name = 'CartCovers'; model.add(coverBank);
const steel = new THREE.MeshStandardMaterial({ name: 'Acero_inoxidable_satinado', color: 0xbfc7cd, metalness: 0.94, roughness: 0.28 });
const bright = new THREE.MeshStandardMaterial({ name: 'Cantos_y_parrillas', color: 0xd0d7dc, metalness: 0.98, roughness: 0.18 });
const white = new THREE.MeshStandardMaterial({ name: 'Pintura_clara_referencia', color: 0xe4e8eb, metalness: 0.03, roughness: 0.40 });
const black = new THREE.MeshStandardMaterial({ name: 'Marcos_negros', color: 0x131a22, metalness: 0.15, roughness: 0.32 });
const red = new THREE.MeshStandardMaterial({ name: 'Mando_rojo', color: 0xb9191e, metalness: 0.05, roughness: 0.30 });
const green = new THREE.MeshStandardMaterial({ name: 'Mando_verde', color: 0x0d7553, metalness: 0.05, roughness: 0.30 });
const blue = new THREE.MeshStandardMaterial({ name: 'Rotulo_azul', color: 0x1744b9, metalness: 0.05, roughness: 0.38, emissive: 0x0b1e52, emissiveIntensity: 0.25 });
let parent = chassis;
function add(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(...position);
  if (parent !== model) mesh.position.sub(parent.position);
  mesh.rotation.set(...rotation); parent.add(mesh); return mesh;
}
function box(name, size, position, material = steel, r = 0.003, rotation = [0, 0, 0]) {
  return add(new RoundedBoxGeometry(...size, 2, Math.min(r, ...size.map(v => v / 2))), material, name, position, rotation);
}
function cyl(name, rt, rb, h, pos, mat = bright, rot = [0, 0, 0], seg = 24) { return add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, name, pos, rot); }
function line(name, a, b, radius = 0.0025, mat = bright) {
  const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), d = bv.clone().sub(av);
  const g = new THREE.CylinderGeometry(radius, radius, d.length(), 10); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return add(g, mat, name, av.add(bv).multiplyScalar(0.5).toArray());
}
function curve(name, points, radius, mat = bright) {
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 32, radius, 6, false), mat, name);
}
function text(value, size, pos, mat = white, rotation = [0, 0, 0]) {
  const g = new TextGeometry(value, { font, size, depth: 0.0003, curveSegments: 4, bevelEnabled: false }); g.computeBoundingBox(); g.translate(-(g.boundingBox.max.x - g.boundingBox.min.x) / 2, 0, 0); add(g, mat, `Rotulo_${value}`, pos, rotation);
}
function wheels(w, d) {
  for (const x of [-w / 2 + 0.065, w / 2 - 0.065]) for (const z of [-d / 2 + 0.07, d / 2 - 0.07]) {
    cyl('Rueda', 0.034, 0.034, 0.026, [x, 0.034, z], black, [0, 0, Math.PI / 2]); cyl('Eje_rueda', 0.009, 0.009, 0.036, [x, 0.034, z], bright, [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) box('Horquilla_rueda', [0.004, 0.041, 0.028], [x + side * 0.018, 0.055, z], bright, 0.003);
    box('Placa_rueda', [0.052, 0.009, 0.052], [x, 0.077, z], bright, 0.002);
  }
}
const yellow = new THREE.MeshStandardMaterial({ name: 'Toldo_amarillo', color: 0xffc900, metalness: 0, roughness: 0.65, side: THREE.DoubleSide });
const canvasRed = new THREE.MeshStandardMaterial({ name: 'Toldo_rojo', color: 0xdc121c, metalness: 0, roughness: 0.65, side: THREE.DoubleSide });
const handleBlue = new THREE.MeshStandardMaterial({ name: 'Mango_azul', color: 0x134bb6, metalness: 0.06, roughness: 0.28 });
function knob(x, y, z, radius, coloredRing = false) {
  cyl('Base_mando', radius * 1.12, radius * 1.12, 0.013, [x, y, z], black, [Math.PI / 2, 0, 0]);
  cyl('Aro_mando', radius, radius, 0.015, [x, y, z + 0.011], coloredRing ? red : bright, [Math.PI / 2, 0, 0]);
  cyl('Dial_mando', radius * 0.74, radius * 0.80, 0.020, [x, y, z + 0.028], coloredRing ? steel : black, [Math.PI / 2, 0, 0]);
  box('Marca_mando', [0.004, radius * 0.34, 0.002], [x, y + radius * 0.50, z + 0.040], white, 0.0006);
}
function horizontalHandle(name, x, y, z, w, mat = bright) {
  curve(name, [[x - w / 2, y, z], [x - w / 2 + 0.012, y, z + 0.025], [x + w / 2 - 0.012, y, z + 0.025], [x + w / 2, y, z]], 0.005, mat);
}
function well(name, w, d, depth, x, y, z) {
  // Open shallow liner, not a filled black box. The lower interior is deliberately plain.
  box(`${name}_fondo`, [w, 0.006, d], [x, y - depth, z], steel, 0.002);
  for (const s of [-1, 1]) {
    box(`${name}_lateral`, [0.006, depth, d], [x + s * (w / 2 - 0.003), y - depth / 2, z], steel, 0.002);
    box(`${name}_frente`, [w, depth, 0.006], [x, y - depth / 2, z + s * (d / 2 - 0.003)], steel, 0.002);
    box(`${name}_borde`, [0.014, 0.010, d + 0.018], [x + s * (w / 2 + 0.003), y, z], bright, 0.002);
    box(`${name}_borde`, [w + 0.025, 0.010, 0.014], [x, y, z + s * (d / 2 + 0.003)], bright, 0.002);
  }
}
function basket(name, w, d, h, x, y, z, gripMat = handleBlue) {
  const bottomW = w * 0.88, bottomD = d * 0.88;
  const bottomY = y, topY = y + h;
  const pitch = 0.014, wire = 0.0009;
  for (const s of [-1, 1]) {
    line(`${name}_aro_superior`, [x - w / 2, topY, z + s * d / 2], [x + w / 2, topY, z + s * d / 2], 0.0023);
    line(`${name}_aro_superior`, [x + s * w / 2, topY, z - d / 2], [x + s * w / 2, topY, z + d / 2], 0.0023);
    line(`${name}_aro_inferior`, [x - bottomW / 2, bottomY, z + s * bottomD / 2], [x + bottomW / 2, bottomY, z + s * bottomD / 2], 0.0020);
    line(`${name}_aro_inferior`, [x + s * bottomW / 2, bottomY, z - bottomD / 2], [x + s * bottomW / 2, bottomY, z + bottomD / 2], 0.0020);
  }
  for (let u = -0.5; u <= 0.5001; u += 1 / Math.ceil(w / pitch)) {
    for (const s of [-1, 1]) line(`${name}_malla_vertical`, [x + u * bottomW, bottomY, z + s * bottomD / 2], [x + u * w, topY, z + s * d / 2], wire);
    line(`${name}_rejilla_fondo`, [x + u * bottomW, bottomY, z - bottomD / 2], [x + u * bottomW, bottomY, z + bottomD / 2], wire);
  }
  for (let u = -0.5; u <= 0.5001; u += 1 / Math.ceil(d / pitch)) {
    for (const s of [-1, 1]) line(`${name}_malla_lateral`, [x + s * bottomW / 2, bottomY, z + u * bottomD], [x + s * w / 2, topY, z + u * d], wire);
    line(`${name}_rejilla_fondo`, [x - bottomW / 2, bottomY, z + u * bottomD], [x + bottomW / 2, bottomY, z + u * bottomD], wire);
  }
  for (let dy = pitch; dy < h - pitch / 2; dy += pitch) {
    const t = dy / h, ww = bottomW + (w - bottomW) * t, dd = bottomD + (d - bottomD) * t;
    for (const s of [-1, 1]) {
      line(`${name}_malla_horizontal`, [x - ww / 2, y + dy, z + s * dd / 2], [x + ww / 2, y + dy, z + s * dd / 2], wire);
      line(`${name}_malla_horizontal`, [x + s * ww / 2, y + dy, z - dd / 2], [x + s * ww / 2, y + dy, z + dd / 2], wire);
    }
  }
  // Two rods rise from the front and carry the blue insulated grip visible in the photographs.
  for (const s of [-1, 1]) curve(`${name}_soporte_mango`, [[x + s * 0.019, y + 0.018, z + bottomD / 2], [x + s * 0.019, topY, z + d / 2], [x + s * 0.019, topY + 0.125, z + d / 2 + 0.025], [x + s * 0.019, topY + 0.135, z + d / 2 + 0.140]], 0.0027);
  box(`${name}_mango`, [0.050, 0.019, 0.130], [x, topY + 0.135, z + d / 2 + 0.100], gripMat, 0.008);
}
function canopyStrip(x0, x1, material) {
  // Arched red/yellow awning with rounded hanging front edge, no texture approximation.
  const verts = [], indexes = [], n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n, z = -0.285 + t * 0.620, y = 1.690 + Math.sin(Math.PI * t) * 0.155;
    verts.push(x0, y, z, x1, y, z);
    if (i < n) { const k = i * 2; indexes.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(indexes); g.computeVertexNormals(); add(g, material, 'Lona_rayada_toldo');
  const sh = new THREE.Shape(); sh.moveTo(x0, 1.692); sh.lineTo(x1, 1.692); sh.lineTo(x1, 1.555); sh.quadraticCurveTo((x0 + x1) / 2, 1.505, x0, 1.555); sh.closePath();
  add(new THREE.ShapeGeometry(sh), material, 'Faldon_redondeado_toldo', [0, 0, 0.335]);
  const rear = new THREE.Shape(); rear.moveTo(x0, 1.692); rear.lineTo(x1, 1.692); rear.lineTo(x1, 1.575); rear.quadraticCurveTo((x0 + x1) / 2, 1.525, x0, 1.575); rear.closePath();
  add(new THREE.ShapeGeometry(rear), material, 'Faldon_trasero_toldo', [0, 0, -0.285]);
}

function station(name, build) {
  const group = new THREE.Group(); group.name = name;
  group.userData = { selectableStation: true, dimensionsVerified: false };
  moduleBank.add(group); parent = group; build(); parent = chassis;
}
function cover(name, x, width, depth = .454) {
  const group = new THREE.Group(); group.name = name;
  group.userData = { neutralWorktop: true, restScale: [1, 1, 1], dimensionsVerified: false };
  coverBank.add(group); parent = group;
  box('Superficie_lisa_sustituta', [width, .015, depth], [x, .785, .005], bright, .003);
  parent = chassis;
  // glTF has no core visibility flag: zero scale preserves a clean 4-in-1
  // default view while keeping the insert geometry available to the runtime.
  group.scale.setScalar(0);
}
const W = 1.18, D = 0.55, top = 0.76;
wheels(W, D);
box('Gabinete_modulo', [W, 0.585, D], [0, 0.3775, 0], steel, 0.003);
// Separate deck pieces leave the photographed fryer well genuinely open.
box('Encimera_izquierda', [0.365, 0.034, 0.575], [-0.425, top, 0], bright, 0.004);
box('Encimera_derecha', [0.640, 0.034, 0.575], [0.2875, top, 0], bright, 0.004);
for (const z of [-0.238, 0.258]) box('Encimera_borde_poza', [0.210, 0.034, 0.060], [-0.138, top, z], bright, 0.003);
box('Respaldo_encimera', [W, 0.104, 0.014], [0, top + 0.068, -D / 2 + 0.008], steel, 0.002);
const doorYs = 0.378;
for (const [x, w] of [[-0.425, 0.300], [-0.115, 0.292], [0.455, 0.245]]) {
  box('Puerta_almacenamiento', [w, 0.497, 0.013], [x, doorYs, D / 2 + 0.011], steel, 0.003);
  horizontalHandle('Tirador_modulo', x + w * 0.27, 0.598, D / 2 + 0.018, 0.075);
}
box('Panel_mandos_modulo', [0.205, 0.485, 0.010], [0.200, doorYs, D / 2 + 0.013], steel, 0.002);
for (const x of [0.157, 0.244]) for (const y of [0.244, 0.324, 0.404, 0.484]) {
  box('Placa_mando_azul', [0.078, 0.070, 0.003], [x, y, D / 2 + 0.022], blue, 0.001); knob(x, y, D / 2 + 0.026, 0.026);
}
box('Frente_encimera', [W, 0.071, 0.009], [0, top - 0.040, D / 2 + 0.018], steel, 0.001);
box('Placa_INOX_modulo', [0.095, 0.030, 0.003], [-0.505, top - 0.035, D / 2 + 0.024], blue, 0.001); text('INOX304', 0.013, [-0.505, top - 0.040, D / 2 + 0.027], white);
// Observed work areas: pressure-vessel lid, fryer well, covered pans and griddle.
station('Broaster', () => {
cyl('Tapa_broastera', 0.121, 0.124, 0.016, [-0.415, top + 0.030, 0.008], bright, [0, 0, 0], 64);
box('Puente_cierre_broastera', [0.022, 0.020, 0.280], [-0.415, top + 0.059, -0.020], steel, 0.002);
cyl('Centro_cierre', 0.013, 0.013, 0.030, [-0.415, top + 0.082, -0.020], bright);
horizontalHandle('Maneral_broastera', -0.415, top + 0.098, -0.074, 0.107, bright);
});
station('Fryer', () => {
well('Poza_freidora_modulo', 0.180, 0.355, 0.085, -0.138, top + 0.020, 0.020);
basket('Canastilla_modulo', 0.150, 0.270, 0.130, -0.138, top - 0.015, -0.008, green);
});
station('Warmer', () => {
for (const z of [-0.108, 0.105]) { box('Tapa_conservadora', [0.210, 0.007, 0.198], [0.113, top + 0.026, z], bright, 0.004); horizontalHandle('Asa_tapa_conservadora', 0.113, top + 0.031, z, 0.075); }
});
station('Griddle', () => {
box('Plancha_lisa', [0.320, 0.014, 0.454], [0.411, top + 0.027, 0], steel, 0.004);
box('Reborde_plancha', [0.015, 0.037, 0.454], [0.566, top + 0.046, 0], steel, 0.001);
});
for (const x of [-0.610, 0.610]) for (const z of [-0.270, 0.270]) line('Poste_toldo', [x, top - 0.02, z], [x, 1.710, z], 0.009, bright);
curve('Barra_empuje_derecha', [[0.602, top + 0.030, -0.15], [0.696, top + 0.030, -0.12], [0.696, top + 0.030, 0.19], [0.602, top + 0.030, 0.22]], 0.009, bright);
const n = 11, width = 1.34;
parent = canopy;
for (let i = 0; i < n; i++) canopyStrip(-width / 2 + i * width / n, -width / 2 + (i + 1) * width / n, i % 2 ? canvasRed : yellow);
for (const z of [-0.270, 0.270]) line('Travesano_toldo', [-0.620, 1.693, z], [0.620, 1.693, z], 0.007, bright);
parent = chassis;
cover('BroasterCover', -.415, .270);
cover('FryerCover', -.138, .207, .448);
cover('WarmerCover', .113, .210);
cover('GriddleCover', .411, .320);

// Merge only rigid children of the same station; preserve all toggle boundaries.
for (const container of [chassis, canopy, ...moduleBank.children, ...coverBank.children]) {
  const buckets = new Map(), meshes = container.children.filter(object => object.isMesh);
  for (const object of meshes) {
    object.updateMatrix();
    const geometry = object.geometry.clone().applyMatrix4(object.matrix);
    const geo = geometry.index ? geometry.toNonIndexed() : geometry; geo.deleteAttribute('uv');
    if (!buckets.has(object.material.uuid)) buckets.set(object.material.uuid, { material: object.material, geometries: [], parts: [] });
    buckets.get(object.material.uuid).geometries.push(geo); buckets.get(object.material.uuid).parts.push(object.name);
  }
  for (const mesh of meshes) container.remove(mesh);
  for (const { material, geometries, parts } of buckets.values()) {
    const geometry = mergeGeometries(geometries, false); if (!geometry) throw new Error('Could not merge P15');
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${container.name}_${material.name}`; mesh.userData.parts = parts; container.add(mesh);
  }
}
model.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
model.userData.visualEnvelopeApproximate = size.toArray();
const bytes = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: false, trs: true }));
const report = inspectGlb(bytes);
if (report.errors.length || report.warnings.length || bytes.length > 5 * 1024 * 1024) throw new Error(JSON.stringify(report));
const output = path.resolve('public/models/inox/modulo-de-comida-4-en-1-configurable-v1.glb');
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes);
console.log(JSON.stringify({ code: 'P15', output, bytes: bytes.length, triangles: report.triangles, dimensionsVerified: false, visualEnvelopeApproximate: size.toArray(), modules }, null, 2));
