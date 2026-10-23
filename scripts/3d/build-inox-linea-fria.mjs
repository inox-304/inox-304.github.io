/** V2 photo reconstructions P16/P17/P18/P21 with closed, hinged doors.
 * Normalized visual scale only. Animation is illustrative, not manufacturer CAD.
 * Historical v1 files, including P22, are never overwritten by this generator.
 * See docs/modelos-3d/inox-linea-fria.md.
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
const specifications = [
  { code: 'P16', slug: 'armario-refrigerado-de-2-puertas', page: 11, type: 'double' },
  { code: 'P17', slug: 'armarios-frigorificos-camara-frigorifica', page: 11, type: 'four' },
  { code: 'P18', slug: 'mesa-fria', page: 12, type: 'counter' },
  { code: 'P21', slug: 'abatidor-de-temperatura-de-5-bandejas', page: 13, type: 'blast' },
];

for (const spec of specifications) {
  const model = new THREE.Group(); model.name = `INOX_${spec.code}_${spec.type}`;
  model.userData = {
    productCode: spec.code, revision: '2.0', dimensionsVerified: false,
    scale: spec.verifiedWidth ? 'ONLY_WIDTH_VERIFIED_DEPTH_AND_HEIGHT_APPROXIMATE' : 'NORMALIZED_VISUAL_SCALE_NOT_PHYSICAL_DIMENSIONS',
    ...(spec.verifiedWidth ? { verifiedWidthMeters: spec.verifiedWidth } : {}),
    description: 'Reconstrucción de fotografía de catálogo. Formas secundarias y dimensiones no documentadas son aproximadas. No usar como plano de fabricación o instalación ni para realidad aumentada a escala.',
    reference: `INOX304_datos_y_catalogo.pdf, página ${spec.page}; public/images/products/${spec.slug}.webp`,
    interaction: 'Puertas cerradas de inicio. Apertura ilustrativa mediante pivotes en el canto lateral; el recorrido no es una especificación del fabricante.',
    interior: ['P18', 'P21'].includes(spec.code) ? 'Casco interior simple e ilustrativo; no documenta distribución real, capacidad o mecanismos ocultos.' : 'Interior visible de referencia y disposición complementaria aproximada.',
  };
  const steel = new THREE.MeshStandardMaterial({ name: 'Acero_inoxidable_satinado', color: 0xb3bec7, metalness: 0.96, roughness: 0.29 });
  const liner = new THREE.MeshStandardMaterial({ name: 'Interior_inox_satinado', color: 0xabb8c1, metalness: 0.91, roughness: 0.38 });
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
  const animatedDoors = [];
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
  function door(name, hingeX, centerY, z, w, h, side, openAngle, mat = steel, options = {}) {
    const group = new THREE.Group(); group.name = name; group.position.set(hingeX, centerY, z); model.add(group); parent = group;
    const thickness = options.thickness || 0.033;
    group.userData = { role: 'hinged-door', width: w, height: h, hingeSide: side === 1 ? 'left' : 'right', openAngleRadians: openAngle, closedByDefault: true };
    const cx = side * w / 2;
    box('Hoja_puerta', [w, h, thickness], [cx, 0, 0], mat, 0.004);
    // A gasket frame follows the door. It is not a solid black cover over the opening.
    for (const s of [-1, 1]) {
      box('Junta_vertical', [0.010, h - 0.018, 0.006], [cx + s * (w / 2 - 0.012), 0, -thickness / 2 - 0.003], seal, 0.002);
      box('Junta_horizontal', [w - 0.014, 0.010, 0.006], [cx, s * (h / 2 - 0.012), -thickness / 2 - 0.003], seal, 0.002);
    }
    box('Revestimiento_interior', [w - 0.039, h - 0.044, 0.006], [cx, 0, -thickness / 2 - 0.004], liner, 0.003);
    const hx = side * (w - 0.022);
    if (options.handle === 'lower') box('Unero_inferior_puerta', [w - 0.026, 0.012, 0.012], [cx, -h / 2 + 0.006, thickness / 2 + 0.004], black, 0.002);
    else {
      const hh = Math.min(0.085, h * 0.23), front = thickness / 2 + 0.008;
      curve('Tirador_vertical', [[hx, -hh, front], [hx, -hh * 0.68, front + 0.023], [hx, hh * 0.68, front + 0.023], [hx, hh, front]], Math.min(0.006, w * 0.016), bright);
    }
    if (options.visibleHinges !== false) for (const y of [-h * 0.36, h * 0.36]) cyl('Bisagra_visible', 0.007, 0.007, Math.min(0.056, h * 0.13), [0, y, 0.002], bright);
    parent = model;
    animatedDoors.push({ group, openAngle });
    return group;
  }

  if (spec.type === 'double' || spec.type === 'four') {
    const four = spec.type === 'four', W = 1, H = four ? 1.52 : 1.78, D = 0.60, floor = 0.10, cap = four ? 0.18 : 0.28;
    const mat = steel, innerTop = H - cap, innerHeight = innerTop - floor;
    feet(W, D);
    box('Lateral_izquierdo', [0.032, H - floor, D], [-W / 2 + 0.016, (H + floor) / 2, 0], mat);
    box('Lateral_derecho', [0.032, H - floor, D], [W / 2 - 0.016, (H + floor) / 2, 0], mat);
    box('Fondo_interior', [W - 0.060, innerHeight, 0.026], [0, (innerTop + floor) / 2, -D / 2 + 0.013], mat);
    box('Base_interior', [W, 0.032, D], [0, floor + 0.016, 0], mat);
    box('Cabecera', [W, cap, D], [0, H - cap / 2, 0], mat);
    box('Particion_vertical', [0.032, innerHeight, D - 0.02], [0, (innerTop + floor) / 2, 0.01], mat);
    if (four) {
      const mid = floor + innerHeight * 0.47;
      box('Particion_horizontal', [W - 0.04, 0.030, D - 0.01], [0, mid, 0.005], mat);
      door('Puerta_superior_izquierda', -0.475, (innerTop + mid) / 2, 0.320, 0.450, innerTop - mid - 0.030, 1, -1.745, mat);
      door('Puerta_inferior_izquierda', -0.475, (mid + floor) / 2, 0.320, 0.450, mid - floor - 0.030, 1, -1.745, mat);
      door('Puerta_superior_derecha', 0.475, (innerTop + mid) / 2, 0.320, 0.450, innerTop - mid - 0.030, -1, 1.745, mat);
      door('Puerta_inferior_derecha', 0.475, (mid + floor) / 2, 0.320, 0.450, mid - floor - 0.030, -1, 1.745, mat);
      for (const x of [-0.248, 0.248]) for (const y of [floor + (mid - floor) * 0.52, mid + (innerTop - mid) * 0.34, mid + (innerTop - mid) * 0.68]) shelf('Parrilla_armario', 0.409, 0.480, x, y, 0.005, white);
      display(0.397, H - 0.087, 0.303, true); box('Placa_INOX', [0.113, 0.036, 0.002], [-0.358, H - 0.088, 0.303], blue, 0.001); text('INOX304', 0.016, [-0.358, H - 0.093, 0.305], white);
    } else {
      door('Puerta_izquierda', -0.475, (innerTop + floor) / 2, 0.320, 0.450, innerHeight - 0.025, 1, -1.745, mat);
      door('Puerta_derecha', 0.475, (innerTop + floor) / 2, 0.320, 0.450, innerHeight - 0.025, -1, 1.745, mat);
      for (const x of [-0.248, 0.248]) for (const y of [0.365, 0.755, 1.135]) shelf('Parrilla_armario', 0.410, 0.480, x, y, 0.005);
      for (let i = 0; i < 18; i++) for (const x of [0.039, 0.455]) box('Guia_bandeja', [0.016, 0.006, 0.460], [x, 0.235 + i * 0.065, 0.010], bright, 0.002);
      box('Placa_ventilador_visible', [0.178, 0.178, 0.007], [0.177, 1.340, -0.278], steel, 0.005);
      cyl('Fondo_ventilador', 0.073, 0.073, 0.006, [0.177, 1.340, -0.270], black, [Math.PI / 2, 0, 0], 40);
      for (const r of [0.020, 0.031, 0.043, 0.055, 0.067]) torus('Rejilla_ventilador', r, 0.0015, [0.177, 1.340, -0.265], bright, [0, 0, 0]);
      for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) line('Radio_ventilador', [0.177 - Math.cos(angle) * 0.07, 1.340 - Math.sin(angle) * 0.07, -0.263], [0.177 + Math.cos(angle) * 0.07, 1.340 + Math.sin(angle) * 0.07, -0.263], 0.0016);
      box('Banda_negra_cabecera', [0.935, 0.082, 0.004], [0, H - 0.145, 0.302], black, 0.001); display(0.055, H - 0.145, 0.307);
    }
  }

  if (spec.type === 'counter') {
    const W = 1, D = 0.405;
    wheels(W, D);
    // Hollow food-storage bay; the machinery bay stays closed and contains no invented motor.
    box('Lateral_izquierdo_mesa', [0.020, 0.420, D], [-0.490, 0.292, 0], steel, 0.003);
    box('Lateral_derecho_mesa', [0.020, 0.420, D], [0.490, 0.292, 0], steel, 0.003);
    box('Fondo_mesa', [0.960, 0.420, 0.018], [0, 0.292, -D / 2 + 0.009], liner, 0.003);
    box('Base_interior_mesa', [0.960, 0.022, D - 0.020], [0, 0.093, 0.005], liner, 0.003);
    box('Techo_interior_mesa', [0.960, 0.014, D - 0.020], [0, 0.492, 0.005], liner, 0.003);
    box('Separacion_compartimento_equipo', [0.018, 0.398, D - 0.020], [0.260, 0.293, 0.005], liner, 0.002);
    box('Compartimento_equipo_cerrado', [0.210, 0.398, D - 0.020], [0.375, 0.293, 0.005], steel, 0.002);
    for (const x of [-0.481, -0.115, 0.252]) box('Marco_frontal_mesa', [0.014, 0.397, 0.018], [x, 0.293, 0.201], steel, 0.002);
    // One shallow shelf makes the illustrative inner volume readable without claiming a real layout.
    box('Repisa_interior_ilustrativa', [0.724, 0.007, 0.334], [-0.115, 0.292, -0.002], liner, 0.002);
    box('Encimera', [1.020, 0.020, 0.425], [0, 0.512, 0.005], bright, 0.002);
    box('Copete_trasero', [1.008, 0.058, 0.010], [0, 0.546, -0.198], steel, 0.002);
    door('Puerta_mesa_izquierda', -0.482, 0.294, 0.221, 0.360, 0.388, 1, -1.745, steel, { thickness: 0.018 });
    door('Puerta_mesa_derecha', 0.252, 0.294, 0.221, 0.360, 0.388, -1, 1.745, steel, { thickness: 0.018 });
    box('Cajon_lateral_superior', [0.219, 0.193, 0.015], [0.381, 0.384, 0.211], steel, 0.003);
    box('Unero_cajon', [0.196, 0.014, 0.018], [0.381, 0.473, 0.219], bright, 0.003);
    box('Fondo_rejilla_compartimento', [0.222, 0.182, 0.003], [0.381, 0.187, 0.208], black, 0.002);
    const holes = []; for (let row = 0; row < 7; row++) for (let col = 0; col < 11; col++) holes.push([-0.095 + col * 0.019, -0.070 + row * 0.018, 0.013, 0.010]);
    perforated('Rejilla_inferior_mesa', 0.221, 0.185, holes, [0.381, 0.187, 0.212]); display(0.352, 0.257, 0.217, true); box('Interruptor_mesa', [0.014, 0.022, 0.006], [0.421, 0.257, 0.223], red, 0.001);
    for (const x of [-0.475, 0.475]) for (const z of [-0.177, -0.010]) cyl('Poste_repisero', 0.007, 0.007, 0.438, [x, 0.741, z]);
    for (const y of [0.735, 0.958]) {
      box('Repisa_superior', [0.992, 0.008, 0.185], [0, y, -0.093], steel, 0.002);
      line('Baranda_posterior', [-0.475, y + 0.027, -0.175], [0.475, y + 0.027, -0.175], 0.004);
      for (const x of [-0.475, 0.475]) line('Baranda_lateral', [x, y + 0.027, -0.175], [x, y + 0.027, -0.010], 0.004);
    }
  }

  if (spec.type === 'blast') {
    const W = 1, H = 1.13, D = 0.86;
    wheels(W, D);
    // Open shell above the closed machinery zone; no fictional refrigeration system inside.
    box('Lateral_izquierdo_abatidor', [0.030, H - 0.080, D], [-0.485, (H + 0.080) / 2, 0], steel, 0.004);
    box('Lateral_derecho_abatidor', [0.030, H - 0.080, D], [0.485, (H + 0.080) / 2, 0], steel, 0.004);
    box('Fondo_abatidor', [0.940, H - 0.080, 0.025], [0, (H + 0.080) / 2, -D / 2 + 0.0125], liner, 0.003);
    box('Compartimento_inferior_cerrado', [0.940, 0.424, D - 0.025], [0, 0.292, 0.0125], steel, 0.003);
    box('Base_camara_abatidor', [0.940, 0.020, D - 0.030], [0, 0.518, 0], liner, 0.003);
    box('Techo_camara_abatidor', [0.940, 0.020, D - 0.030], [0, 1.107, 0], liner, 0.003);
    for (const x of [-0.469, 0.469]) box('Marco_entrada_abatidor', [0.018, 0.583, 0.030], [x, 0.817, 0.414], steel, 0.002);
    // Five simple removable-tray positions illustrate the catalog's five-tray description.
    // They are not a dimensional standard or a photographed interior reconstruction.
    for (let i = 0; i < 5; i++) {
      const y = 0.575 + i * 0.103;
      for (const x of [-0.437, 0.437]) box('Guia_bandeja_ilustrativa', [0.022, 0.009, 0.711], [x, y - 0.006, -0.005], bright, 0.002);
      box('Bandeja_interior_ilustrativa', [0.866, 0.005, 0.705], [0, y, -0.005], liner, 0.002);
      box('Frente_bandeja_ilustrativa', [0.866, 0.013, 0.005], [0, y + 0.004, 0.345], bright, 0.002);
    }
    box('Cubierta_superior', [1.006, 0.025, D + 0.008], [0, H - 0.006, 0.004], bright, 0.003);
    const blastDoor = door('Puerta_abatidor', 0.473, 0.807, 0.449, 0.946, 0.559, -1, 1.745, steel, { thickness: 0.024, handle: 'lower', visibleHinges: false });
    parent = blastDoor;
    box('Placa_marca', [0.162, 0.055, 0.002], [-0.813, 0.230, 0.014], black, 0.001); text('ilumi', 0.042, [-0.813, 0.216, 0.016], white);
    parent = model;
    box('Fondo_ventilacion_abatidor', [0.965, 0.432, 0.004], [0, 0.300, 0.432], black, 0.001);
    const slots = []; for (let col = 0; col < 15; col++) { const top = 0.152 - (1 - Math.abs(col - 7) / 7) * 0.115; for (let y = -0.177; y < top; y += 0.021) slots.push([-0.420 + col * 0.060, y, 0.042, 0.010]); }
    perforated('Chapa_ventilada_abatidor', 0.970, 0.438, slots, [0, 0.300, 0.438]);
    box('Marco_display_abatidor', [0.190, 0.115, 0.006], [0.100, 0.440, 0.444], black, 0.006); box('Pantalla_abatidor', [0.086, 0.075, 0.002], [0.071, 0.442, 0.449], charcoal, 0.003);
    for (const x of [0.133, 0.162]) for (const y of [0.410, 0.440, 0.470]) box('Boton_abatidor', [0.020, 0.020, 0.002], [x, y, 0.450], black, 0.002);
  }

  if (spec.type === 'open') {
    const W = 1.16, D = 0.70, H = 2.00;
    feet(W, D, 0.040);
    box('Base_open_cooler', [W, 0.410, D], [0, 0.245, 0], charcoal, 0.008);
    box('Fondo_exhibidor', [W, 1.550, 0.080], [0, 1.225, -D / 2 + 0.040], charcoal, 0.005);
    box('Techo_exhibidor', [W, 0.180, D], [0, H - 0.090, 0], charcoal, 0.005);
    box('Fondo_rejilla_inferior', [0.950, 0.275, 0.003], [0.035, 0.190, 0.352], black, 0.001);
    const grille = []; for (let i = 0; i < 8; i++) grille.push([0, -0.101 + i * 0.029, i > 5 ? 0.69 : 0.85, 0.016]);
    perforated('Rejilla_compresor_visible', 0.960, 0.285, grille, [0.035, 0.190, 0.355], charcoal);
    display(0.452, 0.285, 0.360); box('Interruptor_verde_open', [0.021, 0.032, 0.006], [0.425, 0.245, 0.365], green, 0.002); box('Interruptor_rojo_open', [0.021, 0.032, 0.006], [0.465, 0.245, 0.365], red, 0.002);
    const ventHoles = []; for (let row = 0; row < 35; row++) for (let col = 0; col < 5; col++) ventHoles.push([-0.28 + col * 0.14, -0.635 + row * 0.037, 0.098, 0.004]);
    perforated('Panel_trasero_perforado', 1.035, 1.365, ventHoles, [0, 1.150, -0.267], charcoal);
    const frontProfile = [[0.46, 0.310], [0.72, 0.350], [1.20, 0.315], [1.65, 0.245], [1.82, 0.280]];
    for (const side of [-1, 1]) {
      const p = new THREE.Shape(); p.moveTo(0.310, 0.460); for (const [y, z] of frontProfile.slice(1)) p.lineTo(z, y); p.lineTo(-0.310, 1.820); p.lineTo(-0.310, 0.460); p.closePath();
      const g = new THREE.ShapeGeometry(p); g.rotateY(-Math.PI / 2); add(g, glass, 'Cristal_lateral_curvo', [side * 0.538, 0, 0]);
      curve('Marco_lateral_curvo_open', frontProfile.map(([y, z]) => [side * 0.545, y, z]), 0.012, black);
      box('Marco_lateral_trasero', [0.018, 1.370, 0.018], [side * 0.545, 1.145, -0.310], black, 0.003);
      box('Perfil_frontal_aluminio', [0.039, 1.370, 0.036], [side * 0.535, 1.145, 0.348], bright, 0.012);
    }
    box('Bandeja_inferior_open', [1.040, 0.012, 0.600], [0, 0.467, 0.020], steel, 0.003);
    for (const y of [0.700, 0.988, 1.276, 1.564]) {
      box('Repisa_exhibidor', [1.030, 0.016, 0.535], [0, y, 0.025], charcoal, 0.003);
      box('Frente_claro_repisa', [1.045, 0.041, 0.024], [0, y + 0.005, 0.300], white, 0.005);
      for (const x of [-0.485, 0.485]) box('Soporte_repisa', [0.012, 0.040, 0.480], [x, y - 0.024, 0.015], charcoal, 0.004);
    }
    box('Marco_cartel', [1.160, 0.184, 0.028], [0, 1.912, 0.358], black, 0.005);
    box('Cartel_azul_ILUMI', [1.110, 0.145, 0.004], [0, 1.912, 0.374], blue, 0.004); text('ilumi', 0.092, [0, 1.883, 0.378], white);
  }

  // Batch only inside each rigid group. Door geometry stays local to its real edge pivot;
  // handles, lining, gasket and label move together, never flattened into the fixed body.
  function batchRigidGroup(group) {
    const buckets = new Map(), meshes = group.children.filter(object => object.isMesh);
    for (const object of meshes) {
      object.updateMatrix();
      const geometry = object.geometry.clone().applyMatrix4(object.matrix);
      const geo = geometry.index ? geometry.toNonIndexed() : geometry; geo.deleteAttribute('uv');
      if (!buckets.has(object.material.uuid)) buckets.set(object.material.uuid, { material: object.material, geometries: [], parts: [] });
      buckets.get(object.material.uuid).geometries.push(geo); buckets.get(object.material.uuid).parts.push(object.name);
      group.remove(object);
    }
    for (const { material, geometries, parts } of buckets.values()) {
      const geometry = mergeGeometries(geometries, false); if (!geometry) throw new Error(`Could not merge ${spec.code}`);
      for (const attribute of Object.values(geometry.attributes)) for (const value of attribute.array) if (!Number.isFinite(value)) throw new Error(`Non-finite geometry in ${spec.code}`);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `${group.name}_${material.name}`; mesh.userData.parts = parts; group.add(mesh);
    }
  }
  batchRigidGroup(model);
  for (const { group } of animatedDoors) batchRigidGroup(group);
  const tracks = animatedDoors.map(({ group, openAngle }) => {
    const closed = new THREE.Quaternion(), opened = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), openAngle);
    return new THREE.QuaternionKeyframeTrack(`${group.name}.quaternion`, [0, 1, 1.2], [...closed.toArray(), ...opened.toArray(), ...opened.toArray()]);
  });
  if (!tracks.length) throw new Error(`No hinged doors for ${spec.code}`);
  const clip = new THREE.AnimationClip('Abrir_puertas', 1.2, tracks);
  model.userData.animation = { name: clip.name, duration: clip.duration, doors: animatedDoors.length, initialState: 'closed', finalState: 'open-held', openingDegreesApproximate: 100 };
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  model.userData.visualEnvelopeApproximate = size.toArray();
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true, animations: [clip] }));
  const report = inspectGlb(bytes); if (report.errors.length || report.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(report));
  const output = path.resolve(`public/models/inox/${spec.slug}-v2.glb`); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes);
  let meshes = 0; model.traverse(object => { if (object.isMesh) meshes++; });
  console.log(JSON.stringify({ code: spec.code, output, bytes: bytes.length, triangles: report.triangles, meshes, dimensionsVerified: false, visualEnvelopeApproximate: size.toArray(), animations: [clip.name], doors: animatedDoors.length }, null, 2));
}
