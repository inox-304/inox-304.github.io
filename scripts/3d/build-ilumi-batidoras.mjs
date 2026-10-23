/** ILUMI B-10L / B-20L / B-30L. Photo-based visual reconstructions, not manufacturer CAD.
 * Sources and approximation limits: docs/modelos-3d/ilumi-batidoras.md.
 * Rebuild: node scripts/3d/build-ilumi-batidoras.mjs
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
    blob.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }).catch(e => this.onerror?.(e));
  }
};
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));
const specs = [
  { sku: 'B-10L', liters: 10, width: 0.44, depth: 0.34, height: 0.65, bowlDiameter: 0.27, bowlDepth: 0.25 },
  { sku: 'B-20L', liters: 20, width: 0.54, depth: 0.43, height: 0.77, bowlDiameter: 0.34, bowlDepth: 0.29 },
  { sku: 'B-30L', liters: 30, width: 0.57, depth: 0.45, height: 0.78, bowlDiameter: 0.36, bowlDepth: 0.34 },
];

for (const spec of specs) {
  const { sku, liters, width: W, depth: D, height: H, bowlDiameter, bowlDepth } = spec;
  const s = H / 0.65, R = bowlDiameter / 2, bowlZ = D / 2 - R - 0.005;
  const bowlBottom = 0.065 * s, bowlRim = bowlBottom + bowlDepth;
  const headHeight = 0.15 * s, headBottom = H - headHeight;
  const neckBottom = headBottom - 0.065 * s;
  const baseHalf = R + 0.035 * s;
  const model = new THREE.Group();
  model.name = `ILUMI_${sku.replace('-', '')}`;
  model.userData = { units: 'meters', revision: '1.0', nominalDimensions: { width: W, depth: D, height: H }, bowlLiters: liters, bowlDiameter, bowlDepth, description: 'Reconstrucción visual aproximada basada en fotografía y ficha ILUMI. No es CAD de fabricación. Modelo estático, sin simulación de funcionamiento.' };
  const paint = new THREE.MeshPhysicalMaterial({ name: 'Hierro_pintado_blanco', color: 0xe9edef, roughness: 0.26, metalness: 0.08, clearcoat: 0.35, clearcoatRoughness: 0.21 });
  const steel = new THREE.MeshStandardMaterial({ name: 'Inox_satinado_bowl', color: 0xbdc5cc, roughness: 0.24, metalness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ name: 'Inox_rejilla_y_herramienta', color: 0xd2d8dd, roughness: 0.16, metalness: 0.98 });
  const black = new THREE.MeshStandardMaterial({ name: 'Volante_y_mando_negro', color: 0x0d1218, roughness: 0.25, metalness: 0.12 });
  const rubber = new THREE.MeshStandardMaterial({ name: 'Apoyos_goma', color: 0x15191d, roughness: 0.85, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ name: 'Detalles_oscuros', color: 0x343b43, roughness: 0.4, metalness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ name: 'Interruptor_rojo', color: 0xb51b23, roughness: 0.24, metalness: 0.05 });
  const white = new THREE.MeshStandardMaterial({ name: 'Rotulos_claros', color: 0xf8fafb, roughness: 0.6, metalness: 0 });
  const buckets = new Map();

  function add(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const transform = new THREE.Object3D(); transform.position.set(...position); transform.rotation.set(...rotation); transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    geo.deleteAttribute('uv');
    if (!buckets.has(material.uuid)) buckets.set(material.uuid, { material, geometries: [], names: [] });
    buckets.get(material.uuid).geometries.push(geo); buckets.get(material.uuid).names.push(name);
  }
  function box(name, size, position, material = paint, radius = 0.004 * s, rotation = [0, 0, 0]) {
    add(new RoundedBoxGeometry(...size, 3, Math.min(radius, ...size.map(v => v / 2))), material, name, position, rotation);
  }
  function cylinder(name, rt, rb, height, position, material = chrome, rotation = [0, 0, 0], segments = 40) {
    add(new THREE.CylinderGeometry(rt, rb, height, segments), material, name, position, rotation);
  }
  function torus(name, radius, tube, position, material = chrome, rotation = [Math.PI / 2, 0, 0]) {
    add(new THREE.TorusGeometry(radius, tube, 8, 64), material, name, position, rotation);
  }
  function tube(name, coordinates, radius, material = chrome, segments = 28, closed = false) {
    const curve = new THREE.CatmullRomCurve3(coordinates.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
    add(new THREE.TubeGeometry(curve, segments, radius, 6, closed), material, name);
  }
  function rod(name, a, b, radius, material = chrome) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), delta = bv.clone().sub(av);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 16);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    add(geometry, material, name, av.add(bv).multiplyScalar(0.5).toArray());
  }

  // Cast U-shaped base. Side rails leave a clear opening under the bowl.
  const railWidth = 0.046 * s;
  for (const side of [-1, 1]) {
    const rail = new THREE.Shape();
    rail.moveTo(-D / 2, 0.005 * s); rail.lineTo(-D / 2, 0.075 * s);
    rail.lineTo(-D / 2 + 0.055 * s, 0.108 * s); rail.lineTo(D / 2 - 0.035 * s, 0.080 * s);
    rail.lineTo(D / 2, 0.015 * s); rail.lineTo(D / 2, 0.005 * s); rail.closePath();
    const geo = new THREE.ExtrudeGeometry(rail, { depth: railWidth, bevelEnabled: false, curveSegments: 4 });
    geo.translate(0, 0, -railWidth / 2); geo.rotateY(Math.PI / 2);
    add(geo, paint, 'Pata_lateral_fundida', [side * (baseHalf - railWidth / 2), 0, 0]);
    for (const z of [-D / 2 + 0.018 * s, D / 2 - 0.018 * s]) box('Apoyo_antideslizante', [railWidth * 0.82, 0.005 * s, 0.026 * s], [side * (baseHalf - railWidth / 2), 0.0025 * s, z], rubber, 0.001 * s);
  }
  box('Puente_trasero_base', [baseHalf * 2 - 0.02 * s, 0.075 * s, 0.095 * s], [0, 0.065 * s, -D / 2 + 0.055 * s], paint, 0.014 * s);
  box('Columna_posterior', [0.112 * s, headBottom - 0.065 * s, 0.087 * s], [0, (headBottom + 0.095 * s) / 2, -D / 2 + 0.068 * s], paint, 0.018 * s);
  box('Nervadura_columna', [0.15 * s, 0.035 * s, 0.11 * s], [0, 0.125 * s, -D / 2 + 0.066 * s], paint, 0.009 * s);
  box('Soporte_bowl', [R * 1.9, 0.027 * s, 0.075 * s], [0, bowlBottom + bowlDepth * 0.35, bowlZ - R * 0.7], paint, 0.008 * s);

  // Empty, genuinely hollow bowl with rounded lower body and rolled rim.
  const outer = [[0, 0], [R * 0.30, 0.002], [R * 0.57, bowlDepth * 0.06], [R * 0.80, bowlDepth * 0.18], [R * 0.94, bowlDepth * 0.34], [R * 0.985, bowlDepth * 0.58], [R, bowlDepth]];
  const inner = [[R - 0.002, bowlDepth], [R * 0.985 - 0.002, bowlDepth * 0.58], [R * 0.94 - 0.002, bowlDepth * 0.34], [R * 0.80 - 0.002, bowlDepth * 0.18], [R * 0.57 - 0.002, bowlDepth * 0.06 + 0.002], [R * 0.30, 0.004], [0, 0.003]];
  // Interpolate each wall separately to preserve a thin, open top edge.
  const outside = new THREE.SplineCurve(outer.map(p => new THREE.Vector2(...p))).getPoints(40);
  const inside = new THREE.SplineCurve(inner.map(p => new THREE.Vector2(...p))).getPoints(40);
  add(new THREE.LatheGeometry([...outside, ...inside], 80), steel, 'Bowl_hueco_acero_inoxidable', [0, bowlBottom, bowlZ]);
  torus('Labio_enrollado_bowl', R, 0.0024 * s, [0, bowlRim, bowlZ], chrome);
  for (const side of [-1, 1]) {
    const x = side * (R + 0.008 * s), y = bowlBottom + bowlDepth * 0.53;
    box('Oreja_sujecion_bowl', [0.018 * s, 0.068 * s, 0.033 * s], [x, y, bowlZ - 0.015 * s], steel, 0.003 * s);
    cylinder('Casquillo_sujecion', 0.013 * s, 0.013 * s, 0.039 * s, [side * (R + 0.017 * s), y, bowlZ - 0.008 * s], chrome);
    box('Pestana_bowl', [0.034 * s, 0.003 * s, 0.044 * s], [side * (R + 0.010 * s), y + 0.035 * s, bowlZ + 0.003 * s], steel, 0.001 * s);
  }

  // Rounded white transmission head and its front inspection cover.
  const headWidth = 0.219 * s;
  box('Cabezal_fundido_blanco', [headWidth, headHeight, D - 0.018 * s], [0, H - headHeight / 2, -0.005 * s], paint, 0.040 * s);
  box('Tapa_frontal_cabezal', [0.132 * s, 0.068 * s, 0.013 * s], [0, H - 0.103 * s, D / 2 - 0.009 * s], paint, 0.007 * s);
  for (const x of [-0.055 * s, 0.055 * s]) for (const y of [H - 0.129 * s, H - 0.078 * s]) cylinder('Tornillo_tapa_cabezal', 0.0022 * s, 0.0022 * s, 0.0017 * s, [x, y, D / 2 - 0.0015 * s], chrome, [Math.PI / 2, 0, 0], 16);
  cylinder('Collarin_blanco', 0.102 * s, 0.099 * s, 0.035 * s, [0, headBottom - 0.0175 * s, bowlZ], paint);
  cylinder('Collarin_inox_planetario', 0.096 * s, 0.096 * s, 0.030 * s, [0, headBottom - 0.050 * s, bowlZ], chrome, [0, 0, 0], 56);
  torus('Junta_collarin', 0.097 * s, 0.0014 * s, [0, headBottom - 0.036 * s, bowlZ], dark);
  cylinder('Eje_herramienta', 0.014 * s, 0.017 * s, Math.max(0.04, neckBottom - bowlRim + 0.025 * s), [0, (neckBottom + bowlRim - 0.025 * s) / 2, bowlZ], chrome);

  // Wire safety cage visible in the references; rear gap clears the column.
  const guardTop = neckBottom - 0.004 * s, guardBottom = bowlRim + 0.013 * s;
  for (let ring = 0; ring < 6; ring++) {
    const t = ring / 5, radius = R * (0.98 - 0.35 * t), y = THREE.MathUtils.lerp(guardBottom, guardTop, t);
    const points = Array.from({ length: 49 }, (_, i) => {
      const a = -0.34 * Math.PI + 1.68 * Math.PI * i / 48;
      return [Math.cos(a) * radius, y, bowlZ + Math.sin(a) * radius];
    });
    tube('Aro_rejilla_seguridad', points, 0.0019 * s, chrome, 56);
  }
  for (let rib = 0; rib < 11; rib++) {
    const angle = -0.34 * Math.PI + 1.68 * Math.PI * rib / 10;
    tube('Varilla_rejilla', [0, 0.5, 1].map(t => {
      const radius = R * (0.98 - 0.35 * t);
      return [Math.cos(angle) * radius, THREE.MathUtils.lerp(guardBottom, guardTop, t), bowlZ + Math.sin(angle) * radius];
    }), 0.0019 * s, chrome, 12);
  }
  for (const side of [-1, 1]) rod('Soporte_rejilla', [side * 0.078 * s, guardTop, bowlZ - R * 0.48], [side * 0.078 * s, neckBottom + 0.014 * s, bowlZ - R * 0.48], 0.0034 * s, chrome);

  // The whisk shown in the photo, modeled at rest; no hidden gearing is invented.
  const whiskTop = bowlRim - 0.018 * s, whiskBottom = bowlBottom + bowlDepth * 0.22;
  cylinder('Cubo_globo_batidor', 0.034 * s, 0.042 * s, 0.018 * s, [0, whiskTop, bowlZ], chrome);
  for (let wire = 0; wire < 12; wire++) {
    const a = wire * Math.PI / 6, radius = R * 0.69;
    const points = [
      [Math.cos(a) * 0.026 * s, whiskTop - 0.006 * s, bowlZ + Math.sin(a) * 0.026 * s],
      [Math.cos(a) * radius, THREE.MathUtils.lerp(whiskBottom, whiskTop, 0.55), bowlZ + Math.sin(a) * radius],
      [Math.cos(a) * radius * 0.78, whiskBottom + 0.028 * s, bowlZ + Math.sin(a) * radius * 0.78],
      [0, whiskBottom, bowlZ],
    ];
    tube('Alambre_globo_batidor', points, 0.00125 * s, chrome, 24);
  }

  // Side control plate, red rocker and metal selector lever.
  const controlX = headWidth / 2 + 0.001 * s;
  box('Placa_mandos_lateral', [0.0015 * s, 0.078 * s, 0.133 * s], [controlX, H - 0.098 * s, 0.005 * s], steel, 0.001 * s);
  box('Marco_interruptor', [0.003 * s, 0.025 * s, 0.016 * s], [controlX + 0.002 * s, H - 0.096 * s, -0.008 * s], black, 0.001 * s);
  box('Interruptor_encendido_rojo', [0.004 * s, 0.019 * s, 0.012 * s], [controlX + 0.004 * s, H - 0.096 * s, -0.008 * s], red, 0.001 * s);
  for (const y of [H - 0.124 * s, H - 0.070 * s]) for (const z of [-0.053 * s, 0.062 * s]) cylinder('Tornillo_mandos', 0.0018 * s, 0.0018 * s, 0.0015 * s, [controlX + 0.002 * s, y, z], chrome, [0, 0, Math.PI / 2], 16);
  cylinder('Eje_selector_velocidad', 0.012 * s, 0.012 * s, 0.031 * s, [controlX + 0.016 * s, H - 0.126 * s, 0.046 * s], chrome, [0, 0, Math.PI / 2]);
  rod('Palanca_selector', [controlX + 0.024 * s, H - 0.127 * s, 0.046 * s], [controlX + 0.087 * s, H - 0.160 * s, 0.063 * s], 0.005 * s, chrome);
  for (let tick = 0; tick < 3; tick++) box('Marca_selector', [0.0008 * s, 0.0012 * s, 0.013 * s], [controlX + 0.0015 * s, H - (0.078 + tick * 0.012) * s, 0.029 * s], dark, 0.0002 * s);
  box('Placa_especificacion_lateral', [0.001 * s, 0.058 * s, 0.051 * s], [controlX, H - 0.092 * s, -0.100 * s], white, 0.001 * s);

  // Black hand wheel and crank remain stationary.
  const wheelY = guardTop + 0.005 * s, wheelZ = -D / 2 + 0.074 * s;
  const wheelX = baseHalf * 0.83, wheelRadius = 0.048 * s;
  cylinder('Eje_volante', 0.010 * s, 0.010 * s, wheelX - 0.053 * s, [(wheelX + 0.053 * s) / 2, wheelY, wheelZ], chrome, [0, 0, Math.PI / 2]);
  cylinder('Disco_volante', wheelRadius, wheelRadius, 0.009 * s, [wheelX, wheelY, wheelZ], black, [0, 0, Math.PI / 2], 56);
  torus('Borde_volante', wheelRadius, 0.003 * s, [wheelX + 0.004 * s, wheelY, wheelZ], black, [0, Math.PI / 2, 0]);
  cylinder('Centro_volante', 0.013 * s, 0.013 * s, 0.016 * s, [wheelX + 0.009 * s, wheelY, wheelZ], dark, [0, 0, Math.PI / 2]);
  const handleEnd = W - baseHalf, handleStart = wheelX + 0.008 * s;
  cylinder('Manivela_volante', 0.006 * s, 0.007 * s, handleEnd - handleStart, [(handleEnd + handleStart) / 2, wheelY, wheelZ + wheelRadius * 0.68], black, [0, 0, Math.PI / 2], 24);

  // Restrained manufacturer name plate. No invented certifications or tiny text.
  cylinder('Placa_marca_redonda', 0.013 * s, 0.013 * s, 0.0015 * s, [0, H - 0.105 * s, D / 2 - 0.001 * s], black, [Math.PI / 2, 0, 0], 40);
  const letters = new TextGeometry('ilumi', { font, size: 0.007 * s, depth: 0.00015, curveSegments: 4, bevelEnabled: false });
  letters.computeBoundingBox(); const labelWidth = letters.boundingBox.max.x - letters.boundingBox.min.x;
  add(letters, white, 'Marca_ilumi', [-labelWidth / 2, H - 0.108 * s, D / 2 + 0.0001 * s]);

  for (const { material, geometries, names } of buckets.values()) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`Cannot merge ${sku} ${material.name}`);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = material.name; mesh.userData.parts = names; model.add(mesh);
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), actual = bounds.getSize(new THREE.Vector3());
  // Tiny plate protrusions are included when aligning to the stated exterior envelope.
  model.scale.set(W / actual.x, H / actual.y, D / actual.z);
  model.position.set(-(bounds.min.x + bounds.max.x) / 2 * model.scale.x, -bounds.min.y * model.scale.y, -(bounds.min.z + bounds.max.z) / 2 * model.scale.z);
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true }));
  const report = inspectGlb(bytes);
  if (report.errors.length || report.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(report));
  const output = path.resolve(`public/models/ilumi/${sku.toLowerCase()}-v1.glb`);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes);
  console.log(JSON.stringify({ sku, output, bytes: bytes.length, triangles: report.triangles, meshes: model.children.length, dimensionsMeters: size.toArray(), animations: [], bowlNominalMeters: [bowlDiameter, bowlDepth], envelopeCorrection: model.scale.toArray() }, null, 2));
}
