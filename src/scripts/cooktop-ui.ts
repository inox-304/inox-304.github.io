import { cooktopQuoteSummary, cooktopSummary, energyName, initialCooktopSelection, moduleCells, previewCooktopPlacement, validateCooktopSelection, type CooktopConfig, type CooktopSelection } from '../lib/cooktop-config';
import { cooktopAssetFor } from '../lib/cooktop-assets';

type View = { key: string; productId: string; config: CooktopConfig; selection: CooktopSelection; anchor: number; armed: string | null; past: CooktopSelection[]; future: CooktopSelection[]; content: HTMLElement; status: HTMLElement; onChange: (text: string) => void; pick?: (anchor: number) => void };
const views = new WeakMap<HTMLElement, View>();
export function readCooktop(root: HTMLElement | null, productId: string) {
  const view = root ? views.get(root) : undefined;
  return view?.productId === productId ? { config: view.config, selection: view.selection } : null;
}
export function pickCooktopAnchor(root: HTMLElement | null, productId: string, anchor: number) {
  const view = root ? views.get(root) : undefined;
  if (view?.productId === productId) view.pick?.(anchor);
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text: string, action: () => void, className = '') {
  const node = el('button', text, className); node.type = 'button'; node.onclick = action; return node;
}
const snapshot = (selection: CooktopSelection): CooktopSelection => JSON.parse(JSON.stringify(selection));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Esta combinación no está disponible.';
const familyNames = { linear: 'Cocina lineal', central: 'Cocina central', builtin: 'Cocina empotrada', home: 'Cocina de casa semiindustrial' };

/** Each product owns its allowed parts, dimensions and history; never mix catalog families. */
export function renderCooktop(root: HTMLElement, config: CooktopConfig | null, productId: string, onChange: (text: string) => void, preview = false, model3d = ''): void {
  if (!config || (!config.enabled && !preview)) {
    root.hidden = true; root.replaceChildren(); views.delete(root); onChange('');
    document.dispatchEvent(new CustomEvent('inox:cooktop-updated', { detail: { productId, state: null, interactive: false } })); return;
  }
  const rules = config;
  const key = `${productId}:${JSON.stringify(rules)}`;
  let view = views.get(root);
  if (!view || view.key !== key) {
    const content = el('div', '', 'cooktop-content'), status = el('p', '', 'cooktop-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    view = { key, productId, config: rules, selection: initialCooktopSelection(rules), anchor: 0, armed: null, past: [], future: [], content, status, onChange };
    views.set(root, view); root.replaceChildren(content, status);
  }
  view.onChange = onChange; root.hidden = false;
  const current = view;
  const announce = (text: string) => { current.status.textContent = text; };
  const getLayout = () => rules.layouts.find(layout => layout.id === current.selection.layoutId)!;
  const occupant = (cell: number) => current.selection.placements.find(placement => moduleCells(getLayout(), rules.modules.find(module => module.id === placement.moduleId)!, placement.anchor).includes(cell));
  const normalizeAnchor = () => { current.anchor = occupant(current.anchor)?.anchor ?? current.anchor; };
  const placementAt = (cell: number, moduleId = current.armed) => moduleId ? previewCooktopPlacement(rules, current.selection, moduleId, cell) : null;
  const validTargets = (moduleId: string | null = current.armed) => {
    if (!moduleId) return [];
    return Array.from({ length: getLayout().rows * getLayout().columns }, (_, cell) => cell).filter(cell => { try { placementAt(cell, moduleId); return true; } catch { return false; } });
  };
  function interaction(previewCell: number | null = null) {
    const validCells = validTargets();
    let previewCells: number[] = [];
    if (previewCell !== null && current.armed) { try { previewCells = placementAt(previewCell)!.cells; } catch { /* No ghost for an invalid footprint. */ } }
    for (const node of current.content.querySelectorAll<HTMLElement>('.cooktop-cell')) {
      const cells = (node.dataset.cells || '').split(',').map(Number);
      node.classList.toggle('is-valid-target', Boolean(current.armed) && cells.some(cell => validCells.includes(cell)));
      node.classList.toggle('is-preview-target', cells.some(cell => previewCells.includes(cell)));
      node.classList.toggle('is-unavailable-target', Boolean(current.armed) && !cells.some(cell => validCells.includes(cell)));
    }
    document.dispatchEvent(new CustomEvent('inox:cooktop-interaction', { detail: { productId, interaction: { anchor: current.anchor, moduleId: current.armed, validCells, previewCells } } }));
  }
  function commit(next: CooktopSelection, message: string, focus = '') {
    try {
      const validated = validateCooktopSelection(rules, next);
      if (JSON.stringify(validated) !== JSON.stringify(current.selection)) {
        current.past.push(snapshot(current.selection)); if (current.past.length > 40) current.past.shift();
        current.future = []; current.selection = validated;
      }
      current.armed = null; normalizeAnchor(); draw(message, focus, true);
    } catch (error) { announce(errorMessage(error)); }
  }
  function chooseCell(cell: number) {
    const layout = getLayout();
    if (!Number.isInteger(cell) || cell < 0 || cell >= layout.rows * layout.columns) return;
    if (current.armed) {
      try {
        const module = rules.modules.find(item => item.id === current.armed)!;
        const placement = placementAt(cell)!; current.anchor = placement.anchor;
        commit(placement.selection, `${module.name}: posiciones ${placement.cells.map(position => position + 1).join(' y ')}. ${cooktopSummary(rules, placement.selection).text}.`, 'cell');
      } catch (error) { announce(errorMessage(error)); interaction(null); }
    } else {
      current.anchor = occupant(cell)?.anchor ?? cell;
      draw(`Posición ${current.anchor + 1} seleccionada. Elige una pieza para reemplazarla.`, 'cell', true);
    }
  }
  function history(direction: 'undo' | 'redo') {
    const source = direction === 'undo' ? current.past : current.future;
    const destination = direction === 'undo' ? current.future : current.past;
    const next = source.pop(); if (!next) return;
    destination.push(snapshot(current.selection)); current.selection = next; current.armed = null; current.anchor = Math.min(current.anchor, getLayout().rows * getLayout().columns - 1); normalizeAnchor();
    draw(direction === 'undo' ? 'Cambio deshecho.' : 'Cambio rehecho.', `.${direction === 'undo' ? 'cooktop-undo' : 'cooktop-redo'}`, true);
  }
  function draw(announcement = '', focus = '', interactive = false) {
    normalizeAnchor();
    const layout = getLayout();
    const title = el('h2', 'Crea tu cocina');
    const intro = el('p', 'Elige una pieza y toca dónde colocarla, en el plano o en el 3D. Puedes deshacer cada cambio.', 'cooktop-intro');
    const baseSection = el('section', '', 'cooktop-step');
    baseSection.append(el('h3', rules.kitchen ? familyNames[rules.kitchen.family] : 'Base de la cocina'));
    const controls = el('div', '', 'cooktop-controls');
    const layoutLabel = el('label', 'Capacidad máxima de la superficie');
    const layoutSelect = el('select'); layoutSelect.setAttribute('aria-label', 'Base de la cocina');
    layoutSelect.replaceChildren(...rules.layouts.map(item => new Option(/\b\d+\s+(?:posiciones|hornillas?)\b/i.test(item.name) ? item.name : `${item.name} · ${item.rows * item.columns} posiciones`, item.id))); layoutSelect.value = layout.id;
    layoutSelect.onchange = () => {
      current.anchor = 0;
      commit({ ...current.selection, layoutId: layoutSelect.value, placements: [] }, 'Cambió la base. Restablecimos las hornillas para que elijas una distribución compatible.', '[aria-label="Base de la cocina"]');
    };
    layoutLabel.append(layoutSelect);
    const energyLabel = el('label', 'Energía de la superficie');
    const energySelect = el('select'); energySelect.setAttribute('aria-label', 'Energía de la superficie');
    energySelect.replaceChildren(...rules.energies.map(energy => new Option(energyName(energy), energy))); energySelect.value = current.selection.energy;
    energySelect.onchange = () => {
      current.anchor = 0;
      commit({ ...current.selection, energy: energySelect.value as CooktopSelection['energy'], placements: [] }, 'Cambió la energía. Restablecimos los módulos para evitar una combinación incompatible.', '[aria-label="Energía de la superficie"]');
    };
    energyLabel.append(energySelect); controls.append(layoutLabel, energyLabel);
    baseSection.append(controls, el('p', 'Las posiciones indican la capacidad inicial. Una plancha u otro módulo sustituye las hornillas del espacio que ocupa.', 'cooktop-note'));

    const surfaceSection = el('section', '', 'cooktop-step cooktop-surface-step');
    surfaceSection.append(el('h3', 'Distribuye la superficie'));
    const options = el('fieldset', '', 'cooktop-options'); options.append(el('legend', 'Elige una pieza'));
    const group = el('div', '', 'cooktop-module-options');
    for (const module of rules.modules) {
      const allowed = validTargets(module.id);
      let reason = '';
      if (!allowed.length) { try { placementAt(current.anchor, module.id); } catch (error) { reason = errorMessage(error); } }
      const option = button('', () => {
        current.armed = current.armed === module.id ? null : module.id;
        draw(current.armed ? `${module.name} listo. Toca una zona resaltada o aplícalo en la posición seleccionada.` : 'Selección de pieza cancelada.', `[data-module-id="${module.id}"]`, true);
      }, `cooktop-module-option cooktop-kind-${module.kind}`);
      option.dataset.moduleId = module.id; option.disabled = !allowed.length; option.setAttribute('aria-pressed', String(current.armed === module.id));
      const symbol = el('span', '', 'cooktop-module-symbol'); symbol.setAttribute('aria-hidden', 'true');
      const footprint = module.width * module.height;
      option.append(symbol, el('strong', module.name), el('span', module.id === rules.defaultModuleId ? 'Recupera la hornilla común' : `${footprint} ${footprint === 1 ? 'posición' : 'posiciones'}`));
      if (reason) { option.append(el('small', reason)); option.title = reason; }
      group.append(option);
    }
    options.append(group); surfaceSection.append(options);
    const instruction = el('p', current.armed ? 'Ahora toca una zona resaltada. El contorno muestra cuánto espacio ocupará.' : 'Toca una posición para seleccionarla, o elige primero una pieza.', 'cooktop-placement-hint');
    surfaceSection.append(instruction);
    const surface = el('div', '', 'cooktop-surface'); surface.append(el('p', 'FONDO · VISTA SUPERIOR', 'cooktop-direction'));
    const grid = el('div', '', 'cooktop-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Posiciones de la superficie de cocción');
    grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(44px, 1fr))`; grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(76px, auto))`;
    const occupied = new Set<number>();
    const drawCell = (anchor: number, moduleId: string) => {
      const module = rules.modules.find(item => item.id === moduleId)!;
      const cells = moduleCells(layout, module, anchor); cells.forEach(cell => occupied.add(cell));
      const node = button('', () => chooseCell(anchor), `cooktop-cell cooktop-kind-${module.kind}`);
      node.dataset.anchor = String(anchor); node.dataset.cells = cells.join(',');
      node.style.gridColumn = `${anchor % layout.columns + 1} / span ${module.width}`; node.style.gridRow = `${Math.floor(anchor / layout.columns) + 1} / span ${module.height}`;
      node.setAttribute('aria-pressed', String(cells.includes(current.anchor)));
      node.setAttribute('aria-label', `Posiciones ${cells.map(cell => cell + 1).join(', ')}: ${module.name}. ${current.armed ? 'Colocar la pieza elegida.' : 'Seleccionar para cambiar.'}`);
      node.onmouseenter = () => interaction(anchor); node.onmouseleave = () => interaction(null);
      node.onfocus = () => interaction(anchor); node.onblur = () => interaction(null);
      const symbol = el('span', '', 'cooktop-module-symbol'); symbol.setAttribute('aria-hidden', 'true');
      node.append(el('span', cells.map(cell => cell + 1).join(' + '), 'cooktop-position'), symbol, el('strong', module.name)); grid.append(node);
    };
    current.selection.placements.forEach(placement => drawCell(placement.anchor, placement.moduleId));
    for (let cell = 0; cell < layout.rows * layout.columns; cell++) if (!occupied.has(cell)) drawCell(cell, rules.defaultModuleId);
    surface.append(grid, el('p', 'FRENTE · CONTROLES', 'cooktop-direction')); surfaceSection.append(surface);
    const selectionActions = el('div', '', 'cooktop-selection-actions');
    selectionActions.append(el('span', `Posición seleccionada: ${current.anchor + 1}`, 'cooktop-selected-position'));
    if (current.armed) {
      const module = rules.modules.find(item => item.id === current.armed)!;
      const apply = button(`Colocar ${module.name} aquí`, () => chooseCell(current.anchor), 'cooktop-apply');
      let reason = ''; try { placementAt(current.anchor); } catch (error) { reason = errorMessage(error); }
      apply.disabled = Boolean(reason); if (reason) apply.title = reason;
      selectionActions.append(apply, button('Cancelar pieza', () => { current.armed = null; draw('Selección de pieza cancelada.', 'cell'); }, 'cooktop-cancel'));
    }
    const selectedPlacement = occupant(current.anchor);
    const remove = button('Quitar módulo y recuperar hornillas', () => {
      const next = placementAt(current.anchor, rules.defaultModuleId)!;
      commit(next.selection, 'Módulo retirado. Recuperaste las hornillas de ese espacio.', 'cell');
    }, 'cooktop-remove');
    remove.disabled = !selectedPlacement; selectionActions.append(remove); surfaceSection.append(selectionActions);

    const kitchenSections: HTMLElement[] = [];
    if (rules.kitchen && current.selection.kitchen) {
      const kitchen = rules.kitchen;
      const updateKitchen = (key: keyof NonNullable<CooktopSelection['kitchen']>, value: string | number, label: string, control: HTMLInputElement | HTMLSelectElement) => {
        try {
          const next = validateCooktopSelection(rules, { ...current.selection, kitchen: { ...current.selection.kitchen, [key]: value } });
          commit(next, `${label} actualizado.`, `[data-kitchen-field="${key}"]`);
        } catch (error) { control.setAttribute('aria-invalid', 'true'); announce(errorMessage(error)); }
      };
      const optionControl = (key: 'oven' | 'structure' | 'support' | 'materialId', label: string, choices: { value: string; name: string }[]) => {
        const field = el('label', label); const select = el('select'); select.dataset.kitchenField = key; select.setAttribute('aria-label', label);
        select.replaceChildren(...choices.map(choice => new Option(choice.name, choice.value))); select.value = current.selection.kitchen![key] || '';
        select.onchange = () => updateKitchen(key, select.value, label, select); field.append(select); return field;
      };
      const oven = el('section', '', 'cooktop-step'); oven.append(el('h3', '1 · Horno'));
      const ovenNames = { none: 'Sin horno', gas: 'Horno a gas', electric: 'Horno eléctrico' };
      if (kitchen.ovens.length) oven.append(optionControl('oven', 'Opción de horno', kitchen.ovens.map(value => ({ value, name: ovenNames[value] }))));
      else oven.append(el('p', 'Este modelo no ofrece opciones de horno.', 'cooktop-note'));
      kitchenSections.push(oven);
      const structure = el('section', '', 'cooktop-step'); structure.append(el('h3', '2 · Estructura'));
      const structureControls = el('div', '', 'cooktop-controls');
      const structureNames = { open: 'Base abierta', cabinet: 'Base cerrada con puertas' }, supportNames = { feet: 'Patas', wheels: 'Ruedas' };
      if (kitchen.structures.length) structureControls.append(optionControl('structure', 'Tipo de base', kitchen.structures.map(value => ({ value, name: structureNames[value] }))));
      if (kitchen.supports.length) structureControls.append(optionControl('support', 'Apoyo de la cocina', kitchen.supports.map(value => ({ value, name: supportNames[value] }))));
      if (structureControls.childElementCount) structure.append(structureControls); else structure.append(el('p', 'Este modelo no ofrece cambios de estructura desde aquí.', 'cooktop-note'));
      kitchenSections.push(structure);
      const measures = el('section', '', 'cooktop-step'); measures.append(el('h3', '3 · Medidas y cubierta'));
      if (kitchen.dimensions) {
        const dimensionControls = el('div', '', 'cooktop-dimensions');
        const dimensions = [['widthMm', 'Ancho'], ['depthMm', 'Fondo'], ['heightMm', 'Alto']] as const;
        for (const [key, label] of dimensions) {
          const range = kitchen.dimensions[key], field = el('label', `${label} (mm)`), input = el('input'); input.type = 'number'; input.inputMode = 'numeric';
          input.min = String(range.min); input.max = String(range.max); input.step = String(range.step); input.value = String(current.selection.kitchen[key]); input.dataset.kitchenField = key; input.setAttribute('aria-label', `${label} de la cocina en milímetros`);
          input.onchange = () => { if (!input.value.trim()) { input.setAttribute('aria-invalid', 'true'); announce(`Indica el ${label.toLowerCase()} dentro del intervalo permitido.`); return; } updateKitchen(key, Number(input.value), label, input); };
          field.append(input, el('small', `${range.min}–${range.max} mm · pasos de ${range.step} mm`)); dimensionControls.append(field);
        }
        measures.append(dimensionControls);
      } else measures.append(el('p', 'Las medidas personalizadas todavía no están habilitadas para este modelo. Se confirman al cotizar.', 'cooktop-note'));
      if (kitchen.materials.length) measures.append(optionControl('materialId', 'Acero y espesor de la cubierta', kitchen.materials.map(material => ({ value: material.id, name: `${material.name} · ${material.steel} · ${material.thicknessMm} mm` }))));
      measures.append(el('p', (kitchen.materials.length ? 'El acero y espesor elegidos corresponden a la cubierta. ' : 'El acero y el espesor de la cubierta se confirman al cotizar. ') + 'El consumo de materiales, los otros componentes y el costo final requieren la receta de fabricación.', 'cooktop-note'));
      kitchenSections.push(measures);
    }
    const summary = el('p', cooktopSummary(rules, current.selection).text, 'cooktop-summary');
    const historyActions = el('div', '', 'cooktop-history');
    const undo = button('Deshacer', () => history('undo'), 'cooktop-undo');
    const redo = button('Rehacer', () => history('redo'), 'cooktop-redo');
    const reset = button('Restablecer hornillas', () => { current.anchor = 0; commit({ ...current.selection, placements: [] }, 'Distribución restablecida con todas las hornillas comunes.', 'cell'); }, 'cooktop-reset');
    undo.disabled = !current.past.length; redo.disabled = !current.future.length; reset.disabled = !current.selection.placements.length; historyActions.append(undo, redo, reset);
    const note = el('p', cooktopAssetFor(productId, model3d) ? 'Toca una pieza del modelo 3D para seleccionarla o colocar el módulo elegido. Visualización ilustrativa; medidas, precio y fabricación por confirmar.' : 'Plano de distribución para cotizar. El visor de este equipo muestra el modelo base mientras se preparan sus piezas 3D. Medidas, precio y fabricación por confirmar.', 'cooktop-note');
    current.content.replaceChildren(title, intro);
    if (!rules.enabled) current.content.append(el('p', 'Borrador privado · todavía no se ofrece a los clientes.', 'cooktop-draft'));
    current.content.append(baseSection, surfaceSection, ...kitchenSections, summary, historyActions, note);
    current.pick = chooseCell;
    if (announcement) announce(announcement);
    current.onChange(cooktopQuoteSummary(rules, current.selection));
    document.dispatchEvent(new CustomEvent('inox:cooktop-updated', { detail: { productId, state: { config: rules, selection: current.selection }, interactive } }));
    interaction(current.armed ? current.anchor : null);
    if (focus) root.querySelector<HTMLElement>(focus === 'cell' ? `[data-anchor="${current.anchor}"]` : focus)?.focus();
  }
  draw();
}
