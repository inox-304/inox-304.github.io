/** Product-scoped rules for a cooking surface. Dimensions are positions, never physical measurements. */
export type CooktopEnergy = 'gas' | 'electric';
export type CooktopLayout = { id: string; name: string; rows: number; columns: number };
export type CooktopModule = { id: string; name: string; kind: 'burner' | 'wok' | 'griddle' | 'grill' | 'fryer' | 'other'; width: number; height: number; energies: CooktopEnergy[]; allowedLayouts: string[]; maxQuantity: number; anchors: Record<string, number[]> };
export type KitchenFamily = 'linear' | 'central' | 'builtin' | 'home';
export type KitchenOven = 'none' | 'gas' | 'electric';
export type KitchenStructure = 'open' | 'cabinet';
export type KitchenSupport = 'feet' | 'wheels';
export type KitchenDimension = 'widthMm' | 'depthMm' | 'heightMm';
export type KitchenMaterial = { id: string; name: string; steel: string; thicknessMm: number };
export type KitchenConfig = { family: KitchenFamily; ovens: KitchenOven[]; structures: KitchenStructure[]; supports: KitchenSupport[]; materials: KitchenMaterial[]; dimensions: Record<KitchenDimension, { min: number; max: number; step: number }> | null };
export type KitchenSelection = { oven: KitchenOven | null; structure: KitchenStructure | null; support: KitchenSupport | null; materialId: string | null; widthMm: number | null; depthMm: number | null; heightMm: number | null };
export type CooktopConfig = { version: 1; kind: 'cooktop'; enabled: boolean; energies: CooktopEnergy[]; defaultModuleId: string; layouts: CooktopLayout[]; modules: CooktopModule[]; kitchen?: KitchenConfig };
export type CooktopSelection = { layoutId: string; energy: CooktopEnergy; placements: { moduleId: string; anchor: number }[]; kitchen?: KitchenSelection };
export const energyName = (energy: CooktopEnergy) => energy === 'gas' ? 'Gas' : 'Eléctrica';
export const kitchenFamilyName = (family: KitchenFamily) => ({ linear: 'Cocina lineal', central: 'Cocina central', builtin: 'Cocina empotrada', home: 'Cocina de casa semiindustrial' })[family];

function fail(message = 'La configuración del equipo no es válida.'): never { throw new Error(message); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) fail();
  return item;
}
function array(value: unknown, max: number, empty = false): unknown[] {
  if (!Array.isArray(value) || value.length > max || (!empty && !value.length)) fail();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 120 || /[\u0000-\u001f]/.test(value) || [...value].some(char => { const point = char.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; })) fail();
  return value.trim();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) fail();
  return value;
}
function unique<T>(items: T[]): T[] { if (new Set(items).size !== items.length) fail(); return items; }
function energies(value: unknown): CooktopEnergy[] {
  return unique(array(value, 2).map(item => { if (item !== 'gas' && item !== 'electric') fail(); return item; }));
}

function options<T extends string>(value: unknown, choices: readonly T[]): T[] {
  return unique(array(value, choices.length, true).map(item => { if (!choices.includes(item as T)) fail(); return item as T; }));
}
const dimensionAxes: KitchenDimension[] = ['widthMm', 'depthMm', 'heightMm'];
function parseKitchen(value: unknown): KitchenConfig {
  const data = record(value, ['family', 'ovens', 'structures', 'supports', 'materials', 'dimensions']);
  if (!['linear', 'central', 'builtin', 'home'].includes(data.family as string)) fail();
  const materials = array(data.materials, 24, true).map(value => {
    const m = record(value, ['id', 'name', 'steel', 'thicknessMm']);
    if (typeof m.thicknessMm !== 'number' || !Number.isFinite(m.thicknessMm) || m.thicknessMm <= 0 || m.thicknessMm > 20) fail();
    return { id: id(m.id), name: name(m.name), steel: name(m.steel), thicknessMm: m.thicknessMm };
  });
  unique(materials.map(m => m.id));
  let dimensions: KitchenConfig['dimensions'] = null;
  if (data.dimensions !== null) {
    const source = record(data.dimensions, dimensionAxes);
    dimensions = {} as NonNullable<KitchenConfig['dimensions']>;
    for (const axis of dimensionAxes) {
      const bounds = record(source[axis], ['min', 'max', 'step']);
      const min = integer(bounds.min, 1, 10000), max = integer(bounds.max, min, 10000);
      dimensions[axis] = { min, max, step: integer(bounds.step, 1, Math.max(1, max - min)) };
    }
  }
  return { family: data.family as KitchenFamily, ovens: options(data.ovens, ['none', 'gas', 'electric']), structures: options(data.structures, ['open', 'cabinet']), supports: options(data.supports, ['feet', 'wheels']), materials, dimensions };
}
function validateKitchen(config: KitchenConfig, value: unknown): KitchenSelection {
  const item = record(value, ['oven', 'structure', 'support', 'materialId', ...dimensionAxes]);
  for (const [key, allowed] of [['oven', config.ovens], ['structure', config.structures], ['support', config.supports], ['materialId', config.materials.map(m => m.id)]] as const) {
    if (!allowed.length ? item[key] !== null : typeof item[key] !== 'string' || !(allowed as string[]).includes(item[key] as string)) fail('La opción de horno, estructura, apoyo o material no está autorizada para esta cocina.');
  }
  for (const axis of dimensionAxes) {
    if (!config.dimensions) { if (item[axis] !== null) fail('Las medidas de esta cocina todavía no están habilitadas.'); }
    else {
      const bounds = config.dimensions[axis], selected = integer(item[axis], bounds.min, bounds.max);
      if ((selected - bounds.min) % bounds.step) fail('La medida elegida no respeta los pasos permitidos por el propietario.');
    }
  }
  return { ...item } as KitchenSelection;
}

export function moduleCells(layout: CooktopLayout, module: Pick<CooktopModule, 'width' | 'height'>, anchor: number): number[] {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= layout.rows * layout.columns) return [];
  const row = Math.floor(anchor / layout.columns), col = anchor % layout.columns;
  if (row + module.height > layout.rows || col + module.width > layout.columns) return [];
  return Array.from({ length: module.height }, (_, y) => Array.from({ length: module.width }, (_, x) => (row + y) * layout.columns + col + x)).flat();
}

/** Reject unknown fields and malformed rules instead of offering guessed compatibility. */
export function parseCooktopConfig(value: unknown): CooktopConfig | null {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return null;
  const hasKitchen = typeof value === 'object' && value !== null && Object.hasOwn(value, 'kitchen');
  const item = record(value, ['version', 'kind', 'enabled', 'energies', 'defaultModuleId', 'layouts', 'modules', ...(hasKitchen ? ['kitchen'] : [])]);
  if (item.version !== 1 || item.kind !== 'cooktop' || typeof item.enabled !== 'boolean') fail();
  const power = energies(item.energies);
  const layouts = array(item.layouts, 6).map(value => {
    const l = record(value, ['id', 'name', 'rows', 'columns']);
    const layout = { id: id(l.id), name: name(l.name), rows: integer(l.rows, 1, 3), columns: integer(l.columns, 1, 12) };
    if (layout.rows * layout.columns > 12) fail();
    return layout;
  });
  unique(layouts.map(l => l.id));
  const modules = array(item.modules, 12).map(value => {
    const m = record(value, ['id', 'name', 'kind', 'width', 'height', 'energies', 'allowedLayouts', 'maxQuantity', 'anchors']);
    if (!['burner', 'wok', 'griddle', 'grill', 'fryer', 'other'].includes(m.kind as string)) fail();
    const allowedLayouts = unique(array(m.allowedLayouts, 6).map(id));
    if (allowedLayouts.some(key => !layouts.some(l => l.id === key))) fail();
    const module: CooktopModule = { id: id(m.id), name: name(m.name), kind: m.kind as CooktopModule['kind'], width: integer(m.width, 1, 12), height: integer(m.height, 1, 3), energies: energies(m.energies), allowedLayouts, maxQuantity: integer(m.maxQuantity, 1, 12), anchors: Object.create(null) };
    if (module.energies.some(key => !power.includes(key))) fail();
    const anchors = record(m.anchors, allowedLayouts);
    for (const layoutId of allowedLayouts) {
      const layout = layouts.find(l => l.id === layoutId)!;
      const cells = unique(array(anchors[layoutId], 12).map(value => integer(value, 0, layout.rows * layout.columns - 1)));
      if (cells.some(cell => !moduleCells(layout, module, cell).length)) fail();
      module.anchors[layoutId] = cells;
    }
    return module;
  });
  unique(modules.map(m => m.id));
  const defaultModuleId = id(item.defaultModuleId), base = modules.find(m => m.id === defaultModuleId);
  if (!base || base.kind !== 'burner' || base.width !== 1 || base.height !== 1 || power.some(p => !base.energies.includes(p))) fail();
  if (layouts.some(l => !base.allowedLayouts.includes(l.id) || base.anchors[l.id]?.length !== l.rows * l.columns || base.maxQuantity < l.rows * l.columns)) fail();
  return { version: 1, kind: 'cooktop', enabled: item.enabled, energies: power, defaultModuleId, layouts, modules, ...(hasKitchen ? { kitchen: parseKitchen(item.kitchen) } : {}) };
}

export function initialCooktopSelection(config: CooktopConfig): CooktopSelection {
  const k = config.kitchen;
  return { layoutId: config.layouts[0].id, energy: config.energies[0], placements: [], ...(k ? { kitchen: {
    oven: k.ovens[0] ?? null, structure: k.structures[0] ?? null, support: k.supports[0] ?? null, materialId: k.materials[0]?.id ?? null,
    widthMm: k.dimensions?.widthMm.min ?? null, depthMm: k.dimensions?.depthMm.min ?? null, heightMm: k.dimensions?.heightMm.min ?? null,
  } } : {}) };
}

export function validateCooktopSelection(config: CooktopConfig, value: unknown): CooktopSelection {
  const item = record(value, ['layoutId', 'energy', 'placements', ...(config.kitchen ? ['kitchen'] : [])]);
  const layout = config.layouts.find(l => l.id === item.layoutId);
  if (!layout || !config.energies.includes(item.energy as CooktopEnergy)) fail('La base o el tipo de energía no están autorizados.');
  const occupied = new Set<number>(), counts = new Map<string, number>();
  const placements = array(item.placements, 12, true).map(value => {
    const p = record(value, ['moduleId', 'anchor']);
    const module = config.modules.find(m => m.id === p.moduleId);
    if (!module || module.id === config.defaultModuleId) fail('Esta pieza no está autorizada para el equipo.');
    const anchor = integer(p.anchor, 0, layout.rows * layout.columns - 1);
    if (!module.energies.includes(item.energy as CooktopEnergy)) fail('La pieza no admite el tipo de energía elegido.');
    if (!module.allowedLayouts.includes(layout.id) || !module.anchors[layout.id]?.includes(anchor)) fail('Esta pieza no está autorizada en esa posición.');
    const cells = moduleCells(layout, module, anchor);
    if (!cells.length) fail('La pieza no cabe dentro de la cocina.');
    if (cells.some(cell => occupied.has(cell))) fail('Las piezas no pueden superponerse. Retira primero el módulo que ocupa ese espacio.');
    cells.forEach(cell => occupied.add(cell));
    const count = (counts.get(module.id) || 0) + 1; counts.set(module.id, count);
    if (count > module.maxQuantity) fail(`Solo se permite ${module.maxQuantity} de «${module.name}» en este equipo.`);
    return { moduleId: module.id, anchor };
  });
  return { layoutId: layout.id, energy: item.energy as CooktopEnergy, placements, ...(config.kitchen ? { kitchen: validateKitchen(config.kitchen, item.kitchen) } : {}) };
}

/** Replace only the clicked module; never silently discard another neighboring module. */
export function placeCooktopModule(config: CooktopConfig, state: CooktopSelection, moduleId: string, cell: number): CooktopSelection {
  const current = validateCooktopSelection(config, state), layout = config.layouts.find(l => l.id === current.layoutId)!;
  integer(cell, 0, layout.rows * layout.columns - 1);
  if (!config.modules.some(m => m.id === moduleId)) fail('La pieza no pertenece a este equipo.');
  const existing = current.placements.find(p => moduleCells(layout, config.modules.find(m => m.id === p.moduleId)!, p.anchor).includes(cell));
  const next = current.placements.filter(p => p !== existing);
  if (moduleId !== config.defaultModuleId) next.push({ moduleId, anchor: existing?.anchor ?? cell });
  return validateCooktopSelection(config, { ...current, placements: next });
}

/** A customer may touch either half of a two-position piece. Resolve only approved anchors. */
export function previewCooktopPlacement(config: CooktopConfig, state: CooktopSelection, moduleId: string, cell: number): { selection: CooktopSelection; anchor: number; cells: number[] } {
  const current = validateCooktopSelection(config, state), layout = config.layouts.find(l => l.id === current.layoutId)!;
  integer(cell, 0, layout.rows * layout.columns - 1);
  const module = config.modules.find(m => m.id === moduleId);
  if (!module) fail('La pieza no pertenece a este equipo.');
  const existing = current.placements.find(p => moduleCells(layout, config.modules.find(m => m.id === p.moduleId)!, p.anchor).includes(cell));
  // When editing an existing piece, never slide the replacement into a neighboring piece.
  const candidates = existing ? [existing.anchor] : [cell, ...(module.anchors[layout.id] || []).filter(anchor => anchor !== cell && moduleCells(layout, module, anchor).includes(cell))];
  let reason = 'Esta pieza no está autorizada en esa posición.';
  for (const anchor of candidates) {
    try {
      const selection = placeCooktopModule(config, current, moduleId, anchor);
      // A fallback anchor must not silently remove an optional piece other than the one touched.
      if (!existing && current.placements.some(p => !selection.placements.some(next => next.moduleId === p.moduleId && next.anchor === p.anchor))) continue;
      const cells = moduleId === config.defaultModuleId && existing
        ? moduleCells(layout, config.modules.find(m => m.id === existing.moduleId)!, existing.anchor)
        : moduleCells(layout, module, anchor);
      return { selection, anchor, cells };
    } catch (error) { reason = error instanceof Error ? error.message : reason; }
  }
  return fail(reason);
}

export function cooktopSummary(config: CooktopConfig, state: CooktopSelection): { text: string; burners: number; occupied: number; parts: { name: string; count: number }[] } {
  const valid = validateCooktopSelection(config, state), layout = config.layouts.find(l => l.id === valid.layoutId)!;
  const occupied = valid.placements.reduce((sum, p) => { const m = config.modules.find(m => m.id === p.moduleId)!; return sum + m.width * m.height; }, 0);
  const burners = layout.rows * layout.columns - occupied;
  const parts = config.modules.filter(m => m.id !== config.defaultModuleId).map(m => ({ name: m.name, count: valid.placements.filter(p => p.moduleId === m.id).length })).filter(m => m.count);
  const text = `${burners} hornillas comunes${parts.map(m => ` · ${m.count} ${m.name}`).join('')}`;
  return { text, burners, occupied, parts };
}

export function cooktopQuoteSummary(config: CooktopConfig, state: CooktopSelection): string {
  const valid = validateCooktopSelection(config, state), layout = config.layouts.find(l => l.id === valid.layoutId)!;
  const details: string[] = [], k = valid.kitchen, rules = config.kitchen;
  if (k && rules) {
    details.push(kitchenFamilyName(rules.family));
    if (k.oven) details.push(`Horno: ${{ none: 'sin horno', gas: 'a gas', electric: 'eléctrico' }[k.oven]}`);
    if (k.structure) details.push(`Estructura: ${{ open: 'abierta', cabinet: 'con gabinete' }[k.structure]}`);
    if (k.support) details.push(`Apoyos: ${{ feet: 'patas', wheels: 'ruedas' }[k.support]}`);
    const material = rules.materials.find(m => m.id === k.materialId);
    if (material) details.push(`Cubierta: ${material.name}, acero ${material.steel}, ${material.thicknessMm} mm`);
    if (rules.dimensions) details.push(`Medidas solicitadas (ancho × fondo × alto): ${k.widthMm} × ${k.depthMm} × ${k.heightMm} mm`);
  }
  return `\nDistribución solicitada: ${layout.name} (${layout.rows * layout.columns} posiciones), superficie ${energyName(valid.energy)}.\n${cooktopSummary(config, valid).text}.\n${valid.placements.map(p => { const m = config.modules.find(m => m.id === p.moduleId)!; return `• ${m.name}: posiciones ${moduleCells(layout, m, p.anchor).map(n => n + 1).join(', ')} (vista superior; numeración de izquierda a derecha, fondo a frente).`; }).join('\n')}${details.length ? `\n${details.join(' · ')}.` : ''}\nVisualización ilustrativa. Precio, medidas y fabricación por confirmar.`;
}
