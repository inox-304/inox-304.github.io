/** ILUMI OJM-01AI. Photo-based approximate visual reconstruction, not manufacturer CAD.
 * Nominal envelope 470 x 490 x 880 mm from the official mechanical drawing.
 * Packaging dimensions in the sheet are NOT used. See docs/modelos-3d/ilumi-ojm-01ai.md.
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
const model = new THREE.Group(); model.name = 'ILUMI_OJM_01AI';
model.userData = {
  sku: 'OJM-01AI', units: 'meters', revision: '1.0',
  nominalDimensions: { width: 0.470, depth: 0.490, height: 0.880 },
  description: 'Reconstrucción visual aproximada de fotografías y plano exterior ILUMI. No es CAD de fabricación ni simulación de funcionamiento. Canastillo vacío; componentes visibles simplificados.',
  source: 'https://ilumiperu.com/products/extractor-de-naranjas',
};
  const steel = new THREE.MeshStandardMaterial({ name: 'Acero_inoxidable_satinado', color: 0xbfc7cd, metalness: 0.94, roughness: 0.28 });
  const bright = new THREE.MeshStandardMaterial({ name: 'Cantos_y_parrillas', color: 0xd0d7dc, metalness: 0.98, roughness: 0.18 });
  const white = new THREE.MeshStandardMaterial({ name: 'Acabado_claro', color: 0xe4e8eb, metalness: 0.25, roughness: 0.30 });
  const black = new THREE.MeshStandardMaterial({ name: 'Marcos_negros', color: 0x131a22, metalness: 0.15, roughness: 0.32 });
  const charcoal = new THREE.MeshStandardMaterial({ name: 'Carcasa_grafito', color: 0x333b43, metalness: 0.40, roughness: 0.36 });
  const seal = new THREE.MeshStandardMaterial({ name: 'Juntas_y_rodadura', color: 0x151b20, metalness: 0, roughness: 0.75 });
  const red = new THREE.MeshStandardMaterial({ name: 'Mando_rojo', color: 0xb9191e, metalness: 0.05, roughness: 0.30 });
  const green = new THREE.MeshStandardMaterial({ name: 'Mando_verde', color: 0x0d7553, metalness: 0.05, roughness: 0.30 });
  const blue = new THREE.MeshStandardMaterial({ name: 'Rotulo_azul', color: 0x1744b9, metalness: 0.05, roughness: 0.38, emissive: 0x0b1e52, emissiveIntensity: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ name: 'Cristales_laterales', color: 0xe4eff7, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.09, depthWrite: false, clearcoat: 0.65, clearcoatRoughness: 0.10, side: THREE.DoubleSide });
  let parent = model;
  function add(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(...position); mesh.rotation.set(...rotation); parent.add(mesh); return mesh;
  }
  function box(name, size, position, material = steel, r = 0.003, rotation = [0, 0, 0]) {
    return add(new RoundedBoxGeometry(...size, 2, Math.min(r, ...size.map(v => v / 2))), material, name, position, rotation);
  }
  function cyl(name, rt, rb, h, pos, mat = bright, rot = [0, 0, 0], seg = 24) { return add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, name, pos, rot); }
  function torus(name, radius, tube, pos, mat = bright, rot = [Math.PI / 2, 0, 0]) { return add(new THREE.TorusGeometry(radius, tube, 6, 48), mat, name, pos, rot); }
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
  function rr(w, h, r, x = 0, y = 0) {
    const p = new THREE.Shape(); x -= w / 2; y -= h / 2;
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r); p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h); p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r); p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); return p;
  }
  function perforated(name, w, h, holes, pos, mat = steel, rotation = [0, 0, 0]) {
    const p = rr(w, h, 0.003);
    for (const [x, y, sw, sh] of holes) p.holes.push(rr(sw, sh, Math.min(sw, sh) / 2, x, y));
    add(new THREE.ExtrudeGeometry(p, { depth: 0.002, bevelEnabled: false, curveSegments: 3 }), mat, name, pos, rotation);
  }
  function shelf(name, w, d, x, y, z, mat = bright) {
    for (const xx of [-w / 2, w / 2]) line(`${name}_marco`, [x + xx, y, z - d / 2], [x + xx, y, z + d / 2], 0.003, mat);
    for (const zz of [-d / 2, d / 2]) line(`${name}_marco`, [x - w / 2, y, z + zz], [x + w / 2, y, z + zz], 0.003, mat);
    const count = Math.ceil(w / 0.018);
    for (let i = 0; i <= count; i++) { const xx = x - w / 2 + w * i / count; line(`${name}_varilla`, [xx, y, z - d / 2], [xx, y, z + d / 2], 0.0015, mat); }
    for (let i = 0; i < 4; i++) { const zz = z - d / 2 + d * (i + 0.5) / 4; line(`${name}_travesano`, [x - w / 2, y, zz], [x + w / 2, y, zz], 0.0014, mat); }
  }
  function feet(w, d, h = 0.10) {
    for (const x of [-w / 2 + 0.055, w / 2 - 0.055]) for (const z of [-d / 2 + 0.055, d / 2 - 0.055]) {
      cyl('Pata_metalica', 0.020, 0.018, h - 0.01, [x, h / 2 + 0.005, z]); cyl('Apoyo_goma', 0.019, 0.021, 0.010, [x, 0.005, z], seal);
    }
  }
  function wheels(w, d) {
    for (const x of [-w / 2 + 0.065, w / 2 - 0.065]) for (const z of [-d / 2 + 0.07, d / 2 - 0.07]) {
      cyl('Rueda', 0.034, 0.034, 0.026, [x, 0.034, z], white, [0, 0, Math.PI / 2]); cyl('Eje_rueda', 0.009, 0.009, 0.036, [x, 0.034, z], bright, [0, 0, Math.PI / 2]);
      for (const side of [-1, 1]) box('Horquilla_rueda', [0.004, 0.041, 0.028], [x + side * 0.018, 0.055, z], bright, 0.003);
      box('Placa_rueda', [0.052, 0.009, 0.052], [x, 0.077, z], bright, 0.002);
    }
  }
  function display(x, y, z, controls = false) {
    box('Marco_control', [0.100, 0.048, 0.008], [x, y, z], black, 0.004); box('Pantalla_control', [0.058, 0.030, 0.002], [x - 0.012, y, z + 0.005], charcoal, 0.002);
    text('--', 0.014, [x - 0.012, y - 0.005, z + 0.006], red);
    if (controls) { box('Interruptor_verde', [0.017, 0.025, 0.005], [x + 0.041, y, z + 0.004], green, 0.001); }
  }
  function door(name, hingeX, centerY, z, w, h, side, openAngle, mat = steel) {
    const group = new THREE.Group(); group.name = name; group.position.set(hingeX, centerY, z); group.rotation.y = openAngle; model.add(group); parent = group;
    const cx = side * w / 2;
    box('Hoja_puerta', [w, h, 0.033], [cx, 0, 0], mat, 0.004);
    box('Junta_perimetral', [w - 0.014, h - 0.018, 0.006], [cx, 0, -0.020], seal, 0.003);
    box('Revestimiento_interior', [w - 0.032, h - 0.040, 0.006], [cx, 0, -0.024], mat, 0.003);
    const hx = side * (w - 0.022);
    curve('Tirador_vertical', [[hx, -0.085, 0.025], [hx, -0.058, 0.048], [hx, 0.058, 0.048], [hx, 0.085, 0.025]], 0.006, bright);
    for (const y of [-h * 0.36, h * 0.36]) cyl('Bisagra_visible', 0.009, 0.009, 0.056, [0, y, 0.002], bright);
    parent = model;
  }

const orange = new THREE.MeshPhysicalMaterial({ name: 'Piezas_moldeadas_naranjas', color: 0xf58b12, metalness: 0.02, roughness: 0.27, clearcoat: 0.45, clearcoatRoughness: 0.22 });
const orangeDark = new THREE.MeshStandardMaterial({ name: 'Juntas_piezas_naranjas', color: 0xd86d0e, metalness: 0.03, roughness: 0.34 });
const acrylicEdge = new THREE.MeshPhysicalMaterial({ name: 'Cantos_protector_transparente', color: 0xd5e8f1, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.27, depthWrite: false, clearcoat: 0.60 });

// Steel cabinet: two side plinths, rear body and a real glass clearance underneath.
const W = 0.470, D = 0.490, H = 0.880;
for (const x of [-0.182, 0.182]) for (const z of [-0.185, 0.185]) cyl('Pata_caucho', 0.016, 0.018, 0.020, [x, 0.010, z], seal);
box('Base_trasera', [0.430, 0.238, 0.178], [0, 0.139, -0.136], steel, 0.008);
for (const x of [-0.158, 0.158]) box('Pedestal_lateral', [0.114, 0.238, 0.448], [x, 0.139, 0], steel, 0.009);
box('Techo_hueco_vaso', [0.430, 0.022, 0.448], [0, 0.267, 0], bright, 0.003);
box('Fondo_hueco_vaso', [0.194, 0.205, 0.008], [0, 0.135, -0.042], bright, 0.002);
box('Bandeja_inferior_vaso', [0.185, 0.016, 0.236], [0, 0.044, 0.102], bright, 0.003);
const drainSlots = []; for (let row = 0; row < 8; row++) for (let col = 0; col < 2; col++) drainSlots.push([(col ? 1 : -1) * 0.044, -0.091 + row * 0.026, 0.070, 0.009]);
perforated('Rejilla_vaso', 0.180, 0.230, drainSlots, [0, 0.055, 0.102], steel, [-Math.PI / 2, 0, 0]);
box('Fondo_bandeja_goteo', [0.178, 0.007, 0.228], [0, 0.050, 0.102], charcoal, 0.002);
box('Lomo_trasero_motor', [0.430, 0.452, 0.130], [0, 0.487, -0.159], steel, 0.006);
for (const x of [-0.207, 0.207]) box('Lateral_carcasa', [0.016, 0.458, 0.320], [x, 0.486, -0.060], steel, 0.003);
box('Panel_inox_tras_mecanismo', [0.396, 0.405, 0.008], [0, 0.485, -0.088], bright, 0.002);
box('Cubierta_superior_carcasa', [0.430, 0.012, 0.355], [0, 0.720, -0.047], steel, 0.003);

// Four visible orange rotor faces, with molded profiles. Static visual parts only.
function rotor(name, x, y, radius, depth, phase, lower = false) {
  cyl(`${name}_cuerpo`, radius * 0.82, radius * 0.82, depth, [x, y, 0.007], orangeDark, [Math.PI / 2, 0, 0], 48);
  cyl(`${name}_disco`, radius, radius * 0.94, 0.018, [x, y, 0.080], orange, [Math.PI / 2, 0, 0], 64);
  cyl(`${name}_frente_biselado`, radius * 0.88, radius * 0.96, 0.012, [x, y, 0.094], orange, [Math.PI / 2, 0, 0], 64);
  cyl(`${name}_cubo_central`, radius * 0.23, radius * 0.29, 0.012, [x, y, 0.104], orangeDark, [Math.PI / 2, 0, 0], 32);
  cyl(`${name}_tuerca_plastica`, radius * 0.19, radius * 0.19, 0.010, [x, y, 0.115], orange, [Math.PI / 2, 0, 0], 32);
  box(`${name}_ranura_tuerca`, [radius * 0.34, 0.005, 0.003], [x, y, 0.122], orangeDark, 0.001, [0, 0, phase]);
  // Rear rounded pressing lobes visible around the silhouette, not fruit.
  for (let i = 0; i < 3; i++) {
    const a = phase + i * Math.PI * 2 / 3, rr = radius * (lower ? 0.88 : 0.76);
    const g = new THREE.SphereGeometry(radius * (lower ? 0.61 : 0.50), 24, 16, 0, Math.PI * 2, 0, Math.PI); g.scale(1, 1, 0.78);
    add(g, orange, `${name}_lobulo_moldeado`, [x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.010]);
  }
}
rotor('Rotor_superior_izquierdo', -0.090, 0.613, 0.082, 0.118, 0.40);
rotor('Rotor_superior_derecho', 0.090, 0.613, 0.082, 0.118, -0.35);
rotor('Rotor_inferior_izquierdo', -0.102, 0.455, 0.054, 0.103, -0.68, true);
rotor('Rotor_inferior_derecho', 0.102, 0.455, 0.054, 0.103, -2.46, true);
// Lower orange cups and central guide are visible in both official views.
for (const x of [-0.118, 0.118]) {
  const bowl = new THREE.LatheGeometry([new THREE.Vector2(0.010, 0), new THREE.Vector2(0.032, 0.006), new THREE.Vector2(0.048, 0.025), new THREE.Vector2(0.050, 0.056), new THREE.Vector2(0.044, 0.056), new THREE.Vector2(0.041, 0.030), new THREE.Vector2(0.027, 0.013), new THREE.Vector2(0.010, 0.006)], 48);
  add(bowl, orange, 'Copa_inferior_moldeada', [x, 0.323, 0.042], [0.15, 0, Math.sign(x) * 0.15]);
  curve('Guia_inferior_inox', [[x + Math.sign(x) * 0.033, 0.300, 0.135], [x, 0.312, 0.151], [x - Math.sign(x) * 0.030, 0.330, 0.142]], 0.003, bright);
}
box('Guia_central_naranja', [0.047, 0.092, 0.048], [0, 0.490, 0.067], orange, 0.003);
for (let i = 0; i < 5; i++) box('Estria_guia_central', [0.043, 0.002, 0.004], [0, 0.451 + i * 0.005, 0.093], orangeDark, 0.0005);

// Clear protective acrylic front and sides: alpha avoids the opaque/milky transmission issue.
add(new THREE.PlaneGeometry(0.421, 0.423), glass, 'Protector_frontal_acrilico', [0, 0.503, 0.232]);
for (const x of [-0.215, 0.215]) {
  add(new THREE.PlaneGeometry(0.323, 0.423), glass, 'Protector_lateral_acrilico', [x, 0.503, 0.070], [0, Math.PI / 2, 0]);
  box('Canto_vertical_protector', [0.005, 0.430, 0.005], [x, 0.503, 0.232], acrylicEdge, 0.001);
  box('Canto_trasero_protector', [0.004, 0.424, 0.004], [x, 0.503, -0.091], acrylicEdge, 0.001);
}
for (const y of [0.2915, 0.7145]) {
  box('Canto_horizontal_protector', [0.430, 0.005, 0.005], [0, y, 0.232], acrylicEdge, 0.001);
  for (const x of [-0.215, 0.215]) box('Canto_superior_lateral', [0.005, 0.005, 0.323], [x, y, 0.070], acrylicEdge, 0.001);
}
for (const x of [-0.218, 0.218]) curve('Arco_alambre_protector', [[x, 0.292, 0.223], [x, 0.346, 0.246], [x, 0.421, 0.230], [x, 0.381, 0.198]], 0.0027, bright);
line('Barra_protectora_inferior', [-0.231, 0.310, 0.235], [0.231, 0.310, 0.235], 0.003);
box('Cajon_extraible_frente', [0.347, 0.027, 0.055], [0, 0.281, 0.208], steel, 0.004);
curve('Tirador_cajon', [[-0.060, 0.280, 0.236], [-0.051, 0.280, 0.244], [0.051, 0.280, 0.244], [0.060, 0.280, 0.236]], 0.003, bright);

// Empty fruit basket and sloping wire feeding chute. No oranges or juice are added.
const basketY = 0.754, basketTop = 0.878, bw = 0.394, bd = 0.285, bz = -0.035;
for (const y of [basketY, basketY + 0.061, basketTop]) {
  curve('Aro_canastillo', [[-bw / 2 + 0.012, y, bz + bd / 2], [-bw / 2, y, bz + bd / 2 - 0.012], [-bw / 2, y, bz - bd / 2 + 0.012], [-bw / 2 + 0.012, y, bz - bd / 2], [bw / 2 - 0.012, y, bz - bd / 2], [bw / 2, y, bz - bd / 2 + 0.012], [bw / 2, y, bz + bd / 2 - 0.012], [bw / 2 - 0.012, y, bz + bd / 2], [-bw / 2 + 0.012, y, bz + bd / 2]], 0.0021, bright);
}
for (let i = 0; i <= 8; i++) {
  const x = -bw / 2 + i * bw / 8;
  for (const z of [bz - bd / 2, bz + bd / 2]) line('Varilla_vertical_canastillo', [x, basketY, z], [x, basketTop, z], 0.0016);
  line('Fondo_canastillo', [x, basketY, bz - bd / 2], [x, basketY, bz + bd / 2], 0.0016);
}
for (let i = 0; i <= 6; i++) {
  const z = bz - bd / 2 + i * bd / 6;
  for (const x of [-bw / 2, bw / 2]) line('Varilla_vertical_canastillo', [x, basketY, z], [x, basketTop, z], 0.0016);
  line('Fondo_canastillo_cruzado', [-bw / 2, basketY, z], [bw / 2, basketY, z], 0.0016);
}
// Visible rail passes diagonally across the front of the basket into the upper chamber.
for (const side of [-1, 1]) {
  curve('Carril_alimentacion', [[-0.223, 0.822 + side * 0.017, 0.133], [-0.185, 0.812 + side * 0.017, 0.158], [0.190, 0.770 + side * 0.017, 0.158], [0.162, 0.712 + side * 0.015, 0.139], [0.119, 0.676 + side * 0.010, 0.124]], 0.0025, bright);
}
for (let i = 0; i < 8; i++) {
  const x = -0.180 + i * 0.048, y = 0.810 - (x + 0.180) / 0.370 * 0.041;
  line('Puente_guia_alimentacion', [x, y - 0.017, 0.158], [x, y + 0.017, 0.158], 0.0017);
}
box('Placa_ilumi', [0.073, 0.025, 0.002], [0.160, 0.239, 0.225], black, 0.001); text('ilumi', 0.019, [0.160, 0.232, 0.227], white);

model.updateMatrixWorld(true);
const originalBounds = new THREE.Box3().setFromObject(model), rawSize = originalBounds.getSize(new THREE.Vector3()), center = originalBounds.getCenter(new THREE.Vector3());
// Align the known external envelope; secondary forms remain photographic estimates.
const fit = new THREE.Matrix4().makeScale(W / rawSize.x, H / rawSize.y, D / rawSize.z);
fit.multiply(new THREE.Matrix4().makeTranslation(-center.x, -originalBounds.min.y, -center.z));
const buckets = new Map();
model.traverse(object => {
  if (!object.isMesh) return;
  const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(fit);
  const geo = geometry.index ? geometry.toNonIndexed() : geometry; geo.deleteAttribute('uv');
  if (!buckets.has(object.material.uuid)) buckets.set(object.material.uuid, { material: object.material, geometries: [], parts: [] });
  buckets.get(object.material.uuid).geometries.push(geo); buckets.get(object.material.uuid).parts.push(object.name);
});
model.clear();
for (const { material, geometries, parts } of buckets.values()) {
  const geometry = mergeGeometries(geometries, false); if (!geometry) throw new Error('Could not merge OJM');
  const mesh = new THREE.Mesh(geometry, material); mesh.name = material.name; mesh.userData.parts = parts; model.add(mesh);
}
model.updateMatrixWorld(true);
const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
for (const [actual, target] of [[size.x, W], [size.y, H], [size.z, D]]) if (Math.abs(actual - target) > 0.00001) throw new Error('Invalid OJM dimensions');
const bytes = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true }));
const report = inspectGlb(bytes); if (report.errors.length || report.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(report));
const output = path.resolve('public/models/ilumi/ojm-01ai-v1.glb'); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes);
console.log(JSON.stringify({ output, bytes: bytes.length, triangles: report.triangles, meshes: model.children.length, dimensions: { width: size.x, depth: size.z, height: size.y }, originalEnvelope: rawSize.toArray(), animations: [] }, null, 2));

