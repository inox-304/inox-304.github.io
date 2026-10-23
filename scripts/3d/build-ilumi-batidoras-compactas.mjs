/** B-7LRE and BIT-270/350/500/750. Sources/limits: docs/modelos-3d/ilumi-siguiente-grupo.md. */
import { THREE, materials, builder, writeModel } from './ilumi-next-geometry.mjs';

{
  const sku = 'B-7LRE', mat = materials(), W = .230, D = .410, H = .441;
  const m = builder(sku, { nominalDimensions: { width: D, depth: W, height: H }, bowlLiters: 7, description: 'Batidora compacta roja. Visualización 3D aproximada desde las fotos ILUMI; cubierta y accesorios representados en reposo. No permite cambiar colores o fabricar componentes.' });
  const { box, panel, cyl, torus, tube, add, text, bowl } = m;
  const bowlZ = .068, R = .108, bowlBottom = .051, bowlDepth = .207, rim = bowlBottom + bowlDepth;
  for (const x of [-.080, .080]) for (const z of [-.150, .150]) cyl('Pata_goma', .013, .006, [x, .003, z], mat.rubber);
  panel('Base_roja_redondeada', W, D, .026, .038, [0, .019, 0], mat.red, [-Math.PI / 2, 0, 0]);
  panel('Borde_base_rojo', W * .965, D * .98, .009, .035, [0, .032, -.001], mat.red, [-Math.PI / 2, 0, 0]);
  // Flared rear column, visually distinct from the larger white industrial mixers.
  const profile = new THREE.Shape();
  profile.moveTo(-.054, .037); profile.lineTo(.055, .037); profile.bezierCurveTo(.043, .11, .042, .20, .040, .29);
  profile.lineTo(-.040, .29); profile.bezierCurveTo(-.042, .20, -.045, .11, -.054, .037); profile.closePath();
  const column = new THREE.ExtrudeGeometry(profile, { depth: .095, bevelEnabled: true, bevelSize: .008, bevelThickness: .008, bevelSegments: 3, curveSegments: 12 });
  add(column, mat.red, 'Columna_roja_curva', [0, 0, -.177]);
  box('Bisagra_cabezal_visible', [.105, .036, .098], [0, .295, -.129], mat.red, .012);
  box('Cabezal_redondeado_rojo', [.150, .137, .330], [0, H - .0685, -.009], mat.red, .055);
  box('Cinturon_metal_cabezal', [.153, .025, .323], [0, .321, -.009], mat.chrome, .009);
  box('Base_cabezal_roja', [.152, .026, .310], [0, .298, -.008], mat.red, .011);
  cyl('Toma_frontal_accesorios', .023, .024, [0, .372, .165], mat.red, [Math.PI / 2, 0, 0]);
  cyl('Cubierta_frontal_metal', .020, .004, [0, .372, .179], mat.chrome, [Math.PI / 2, 0, 0]);
  torus('Anillo_frontal', .019, .0016, [0, .372, .182], mat.steel, [0, 0, 0]);
  cyl('Collarin_planetario', .067, .036, [0, .281, bowlZ], mat.chrome);
  cyl('Base_apoyo_bowl', .061, .019, [0, .044, bowlZ], mat.chrome);
  torus('Anillo_apoyo', .060, .003, [0, .050, bowlZ], mat.chrome);
  bowl('Bowl_hueco_siete_litros', R, bowlDepth, bowlBottom, bowlZ, mat.steel);
  torus('Borde_bowl_enrollado', R, .0035, [0, rim, bowlZ], mat.chrome);
  // Open-sided transparent safety cover, a physical thin shell (no opaque bowl plug).
  const cover = [new THREE.Vector2(.045, .029), new THREE.Vector2(.067, .025), new THREE.Vector2(.109, .006), new THREE.Vector2(.112, 0)];
  add(new THREE.LatheGeometry(cover, 72), mat.glass, 'Cubierta_seguridad_transparente', [0, rim + .004, bowlZ]);
  torus('Borde_cubierta', .111, .002, [0, rim + .005, bowlZ], mat.glass);
  box('Vertedor_cubierta', [.075, .003, .065], [0, rim + .027, bowlZ + .083], mat.glass, .003, [-.19, 0, 0]);
  const whiskBottom = bowlBottom + .035, whiskTop = rim - .012;
  cyl('Eje_batidor', .009, .055, [0, rim + .013, bowlZ], mat.chrome);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    tube('Alambre_globo_en_reposo', [[Math.cos(a) * .018, whiskTop, bowlZ + Math.sin(a) * .018], [Math.cos(a) * .068, .145, bowlZ + Math.sin(a) * .068], [Math.cos(a) * .049, whiskBottom + .018, bowlZ + Math.sin(a) * .049], [0, whiskBottom, bowlZ]], .0011, mat.chrome, 24);
  }
  // Controls visible on the left of the rear column, not simulated operating functions.
  const knobX = -.054, knobZ = -.120;
  cyl('Anillo_velocidad', .025, .004, [knobX, .185, knobZ], mat.chrome, [0, 0, Math.PI / 2]);
  cyl('Selector_velocidad', .016, .014, [knobX - .008, .185, knobZ], mat.black, [0, 0, Math.PI / 2]);
  cyl('Centro_selector', .011, .002, [knobX - .016, .185, knobZ], mat.chrome, [0, 0, Math.PI / 2]);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI * 2 / 16; box('Marca_selector', [.001, .003, .001], [knobX - .003, .185 + Math.sin(a) * .022, knobZ + Math.cos(a) * .022], mat.black, .0001); }
  cyl('Marco_encendido', .019, .004, [knobX, .139, knobZ], mat.chrome, [0, 0, Math.PI / 2]);
  cyl('Boton_encendido', .014, .006, [knobX - .006, .139, knobZ], mat.black, [0, 0, Math.PI / 2]);
  box('Marca_fondo', [.001, .025, .070], [-.076, .381, -.040], mat.black, .0003);
  text('Marca_ilumi', 'ilumi', .018, [-.077, .374, -.040], mat.bright, [0, -Math.PI / 2, 0]);
  m.finalize();
  const bounds = new THREE.Box3().setFromObject(m.root), size = bounds.getSize(new THREE.Vector3());
  m.root.scale.set(W / size.x, H / size.y, D / size.z); m.root.rotation.y = Math.PI / 2;
  await writeModel(sku, m.root);
}

const immersion = [
  { sku: 'BIT-270', shaft: .226, diameter: .028, compact: true, motorHeight: .185, handleHeight: .145 },
  { sku: 'BIT-350', shaft: .300, diameter: .035, compact: false, motorHeight: .180, handleHeight: .155 },
  { sku: 'BIT-500', shaft: .400, diameter: .035, compact: false, motorHeight: .180, handleHeight: .155 },
  { sku: 'BIT-750', shaft: .500, diameter: .035, compact: false, motorHeight: .195, handleHeight: .175 },
];
for (const cfg of immersion) {
  const { sku, shaft, diameter, compact, motorHeight: M, handleHeight: G } = cfg;
  const mat = materials(), paint = compact ? mat.black : mat.navy;
  const m = builder(sku, { verifiedShaftMeters: shaft, verifiedShaftDiameterMeters: diameter, totalDimensionsVerified: false, description: 'Reconstrucción aproximada de foto oficial ILUMI. Longitud del brazo documentada; carcasa, mango y escala total ilustrativos. Sin accesorios no incluidos ni simulación de cuchilla.' });
  const { box, cyl, tube, rod, add, text } = m;
  const bellH = compact ? .039 : .050, bellR = compact ? .037 : .045, shaftTop = bellH + shaft;
  const motorBottom = shaftTop + (compact ? .006 : .028), motorR = compact ? .040 : .047;
  // Stainless tube retains the documented length/diameter. No global scaling.
  cyl('Brazo_acero_inoxidable', diameter / 2, shaft, [0, bellH + shaft / 2, 0], mat.chrome, [0, 0, 0], 48);
  const topBell = [[0, .036], [bellR * .40, .036], [bellR * .80, .033], [bellR, .026]];
  add(new THREE.LatheGeometry(topBell.map(([r, y]) => new THREE.Vector2(r, y * bellH / .039)), 56), mat.chrome, 'Corona_campana');
  // Four open scallops evidenced by the photo; the unseen cutting geometry is omitted.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const points = [[Math.cos(a) * bellR * .85, bellH * .73, Math.sin(a) * bellR * .85], [Math.cos(a) * bellR, bellH * .45, Math.sin(a) * bellR], [Math.cos(a) * bellR * 1.12, .004, Math.sin(a) * bellR * 1.12]];
    tube('Pie_campana_abierta', points, .0055, mat.chrome, 16);
  }
  cyl('Centro_campana', bellR * .35, .018, [0, bellH * .40, 0], mat.steel);
  if (!compact) {
    cyl('Acople_negro', .028, .028, [0, shaftTop + .014, 0], mat.black, [0, 0, 0], 36);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; rod('Estria_acople', [Math.cos(a) * .028, shaftTop + .003, Math.sin(a) * .028], [Math.cos(a) * .028, shaftTop + .025, Math.sin(a) * .028], .0011, mat.dark); }
    cyl('Collarin_metal', motorR * .82, .024, [0, motorBottom + .012, 0], mat.chrome, [0, 0, 0], 48, motorR * .60);
  }
  const lower = motorBottom + (compact ? 0 : .022), bodyTop = lower + M;
  const profile = [[0, 0], [motorR * .65, 0], [motorR * .96, .014], [motorR, M * .35], [motorR * .94, M * .80], [motorR * .80, M], [0, M]];
  add(new THREE.LatheGeometry(new THREE.SplineCurve(profile.map(p => new THREE.Vector2(...p))).getPoints(45), 56), paint, 'Carcasa_motor', [0, lower, 0]);
  if (compact) {
    // Compact black 270 has a solid narrow neck; it is not the open handle of the larger family.
    tube('Mango_macizo_ergonomico', [[0, bodyTop - .005, 0], [.014, bodyTop + G * .38, 0], [.010, bodyTop + G * .88, 0]], .024, paint, 28);
    box('Cabeza_mango', [.098, .033, .065], [0, bodyTop + G * .93, 0], paint, .016, [0, 0, -.15]);
    box('Gatillo', [.011, .033, .027], [-.017, bodyTop + G * .69, 0], mat.dark, .003);
  } else {
    // Extruded loop with a real central hole, a visible differentiator from BIT-270.
    const handle = new THREE.Shape(); handle.moveTo(-.035, 0); handle.lineTo(-.058, G * .86);
    handle.quadraticCurveTo(-.058, G, -.034, G); handle.lineTo(.038, G); handle.lineTo(.045, G * .83);
    handle.lineTo(.018, G * .76); handle.lineTo(.037, 0); handle.closePath();
    const hole = new THREE.Path(); hole.moveTo(-.023, .026); hole.lineTo(.010, .026); hole.lineTo(-.004, G * .80); hole.lineTo(-.036, G * .80); hole.closePath(); handle.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(handle, { depth: .050, bevelEnabled: true, bevelSize: .005, bevelThickness: .005, bevelSegments: 3, curveSegments: 8 });
    add(geo, paint, 'Mango_con_abertura', [0, bodyTop - .008, -.025]);
    box('Gatillo_interior', [.009, .040, .030], [-.014, bodyTop + G * .67, 0], mat.black, .003, [0, 0, -.13]);
    cyl('Dial_superior', .013, .009, [-.006, bodyTop + G + .004, 0], paint);
  }
  // Short cable relief visible in the source; no free dangling cord or accessory modeled.
  rod('Salida_cable', [.033, bodyTop + G * .95, 0], [.113, bodyTop + G * 1.18, 0], .009, mat.black);
  for (const y of [lower + M * .26, lower + M * .77]) for (let row = 0; row < 4; row++) {
    box('Ranura_ventilacion_frontal', [motorR * 1.25, .0022, .001], [0, y + row * .006, motorR * .95], mat.dark, .0003);
  }
  box('Placa_ilumi', [.063, .026, .0012], [0, lower + M * .49, motorR + .001], mat.bright, .0003);
  box('Fondo_marca', [.060, .023, .001], [0, lower + M * .49, motorR + .002], mat.black, .0003);
  text('Marca_ilumi', 'ilumi', .016, [0, lower + M * .49 - .006, motorR + .003], mat.bright);
  m.finalize(); await writeModel(sku, m.root);
}
