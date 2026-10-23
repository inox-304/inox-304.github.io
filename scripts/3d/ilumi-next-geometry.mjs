/** Shared geometry/export helpers for the separately reviewed next ILUMI models. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { inspectGlb } from '../lib/model-budget.mjs';
export { THREE };
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }).catch(error => this.onerror?.(error)); }
};
const font = new FontLoader().parse(JSON.parse(await fs.readFile(new URL('../../node_modules/three/examples/fonts/helvetiker_regular.typeface.json', import.meta.url), 'utf8')));
export function materials() {
  return {
    white: new THREE.MeshPhysicalMaterial({ name: 'Pintura_blanca', color: 0xf0f2f3, roughness: .3, metalness: .06, clearcoat: .3 }),
    red: new THREE.MeshPhysicalMaterial({ name: 'Pintura_roja', color: 0xb31113, roughness: .23, metalness: .12, clearcoat: .5 }),
    steel: new THREE.MeshStandardMaterial({ name: 'Acero_satinado', color: 0xb7c0c8, roughness: .27, metalness: .94 }),
    chrome: new THREE.MeshStandardMaterial({ name: 'Acero_pulido', color: 0xd1d8dd, roughness: .16, metalness: .98 }),
    black: new THREE.MeshStandardMaterial({ name: 'Polimero_negro', color: 0x10151b, roughness: .36 }),
    navy: new THREE.MeshStandardMaterial({ name: 'Polimero_azul', color: 0x243e55, roughness: .37 }),
    dark: new THREE.MeshStandardMaterial({ name: 'Recesos_oscuros', color: 0x06090d, roughness: .8 }),
    rubber: new THREE.MeshStandardMaterial({ name: 'Goma', color: 0x151719, roughness: .8 }),
    bright: new THREE.MeshStandardMaterial({ name: 'Marca_blanca', color: 0xf3f5f7, roughness: .55 }),
    green: new THREE.MeshStandardMaterial({ name: 'Boton_verde', color: 0x009878, roughness: .3 }),
    yellow: new THREE.MeshStandardMaterial({ name: 'Boton_amarillo', color: 0xf5bc21, roughness: .3 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'Cubierta_transparente', color: 0xe3edf4, transparent: true, opacity: .15, depthWrite: false, side: THREE.DoubleSide, roughness: .12, clearcoat: .6 }),
  };
}
export function builder(sku, meta = {}) {
  const root = new THREE.Group(); root.name = `ILUMI_${sku.replaceAll('-', '_')}`;
  root.userData = { units: 'meters', revision: '1.0', description: 'Visualización 3D aproximada a partir de fotografías; diseño fijo del fabricante. No es CAD ni receta de fabricación.', ...meta };
  const groups = new Map();
  function add(geometry, material, name, pos = [0, 0, 0], rot = [0, 0, 0], parent = root) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(...pos); mesh.rotation.set(...rot);
    if (parent !== root) { parent.add(mesh); return mesh; }
    mesh.updateMatrix(); geometry.applyMatrix4(mesh.matrix);
    const g = geometry.index ? geometry.toNonIndexed() : geometry; g.deleteAttribute('uv');
    if (!groups.has(material.uuid)) groups.set(material.uuid, { material, geometries: [], names: [] });
    groups.get(material.uuid).geometries.push(g); groups.get(material.uuid).names.push(name); return mesh;
  }
  const box = (name, size, pos, mat, radius = .003, rot = [0, 0, 0], parent = root) => add(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(v => v / 2))), mat, name, pos, rot, parent);
  function panel(name, width, height, depth, radius, pos, mat, rot = [0, 0, 0]) {
    const s = new THREE.Shape(), x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2);
    s.moveTo(x + r, y); s.lineTo(x + width - r, y); s.quadraticCurveTo(x + width, y, x + width, y + r);
    s.lineTo(x + width, y + height - r); s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    s.lineTo(x + r, y + height); s.quadraticCurveTo(x, y + height, x, y + height - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 }); geo.translate(0, 0, -depth / 2);
    return add(geo, mat, name, pos, rot);
  }
  const cyl = (name, radius, height, pos, mat, rot = [0, 0, 0], segments = 40, bottom = radius, parent = root) => add(new THREE.CylinderGeometry(radius, bottom, height, segments), mat, name, pos, rot, parent);
  const torus = (name, radius, tube, pos, mat, rot = [Math.PI / 2, 0, 0]) => add(new THREE.TorusGeometry(radius, tube, 8, 64), mat, name, pos, rot);
  const tube = (name, points, radius, mat, segments = 32, closed = false) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal'), segments, radius, 8, closed), mat, name);
  function rod(name, a, b, radius, mat) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), delta = bv.clone().sub(av);
    const geo = new THREE.CylinderGeometry(radius, radius, delta.length(), 16);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    return add(geo, mat, name, av.add(bv).multiplyScalar(.5).toArray());
  }
  function text(name, value, size, pos, mat, rot = [0, 0, 0]) {
    const geo = new TextGeometry(value, { font, size, depth: .00015, curveSegments: 3, bevelEnabled: false });
    geo.computeBoundingBox(); geo.translate(-(geo.boundingBox.max.x - geo.boundingBox.min.x) / 2, 0, 0); return add(geo, mat, name, pos, rot);
  }
  function bowl(name, radius, depth, bottom, z, mat, profile = 'round') {
    const outer = profile === 'straight'
      ? [[0, 0], [radius * .80, .001], [radius * .97, depth * .05], [radius, depth * .15], [radius, depth]]
      : [[0, 0], [radius * .35, .001], [radius * .68, depth * .10], [radius * .91, depth * .30], [radius, depth * .65], [radius, depth]];
    const outside = new THREE.SplineCurve(outer.map(p => new THREE.Vector2(...p))).getPoints(36);
    const inner = outside.slice().reverse().map(p => new THREE.Vector2(Math.max(0, p.x - .0018), p.y + .002));
    inner[0].y = depth;
    add(new THREE.LatheGeometry([...outside, ...inner], 72), mat, name, [0, bottom, z]);
  }
  function finalize() {
    for (const { material, geometries, names } of groups.values()) {
      const merged = mergeGeometries(geometries, false); if (!merged) throw new Error(`Merge failed: ${sku}`);
      const mesh = new THREE.Mesh(merged, material); mesh.name = material.name; mesh.userData.parts = names; root.add(mesh);
    }
    groups.clear(); root.updateMatrixWorld(true); return root;
  }
  return { root, add, box, panel, cyl, torus, tube, rod, text, bowl, finalize };
}
export async function writeModel(sku, root, options = {}) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.position.y -= bounds.min.y;
  root.position.x -= (bounds.min.x + bounds.max.x) / 2;
  root.position.z -= (bounds.min.z + bounds.max.z) / 2;
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, animations: options.animations || [] }));
  const report = inspectGlb(bytes);
  if (report.errors.length || report.warnings.length || bytes.length > 8 * 1024 * 1024) throw new Error(JSON.stringify(report));
  const output = `public/models/ilumi/${sku.toLowerCase()}-v1.glb`;
  await fs.mkdir('public/models/ilumi', { recursive: true }); await fs.writeFile(output, bytes);
  console.log(JSON.stringify({ sku, output, bytes: bytes.length, triangles: report.triangles, dimensionsMeters: size.toArray(), animations: (options.animations || []).map(a => a.name) }));
}
