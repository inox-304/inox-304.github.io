/** Photo reconstructions of remaining catalogue equipment. No manufacturer CAD.
 * All external dimensions are unverified; the normalized envelope is visual only.
 * See docs/modelos-3d/inox-equipos-restantes.md. No motion is inferred from labels.
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
  { code: 'P12', slug: 'freidora-doble-profesional', page: 9, type: 'fryerDouble' },
  { code: 'P13', slug: 'freidora-de-papa-profesional', page: 9, type: 'fryerNarrow' },
  { code: 'P14', slug: 'freidora-automatica-de-papas', page: 10, type: 'fryerAuto' },
  { code: 'P15', slug: 'modulo-de-comida-4-en-1', page: 10, type: 'cart' },
  { code: 'P19', slug: 'visicooler-580-litros', page: 12, type: 'visicooler', photoExt: 'webp' },
  { code: 'P30', slug: 'licuadora-industrial', page: 19, type: 'blenderSide' },
  { code: 'P31', slug: 'licuadora-industrial-con-base', page: 19, type: 'blenderBase' },
  { code: 'P32', slug: 'maquina-cremoladera-25-l', page: 20, type: 'slush' },
];
for (const spec of specifications) {
  const model = new THREE.Group(); model.name = `INOX_${spec.code}_${spec.type}`;
  model.userData = {
    productCode: spec.code, revision: '1.0', dimensionsVerified: false,
    scale: 'NORMALIZED_VISUAL_SCALE_NOT_PHYSICAL_DIMENSIONS',
    description: 'Reconstrucción visual de fotografía. Escala, zonas ocultas y formas secundarias aproximadas. No usar como plano, receta de material, capacidad calculada o instalación a escala.',
    reference: `INOX304_datos_y_catalogo.pdf, página ${spec.page}; public/images/products/${spec.slug}.${spec.photoExt || 'jpg'}`,
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

  const yellow = new THREE.MeshStandardMaterial({ name: 'Toldo_amarillo', color: 0xffc900, metalness: 0, roughness: 0.65, side: THREE.DoubleSide });
  const canvasRed = new THREE.MeshStandardMaterial({ name: 'Toldo_rojo', color: 0xdc121c, metalness: 0, roughness: 0.65, side: THREE.DoubleSide });
  const handleBlue = new THREE.MeshStandardMaterial({ name: 'Mango_azul', color: 0x134bb6, metalness: 0.06, roughness: 0.28 });
  const tankEdge = new THREE.MeshPhysicalMaterial({ name: 'Bordes_tolva_transparente', color: 0xdbedf5, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.30, depthWrite: false, clearcoat: 0.65 });
  const glassOpaque = new THREE.MeshPhysicalMaterial({ name: 'Cristal_tapa_licuadora', color: 0x88a1ab, metalness: 0.18, roughness: 0.19, clearcoat: 0.65 });
  function lathe(name, profile, pos, mat = steel, segments = 64) {
    return add(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p)), segments), mat, name, pos);
  }
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
    const w = x1 - x0, sh = new THREE.Shape(); sh.moveTo(x0, 1.692); sh.lineTo(x1, 1.692); sh.lineTo(x1, 1.555); sh.quadraticCurveTo((x0 + x1) / 2, 1.505, x0, 1.555); sh.closePath();
    add(new THREE.ShapeGeometry(sh), material, 'Faldon_redondeado_toldo', [0, 0, 0.335]);
    const rear = new THREE.Shape(); rear.moveTo(x0, 1.692); rear.lineTo(x1, 1.692); rear.lineTo(x1, 1.575); rear.quadraticCurveTo((x0 + x1) / 2, 1.525, x0, 1.575); rear.closePath();
    add(new THREE.ShapeGeometry(rear), material, 'Faldon_trasero_toldo', [0, 0, -0.285]);
  }

  if (spec.type.startsWith('fryer')) {
    const double = spec.type === 'fryerDouble', automatic = spec.type === 'fryerAuto';
    const W = double ? 1.00 : 0.58, D = double ? 0.70 : 0.76;
    const top = double ? 0.94 : 1.03, splashH = double ? 0.235 : 0.275;
    wheels(W, D);
    box('Gabinete_lateral_izquierdo', [0.022, top - 0.08, D], [-W / 2 + 0.011, (top + 0.08) / 2, 0], steel, 0.004);
    box('Gabinete_lateral_derecho', [0.022, top - 0.08, D], [W / 2 - 0.011, (top + 0.08) / 2, 0], steel, 0.004);
    box('Gabinete_fondo', [W, top - 0.08, 0.014], [0, (top + 0.08) / 2, -D / 2 + 0.007], steel, 0.003);
    box('Gabinete_base', [W, 0.020, D], [0, 0.09, 0], steel, 0.003);
    box('Panel_mandos', [W - 0.020, 0.175, 0.030], [0, top - 0.102, D / 2 + 0.005], steel, automatic ? 0.018 : 0.009);
    box('Borde_frontal_redondeado', [W, 0.065, 0.075], [0, top - 0.025, D / 2 - 0.010], bright, double ? 0.006 : 0.029);
    box('Respaldo_freidora', [W, splashH, 0.025], [0, top + splashH / 2, -D / 2 + 0.013], steel, 0.004);
    box('Plegado_respaldo', [W, 0.015, 0.035], [0, top + splashH, -D / 2 + 0.015], bright, 0.003);
    for (const x of [-W / 2 + 0.018, W / 2 - 0.018]) box('Marco_encimera_lateral', [0.036, 0.028, D], [x, top, 0], bright, 0.003);
    const doorH = top - 0.295, doorY = 0.105 + doorH / 2;
    if (double) {
      for (const x of [-W / 4, W / 4]) {
        box('Puerta_gabinete', [W / 2 - 0.031, doorH, 0.020], [x, doorY, D / 2 + 0.012], steel, 0.003);
        const hx = x < 0 ? -0.038 : 0.038;
        curve('Tirador_vertical_puerta', [[hx, doorY - 0.10, D / 2 + 0.024], [hx, doorY - 0.075, D / 2 + 0.058], [hx, doorY + 0.075, D / 2 + 0.058], [hx, doorY + 0.10, D / 2 + 0.024]], 0.007);
        for (const y of [doorY - doorH * 0.36, doorY + doorH * 0.36]) cyl('Bisagra_puerta', 0.005, 0.005, 0.055, [Math.sign(x) * (W / 2 - 0.026), y, D / 2 + 0.022], bright);
      }
      for (const x of [-0.245, 0.105]) { well('Poza_independiente', 0.296, 0.51, 0.15, x, top + 0.004, -0.020); basket('Canastilla_doble', 0.274, 0.440, 0.200, x, top + 0.025, -0.045); knob(x, top - 0.105, D / 2 + 0.029, 0.044, true); }
      box('Descanso_lateral_derecho', [0.202, 0.014, D - 0.057], [0.374, top + 0.006, 0.005], steel, 0.002);
      cyl('Perno_visible_descanso', 0.006, 0.008, 0.023, [0.365, top + 0.026, 0.110], black);
    } else {
      box('Puerta_gabinete', [W - 0.047, doorH, 0.021], [0, doorY, D / 2 + 0.014], steel, 0.004);
      horizontalHandle('Tirador_puerta', -0.135, doorY + doorH * 0.34, D / 2 + 0.027, 0.155);
      knob(0.035, top - 0.105, D / 2 + 0.028, automatic ? 0.043 : 0.040);
      well('Cuba_freidora', W - 0.085, D - 0.115, 0.165, 0, top + 0.005, 0);
      for (const x of [-0.128, 0.128]) basket('Canastilla', 0.229, 0.460, 0.196, x, top + 0.025, -0.060);
      line('Soporte_canastillas_trasero', [-0.245, top + 0.205, -D / 2 + 0.041], [0.245, top + 0.205, -D / 2 + 0.041], 0.0035);
      if (automatic) { box('Placa_INOX', [0.116, 0.038, 0.002], [0.170, top + splashH - 0.049, -D / 2 + 0.028], blue, 0.001); text('INOX304', 0.015, [0.170, top + splashH - 0.054, -D / 2 + 0.030], white); }
    }
  }

  if (spec.type === 'cart') {
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
    cyl('Tapa_broastera', 0.121, 0.124, 0.016, [-0.415, top + 0.030, 0.008], bright, [0, 0, 0], 64);
    box('Puente_cierre_broastera', [0.022, 0.020, 0.280], [-0.415, top + 0.059, -0.020], steel, 0.002);
    cyl('Centro_cierre', 0.013, 0.013, 0.030, [-0.415, top + 0.082, -0.020], bright);
    horizontalHandle('Maneral_broastera', -0.415, top + 0.098, -0.074, 0.107, bright);
    well('Poza_freidora_modulo', 0.180, 0.355, 0.085, -0.138, top + 0.020, 0.020);
    basket('Canastilla_modulo', 0.150, 0.270, 0.130, -0.138, top - 0.015, -0.008, green);
    for (const z of [-0.108, 0.105]) { box('Tapa_conservadora', [0.210, 0.007, 0.198], [0.113, top + 0.026, z], bright, 0.004); horizontalHandle('Asa_tapa_conservadora', 0.113, top + 0.031, z, 0.075); }
    box('Plancha_lisa', [0.320, 0.014, 0.454], [0.411, top + 0.027, 0], steel, 0.004);
    box('Reborde_plancha', [0.015, 0.037, 0.454], [0.566, top + 0.046, 0], steel, 0.001);
    for (const x of [-0.610, 0.610]) for (const z of [-0.270, 0.270]) line('Poste_toldo', [x, top - 0.02, z], [x, 1.710, z], 0.009, bright);
    curve('Barra_empuje_derecha', [[0.602, top + 0.030, -0.15], [0.696, top + 0.030, -0.12], [0.696, top + 0.030, 0.19], [0.602, top + 0.030, 0.22]], 0.009, bright);
    const n = 11, width = 1.34;
    for (let i = 0; i < n; i++) canopyStrip(-width / 2 + i * width / n, -width / 2 + (i + 1) * width / n, i % 2 ? canvasRed : yellow);
    for (const z of [-0.270, 0.270]) line('Travesano_toldo', [-0.620, 1.693, z], [0.620, 1.693, z], 0.007, bright);
  }

  if (spec.type === 'visicooler') {
    const W = 0.79, D = 0.64, H = 2.02, insideBottom = 0.365, insideTop = 1.720;
    wheels(W, D);
    box('Base_compresor', [W, insideBottom - 0.080, D], [0, (insideBottom + 0.080) / 2, 0], black, 0.006);
    box('Panel_izquierdo', [0.035, H - 0.080, D], [-W / 2 + 0.0175, (H + 0.080) / 2, 0], white, 0.004);
    box('Panel_derecho', [0.035, H - 0.080, D], [W / 2 - 0.0175, (H + 0.080) / 2, 0], white, 0.004);
    box('Fondo_claro_visicooler', [W - 0.060, insideTop - insideBottom, 0.030], [0, (insideTop + insideBottom) / 2, -D / 2 + 0.015], white, 0.002);
    box('Techo_visicooler', [W, H - insideTop, D], [0, (H + insideTop) / 2, 0], white, 0.005);
    box('Base_interior_visicooler', [W - 0.054, 0.020, D - 0.030], [0, insideBottom, 0.010], white, 0.002);
    for (const x of [-0.337, 0.337]) {
      box('Guia_repisas', [0.014, 1.280, 0.007], [x, 1.020, -0.275], bright, 0.002);
      for (let i = 0; i < 37; i++) box('Ranura_guia', [0.005, 0.008, 0.003], [x, 0.412 + i * 0.033, -0.269], charcoal, 0.001);
    }
    // Five wire shelves are visible in the owner's source, including the low shelf.
    for (const y of [0.424, 0.680, 0.936, 1.192, 1.448]) {
      shelf('Parrilla_visicooler', 0.688, 0.520, 0, y, 0.014, white);
      box('Frente_claro_parrilla', [0.690, 0.034, 0.013], [0, y, 0.281], white, 0.002);
    }
    for (const x of [-0.365, 0.365]) box('Marco_puerta_vertical', [0.036, 1.365, 0.034], [x, 1.0375, D / 2 + 0.020], bright, 0.003);
    for (const y of [insideBottom, insideTop]) box('Marco_puerta_horizontal', [0.762, 0.037, 0.034], [0, y, D / 2 + 0.020], bright, 0.003);
    add(new THREE.PlaneGeometry(0.698, 1.313), glass, 'Puerta_acristalada_cerrada', [0, 1.0425, D / 2 + 0.019]);
    box('Unero_inferior_puerta', [0.145, 0.028, 0.025], [0, 0.397, D / 2 + 0.031], white, 0.005);
    cyl('Cerradura_marco', 0.010, 0.010, 0.007, [-0.225, 1.720, D / 2 + 0.041], bright, [Math.PI / 2, 0, 0]);
    box('Cabecera_negra', [W, 0.284, 0.030], [0, 1.864, D / 2 + 0.016], black, 0.004);
    box('Cartel_azul', [0.718, 0.226, 0.004], [0, 1.874, D / 2 + 0.033], blue, 0.002);
    text('ilumi', 0.144, [0, 1.833, D / 2 + 0.036], white); text('equipamiento comercial', 0.018, [0, 1.795, D / 2 + 0.036], white);
    display(0.328, 1.737, D / 2 + 0.041);
    // Front louvers are actual separated strips over a dark recess.
    box('Fondo_rejilla_base', [0.710, 0.250, 0.004], [0, 0.218, D / 2 + 0.017], black, 0.002);
    for (let i = 0; i < 7; i++) box('Lama_ventilacion', [0.716, 0.021, 0.024], [0, 0.114 + i * 0.033, D / 2 + 0.028], charcoal, 0.005, [-0.18, 0, 0]);
    box('Placa_ilumi_base', [0.120, 0.047, 0.004], [-0.270, 0.319, D / 2 + 0.045], black, 0.001); text('ilumi', 0.031, [-0.270, 0.306, D / 2 + 0.048], white);
  }

  if (spec.type === 'blenderSide' || spec.type === 'blenderBase') {
    const side = spec.type === 'blenderSide', cx = side ? -0.170 : 0, bottom = side ? 0.625 : 0.540;
    const bowlH = side ? 0.600 : 0.575, lowerR = side ? 0.121 : 0.119, upperR = side ? 0.215 : 0.200, centerZ = side ? 0.025 : 0;
    const rimY = bottom + bowlH;
    // Closed vessel: exterior taper and rolled lip only. Capacity is not calculated from this approximation.
    lathe('Vaso_conico_inox', [[lowerR, 0], [lowerR + 0.007, 0.012], [upperR, bowlH - 0.012], [upperR, bowlH], [upperR - 0.005, bowlH], [lowerR - 0.005, 0.010], [lowerR, 0]], [cx, bottom, centerZ]);
    torus('Borde_vaso', upperR, 0.004, [cx, rimY, centerZ]);
    lathe('Tapa_vaso', [[0, 0.050], [0.045, 0.049], [upperR * 0.46, 0.040], [upperR * 0.77, 0.022], [upperR, 0.003], [upperR + 0.004, -0.002]], [cx, rimY, centerZ], side ? bright : glassOpaque);
    torus('Borde_tapa', upperR + 0.002, 0.004, [cx, rimY + 0.002, centerZ]);
    if (side) { cyl('Pomo_tapa', 0.012, 0.006, 0.025, [cx, rimY + 0.064, centerZ], bright); cyl('Cabeza_pomo', 0.014, 0.012, 0.005, [cx, rimY + 0.079, centerZ], bright); }
    else box('Pomo_tapa', [0.083, 0.045, 0.064], [cx, rimY + 0.068, centerZ], bright, 0.003);
    cyl('Collarin_base_vaso', lowerR + 0.010, lowerR + 0.006, 0.070, [cx, bottom - 0.035, centerZ], bright);
    if (side) {
      cyl('Acople_visible', 0.087, 0.087, 0.115, [cx, bottom - 0.128, centerZ], steel);
      box('Plataforma_vaso', [0.280, 0.022, 0.285], [cx, bottom - 0.195, centerZ], steel, 0.004);
      box('Caja_motor_lateral', [0.328, 0.367, 0.350], [0.240, 0.610, -0.003], steel, 0.005);
      box('Tapa_caja_motor', [0.345, 0.023, 0.365], [0.240, 0.804, -0.003], bright, 0.003);
      const slots = []; for (const x of [-0.063, 0.063]) for (let row = 0; row < 4; row++) slots.push([x, -0.090 + row * 0.026, 0.070, 0.010]);
      box('Receso_ventilacion_motor', [0.297, 0.330, 0.004], [0.240, 0.610, 0.175], black, 0.001);
      perforated('Frente_ventilado_motor', 0.304, 0.344, slots, [0.240, 0.610, 0.180]);
      box('Placa_INOX_motor', [0.195, 0.060, 0.002], [0.240, 0.713, 0.184], white, 0.001); text('INOX 304', 0.028, [0.240, 0.701, 0.186], blue);
      // Two triangular tubular frames and a lower platform, as visible in the source.
      for (const z of [-0.235, 0.235]) {
        curve('Bastidor_triangular', [[-0.400, 0.100, z], [-0.432, 0.140, z], [-0.405, 0.214, z], [-0.270, 0.462, z], [-0.155, 0.480, z], [0.408, 0.167, z], [0.428, 0.112, z], [0.384, 0.080, z], [-0.400, 0.080, z]], 0.011, bright);
        line('Pilar_motor', [0.330, 0.158, z * 0.65], [0.330, 0.426, z * 0.65], 0.011);
      }
      box('Plataforma_inferior', [0.555, 0.012, 0.430], [0.030, 0.106, 0], steel, 0.002);
      for (const z of [-0.235, 0.235]) line('Travesano_inferior', [-0.350, 0.080, z], [0.350, 0.080, z], 0.009);
      curve('Asa_vaso', [[cx + upperR * 0.9, rimY - 0.090, centerZ], [cx + upperR + 0.095, rimY - 0.105, centerZ], [cx + lowerR + 0.110, bottom + 0.155, centerZ], [cx + lowerR, bottom + 0.100, centerZ]], 0.010);
      curve('Palanca_visible', [[-0.340, 0.102, 0.266], [-0.371, 0.144, 0.266], [0.208, 1.340, 0.266]], 0.009);
      line('Empunadura_palanca', [0.208, 1.340, 0.266], [0.257, 1.443, 0.266], 0.014, bright);
      // Front clasp, photographed on the rim; no unsupported release animation.
      box('Cierre_tapa', [0.035, 0.082, 0.010], [cx, rimY - 0.033, centerZ + upperR + 0.008], bright, 0.002);
      box('Enganche_tapa', [0.040, 0.024, 0.015], [cx, rimY + 0.001, centerZ + upperR + 0.007], steel, 0.002);
    } else {
      box('Caja_motor_base', [0.355, 0.315, 0.365], [0, 0.315, 0], steel, 0.004);
      box('Cubierta_motor', [0.375, 0.017, 0.385], [0, 0.481, 0], bright, 0.003);
      box('Placa_INOX', [0.115, 0.045, 0.003], [-0.107, 0.438, 0.186], blue, 0.001); text('INOX304', 0.017, [-0.107, 0.427, 0.189], white);
      for (const x of [-0.242, 0.242]) {
        curve('Bastidor_tubular', [[x, 0.099, -0.253], [x, 0.075, -0.210], [x, 0.075, 0.254], [x, 0.121, 0.277], [x, 0.188, 0.235], [x, 0.680, -0.167], [x, 0.774, -0.227], [x, 0.790, -0.277]], 0.011);
        line('Soporte_lateral_caja', [x, 0.360, 0.130], [x, 0.141, -0.220], 0.009);
      }
      for (const z of [-0.235, 0, 0.235]) box('Travesano_base', [0.500, 0.013, 0.065], [0, 0.090, z], bright, 0.002);
      line('Barra_exterior_visible', [0.145, rimY + 0.020, -0.045], [0.250, rimY + 0.268, -0.045], 0.010, bright);
      line('Empunadura_barra', [0.225, rimY + 0.210, -0.045], [0.250, rimY + 0.268, -0.045], 0.015, bright);
      for (const x of [-0.190, 0.190]) for (const z of [-0.215, 0.215]) {
        cyl('Rueda_roja', 0.026, 0.026, 0.021, [x, 0.026, z], red, [0, 0, Math.PI / 2]);
        box('Horquilla_rueda', [0.030, 0.039, 0.025], [x, 0.048, z], bright, 0.003);
      }
    }
    if (side) for (const x of [-0.310, 0.340]) for (const z of [-0.190, 0.190]) {
      cyl('Rueda_base', 0.033, 0.033, 0.024, [x, 0.033, z], black, [0, 0, Math.PI / 2]); box('Horquilla_rueda', [0.032, 0.040, 0.025], [x, 0.058, z], bright, 0.003);
    }
  }

  if (spec.type === 'slush') {
    const W = 0.610, D = 0.480, baseH = 0.455;
    feet(W, D, 0.025);
    box('Cuerpo_cremoladera', [W, baseH - 0.025, D], [0, (baseH + 0.025) / 2, 0], steel, 0.006);
    box('Marco_superior_negro', [W + 0.010, 0.025, D + 0.010], [0, baseH + 0.003, 0], black, 0.004);
    box('Frente_control_negro', [W - 0.040, 0.078, 0.006], [0, baseH - 0.065, D / 2 + 0.005], black, 0.002);
    for (const x of [-0.052, 0.052]) {
      box('Pantalla_control', [0.031, 0.021, 0.003], [x, baseH - 0.050, D / 2 + 0.010], charcoal, 0.002);
      for (const dx of [-0.031, 0, 0.031]) cyl('Boton_control', 0.005, 0.005, 0.003, [x + dx, baseH - 0.080, D / 2 + 0.011], white, [Math.PI / 2, 0, 0], 16);
    }
    box('Placa_marca', [0.155, 0.046, 0.003], [-0.180, 0.145, D / 2 + 0.006], black, 0.001); text('ilumi', 0.035, [-0.180, 0.132, D / 2 + 0.009], white);
    const vents = []; for (let row = 0; row < 13; row++) for (let col = 0; col < 5; col++) vents.push([-0.170 + col * 0.085, -0.150 + row * 0.024, 0.063, 0.009]);
    for (const side of [-1, 1]) {
      box('Fondo_lateral_ventilado', [0.004, 0.362, 0.449], [side * (W / 2 + 0.001), 0.230, 0], black, 0.001);
      perforated('Panel_lateral_perforado', 0.450, 0.365, vents, [side * (W / 2 + 0.004), 0.230, 0], steel, [0, side * Math.PI / 2, 0]);
    }
    for (const x of [-0.151, 0.151]) {
      // Empty hoppers retain the observed silhouette without inventing a juice or hidden auger.
      const p = [[0.045, 0], [0.091, 0.020], [0.124, 0.055], [0.139, 0.105], [0.143, 0.360], [0.145, 0.390]];
      const hopper = lathe('Tolva_vacia', p, [x, baseH + 0.010, -0.003], glass); hopper.scale.z = 1.28;
      const lip = torus('Borde_superior_tolva', 0.145, 0.004, [x, baseH + 0.400, -0.003], tankEdge); lip.scale.z = 1.28;
      const lid = lathe('Tapa_transparente', [[0, 0.025], [0.080, 0.023], [0.125, 0.016], [0.149, 0.002], [0.149, -0.008]], [x, baseH + 0.405, -0.003], glass); lid.scale.z = 1.28;
      box('Pestana_tapa', [0.055, 0.008, 0.026], [x, baseH + 0.413, 0.178], tankEdge, 0.004);
      // Front dispensing lever and spout are directly visible in the supplied photo.
      box('Soporte_grifo', [0.058, 0.178, 0.024], [x, baseH + 0.085, 0.178], black, 0.017);
      box('Palanca_grifo', [0.043, 0.105, 0.025], [x, baseH + 0.103, 0.204], black, 0.015);
      curve('Detalle_metalico_palanca', [[x - 0.014, baseH + 0.045, 0.222], [x - 0.014, baseH + 0.100, 0.232], [x + 0.014, baseH + 0.100, 0.232], [x + 0.014, baseH + 0.045, 0.222]], 0.003, bright);
      cyl('Boquilla_salida', 0.015, 0.013, 0.042, [x, baseH - 0.018, 0.200], black);
      horizontalHandle('Soporte_bandeja_goteo', x, 0.105, 0.246, 0.245, bright);
      const trayZ = 0.338, trayW = 0.284, trayD = 0.215;
      box('Fondo_bandeja_goteo', [trayW, 0.013, trayD], [x, 0.043, trayZ], black, 0.008);
      for (const s of [-1, 1]) { box('Borde_bandeja', [0.009, 0.027, trayD], [x + s * (trayW / 2 - 0.004), 0.053, trayZ], black, 0.004); box('Borde_bandeja', [trayW, 0.027, 0.009], [x, 0.053, trayZ + s * (trayD / 2 - 0.004)], black, 0.004); }
      const slots = []; for (let row = 0; row < 7; row++) for (let col = 0; col < 2; col++) slots.push([(col ? 1 : -1) * 0.065, -0.075 + row * 0.025, 0.103, 0.010]);
      perforated('Rejilla_bandeja_goteo', trayW - 0.020, trayD - 0.020, slots, [x, 0.070, trayZ], charcoal, [-Math.PI / 2, 0, 0]);
      cyl('Orificio_visual_rejilla', 0.012, 0.012, 0.002, [x, 0.073, trayZ], black);
    }
  }

  // The supplied viewpoints do not prove a travel or hinge for these mechanisms.
  // Preserve the photographed pose; the model remains orbitable without fabricated clips.
  model.updateMatrixWorld(true);
  const buckets = new Map();
  model.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const geo = geometry.index ? geometry.toNonIndexed() : geometry; geo.deleteAttribute('uv');
    if (!buckets.has(object.material.uuid)) buckets.set(object.material.uuid, { material: object.material, geometries: [], parts: [] });
    buckets.get(object.material.uuid).geometries.push(geo); buckets.get(object.material.uuid).parts.push(object.name);
  });
  model.clear();
  for (const { material, geometries, parts } of buckets.values()) {
    const geometry = mergeGeometries(geometries, false); if (!geometry) throw new Error(`Could not merge ${spec.code}`);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = material.name; mesh.userData.parts = parts; model.add(mesh);
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  model.userData.visualEnvelopeApproximate = size.toArray();
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true }));
  const report = inspectGlb(bytes);
  if (report.errors.length || report.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(report));
  const output = path.resolve(`public/models/inox/${spec.slug}-v1.glb`); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes);
  console.log(JSON.stringify({ code: spec.code, output, bytes: bytes.length, triangles: report.triangles, meshes: model.children.length, dimensionsVerified: false, visualEnvelopeApproximate: size.toArray(), animations: [] }, null, 2));
}

