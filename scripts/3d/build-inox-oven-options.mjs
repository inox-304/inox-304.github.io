/** Revisable option models: pizza based on the owner's gas-oven photo, without workshop dimensions. */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }).catch(error => this.onerror?.(error));
  }
};

export const ovenOptionSpecs = [
  ...['gas', 'electric'].map(energy => ({ kind: 'pizza', capacity: 2, energy })),
  ...[4, 6, 8, 10].flatMap(capacity => ['gas', 'electric'].flatMap(energy => [false, true].map(glass => ({ kind: 'tavola', capacity, energy, glass })))),
];

export const optionAssetStem = spec => `${spec.kind}-config-${spec.capacity}-${spec.energy}${spec.kind === 'tavola' ? (spec.glass ? '-glass' : '-open') : ''}-v1`;
export const pizzaSourcePhoto = 'https://www.facebook.com/photo.php?fbid=799997833864409';

function roundedRect(w, h, radius = .012, centerX = 0, centerY = 0) {
  const s = new T.Shape(), x = centerX - w / 2, y = centerY - h / 2, r = Math.min(radius, w / 3, h / 3);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}

export function createOvenOptionScene(spec) {
  if (!ovenOptionSpecs.some(item => JSON.stringify(item) === JSON.stringify(spec))) throw new Error('Unknown illustrative oven option');
  const scene = new T.Scene(); scene.name = `INOX_Illustrative_${optionAssetStem(spec)}`;
  scene.userData = {
    version: 1, ...spec, visualOnly: true, dimensionsVerified: false, manufacturingUse: false,
    sourcePhoto: null, optionSource: 'Owner-confirmed option list, 2026-10-23',
    description: 'Diseño ilustrativo revisable, sin fotografía verificada ni medidas comerciales. No es CAD de fabricación.',
    orientation: 'Y up; front +Z', units: 'meters', scaleStatus: 'Scene proportions only; no commercial dimensions are asserted.',
    ...(spec.kind === 'tavola' ? { glassApproval: 'owner-confirmed', glassInterpretation: 'Cover above the trays, independent from gas/electric energy. Exact proportions remain illustrative.' } : {}),
    ...(spec.kind === 'pizza' ? {
      sourcePhoto: pizzaSourcePhoto, sourcePhotoDate: '2020-05-21', sourceEnergy: 'gas',
      referenceFeatures: 'Vertical glazed cabinet, two stacked wire racks, lower controls, rounded front corners and short feet.',
      description: 'Aproximación visual de la fotografía oficial del horno pizzero a gas. Proporciones y apertura lateral ilustrativas, sin medidas comerciales; no es CAD de fabricación.',
      energyDepiction: spec.energy === 'gas' ? 'Gas model based on the official photograph; precise controls are illustrative.' : 'Owner-authorized electric option with illustrative controls, derived from the gas chassis; not a photographed electric model.',
    } : {}),
  };
  const body = new T.Group(); body.name = 'Equipo'; scene.add(body);
  const materials = {
    steel: new T.MeshStandardMaterial({ name: 'Acero_satinado', color: 0xaeb9c1, metalness: .91, roughness: .31 }),
    edge: new T.MeshStandardMaterial({ name: 'Acero_pulido', color: 0xc4ced6, metalness: .94, roughness: .24 }),
    inside: new T.MeshStandardMaterial({ name: 'Interior_acero', color: 0x77838f, metalness: .83, roughness: .39, side: T.DoubleSide }),
    dark: new T.MeshStandardMaterial({ name: 'Mandos_y_juntas', color: 0x171f28, metalness: .15, roughness: .58 }),
    floor: new T.MeshStandardMaterial({ name: 'Base_camara_ilustrativa', color: 0xb7b0a0, metalness: .02, roughness: .85 }),
    white: new T.MeshStandardMaterial({ name: 'Escala_sin_cifras', color: 0xe5e8e9, roughness: .5 }),
    blue: new T.MeshStandardMaterial({ name: 'Pantalla_electrica_sin_valores', color: 0x193e57, emissive: 0x0a3045, emissiveIntensity: .35, roughness: .35 }),
    red: new T.MeshStandardMaterial({ name: 'Piloto_rojo', color: 0xc32b36, roughness: .4 }),
    glass: new T.MeshPhysicalMaterial({ name: 'Vidrio_ilustrativo_sin_especificacion', color: 0x9bbac8, metalness: 0, roughness: .12, transparent: true, opacity: .19, depthWrite: false, side: T.DoubleSide }),
  };
  const buckets = new Map(); let target = body;
  function add(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const transform = new T.Matrix4().compose(new T.Vector3(...position), new T.Quaternion().setFromEuler(new T.Euler(...rotation)), new T.Vector3(1, 1, 1));
    const geo = geometry.index ? geometry.toNonIndexed() : geometry; geo.deleteAttribute('uv'); geo.applyMatrix4(transform);
    const key = `${target.uuid}:${material.uuid}`;
    if (!buckets.has(key)) buckets.set(key, { target, material, geometries: [] });
    buckets.get(key).geometries.push(geo);
  }
  const box = (size, position, material = materials.steel, r = .003) => add(r ? new RoundedBoxGeometry(...size, 2, Math.min(r, ...size.map(n => n / 3))) : new T.BoxGeometry(...size), material, position);
  const cylinder = (radius, length, position, material = materials.edge, rotation = [0, 0, 0]) => add(new T.CylinderGeometry(radius, radius, length, 24), material, position, rotation);
  function bar(a, b, radius = .008, material = materials.edge) {
    const av = new T.Vector3(...a), bv = new T.Vector3(...b), delta = bv.clone().sub(av);
    const geometry = new T.CylinderGeometry(radius, radius, delta.length(), 14);
    geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()));
    add(geometry, material, av.add(bv).multiplyScalar(.5).toArray());
  }
  function group(name, position, build, parent = body, metadata = {}) {
    const node = new T.Group(); node.name = name; node.position.set(...position); node.userData = metadata; parent.add(node);
    const previous = target; target = node; build(node); target = previous; return node;
  }
  function panel(w, h, thickness, position, material = materials.steel, hole) {
    const shape = roundedRect(w, h, .009);
    if (hole) shape.holes.push(roundedRect(hole[0], hole[1], .018));
    add(new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 7 }), material, position);
  }
  function deck(w, d, y, holes = []) {
    const shape = roundedRect(w, d);
    for (const hole of holes) shape.holes.push(roundedRect(hole.w, hole.d, .012, hole.x, -hole.z));
    add(new T.ExtrudeGeometry(shape, { depth: .018, bevelEnabled: false, curveSegments: 7 }), materials.edge, [0, y - .018, 0], [-Math.PI / 2, 0, 0]);
  }
  function knob(x, y, z, radius = .023) {
    cylinder(radius + .004, .005, [x, y, z], materials.edge, [Math.PI / 2, 0, 0]);
    cylinder(radius, .026, [x, y, z + .014], materials.dark, [Math.PI / 2, 0, 0]);
    box([.004, radius * .6, .003], [x, y + radius * .4, z + .028], materials.white, .0005);
  }
  function energyPanel(x, y, z) {
    group(`Controles_${spec.energy}`, [x, y, z], () => {
      box([.22, .18, .015], [0, 0, 0], materials.steel);
      if (spec.energy === 'gas') {
        cylinder(.026, .008, [0, .05, .012], materials.edge, [Math.PI / 2, 0, 0]);
        cylinder(.022, .009, [0, .05, .016], materials.white, [Math.PI / 2, 0, 0]);
        bar([0, .05, .023], [.012, .061, .023], .0015, materials.dark);
        knob(0, -.025, .01, .028);
        cylinder(.006, .005, [.074, -.025, .013], materials.red, [Math.PI / 2, 0, 0]);
      } else {
        box([.13, .052, .006], [0, .045, .012], materials.dark);
        box([.108, .029, .007], [0, .045, .016], materials.blue);
        knob(-.05, -.035, .01, .022); knob(.05, -.035, .01, .022);
      }
    }, body, { role: 'energyControls', energy: spec.energy, depiction: 'Illustrative control layout; no values, power or temperatures asserted.' });
  }
  function stand(w, d, top, shelf = true) {
    for (const x of [-w / 2 + .04, w / 2 - .04]) for (const z of [-d / 2 + .04, d / 2 - .04]) {
      box([.035, top - .05, .035], [x, (top + .05) / 2, z]);
      cylinder(.026, .045, [x, .0225, z], materials.dark);
    }
    if (shelf) { box([w - .055, .022, d - .055], [0, .18, 0]); for (const z of [-d / 2 + .035, d / 2 - .035]) box([w - .055, .025, .009], [0, .197, z]); }
  }
  function tray(index, x, y, z, w, d, height) {
    return group(`Bandeja_${index + 1}`, [x, y, z], () => {
      box([w - .012, .005, d - .012], [0, 0, 0], materials.inside, .002);
      for (const side of [-1, 1]) {
        box([.006, height, d], [side * (w - .006) / 2, height / 2, 0], materials.inside, .002);
        box([w, height, .006], [0, height / 2, side * (d - .006) / 2], materials.inside, .002);
        box([.018, .007, d + .018], [side * (w - .006) / 2, height, 0], materials.edge, .002);
        box([w + .018, .007, .018], [0, height, side * (d - .006) / 2], materials.edge, .002);
      }
    }, body, { role: 'tray', index: index + 1, capacityUnit: 'bandejas', dimensionsVerified: false });
  }
  const animations = [];
  if (spec.kind === 'pizza') {
    const w = .77, d = .64, base = .075, top = 1.00, front = d / 2;
    const chamberBottom = .25, chamberTop = .85, rackWidth = .61, rackDepth = .52;
    // Photo-led silhouette only: no dimension or hinge specification is asserted.
    for (const x of [-w / 2 + .055, w / 2 - .055]) for (const z of [-d / 2 + .055, d / 2 - .055]) {
      box([.075, .075, .075], [x, .0375, z], materials.steel, .008);
    }
    box([w, .175, d], [0, base + .0875, 0], materials.steel, .025);
    box([w, .15, d], [0, top - .075, 0], materials.steel, .028);
    box([w - .06, .012, d - .055], [0, chamberBottom + .006, 0], materials.edge);
    for (const side of [-1, 1]) {
      box([.075, top - base, .095], [side * (w - .075) / 2, (top + base) / 2, front - .0475], materials.steel, .025);
      box([.025, chamberTop - chamberBottom, .025], [side * (w - .035) / 2, (chamberTop + chamberBottom) / 2, -d / 2 + .015], materials.edge);
      box([.004, chamberTop - chamberBottom - .012, d - .105], [side * (w - .018) / 2, (chamberTop + chamberBottom) / 2, -.015], materials.glass, .001);
    }
    box([w - .055, chamberTop - chamberBottom - .012, .004], [0, (chamberTop + chamberBottom) / 2, -d / 2 + .012], materials.glass, .001);
    for (let index = 0; index < 2; index++) {
      const y = .405 + index * .225;
      group(`Rejilla_${index + 1}`, [0, y, -.012], () => {
        for (const z of [-rackDepth / 2, rackDepth / 2]) bar([-rackWidth / 2, 0, z], [rackWidth / 2, 0, z], .005);
        for (const x of [-rackWidth / 2, rackWidth / 2]) bar([x, 0, -rackDepth / 2], [x, 0, rackDepth / 2], .005);
        for (let rod = 0; rod < 19; rod++) {
          const z = (rod / 18 - .5) * (rackDepth - .022);
          bar([-rackWidth / 2 + .006, .002, z], [rackWidth / 2 - .006, .002, z], .003);
        }
        bar([0, -.004, -rackDepth / 2], [0, -.004, rackDepth / 2], .004);
      }, body, { role: 'tray', type: 'wireRack', index: index + 1, capacityUnit: 'rejillas', sourcePhoto: pizzaSourcePhoto, dimensionsVerified: false });
      for (const side of [-1, 1]) box([.018, .012, rackDepth + .025], [side * (rackWidth + .025) / 2, y - .01, -.012], materials.edge);
    }
    const doorWidth = .616, doorHeight = .596, hingeX = -doorWidth / 2, hingeY = chamberBottom + .002;
    const door = group('Puerta_horno_pizza', [hingeX, hingeY, front + .006], () => {
      panel(doorWidth, doorHeight, .009, [doorWidth / 2, doorHeight / 2, 0], materials.edge, [doorWidth - .025, doorHeight - .025]);
      box([doorWidth - .023, doorHeight - .023, .004], [doorWidth / 2, doorHeight / 2, .006], materials.glass, .003);
      group('Pomo_derecho', [doorWidth - .023, doorHeight * .49, 0], () => {
        box([.037, .041, .014], [0, 0, .015], materials.edge, .004);
        cylinder(.018, .025, [0, 0, .033], materials.edge, [Math.PI / 2, 0, 0]);
        cylinder(.013, .004, [0, 0, .047], materials.white, [Math.PI / 2, 0, 0]);
      }, target, { role: 'doorHandle', sideInClosedFront: 'right' });
    }, body, { role: 'ovenDoor', closedByDefault: true, openingIllustrative: true, openingMechanism: 'Side-swing visual approximation; actual hinge mechanism is not verified.' });
    const closed = new T.Quaternion(), open = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI * .49);
    animations.push(new T.AnimationClip('Abrir_puertas', 1.2, [new T.QuaternionKeyframeTrack(`${door.name}.quaternion`, [0, .1, 1.05, 1.2], [...closed.toArray(), ...closed.toArray(), ...open.toArray(), ...open.toArray()])]));
    group(`Controles_${spec.energy}`, [0, .16, front + .007], () => {
      if (spec.energy === 'gas') {
        for (const x of [-.10, .10]) {
          box([.097, .101, .005], [x, 0, 0], materials.white, .002);
          box([.085, .088, .006], [x, 0, .004], materials.blue, .002);
          for (let tick = 0; tick < 9; tick++) {
            const a = Math.PI * (.12 + tick * .095);
            bar([x + Math.cos(a) * .029, -.006 + Math.sin(a) * .029, .009], [x + Math.cos(a) * .036, -.006 + Math.sin(a) * .036, .009], .001, materials.white);
          }
          cylinder(.021, .026, [x, -.014, .02], materials.white, [Math.PI / 2, 0, 0]);
          box([.003, .017, .004], [x, -.010, .035], materials.dark, .0005);
        }
      } else {
        box([.14, .06, .008], [-.12, .008, .008], materials.dark);
        box([.117, .038, .009], [-.12, .008, .013], materials.blue);
        knob(.065, 0, .005, .025); knob(.15, 0, .005, .025);
        cylinder(.005, .005, [.22, .017, .009], materials.red, [Math.PI / 2, 0, 0]);
      }
    }, body, { role: 'energyControls', energy: spec.energy, depiction: spec.energy === 'gas' ? 'Lower paired dials visually based on the photo; no ratings asserted.' : 'Illustrative electric controls; no photographed electric variant or ratings asserted.' });
  } else {
    const columns = spec.capacity / 2, pitch = .31, w = columns * pitch + .16, d = .81, top = .91;
    stand(w, d, top - .20);
    for (const side of [-1, 1]) {
      box([w, .18, .018], [0, top - .11, side * (d - .018) / 2]);
      box([.018, .18, d - .036], [side * (w - .018) / 2, top - .11, 0]);
    }
    box([w - .03, .018, d - .03], [0, top - .19, 0], materials.inside);
    const holes = [];
    for (let row = 0; row < 2; row++) for (let column = 0; column < columns; column++) {
      const x = (column - (columns - 1) / 2) * pitch, z = (row - .5) * .35;
      holes.push({ x, z, w: .275, d: .315 });
      tray(row * columns + column, x, top - .10, z, .273, .313, .105);
    }
    deck(w + .035, d + .025, top, holes);
    energyPanel(0, top - .105, d / 2 + .005);
    if (spec.glass) group('Cubierta_vidrio_opcional', [0, 0, 0], () => {
      const supportX = w / 2 - .055;
      for (const x of [-supportX, supportX]) for (const z of [-.34, .34]) {
        box([.023, .37, .023], [x, top + .19, z], materials.edge);
        cylinder(.022, .009, [x, top + .013, z]);
      }
      box([w + .018, .006, d + .018], [0, top + .38, 0], materials.glass, .002);
      box([w - .04, .24, .006], [0, top + .25, -.35], materials.glass, .002);
      for (const x of [-supportX, supportX]) bar([x, top + .378, -.36], [x, top + .378, .36], .007);
    }, body, { role: 'optionalGlass', ownerApproval: 'owner-confirmed', purpose: 'cover-above-trays', exactProportions: 'illustrative' });
  }
  for (const { target: parent, material, geometries } of buckets.values()) {
    const mesh = new T.Mesh(mergeGeometries(geometries), material); mesh.name = `${parent.name}_${material.name}`;
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  }
  scene.updateMatrixWorld(true); return { scene, animations };
}

async function build() {
  const pizzaOnly = process.argv.includes('--pizza-only');
  const manifestPath = '.work/hornos-audit-20261023/model-manifest.json';
  const previous = pizzaOnly ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : [];
  const manifest = [];
  await fs.mkdir('public/models/inox', { recursive: true });
  await fs.mkdir('.work/hornos-audit-20261023', { recursive: true });
  for (const spec of ovenOptionSpecs) {
    if (pizzaOnly && spec.kind !== 'pizza') {
      const preserved = previous.find(item => item.model3d === `/models/inox/${optionAssetStem(spec)}.glb`);
      if (!preserved) throw new Error(`Cannot preserve missing manifest entry: ${optionAssetStem(spec)}`);
      manifest.push(preserved); continue;
    }
    const { scene, animations } = createOvenOptionScene(spec);
    const bytes = Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, animations }));
    const budget = inspectGlb(bytes);
    if (budget.errors.length || bytes.length > 8 * 1024 * 1024) throw new Error(`${optionAssetStem(spec)}: ${budget.errors.join('; ') || 'Exceeds 8 MB'}`);
    const model3d = `/models/inox/${optionAssetStem(spec)}.glb`;
    await fs.writeFile(`public${model3d}`, bytes);
    manifest.push({ ...spec, model3d, doorAnimation: animations[0]?.name || '', bytes: bytes.length, triangles: budget.triangles, illustrative: true, photoVerified: spec.kind === 'pizza' && spec.energy === 'gas', ...(spec.kind === 'pizza' ? { sourcePhoto: pizzaSourcePhoto, sourceEnergy: 'gas', electricAppearanceIllustrative: spec.energy === 'electric', poster: `/images/products/${optionAssetStem(spec)}.webp` } : { glassApproval: 'owner-confirmed' }) });
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ count: manifest.length, regenerated: pizzaOnly ? 2 : manifest.length, largestBytes: Math.max(...manifest.map(item => item.bytes)), maxTriangles: Math.max(...manifest.map(item => item.triangles)), manifest: manifestPath }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await build();
