/**
 * CR-121 / CR-122 / CR-123, reconstructed from ILUMI photographs and sheets.
 * Presentation geometry only; not manufacturer CAD or manufacturing dimensions.
 * Run: node scripts/3d/build-ilumi-cremoladeras.mjs [CR-121|CR-122|CR-123]
 * Evidence and limits: docs/modelos-3d/ilumi-cremoladeras.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch(error => this.onerror?.(error));
  }
};

const family = [
  { sku: 'CR-121', bowls: 1, width: 0.240, liters: 12 },
  { sku: 'CR-122', bowls: 2, width: 0.430, liters: 24 },
  { sku: 'CR-123', bowls: 3, width: 0.620, liters: 36 },
];
const selected = process.argv[2]?.toUpperCase();
if (selected && !family.some(item => item.sku === selected)) throw new Error('Unknown cremoladera model.');
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));

function roundedShape(width, height, radius, cx = 0, cy = 0) {
  const shape = new THREE.Shape();
  const x = cx - width / 2, y = cy - height / 2, r = Math.min(radius, width / 2, height / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y); shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r); shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// The CR vessels have a lower horizontal half-cylinder and a tall rectangular
// upper reservoir. They are not the vertical rectangular tanks of DJ dispensers.
function bowlProfile(radius, top, shoulder = radius + 0.005) {
  const shape = new THREE.Shape(), center = 0.530;
  shape.moveTo(-radius, center);
  shape.absarc(0, center, radius, Math.PI, 2 * Math.PI, false);
  shape.lineTo(shoulder, top - 0.010);
  shape.quadraticCurveTo(shoulder, top, shoulder - 0.010, top);
  shape.lineTo(-shoulder + 0.010, top);
  shape.quadraticCurveTo(-shoulder, top, -shoulder, top - 0.010);
  shape.closePath();
  return shape;
}

async function build(spec) {
  const model = new THREE.Group();
  model.name = `ILUMI_${spec.sku.replace('-', '_')}`;
  model.userData = {
    description: 'Visualización aproximada a partir de fotografías oficiales. El contenido de color es ilustrativo; no representa accesorios incluidos ni una receta.',
    nominalDimensions: { width: spec.width, depth: 0.530, height: 0.800 },
    capacityLitersTotal: spec.liters, bowls: spec.bowls,
    units: 'meters', orientation: 'Y up; front +Z',
    reconstruction: 'No CAD, rear simplified, hidden mechanism omitted, no inferred animation.',
  };
  const steel = new THREE.MeshStandardMaterial({ name: 'Chapa_inoxidable_satinada', color: 0xb9bfc3, metalness: 0.82, roughness: 0.33 });
  const edges = new THREE.MeshStandardMaterial({ name: 'Cantos_y_soportes_inox', color: 0xd2d7db, metalness: 0.93, roughness: 0.22 });
  const black = new THREE.MeshStandardMaterial({ name: 'Plastico_negro', color: 0x12171b, metalness: 0.06, roughness: 0.31 });
  const rubber = new THREE.MeshStandardMaterial({ name: 'Patas_y_juntas', color: 0x111315, metalness: 0, roughness: 0.74 });
  const shadow = new THREE.MeshStandardMaterial({ name: 'Interior_ventilacion', color: 0x2d353b, metalness: 0.28, roughness: 0.65 });
  const white = new THREE.MeshStandardMaterial({ name: 'Serigrafia_clara', color: 0xe8ecee, metalness: 0, roughness: 0.55 });
  const panel = new THREE.MeshStandardMaterial({ name: 'Panel_digital_negro', color: 0x080b10, metalness: 0.08, roughness: 0.23 });
  const digits = new THREE.MeshStandardMaterial({ name: 'Segmentos_display', color: 0x773337, metalness: 0, roughness: 0.5, emissive: 0x210305 });
  const gold = new THREE.MeshStandardMaterial({ name: 'Franja_panel_CR121', color: 0xb49d62, metalness: 0.15, roughness: 0.48 });
  const pushBlue = new THREE.MeshStandardMaterial({ name: 'Distintivo_push_CR122', color: 0x187599, metalness: 0.2, roughness: 0.33 });
  const glass = new THREE.MeshPhysicalMaterial({ name: 'Tolva_policarbonato_transparente', color: 0xf0f6fc, roughness: 0.12, metalness: 0,
    transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const glassRim = new THREE.MeshPhysicalMaterial({ name: 'Bordes_moldeados_tolva', color: 0xdce9f4, roughness: 0.18, metalness: 0,
    transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.65 });
  const beverageColors = spec.bowls === 1 ? [0xd99a22] : [0xe4b91b, 0xb73137, 0xe4b91b];
  const beverages = beverageColors.slice(0, spec.bowls).map((color, index) => new THREE.MeshStandardMaterial({
    name: `Contenido_ilustrativo_tolva_${index + 1}`, color, metalness: 0, roughness: 0.56,
  }));
  const parts = new Map();
  function add(geometry, material, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);
    const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
    expanded.deleteAttribute('uv');
    if (!parts.has(material.uuid)) parts.set(material.uuid, { material, geometries: [], names: [] });
    const bucket = parts.get(material.uuid); bucket.geometries.push(expanded); bucket.names.push(name);
  }
  function box(name, size, position, material = steel, radius = 0.0015) {
    add(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(value => value / 2))), material, name, position);
  }
  function cylinder(name, radius, height, position, material = edges, rotation = [0, 0, 0], segments = 24) {
    add(new THREE.CylinderGeometry(radius, radius, height, segments), material, name, position, rotation);
  }
  function extrude(shape, depth, material, name, position = [0, 0, 0], rotation = [0, 0, 0], curveSegments = 8) {
    add(new THREE.ExtrudeGeometry(shape, { depth, curveSegments, bevelEnabled: false }), material, name, position, rotation);
  }
  function horizontalFrame(name, w, d, border, y, z, material, cx = 0, height = 0.003) {
    const shape = roundedShape(w, d, 0.010);
    shape.holes.push(roundedShape(w - 2 * border, d - 2 * border, 0.007));
    extrude(shape, height, material, name, [cx, y, z], [-Math.PI / 2, 0, 0]);
  }
  function word(text, size, position, material = white) {
    const geometry = new TextGeometry(text, { font, size, depth: 0.00015, curveSegments: 3, bevelEnabled: false });
    geometry.computeBoundingBox();
    geometry.translate(-(geometry.boundingBox.max.x + geometry.boundingBox.min.x) / 2, 0, 0);
    add(geometry, material, `Rotulo_${text}`, position);
  }

  // Single shared housing; the manufacturer's widths increase by 190 mm per bowl.
  const w = spec.width;
  box('Chapa_frontal', [w - 0.004, 0.380, 0.0025], [0, 0.212, 0.13875]);
  box('Chapa_trasera_simplificada', [w - 0.004, 0.380, 0.002], [0, 0.212, -0.264]);
  box('Placa_inferior', [w, 0.004, 0.405], [0, 0.022, -0.0625], shadow);
  box('Borde_superior_negro', [w, 0.014, 0.405], [0, 0.409, -0.0625], black, 0.003);
  box('Fondo_interior', [w - 0.022, 0.335, 0.378], [0, 0.211, -0.0625], shadow, 0.002);
  for (const x of [-w / 2 + 0.004, w / 2 - 0.004]) {
    box('Canto_frontal', [0.008, 0.383, 0.008], [x, 0.2115, 0.135], edges, 0.002);
    box('Canto_trasero', [0.008, 0.383, 0.008], [x, 0.2115, -0.260], steel, 0.002);
  }
  for (const side of [-1, 1]) {
    const vent = roundedShape(0.393, 0.372, 0.003);
    for (let row = 0; row < 21; row++) for (let col = 0; col < 5; col++) {
      vent.holes.push(roundedShape(0.061, 0.0043, 0.0017, (col - 2) * 0.073, -0.144 + row * 0.0127));
    }
    extrude(vent, 0.0015, steel, 'Chapa_lateral_rejillas_reales', [side * (w / 2 - 0.0015), 0.211, -0.0625], [0, side * Math.PI / 2, 0], 3);
    for (const y of [0.038, 0.385]) for (const z of [-0.245, 0.119]) {
      cylinder('Tornillo_lateral', 0.0022, 0.001, [side * (w / 2 - 0.0005), y, z], edges, [0, 0, Math.PI / 2], 12);
    }
  }
  for (const x of [-w / 2 + 0.021, w / 2 - 0.021]) for (const z of [-0.241, 0.111]) {
    cylinder('Pata_antideslizante', 0.012, 0.012, [x, 0.006, z], rubber);
    cylinder('Apoyo_inoxidable', 0.009, 0.010, [x, 0.017, z], edges);
  }

  // The single-bowl model has the narrower gold-striped control panel seen in its photo.
  box('Panel_de_control', [w - 0.040, 0.067, 0.0018], [0, 0.352, 0.141], panel, 0.003);
  if (spec.bowls === 1) {
    box('Linea_dorada_panel', [w - 0.047, 0.006, 0.0004], [0, 0.365, 0.1422], gold, 0.0002);
    box('Linea_clara_panel', [w - 0.047, 0.001, 0.0004], [0, 0.373, 0.1422], white, 0.0002);
    box('Marco_interruptor_lateral', [0.002, 0.025, 0.016], [-w / 2 + 0.001, 0.362, 0.075], black, 0.001);
    box('Interruptor_lateral', [0.0021, 0.016, 0.009], [-w / 2 + 0.00105, 0.362, 0.075], digits, 0.001);
  }
  const controls = spec.bowls === 1 ? 1 : spec.bowls;
  for (let index = 0; index < controls; index++) {
    const x = (index - (controls - 1) / 2) * 0.046;
    box('Visor_digital', [0.030, 0.014, 0.0008], [x, 0.363, 0.1424], shadow, 0.001);
    // Dim segments represent a display, not a live temperature or operating state.
    for (const offset of [-0.008, 0.003]) {
      for (const y of [0.359, 0.363, 0.367]) box('Segmento_horizontal', [0.0054, 0.0008, 0.0004], [x + offset, y, 0.143], digits, 0.0002);
      for (const dx of [-0.0027, 0.0027]) for (const y of [0.361, 0.365]) box('Segmento_vertical', [0.0008, 0.0027, 0.0004], [x + offset + dx, y, 0.143], digits, 0.0002);
    }
    for (const y of [0.342, 0.329]) {
      cylinder('Boton_panel_borde', 0.0035, 0.001, [x, y, 0.1424], white, [Math.PI / 2, 0, 0], 16);
      cylinder('Boton_panel', 0.0024, 0.0012, [x, y, 0.1430], shadow, [Math.PI / 2, 0, 0], 16);
    }
  }
  const logoX = spec.bowls === 1 ? 0 : -w / 2 + 0.079;
  box('Placa_marca_borde', [0.094, 0.036, 0.001], [logoX, 0.188, 0.1407], edges, 0.0005);
  box('Placa_marca_negra', [0.089, 0.031, 0.001], [logoX, 0.188, 0.1413], panel, 0.0004);
  word('ilumi', 0.024, [logoX, 0.178, 0.142]);

  for (let index = 0; index < spec.bowls; index++) {
    const x = (index - (spec.bowls - 1) / 2) * 0.190;
    const prefix = `Tolva_${index + 1}`;
    // Visible rear cover; no undocumented motor or auger assembly is invented.
    box(`${prefix}_respaldo_negro`, [0.178, 0.198, 0.027], [x, 0.514, -0.235], black, 0.018);
    cylinder(`${prefix}_aro_apoyo_trasero`, 0.097, 0.014, [x, 0.530, -0.211], edges, [Math.PI / 2, 0, 0], 48);
    box(`${prefix}_apoyo_inferior`, [0.180, 0.026, 0.350], [x, 0.426, -0.034], black, 0.004);

    // Clear front/back and side surfaces follow the characteristic half-round bottom.
    extrude(bowlProfile(0.091, 0.782), 0.348, glass, `${prefix}_recipiente_semicilindrico`, [x, 0, -0.211]);
    extrude(bowlProfile(0.085, 0.691, 0.088), 0.329, beverages[index], `${prefix}_contenido_ilustrativo`, [x, 0, -0.202]);
    cylinder(`${prefix}_relieve_circular_frontal`, 0.086, 0.007, [x, 0.530, 0.141], glassRim, [Math.PI / 2, 0, 0], 64);
    cylinder(`${prefix}_contenido_frontal`, 0.080, 0.004, [x, 0.530, 0.1385], beverages[index], [Math.PI / 2, 0, 0], 48);
    horizontalFrame(`${prefix}_borde_superior`, 0.198, 0.358, 0.004, 0.780, -0.037, glassRim, x, 0.004);
    // The black rim and shallow cap match the photographed lid; no opening animation
    // is shipped without evidence of the product's removal/locking mechanism.
    horizontalFrame(`${prefix}_marco_tapa`, 0.202, 0.366, 0.010, 0.788, -0.037, black, x, 0.009);
    extrude(roundedShape(0.182, 0.346, 0.027), 0.003, glassRim, `${prefix}_tapa_superior`, [x, 0.797, -0.037], [-Math.PI / 2, 0, 0]);
    box(`${prefix}_borde_posterior_tapa`, [0.182, 0.010, 0.044], [x, 0.793, -0.190], black, 0.004);
    // Molded edges and two restrained corner ribs distinguish the clear upper reservoir.
    for (const dx of [-0.087, 0.087]) box(`${prefix}_nervadura_frontal`, [0.0024, 0.218, 0.003], [x + dx, 0.667, 0.138], glassRim, 0.001);

    // Tall black pull/push lever in front of the round dispensing chamber.
    box(`${prefix}_palanca_grifo`, [0.041, 0.119, 0.019], [x, 0.535, 0.160], black, 0.014);
    cylinder(`${prefix}_cabeza_palanca`, 0.021, 0.019, [x, 0.593, 0.160], black, [Math.PI / 2, 0, 0], 40);
    cylinder(`${prefix}_boton_central`, 0.015, 0.006, [x, 0.536, 0.173], panel, [Math.PI / 2, 0, 0], 32);
    cylinder(`${prefix}_anillo_pulsador`, 0.019, 0.002, [x, 0.536, 0.169], edges, [Math.PI / 2, 0, 0], 32);
    cylinder(`${prefix}_boton_interior`, 0.0165, 0.004, [x, 0.536, 0.172], black, [Math.PI / 2, 0, 0], 32);
    cylinder(`${prefix}_boquilla`, 0.0105, 0.035, [x, 0.442, 0.163], black);
    cylinder(`${prefix}_salida_interior`, 0.007, 0.001, [x, 0.424, 0.163], shadow);
    box(`${prefix}_soporte_valvula`, [0.029, 0.023, 0.018], [x, 0.468, 0.158], black, 0.005);
    if (spec.bowls === 2) {
      cylinder(`${prefix}_distintivo_push`, 0.0175, 0.0015, [x, 0.593, 0.170], pushBlue, [Math.PI / 2, 0, 0], 32);
      word('PUSH', 0.0078, [x, 0.590, 0.171]);
    }

    const trayWidth = spec.bowls === 1 ? 0.202 : 0.184;
    box(`${prefix}_fondo_bandeja`, [trayWidth, 0.006, 0.128], [x, 0.035, 0.201], black, 0.009);
    horizontalFrame(`${prefix}_pared_bandeja`, trayWidth, 0.128, 0.0035, 0.038, 0.201, black, x, 0.018);
    const grate = roundedShape(trayWidth - 0.009, 0.118, 0.007);
    for (let row = 0; row < 10; row++) for (let col = 0; col < 3; col++) {
      // Keep a central solid pad under the spout, with real drain slots around it.
      if ((row === 4 || row === 5) && col === 1) continue;
      grate.holes.push(roundedShape(0.043, 0.0047, 0.002, (col - 1) * 0.052, (row - 4.5) * 0.0104));
    }
    extrude(grate, 0.0028, black, `${prefix}_rejilla_bandeja_perforada`, [x, 0.054, 0.201], [-Math.PI / 2, 0, 0], 4);
    for (const dx of [-0.024, 0.024]) cylinder(`${prefix}_soporte_bandeja`, 0.0065, 0.030, [x + dx, 0.095, 0.153], edges, [Math.PI / 2, 0, 0]);
  }

  for (const { material, geometries, names } of parts.values()) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error(`Cannot merge ${material.name}`);
    const geometry = mergeVertices(merged, 0.000001);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name; mesh.userData.parts = names;
    model.add(mesh);
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const dimensions = [spec.width, 0.800, 0.530];
  if (size.toArray().some((value, axis) => Math.abs(value - dimensions[axis]) > 0.004)) throw new Error(`Unexpected dimensions ${spec.sku}: ${size.toArray()}`);
  const exporter = new GLTFExporter();
  const buffer = Buffer.from(await exporter.parseAsync(model, { binary: true, onlyVisible: true }));
  const report = inspectGlb(buffer);
  if (report.errors.length || buffer.length > 8 * 1024 * 1024 || report.triangles > 300000) throw new Error(JSON.stringify(report));
  const output = path.resolve(`public/models/ilumi/${spec.sku.toLowerCase()}-v1.glb`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, buffer);
  console.log(JSON.stringify({ sku: spec.sku, output, bytes: buffer.length, triangles: report.triangles, meshes: model.children.length,
    dimensionsMeters: size.toArray(), animations: [], warnings: report.warnings, externalResources: false }));
}

for (const spec of family.filter(item => !selected || item.sku === selected)) await build(spec);
