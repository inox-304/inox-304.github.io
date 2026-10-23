/** AMA-15M / AMA-25M photo reconstructions. Sources: docs/modelos-3d/ilumi-siguiente-grupo.md. */
import { THREE, materials, builder, writeModel } from './ilumi-next-geometry.mjs';

const specs = [
  { sku: 'AMA-15M', lateral: .530, longitudinal: .700, height: .800, radius: .210, bowlDepth: .335, liters: 45, baseTop: .135 },
  { sku: 'AMA-25M', lateral: .590, longitudinal: .880, height: .940, radius: .250, bowlDepth: .365, liters: 68, baseTop: .165 },
];
for (const spec of specs) {
  const { sku, lateral: W, longitudinal: D, height: H, radius: R, bowlDepth: B, baseTop } = spec;
  const s = H / .8, mat = materials();
  const m = builder(sku, { nominalDimensions: { width: D, depth: W, height: H }, bowlLiters: spec.liters, axisConvention: 'Manufacturer longest horizontal dimension aligned to global X after rotation; bowl shape and hidden surfaces approximate.' });
  const { box, panel, cyl, torus, tube, rod, add, text, bowl } = m;
  const bowlZ = D / 2 - R - .028, bowlBottom = baseTop + .045 * s, rim = bowlBottom + B;
  const rear = -D / 2 + .11 * s, headBottom = H - .195 * s, headZ = rear + .070 * s;
  for (const x of [-W * .42, W * .42]) for (const z of [-D * .42, D * .42]) cyl('Pata_fija_goma', .022 * s, .031 * s, [x, .0155 * s, z], mat.rubber, [0, 0, 0], 32, .025 * s);
  // A tapered plinth, not the open U-frame of the planetary mixers.
  const footprint = new THREE.Shape(); footprint.moveTo(-W / 2, -D / 2); footprint.lineTo(W / 2, -D / 2); footprint.lineTo(W / 2, D / 2); footprint.lineTo(-W / 2, D / 2); footprint.closePath();
  const base = new THREE.ExtrudeGeometry(footprint, { depth: baseTop - .031 * s, bevelEnabled: true, bevelSize: .025 * s, bevelThickness: .014 * s, bevelSegments: 2 });
  base.rotateX(-Math.PI / 2); add(base, mat.white, 'Base_fundida_cerrada', [0, .033 * s, 0]);
  box('Columna_trasera', [W * .65, headBottom - baseTop, D * .30], [0, (headBottom + baseTop) / 2, rear], mat.white, .008 * s);
  box('Cabezal_transmision', [W * .71, .145 * s, D * .49], [0, headBottom + .0725 * s, headZ], mat.white, .012 * s);
  // Raised control hood; the angle is only an illustration of the visible face.
  box('Tapa_superior', [W * .71, .060 * s, D * .48], [0, H - .035 * s, headZ - .004 * s], mat.white, .021 * s);
  box('Junta_cabezal', [W * .716, .004 * s, D * .495], [0, headBottom + .115 * s, headZ], mat.steel, .001);
  const panelZ = headZ + D * .245 + .002, panelY = H - .053 * s;
  panel('Contorno_panel_rojo', W * .60, .075 * s, .006, .030 * s, [0, panelY, panelZ], mat.red);
  panel('Panel_mandos', W * .58, .069 * s, .006, .026 * s, [0, panelY, panelZ + .004], mat.black);
  const buttons = [[-.22, .008, mat.red], [-.12, -.012, mat.green], [.10, .008, mat.green], [.18, -.012, mat.yellow]];
  for (const [x, y, material] of buttons) {
    cyl('Anillo_boton', .016 * s, .007 * s, [x * W, panelY + y * s, panelZ + .01], mat.chrome, [Math.PI / 2, 0, 0]);
    cyl('Boton_mando', .012 * s, .01 * s, [x * W, panelY + y * s, panelZ + .016], material, [Math.PI / 2, 0, 0]);
  }
  box('Marco_temporizador', [.043 * s, .048 * s, .008], [0, panelY, panelZ + .01], mat.steel, .002);
  cyl('Dial_temporizador', .016 * s, .008, [0, panelY, panelZ + .017], mat.white, [Math.PI / 2, 0, 0]);
  cyl('Parada_emergencia_soporte', .020 * s, .020 * s, [W * .25, panelY + .018 * s, panelZ + .02], mat.black, [Math.PI / 2, 0, 0]);
  cyl('Parada_emergencia_roja', .025 * s, .014 * s, [W * .25, panelY + .018 * s, panelZ + .037], mat.red, [Math.PI / 2, 0, 0]);
  box('Placa_marca', [.105 * s, .043 * s, .002], [0, headBottom + .051 * s, panelZ], mat.black, .001);
  text('Marca_ilumi', 'ilumi', .032 * s, [0, headBottom + .038 * s, panelZ + .002], mat.bright);
  cyl('Soporte_bowl_visible', .046 * s, .042 * s, [0, baseTop + .024 * s, bowlZ], mat.steel);
  bowl('Bowl_cilindrico_hueco', R, B, bowlBottom, bowlZ, mat.steel, 'straight');
  torus('Borde_bowl', R, .005 * s, [0, rim, bowlZ], mat.chrome);
  // Straight parallel cage bars converge in height, not into an invented rotating lid.
  const guardRear = bowlZ - R * .8, guardY = Math.max(rim + .075 * s, headBottom + .012 * s);
  const frontArc = Array.from({ length: 33 }, (_, i) => { const a = -Math.PI / 2 + Math.PI * i / 32; return [Math.sin(a) * R, rim + .023 * s, bowlZ + Math.cos(a) * R]; });
  tube('Arco_frontal_rejilla', frontArc, .0033 * s, mat.chrome, 40);
  rod('Travesano_posterior_rejilla', [-R, guardY, guardRear], [R, guardY, guardRear], .0033 * s, mat.chrome);
  for (let i = -5; i <= 5; i++) {
    const x = R * i / 5, frontZ = bowlZ + Math.sqrt(Math.max(0, R * R - x * x));
    rod('Varilla_rejilla', [x, guardY, guardRear], [x, rim + .023 * s, frontZ], .0025 * s, mat.chrome);
  }
  for (const x of [-R * .93, R * .93]) rod('Soporte_rejilla', [x, guardY, guardRear], [x, headBottom + .09 * s, guardRear - .012], .005 * s, mat.steel);
  const hookX = -R * .25, hookZ = bowlZ - R * .28;
  cyl('Eje_del_gancho', .018 * s, .10 * s, [hookX, rim + .012 * s, hookZ], mat.chrome);
  const spiral = Array.from({ length: 60 }, (_, i) => { const t = i / 59, a = t * Math.PI * 2.5; return [hookX + Math.cos(a) * R * .34, rim - .025 * s - t * B * .78, hookZ + Math.sin(a) * R * .34]; });
  tube('Gancho_espiral_estatico', spiral, .011 * s, mat.chrome, 80);
  rod('Barra_central_estatica', [R * .23, rim + .03 * s, bowlZ - R * .15], [R * .23, bowlBottom + .035, bowlZ - R * .15], .012 * s, mat.chrome);
  m.finalize();
  // Preserve photo proportions: sideways width is the short stated dimension.
  const bounds = new THREE.Box3().setFromObject(m.root), size = bounds.getSize(new THREE.Vector3());
  m.root.scale.set(W / size.x, H / size.y, D / size.z); m.root.rotation.y = Math.PI / 2;
  await writeModel(sku, m.root);
}
