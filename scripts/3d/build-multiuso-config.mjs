/** P06 configurations derived from the immutable photo-based GLB, never overlaid on old racks. */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';

export const capacities = [4, 6, 8, 10];
export const modes = ['convencional', 'conveccion'];
const sourcePath = 'public/models/inox/horno-multiuso-v2.glb';
const originalRackLevels = [.845, 1.045, 1.245, 1.445];

/** The source generator places four 19-bar racks in these exact bounds.
 * All 4,032 source rack triangles must be removed, or generation stops. */
export function removeSourceRacks(root) {
  let removed = 0, affected = 0;
  root.traverse(node => {
    if (!node.isMesh || node.name !== 'Fijo_Acero_pulido') return;
    const original = node.geometry, positions = original.getAttribute('position'), index = original.index, kept = [];
    const count = index?.count ?? positions.count;
    for (let triangle = 0; triangle < count; triangle += 3) {
      const indices = [0, 1, 2].map(offset => index ? index.getX(triangle + offset) : triangle + offset);
      const rack = originalRackLevels.some(y => indices.every(i => Math.abs(positions.getY(i) - y) <= .00401 && Math.abs(positions.getX(i)) <= .39651 && Math.abs(positions.getZ(i)) <= .29901));
      if (rack) removed++; else kept.push(...indices);
    }
    if (kept.length !== count) {
      const geometry = original.clone(); geometry.setIndex(kept); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      node.geometry = geometry; node.userData = { ...node.userData, parts: node.userData.parts.filter(part => !['Varilla_rejilla', 'Marco_rejilla'].includes(part)) }; affected++;
    }
  });
  if (removed !== 4032 || affected !== 1) throw new Error(`Source rack contract changed: removed=${removed}, affected=${affected}`);
  return removed;
}

function createTrays(capacity, convection) {
  const root = new T.Group(); root.name = 'Bandejas_configurables';
  const material = new T.MeshStandardMaterial({ name: 'Bandejas_acero_satinado', color: 0xa8b2bb, metalness: .88, roughness: .34 });
  const barGeometry = new T.BoxGeometry(1, 1, 1), width = .735, depth = convection ? .49 : .54, z = convection ? .035 : 0;
  const box = (group, name, scale, position) => { const mesh = new T.Mesh(barGeometry, material); mesh.name = name; mesh.scale.set(...scale); mesh.position.set(...position); group.add(mesh); };
  for (let i = 0; i < capacity; i++) {
    const group = new T.Group(); group.name = `Bandeja_${String(i + 1).padStart(2, '0')}`; group.userData = { countAsTray: true, level: i + 1 };
    group.position.y = .845 + i * .60 / (capacity - 1); root.add(group);
    box(group, 'Fondo_bandeja', [width, .003, depth], [0, 0, z]);
    for (const x of [-width / 2, width / 2]) box(group, 'Borde_lateral_bandeja', [.004, .016, depth], [x, .007, z]);
    for (const side of [-1, 1]) box(group, 'Borde_frontal_posterior', [width, .016, .004], [0, .007, z + side * depth / 2]);
    for (const side of [-1, 1]) box(group, 'Guia_bandeja', [.018, .008, depth + .01], [side * (width / 2 + .015), -.007, z]);
  }
  return root;
}

function createConvectionFan() {
  const root = new T.Group(); root.name = 'Ventilador_conveccion';
  root.userData = { visualOnly: true, purpose: 'Identifica visualmente la opción de ventilación; sin especificaciones de caudal, potencia o temperatura.' };
  root.position.set(0, 1.20, -.285);
  const steel = new T.MeshStandardMaterial({ name: 'Proteccion_ventilador', color: 0x89949d, metalness: .78, roughness: .34 });
  const dark = new T.MeshStandardMaterial({ name: 'Aspas_ventilador', color: 0x26333b, metalness: .45, roughness: .49 });
  const backing = new T.Mesh(new T.CylinderGeometry(.137, .137, .018, 48), dark); backing.rotation.x = Math.PI / 2; backing.name = 'Alojamiento_ventilador'; root.add(backing);
  const center = new T.Mesh(new T.CylinderGeometry(.023, .023, .024, 24), steel); center.rotation.x = Math.PI / 2; center.position.z = .015; center.name = 'Eje_ventilador'; root.add(center);
  const bladeGeometry = new T.SphereGeometry(1, 16, 8);
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5, blade = new T.Mesh(bladeGeometry, steel); blade.name = `Aspa_${i + 1}`;
    blade.position.set(Math.cos(angle) * .068, Math.sin(angle) * .068, .015); blade.rotation.z = angle + .35; blade.scale.set(.061, .022, .005); root.add(blade);
  }
  for (const radius of [.042, .075, .110, .137]) { const ring = new T.Mesh(new T.TorusGeometry(radius, .0028, 6, 48), steel); ring.name = 'Rejilla_circular_ventilador'; ring.position.z = .029; root.add(ring); }
  return root;
}

export async function buildMultiuso(mode, capacity) {
  if (!modes.includes(mode) || !capacities.includes(capacity)) throw new Error('Configuración multiuso desconocida.');
  const input = await fs.readFile(sourcePath), source = await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '');
  const removedSourceRackTriangles = removeSourceRacks(source.scene);
  const root = new T.Scene(); root.name = `INOX_P06_${mode}_${capacity}_bandejas`; root.add(...source.scene.children);
  root.userData = { ...root.getObjectByName('INOX304_P06').userData, configurableOven: { productId: 'P06', mode, capacity, capacityUnit: 'bandejas' },
    manufacturingUse: false, dimensionsVerified: false, visualOnly: true, sourceGlb: 'horno-multiuso-v2.glb', sourceSha256: crypto.createHash('sha256').update(input).digest('hex'),
    removedSourceRackTriangles, description: 'Capacidad ilustrada con bandejas contables. Convección añade ventilador visible; medidas, separaciones y prestaciones requieren confirmación de fabricación.' };
  root.add(createTrays(capacity, mode === 'conveccion'));
  if (mode === 'conveccion') root.add(createConvectionFan());
  return { root, animations: source.animations };
}

export async function generateMultiuso() {
  globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.({ target: this }); }).catch(error => this.onerror?.(error)); } };
  const manifest = [];
  for (const mode of modes) for (const capacity of capacities) {
    const { root, animations } = await buildMultiuso(mode, capacity);
    const bytes = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, animations, trs: true })), report = inspectGlb(bytes);
    if (report.errors.length || report.warnings.length) throw new Error(JSON.stringify(report));
    const filename = `multiuso-config-p06-${mode}-${capacity}-v1.glb`;
    await fs.writeFile(`public/models/inox/${filename}`, bytes);
    manifest.push({ productId: 'P06', mode, capacity, capacityUnit: 'bandejas', model3d: `/models/inox/${filename}`, poster: `/images/products/${filename.replace('.glb', '.webp')}`, doorAnimation: 'Abrir_puertas', bytes: bytes.length, triangles: report.triangles });
  }
  await fs.writeFile('scripts/3d/multiuso-config-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ assets: manifest.length, bytes: manifest.reduce((sum, item) => sum + item.bytes, 0), manifest: 'scripts/3d/multiuso-config-manifest.json' }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generateMultiuso();
