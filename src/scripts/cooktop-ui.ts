import { cooktopQuoteSummary, cooktopSummary, energyName, initialCooktopSelection, moduleCells, placeCooktopModule, type CooktopConfig, type CooktopSelection } from '../lib/cooktop-config';

type View = { key: string; selection: CooktopSelection; anchor: number; onChange: (text: string) => void };
const views = new WeakMap<HTMLElement, View>();
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text: string, action: () => void, className = '') {
  const node = el('button', text, className); node.type = 'button'; node.onclick = action; return node;
}

/** One controller per rendered product, using only that product's approved modules. */
export function renderCooktop(root: HTMLElement, config: CooktopConfig | null, productId: string, onChange: (text: string) => void, preview = false): void {
  if (!config || (!config.enabled && !preview)) { root.hidden = true; root.replaceChildren(); views.delete(root); onChange(''); return; }
  const key = `${productId}:${JSON.stringify(config)}`;
  let view = views.get(root);
  if (!view || view.key !== key) { view = { key, selection: initialCooktopSelection(config), anchor: 0, onChange }; views.set(root, view); }
  view.onChange = onChange;
  root.hidden = false;
  const current = view;
  function draw(announcement = '', focusCell = false) {
    const layout = config!.layouts.find(l => l.id === current.selection.layoutId)!;
    const title = el('h2', 'Diseña tu superficie');
    const intro = el('p', 'Elige una posición y cambia su módulo. Solo aparecen las opciones autorizadas para esta cocina.', 'cooktop-intro');
    const controls = el('div', '', 'cooktop-controls');
    const layoutLabel = el('label', 'Base / capacidad');
    const layoutSelect = el('select'); layoutSelect.setAttribute('aria-label', 'Base de la cocina');
    layoutSelect.replaceChildren(...config!.layouts.map(l => new Option(`${l.name} · ${l.rows * l.columns} posiciones`, l.id)));
    layoutSelect.value = layout.id;
    layoutSelect.onchange = () => { current.selection = { ...current.selection, layoutId: layoutSelect.value, placements: [] }; current.anchor = 0; draw('Cambió la base. Restablecimos las hornillas para que elijas una distribución compatible.'); root.querySelector<HTMLSelectElement>('[aria-label="Base de la cocina"]')?.focus(); };
    layoutLabel.append(layoutSelect);
    const energyLabel = el('label', 'Tipo de energía');
    const energySelect = el('select'); energySelect.setAttribute('aria-label', 'Energía de la superficie');
    energySelect.replaceChildren(...config!.energies.map(e => new Option(energyName(e), e))); energySelect.value = current.selection.energy;
    energySelect.onchange = () => { current.selection = { ...current.selection, energy: energySelect.value as CooktopSelection['energy'], placements: [] }; current.anchor = 0; draw('Cambió la energía. Restablecimos los módulos para evitar una combinación incompatible.'); root.querySelector<HTMLSelectElement>('[aria-label="Energía de la superficie"]')?.focus(); };
    energyLabel.append(energySelect); controls.append(layoutLabel, energyLabel);
    const surface = el('div', '', 'cooktop-surface');
    surface.append(el('p', 'FONDO · VISTA SUPERIOR', 'cooktop-direction'));
    const grid = el('div', '', 'cooktop-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Posiciones de la superficie de cocción');
    grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(44px, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(76px, auto))`;
    const occupied = new Set<number>();
    const drawCell = (anchor: number, moduleId: string) => {
      const module = config!.modules.find(m => m.id === moduleId)!;
      const cells = moduleCells(layout, module, anchor); cells.forEach(cell => occupied.add(cell));
      const selected = cells.includes(current.anchor);
      const node = button('', () => { current.anchor = anchor; draw('', true); }, `cooktop-cell cooktop-kind-${module.kind}`);
      node.dataset.anchor = String(anchor); node.style.gridColumn = `${anchor % layout.columns + 1} / span ${module.width}`;
      node.style.gridRow = `${Math.floor(anchor / layout.columns) + 1} / span ${module.height}`;
      node.setAttribute('aria-pressed', String(selected)); node.setAttribute('aria-label', `Posiciones ${cells.map(n => n + 1).join(', ')}: ${module.name}. Seleccionar para cambiar.`);
      const symbol = el('span', '', 'cooktop-module-symbol'); symbol.setAttribute('aria-hidden', 'true');
      node.append(el('span', cells.map(n => n + 1).join(' + '), 'cooktop-position'), symbol, el('strong', module.name));
      grid.append(node);
    };
    current.selection.placements.forEach(p => drawCell(p.anchor, p.moduleId));
    for (let cell = 0; cell < layout.rows * layout.columns; cell++) if (!occupied.has(cell)) drawCell(cell, config!.defaultModuleId);
    surface.append(grid, el('p', 'FRENTE · CONTROLES', 'cooktop-direction'));
    const options = el('fieldset', '', 'cooktop-options'); options.append(el('legend', `Posición ${current.anchor + 1} · elige un módulo`));
    const group = el('div', '', 'cooktop-module-options');
    const active = current.selection.placements.find(p => moduleCells(layout, config!.modules.find(m => m.id === p.moduleId)!, p.anchor).includes(current.anchor))?.moduleId || config!.defaultModuleId;
    for (const module of config!.modules) {
      let error = '';
      try { placeCooktopModule(config!, current.selection, module.id, current.anchor); } catch (e) { error = e instanceof Error ? e.message : 'No disponible en esta posición.'; }
      const option = button('', () => {
        try { current.selection = placeCooktopModule(config!, current.selection, module.id, current.anchor); draw(`${module.name} seleccionado. ${cooktopSummary(config!, current.selection).text}.`, true); }
        catch (e) { draw(e instanceof Error ? e.message : 'No se puede colocar el módulo.'); }
      }, 'cooktop-module-option');
      option.disabled = Boolean(error); option.setAttribute('aria-pressed', String(active === module.id));
      option.append(el('strong', module.name), el('span', `${module.width * module.height} ${module.width * module.height === 1 ? 'posición' : 'posiciones'}`));
      if (error) { const reason = el('small', error); option.append(reason); option.title = error; }
      group.append(option);
    }
    options.append(group);
    const summary = el('p', cooktopSummary(config!, current.selection).text, 'cooktop-summary');
    const reset = button('Restablecer hornillas', () => { current.selection = { ...current.selection, placements: [] }; current.anchor = 0; draw('Distribución restablecida con todas las hornillas comunes.', true); }, 'cooktop-reset');
    const status = el('p', announcement, 'cooktop-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const note = el('p', 'Plano de distribución para cotizar. El visor 3D muestra el equipo base; esta selección aún no modifica su geometría. Medidas, precio y fabricación por confirmar.', 'cooktop-note');
    root.replaceChildren(title, intro);
    if (!config!.enabled) root.append(el('p', 'Borrador privado · todavía no se ofrece a los clientes.', 'cooktop-draft'));
    root.append(controls, surface, options, summary, reset, status, note);
    if (focusCell) grid.querySelector<HTMLButtonElement>(`[data-anchor="${current.anchor}"]`)?.focus();
    current.onChange(cooktopQuoteSummary(config!, current.selection));
  }
  draw();
}
