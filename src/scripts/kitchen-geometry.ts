import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CooktopConfig, CooktopSelection } from '../lib/cooktop-config';

export type KitchenGeometry = {
  root: THREE.Group;
  surface: { minX: number; maxX: number; minZ: number; maxZ: number; y: number };
  doors: { pivot: THREE.Group; axis: 'x' | 'y'; angle: number }[];
};

/** Presentation geometry only. Unspecified dimensions are visual proportions, never a cutting plan. */
export function createKitchenGeometry(config: CooktopConfig, selection: CooktopSelection): KitchenGeometry {
  if (!config.kitchen || !selection.kitchen) throw new Error('Falta la configuración del mobiliario.');
  const layout = config.layouts.find(item => item.id === selection.layoutId)!;
  const settings = config.kitchen, state = selection.kitchen, family = settings.family;
  const inset = family === 'builtin';
  const visualWidth = family === 'home' ? 0.68 : layout.columns * (inset ? 0.37 : 0.47) + 0.08;
  const visualDepth = family === 'home' ? 0.65 : family === 'linear' ? 0.59 : layout.rows * 0.37 + 0.12;
  const width = state.widthMm === null ? visualWidth : state.widthMm / 1000;
  const depth = state.depthMm === null ? visualDepth : state.depthMm / 1000;
  const height = state.heightMm === null ? (inset ? 0.15 : 0.85) : state.heightMm / 1000;
  const selectedMaterial = settings.materials.find(material => material.id === state.materialId);
  const gauge = (selectedMaterial?.thicknessMm || 1) / 1000;
  if (![width, depth, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Las medidas de la cocina no son válidas.');
  const root = new THREE.Group(); root.name = 'CooktopParametricChassis';
  root.userData = { family, visualOnly: true, dimensionsVerified: state.widthMm !== null && state.depthMm !== null && state.heightMm !== null,
    materialId: state.materialId, steel: selectedMaterial?.steel || null, thicknessMm: selectedMaterial?.thicknessMm || null };
  const doors: KitchenGeometry['doors'] = [];
  const steel = new THREE.MeshStandardMaterial({ name: 'Acero_satinado_configurable', color: 0xbac3c8, metalness: 0.88, roughness: 0.31 });
  const edge = new THREE.MeshStandardMaterial({ name: 'Acero_bordes_configurable', color: 0xe0e5e8, metalness: 0.94, roughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ name: 'Controles_y_ruedas', color: 0x14191c, metalness: 0.3, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ name: 'Vidrio_horno', color: 0x17272e, metalness: 0.16, roughness: 0.17 });
  const mark = new THREE.MeshStandardMaterial({ name: 'Indicadores', color: 0xeaf1f5, metalness: 0.1, roughness: 0.4 });
  // Every palette material gets used; disposal can traverse the generated hierarchy once.
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = steel, parent: THREE.Group = root, radius = 0.002) => {
    const geometry = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const cylinder = (name: string, radius: number, length: number, x: number, y: number, z: number, material: THREE.Material = dark, front = false) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material);
    mesh.name = name; mesh.position.set(x, y, z); if (front) mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true; root.add(mesh); return mesh;
  };
  const top = height - (inset ? 0.025 : 0.04), front = depth / 2;
  box('Cubierta_plegada', width, 0.035, depth, 0, top - 0.0175, 0, steel, root, 0.005);
  box('Borde_frontal', width + 0.008, 0.018, 0.024, 0, top, front - 0.005, edge);
  for (const x of [-width / 2 + 0.009, width / 2 - 0.009]) box('Borde_lateral', 0.018, 0.016, depth, x, top, 0, edge);
  box('Borde_posterior', width, 0.018, 0.02, 0, top, -front + 0.008, edge);
  const fasciaHeight = Math.min(0.10, height * 0.25), controlsY = top - fasciaHeight * 0.65;
  box('Panel_controles', width, fasciaHeight, 0.028, 0, controlsY, front - 0.016);
  for (let index = 0; index < layout.rows * layout.columns; index++) {
    const x = -width * 0.42 + (index + 0.5) / (layout.rows * layout.columns) * width * 0.84;
    cylinder('Perilla', Math.min(0.021, width / (layout.rows * layout.columns) * 0.17), 0.025, x, controlsY, front + 0.004);
    box('Marca_perilla', 0.003, 0.012, 0.002, x, controlsY + 0.006, front + 0.018, mark, root, 0);
  }
  const bottom = inset ? Math.max(0.008, height * 0.12) : state.support === 'wheels' ? 0.12 : 0.065;
  const bodyTop = top - fasciaHeight - 0.02, bodyHeight = Math.max(0.06, bodyTop - bottom);
  const legsTop = top - 0.03;
  if (!inset) {
    for (const x of [-width / 2 + 0.035, width / 2 - 0.035]) for (const z of [-front + 0.035, front - 0.035]) {
      box('Pata_estructural', 0.045, Math.max(0.04, legsTop - bottom), 0.045, x, (legsTop + bottom) / 2, z);
      if (state.support === 'wheels') {
        box('Horquilla_rueda', 0.026, 0.045, 0.05, x, 0.098, z, edge);
        const wheel = cylinder('Rueda', 0.044, 0.025, x, 0.047, z); wheel.rotation.z = Math.PI / 2;
        cylinder('Eje_rueda', 0.009, 0.032, x, 0.047, z, edge).rotation.z = Math.PI / 2;
      } else {
        cylinder('Pie_nivelador', 0.026, bottom, x, bottom / 2, z);
      }
    }
  }
  const oven = state.oven !== null && state.oven !== 'none';
  if (state.structure === 'cabinet' || oven || inset) {
    box('Panel_fondo', width - 0.055, bodyHeight, Math.max(gauge, 0.004), 0, bottom + bodyHeight / 2, -front + 0.035);
    for (const x of [-width / 2 + 0.03, width / 2 - 0.03]) box('Panel_lateral', Math.max(gauge, 0.004), bodyHeight, depth - 0.06, x, bottom + bodyHeight / 2, 0);
    box('Piso_mueble', width - 0.06, 0.02, depth - 0.065, 0, bottom + 0.012, 0);
  } else {
    box('Repisa_inferior', width - 0.07, 0.025, depth - 0.065, 0, Math.min(top * 0.24, 0.2), 0);
    box('Refuerzo_posterior', width - 0.05, 0.045, 0.025, 0, bodyTop - 0.035, -front + 0.03);
  }
  if (oven) {
    const ovenW = Math.min(width - 0.10, family === 'home' ? width - 0.10 : width * 0.66);
    const ovenH = Math.max(0.08, bodyHeight - 0.07), ovenY = bottom + 0.03;
    const ovenGroup = new THREE.Group(); ovenGroup.name = state.oven === 'electric' ? 'Horno_electrico' : 'Horno_gas'; root.add(ovenGroup);
    box('Interior_horno', ovenW, ovenH, 0.012, 0, ovenY + ovenH / 2, -front + 0.07, dark, ovenGroup);
    for (const x of [-ovenW / 2, ovenW / 2]) box('Pared_horno', 0.012, ovenH, depth - 0.13, x, ovenY + ovenH / 2, 0, steel, ovenGroup);
    for (const y of [ovenY, ovenY + ovenH]) box('Techo_base_horno', ovenW, 0.012, depth - 0.13, 0, y, 0, steel, ovenGroup);
    for (let rack = 0; rack < 3; rack++) {
      const y = ovenY + ovenH * (0.24 + rack * 0.24);
      for (let bar = 0; bar < 9; bar++) box('Rejilla_horno', 0.004, 0.004, depth - 0.16, -ovenW * 0.43 + bar / 8 * ovenW * 0.86, y, 0, edge, ovenGroup, 0);
      for (const z of [-front + 0.09, front - 0.09]) box('Marco_rejilla', ovenW * 0.9, 0.005, 0.005, 0, y, z, edge, ovenGroup, 0);
    }
    if (state.oven === 'electric') {
      for (const z of [-depth * 0.2, depth * 0.2]) box('Resistencia_horno', ovenW * 0.8, 0.008, 0.008, 0, ovenY + ovenH * 0.92, z, dark, ovenGroup);
    } else {
      box('Quemador_inferior_horno', ovenW * 0.75, 0.018, 0.035, 0, ovenY + 0.022, 0, dark, ovenGroup);
    }
    const pivot = new THREE.Group(); pivot.name = 'Puerta_horno_configurable'; pivot.position.set(0, ovenY, front - 0.024); root.add(pivot);
    box('Marco_puerta_horno', ovenW, ovenH, 0.025, 0, ovenH / 2, 0, steel, pivot, 0.006);
    box('Visor_horno', ovenW * 0.72, ovenH * 0.58, 0.008, 0, ovenH * 0.49, 0.018, glass, pivot, 0.006);
    box('Tirador_horno', ovenW * 0.73, 0.025, 0.029, 0, ovenH * 0.88, 0.042, edge, pivot, 0.008);
    doors.push({ pivot, axis: 'x', angle: Math.PI * 0.47 });
    if (width > ovenW + 0.18) {
      for (const side of [-1, 1]) box('Frente_lateral_horno', (width - ovenW) / 2 - 0.04, ovenH, 0.025, side * (width + ovenW) / 4, ovenY + ovenH / 2, front - 0.024);
    }
    root.userData.oven = state.oven;
  } else if (state.structure === 'cabinet' && !inset) {
    const doorW = (width - 0.075) / 2, doorH = Math.max(0.04, bodyHeight - 0.025);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.name = side < 0 ? 'Puerta_armario_izquierda' : 'Puerta_armario_derecha';
      pivot.position.set(side * (width / 2 - 0.035), bottom + 0.018, front - 0.028); root.add(pivot);
      box('Puerta_armario', doorW, doorH, 0.022, -side * doorW / 2, doorH / 2, 0, steel, pivot);
      box('Tirador_armario', 0.014, doorH * 0.26, 0.022, -side * doorW * 0.86, doorH * 0.55, 0.027, edge, pivot);
      doors.push({ pivot, axis: 'y', angle: side * Math.PI * 0.48 });
    }
  }
  // Glass otherwise has no mesh on an open or built-in configuration.
  if (!oven) glass.dispose();
  root.userData.support = inset ? null : state.support;
  root.userData.structure = state.structure;
  return { root, doors, surface: { minX: -width / 2 + 0.035, maxX: width / 2 - 0.035, minZ: -depth / 2 + 0.035, maxZ: depth / 2 - 0.035, y: top + 0.008 } };
}

/** Normalized template: empty stainless tank, wire basket and insulated handle. */
export function createFryerTemplate(): THREE.Group {
  const root = new THREE.Group(); root.name = 'Fryer'; root.userData = { kind: 'fryer', visualOnly: true, dimensionsVerified: false };
  const steel = new THREE.MeshStandardMaterial({ color: 0xc3cbd0, metalness: 0.89, roughness: 0.27 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252e35, metalness: 0.45, roughness: 0.46 });
  const handle = new THREE.MeshStandardMaterial({ color: 0x12181d, roughness: 0.7 });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = steel) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.scale.set(w, h, d); mesh.position.set(x, y, z); root.add(mesh);
  };
  box(0.94, 0.012, 0.94, 0, 0.006, 0, dark);
  for (const x of [-0.47, 0.47]) box(0.04, 0.09, 0.98, x, 0.045, 0);
  for (const z of [-0.47, 0.47]) box(0.98, 0.09, 0.04, 0, 0.045, z);
  for (let index = 0; index < 11; index++) {
    const a = -0.36 + index * 0.072;
    box(0.008, 0.008, 0.68, a, 0.034, -0.02);
    box(0.72, 0.008, 0.008, 0, 0.034, a - 0.02);
    for (const side of [-1, 1]) {
      box(0.008, 0.10, 0.008, a, 0.08, side * 0.36 - 0.02);
      box(0.008, 0.10, 0.008, side * 0.36, 0.08, a - 0.02);
    }
  }
  for (const x of [-0.36, 0.36]) box(0.012, 0.012, 0.73, x, 0.132, -0.02);
  for (const z of [-0.38, 0.34]) box(0.73, 0.012, 0.012, 0, 0.132, z);
  for (const x of [-0.09, 0.09]) box(0.012, 0.012, 0.12, x, 0.14, 0.39);
  box(0.25, 0.027, 0.055, 0, 0.15, 0.45, handle);
  return root;
}
