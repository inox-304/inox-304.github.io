/** Countable illustrative loads on immutable photo-derived P07/P08 chassis. */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

const sourceModels = {
  P07: 'horno-ecologico-para-pollo-a-la-brasa-v2.glb',
  P08: 'horno-pollero-ecologico-v2.glb',
};
export const capacities = [12, 18, 24, 30];
export const fuels = ['lena', 'carbon'];
const outputRoot = 'public/models/inox';

export function createRoastChicken() {
  const root = new T.Group(); root.name = 'Pollo_asado';
  root.userData = { illustration: 'Pollo entero asado, carga de presentación', countAsChicken: true };
  const skin = new T.MeshStandardMaterial({ name: 'Piel_dorada_asada', vertexColors: true, roughness: .66, metalness: 0 });
  const bone = new T.MeshStandardMaterial({ name: 'Extremos_hueso_claros', color: 0xdec8a6, roughness: .65 });
  const skinParts = [], boneParts = [];
  const golden = new T.Color(0x92420f), brown = new T.Color(0x3b1908), light = new T.Color(0xbd6c24);
  function ellipsoid(scale, position, rotation = [0, 0, 0], material = skin, detail = 24) {
    const geometry = new T.SphereGeometry(1, detail, Math.max(12, Math.round(detail * .65)));
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
      const grain = 1 + .009 * Math.sin(x * 39 + z * 23) * Math.cos(y * 34 - x * 11);
      vertices.setXYZ(i, x * grain, y * grain, z * grain);
    }
    geometry.computeVertexNormals();
    geometry.applyMatrix4(new T.Matrix4().compose(new T.Vector3(...position), new T.Quaternion().setFromEuler(new T.Euler(...rotation)), new T.Vector3(...scale)));
    geometry.deleteAttribute('uv');
    if (material === skin) {
      const points = geometry.getAttribute('position'), colors = [];
      for (let i = 0; i < points.count; i++) {
        const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
        const toast = (Math.sin(x * 160 + z * 110) * Math.cos(y * 190 + x * 70) + 1) / 2;
        const shade = golden.clone().lerp(y > .008 ? light : brown, y > .008 ? .15 + toast * .26 : .10 + toast * .3);
        if (toast > .74) shade.lerp(brown, (toast - .74) * 1.6);
        colors.push(shade.r, shade.g, shade.b);
      }
      geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); skinParts.push(geometry);
    } else boneParts.push(geometry);
  }
  // Plump breast, folded wings, paired thighs and tied drumsticks form a recognizable whole bird.
  ellipsoid([.066, .045, .050], [0, .005, 0], [0, 0, -.08], skin, 32);
  for (const side of [-1, 1]) {
    ellipsoid([.051, .037, .030], [-.005, .021, side * .021], [side * .08, 0, -.08]);
    ellipsoid([.032, .029, .027], [.039, -.017, side * .039], [0, side * .35, .12]);
    ellipsoid([.034, .019, .019], [.066, -.024, side * .045], [0, side * -.28, -.20]);
    ellipsoid([.012, .010, .010], [.091, -.030, side * .038], [0, 0, 0], bone, 16);
    ellipsoid([.030, .013, .013], [-.025, -.002, side * .050], [0, side * .28, -.38]);
    ellipsoid([.019, .010, .010], [-.042, .014, side * .049], [0, side * -.25, .48]);
  }
  ellipsoid([.015, .020, .025], [-.059, -.011, 0]);
  const skinMesh = new T.Mesh(mergeVertices(mergeGeometries(skinParts), 1e-6), skin); skinMesh.name = 'Pollo_piel_pechuga_alas_muslos'; root.add(skinMesh);
  const boneMesh = new T.Mesh(mergeVertices(mergeGeometries(boneParts), 1e-6), bone); boneMesh.name = 'Pollo_extremos_muslos'; root.add(boneMesh);
  skinParts.forEach(geometry => geometry.dispose()); boneParts.forEach(geometry => geometry.dispose());
  return root;
}

function createFuel(design, fuel) {
  const root = new T.Group(); root.name = fuel === 'lena' ? 'Combustible_lena' : 'Combustible_carbon';
  root.userData = { fuel, visualOnly: true, purpose: 'Identificación visual del combustible elegido; ubicación y carga ilustrativas, no un diseño de combustión.' };
  const cx = design === 'P07' ? -.19 : -.23, y = .215, z = .055;
  const metal = new T.MeshStandardMaterial({ name: 'Bandeja_combustible_ilustrativa', color: 0x353b3d, metalness: .6, roughness: .65 });
  const tray = new T.Mesh(new T.BoxGeometry(.28, .012, .32), metal); tray.position.set(cx, y, z); root.add(tray);
  if (fuel === 'lena') {
    const bark = new T.MeshStandardMaterial({ name: 'Lena_corteza', color: 0x543522, roughness: .95 });
    const cut = new T.MeshStandardMaterial({ name: 'Lena_corte', color: 0xb38950, roughness: .88 });
    const geometry = new T.CylinderGeometry(.027, .032, .24, 9);
    for (let i = 0; i < 5; i++) {
      const log = new T.Mesh(geometry, [bark, cut, cut]); log.name = `Leno_${i + 1}`;
      log.rotation.x = Math.PI / 2; log.rotation.z = i % 2 ? -.10 : .10;
      log.position.set(cx + (i % 3 - 1) * .068, y + .039 + Math.floor(i / 3) * .048, z); root.add(log);
    }
  } else {
    const coal = new T.MeshStandardMaterial({ name: 'Carbon_vegetal', color: 0x252320, roughness: .95 });
    const geometry = new T.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 18; i++) {
      const lump = new T.Mesh(geometry, coal); lump.name = `Trozo_carbon_${i + 1}`;
      lump.scale.set(.021 + (i % 3) * .003, .022 + (i % 2) * .005, .028);
      lump.rotation.set(i * .7, i * .42, i * .83);
      lump.position.set(cx + (i % 4 - 1.5) * .057, y + .033 + Math.floor(i / 12) * .032, z + (Math.floor(i / 4) % 3 - 1) * .082); root.add(lump);
    }
  }
  return root;
}

export async function buildPollero(design, fuel, capacity) {
  if (!sourceModels[design] || !fuels.includes(fuel) || !capacities.includes(capacity)) throw new Error('Variante pollero desconocida.');
  const input = await fs.readFile(`${outputRoot}/${sourceModels[design]}`);
  const source = await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '');
  const root = new T.Scene(); root.add(...source.scene.children);
  root.name = `INOX_${design}_${fuel}_${capacity}_pollos`;
  root.userData = { ...root.getObjectByName(`INOX304_${design}`)?.userData, configurableRoaster: { design, fuel, capacity, spitCount: 6, chickensPerSpit: capacity / 6 },
    manufacturingUse: false, dimensionsVerified: false, visualOnly: true,
    sourceGlb: sourceModels[design], sourceSha256: crypto.createHash('sha256').update(input).digest('hex'),
    foodDisplay: 'Carga ilustrativa con número exacto de pollos. No representa tamaño, peso ni rendimiento de cocción garantizado.' };
  const load = new T.Group(); load.name = 'Carga_pollos'; root.add(load);
  const template = createRoastChicken(), count = capacity / 6, radius = design === 'P07' ? .185 : .210, cz = design === 'P07' ? .025 : .005;
  for (let spit = 0; spit < 6; spit++) {
    const angle = spit * Math.PI / 3, y = 1.10 + Math.sin(angle) * radius * .92, z = cz + Math.cos(angle) * radius * .92;
    const group = new T.Group(); group.name = `Espada_carga_${String(spit + 1).padStart(2, '0')}`; group.userData.chickenCount = count; load.add(group);
    for (let slot = 0; slot < count; slot++) {
      const bird = template.clone(true); bird.name = `Pollo_${String(spit * count + slot + 1).padStart(2, '0')}`;
      bird.userData = { countAsChicken: true, spit: spit + 1, slot: slot + 1 };
      const pitch = .69 / count;
      bird.position.set((slot - (count - 1) / 2) * pitch - .014, y, z);
      bird.scale.setScalar(.76);
      // Alternating small rotations avoid a rigid identical outline while preserving exact occupancy.
      bird.rotation.x = (spit % 2 ? -1 : 1) * .10; group.add(bird);
    }
  }
  root.add(createFuel(design, fuel));
  return { root, animations: source.animations, template };
}

export async function generatePolleros() {
  globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.({ target: this }); }).catch(error => this.onerror?.(error)); } };
  const manifest = [];
  for (const design of Object.keys(sourceModels)) for (const fuel of fuels) for (const capacity of capacities) {
    const { root, animations } = await buildPollero(design, fuel, capacity);
    const bytes = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, animations, trs: true }));
    const budget = inspectGlb(bytes);
    if (budget.errors.length || budget.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(budget));
    const filename = `pollero-config-${design.toLowerCase()}-${fuel}-${capacity}-v1.glb`;
    await fs.writeFile(`${outputRoot}/${filename}`, bytes);
    manifest.push({ productId: design, design, fuel, capacity, capacityUnit: 'pollos', model3d: `/models/inox/${filename}`, poster: `/images/products/${filename.replace('.glb', '.webp')}`, doorAnimation: 'Abrir_puertas', bytes: bytes.length, triangles: budget.triangles });
  }
  if (manifest.reduce((sum, item) => sum + item.bytes, 0) > 40 * 1024 * 1024) throw new Error('El conjunto supera 40 MiB.');
  await fs.writeFile('scripts/3d/pollero-config-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ assets: manifest.length, bytes: manifest.reduce((sum, item) => sum + item.bytes, 0), manifest: 'scripts/3d/pollero-config-manifest.json' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generatePolleros();
