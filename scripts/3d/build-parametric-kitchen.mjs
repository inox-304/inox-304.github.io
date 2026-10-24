/** Reproducible illustrative component bank and built-in kitchen; no source model is modified. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createKitchenGeometry, createFryerTemplate } from '../../src/scripts/kitchen-geometry.ts';
import { initialCooktopSelection } from '../../src/lib/cooktop-config.ts';
import { planCooktopParts } from '../../src/scripts/cooktop-scene.ts';
import { inspectGlb } from '../lib/model-budget.mjs';

globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.({ target: this }); }).catch(error => this.onerror?.(error)); } };
const input = await fs.readFile('public/models/inox/cooktop-p04-v1.glb');
const source = await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '');
const bank = source.scene.getObjectByName('CooktopTemplates'); bank.removeFromParent(); bank.add(createFryerTemplate());
const config = { version: 1, kind: 'cooktop', enabled: true, energies: ['gas'], defaultModuleId: 'burner',
  layouts: [{ id: 'four', name: '4 hornillas', rows: 2, columns: 2 }],
  modules: [{ id: 'burner', name: 'Hornilla', kind: 'burner', width: 1, height: 1, energies: ['gas'], allowedLayouts: ['four'], maxQuantity: 4, anchors: { four: [0, 1, 2, 3] } }],
  kitchen: { family: 'builtin', ovens: [], structures: [], supports: [], materials: [], dimensions: null } };
const state = initialCooktopSelection(config), kitchen = createKitchenGeometry(config, state);
const standalone = new THREE.Scene(); standalone.name = 'INOX_Cocina_empotrada_4_zonas'; standalone.add(kitchen.root);
standalone.userData = { visualOnly: true, dimensionsVerified: false, description: 'Visualización ilustrativa de cocina empotrada de cuatro zonas; no constituye un plano de fabricación.' };
for (const part of planCooktopParts(config, state, kitchen.surface)) {
  const instance = bank.getObjectByName(part.template).clone(true); instance.position.set(part.x, part.y, part.z); instance.scale.set(part.scaleX, 1, part.scaleZ); standalone.add(instance);
}
const output = async (scene, filename) => {
  const binary = Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, trs: true }));
  const report = inspectGlb(binary);
  if (report.errors.length || report.warnings.length) throw new Error(JSON.stringify(report));
  await fs.writeFile(`public/models/inox/${filename}`, binary);
  console.log(JSON.stringify({ filename, bytes: report.bytes, triangles: report.triangles }));
};
await output(standalone, 'cocina-empotrada-4-zonas-v1.glb');
const library = new THREE.Scene(); library.name = 'INOX_Parametric_Component_Library';
const placeholder = new THREE.Group(); placeholder.name = 'CooktopChassis';
placeholder.add(new THREE.Mesh(new THREE.BoxGeometry(.82, .15, .86), new THREE.MeshStandardMaterial({ color: 0xbac2c8, metalness: .8, roughness: .3 })));
library.add(placeholder, bank);
library.userData = { visualOnly: true, dimensionsVerified: false, cooktop: { version: 1, surface: kitchen.surface, parametricOnly: true } };
await output(library, 'cooktop-parametric-v1.glb');
