(() => {
  'use strict';
  const energies = { gas: 'Gas', electric: 'Eléctrica' };
  const kinds = { burner: 'Hornilla', wok: 'Quemador wok', griddle: 'Plancha', grill: 'Parrilla', other: 'Otro módulo' };
  const cells = layout => Array.from({ length: layout.rows * layout.columns }, (_, index) => index);
  const validAnchors = (layout, module) => cells(layout).filter(anchor => Math.floor(anchor / layout.columns) + module.height <= layout.rows && anchor % layout.columns + module.width <= layout.columns);
  const positionName = (layout, anchor) => {
    const columns = { 1: ['Centro'], 2: ['Izquierda', 'Derecha'], 3: ['Izquierda', 'Centro', 'Derecha'], 4: ['Izquierda', 'Centro izquierdo', 'Centro derecho', 'Derecha'], 5: ['Izquierda', 'Centro izquierdo', 'Centro', 'Centro derecho', 'Derecha'] };
    const rows = { 1: ['Fila única'], 2: ['Fondo', 'Frente'], 3: ['Fondo', 'Centro', 'Frente'] };
    const column = anchor % layout.columns;
    return `${rows[layout.rows][Math.floor(anchor / layout.columns)]} · ${columns[layout.columns]?.[column] || `Columna ${column + 1}`}`;
  };
  function starterConfig() {
    return { version: 1, kind: 'cooktop', enabled: false, energies: ['gas'], defaultModuleId: 'burner',
      layouts: [{ id: 'six', name: '6 posiciones', rows: 2, columns: 3 }],
      modules: [
        { id: 'burner', name: 'Hornilla', kind: 'burner', width: 1, height: 1, energies: ['gas'], allowedLayouts: ['six'], maxQuantity: 6, anchors: { six: [0, 1, 2, 3, 4, 5] } },
        { id: 'wok', name: 'Quemador wok', kind: 'wok', width: 1, height: 1, energies: ['gas'], allowedLayouts: ['six'], maxQuantity: 2, anchors: { six: [0, 1, 2, 3, 4, 5] } },
        { id: 'griddle', name: 'Plancha', kind: 'griddle', width: 1, height: 2, energies: ['gas'], allowedLayouts: ['six'], maxQuantity: 1, anchors: { six: [0] } },
        { id: 'grill', name: 'Parrilla', kind: 'grill', width: 1, height: 2, energies: ['gas'], allowedLayouts: ['six'], maxQuantity: 1, anchors: { six: [0] } },
      ] };
  }
  function synchronizeBase(config) {
    const base = config.modules.find(module => module.id === config.defaultModuleId);
    if (!base) return;
    Object.assign(base, { kind: 'burner', width: 1, height: 1, energies: [...config.energies],
      allowedLayouts: config.layouts.map(layout => layout.id), maxQuantity: Math.max(...config.layouts.map(layout => layout.rows * layout.columns)),
      anchors: Object.fromEntries(config.layouts.map(layout => [layout.id, cells(layout)])) });
  }
  function trimAnchors(config) {
    config.modules.filter(module => module.id !== config.defaultModuleId).forEach(module => {
      module.allowedLayouts = module.allowedLayouts.filter(id => config.layouts.some(layout => layout.id === id));
      module.anchors = Object.fromEntries(module.allowedLayouts.map(id => {
        const layout = config.layouts.find(layout => layout.id === id);
        return [id, (module.anchors[id] || []).filter(anchor => validAnchors(layout, module).includes(anchor))];
      }));
      module.energies = module.energies.filter(energy => config.energies.includes(energy));
    });
  }
  function problems(config) {
    if (!config) return [];
    const errors = [];
    if (!config.energies.length) errors.push('Elige al menos un tipo de energía.');
    config.layouts.forEach(layout => {
      if (!layout.name.trim()) errors.push('Pon un nombre a cada distribución.');
      if (layout.rows * layout.columns > 12) errors.push(`${layout.name.trim() || 'Distribución sin nombre'}: el máximo es de 12 posiciones. Reduce las filas o columnas.`);
    });
    config.modules.forEach(module => {
      const name = module.name.trim() || 'Módulo sin nombre';
      if (!module.name.trim()) errors.push('Pon un nombre a cada módulo.');
      if (!module.energies.length) errors.push(`${name}: elige al menos un tipo de energía.`);
      if (!module.allowedLayouts.length) errors.push(`${name}: elige al menos una distribución.`);
      module.allowedLayouts.forEach(id => { if (!module.anchors[id]?.length) errors.push(`${name}: marca una posición permitida en ${config.layouts.find(layout => layout.id === id)?.name || id}.`); });
    });
    return errors;
  }
  const uniqueId = (prefix, entries) => { let index = 1; while (entries.some(entry => entry.id === `${prefix}${index}`)) index++; return `${prefix}${index}`; };
  const editableShape = value => value && value.version === 1 && value.kind === 'cooktop' && typeof value.enabled === 'boolean'
    && Array.isArray(value.energies) && value.energies.every(energy => Object.hasOwn(energies, energy))
    && Array.isArray(value.layouts) && value.layouts.length > 0 && value.layouts.length <= 6
    && value.layouts.every(layout => typeof layout.id === 'string' && typeof layout.name === 'string' && Number.isInteger(layout.rows) && layout.rows >= 1 && layout.rows <= 3 && Number.isInteger(layout.columns) && layout.columns >= 1 && layout.columns <= 12 && layout.rows * layout.columns <= 12)
    && Array.isArray(value.modules) && value.modules.length > 0 && value.modules.length <= 12
    && value.modules.every(module => typeof module.id === 'string' && typeof module.name === 'string' && Object.hasOwn(kinds, module.kind)
      && Number.isInteger(module.width) && module.width >= 1 && module.width <= 12 && Number.isInteger(module.height) && module.height >= 1 && module.height <= 3
      && Array.isArray(module.energies) && Array.isArray(module.allowedLayouts) && module.anchors
      && module.allowedLayouts.every(id => value.layouts.some(layout => layout.id === id) && Array.isArray(module.anchors[id])))
    && value.modules.some(module => module.id === value.defaultModuleId);

  function initialize(root) {
    const source = root.querySelector('textarea');
    const controls = root.querySelector('[data-cooktop-controls]');
    const status = root.querySelector('[data-cooktop-status]');
    if (!source || !controls || !status || source.disabled) return;
    const original = source.value;
    let config = null, previewLayout = '', previewModule = '', previewAnchor = 0;
    try {
      const value = JSON.parse(original || '{}');
      if (Object.keys(value).length) { if (!editableShape(value)) throw new Error('Unsupported configuration'); config = value; }
    } catch {
      source.hidden = true; root.querySelector('[data-cooktop-fallback]').hidden = true;
      status.textContent = 'No se pudo abrir esta configuración en el editor visual. El contenido original se conserva; revisa el error del campo antes de guardar.';
      return;
    }
    source.hidden = true;
    root.querySelector('[data-cooktop-fallback]').hidden = true;
    controls.hidden = false;
    function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
    function button(text, action, disabled = false, key = '') { const node = el('button', text); node.type = 'button'; node.disabled = disabled; if (key) node.dataset.focus = key; node.addEventListener('click', action); return node; }
    function check(text, checked, action, key) { const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = checked; input.dataset.focus = key; input.addEventListener('change', () => action(input.checked)); label.append(input, el('span', text)); return label; }
    function field(text, value, action, key, options) {
      const label = el('label', text); const input = el(options ? 'select' : 'input'); input.dataset.focus = key;
      if (options) Object.entries(options).forEach(([value, name]) => { const option = el('option', name); option.value = value; input.append(option); });
      else { input.type = 'text'; input.maxLength = 120; }
      input.value = String(value); input.addEventListener('change', () => action(input.value)); label.append(input); return label;
    }
    const numberField = (name, value, max, action, key) => field(name, value, raw => action(Number(raw)), key, Object.fromEntries(Array.from({ length: max }, (_, i) => [i + 1, String(i + 1)])));
    function commit(message = 'Cambios preparados. Pulsa Guardar para conservarlos.') {
      if (config) synchronizeBase(config);
      source.value = JSON.stringify(config || {});
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
      render(); status.textContent = message;
    }
    const toggle = (array, item, selected) => selected ? [...new Set([...array, item])] : array.filter(value => value !== item);
    function renderPreview(parent) {
      const box = el('section', '', 'cooktop-card cooktop-preview'); box.append(el('h3', 'Vista superior de ejemplo'));
      const layout = config.layouts.find(item => item.id === previewLayout) || config.layouts[0]; previewLayout = layout.id;
      const candidates = config.modules.filter(module => module.allowedLayouts.includes(layout.id) && validAnchors(layout, module).some(anchor => module.anchors[layout.id]?.includes(anchor)));
      const module = candidates.find(item => item.id === previewModule) || candidates[0]; previewModule = module?.id || '';
      const choices = el('div', '', 'cooktop-fields');
      choices.append(field('Distribución', layout.id, id => { previewLayout = id; render(); }, 'preview-layout', Object.fromEntries(config.layouts.map(item => [item.id, item.name]))));
      choices.append(field('Mostrar ubicación de', module?.id || '', id => { previewModule = id; render(); }, 'preview-module', Object.fromEntries(candidates.map(item => [item.id, item.name]))));
      box.append(choices);
      if (module) {
        const allowed = module.anchors[layout.id] || [];
        if (!allowed.includes(previewAnchor)) previewAnchor = allowed[0];
        const footprint = new Set();
        for (let row = 0; row < module.height; row++) for (let column = 0; column < module.width; column++) footprint.add(previewAnchor + row * layout.columns + column);
        const grid = el('div', '', 'cooktop-grid'); grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(44px, 1fr))`;
        cells(layout).forEach(anchor => { const cell = button(`${positionName(layout, anchor)} · ${footprint.has(anchor) ? module.name : 'Hornilla'}`, () => { previewAnchor = anchor; render(); }, !allowed.includes(anchor), `preview-${anchor}`); cell.dataset.covered = String(footprint.has(anchor)); grid.append(cell); });
        box.append(grid, el('p', `${module.name}: ${positionName(layout, previewAnchor)}. Ocupa ${module.width} columna(s) × ${module.height} fila(s).`, 'cooktop-hint'));
      }
      box.append(el('p', 'Pulsa una posición permitida para probar su ubicación. Es un esquema de ejemplo; el modelo 3D sigue mostrando el equipo base.', 'cooktop-hint')); parent.append(box);
    }
    function render() {
      const focused = document.activeElement?.dataset?.focus;
      controls.replaceChildren();
      controls.append(el('p', 'Para cocinas de fabricación propia en Línea caliente. Define sus opciones compatibles; los cambios se aplican únicamente a este equipo cuando pulses Guardar.', 'cooktop-hint'));
      controls.append(el('p', 'Plancha, wok y parrilla que sustituyen hornillas se definen aquí; ruedas o repisas se agregan en Adicionales. Estas reglas corresponden al equipo base; las variaciones independientes no las heredan.', 'cooktop-hint'));
      if (!config) {
        controls.append(el('p', 'Este equipo todavía no tiene configurador.'));
        controls.append(button('Preparar ejemplo de 6 posiciones', () => { config = starterConfig(); commit('Ejemplo preparado y deshabilitado. Revisa sus opciones antes de guardar o habilitarlo.'); }, false, 'prepare'));
        if (original && original !== '{}') controls.append(button('Restaurar configuración inicial', () => { config = JSON.parse(original); commit('Configuración inicial recuperada.'); }));
        return;
      }
      controls.append(check('Habilitar configurador en este equipo', config.enabled, checked => { config.enabled = checked; commit(); }, 'enabled'));
      controls.lastElementChild.className = 'cooktop-enable';
      controls.append(el('p', config.enabled ? 'Al guardar, se mostrará si el producto también está activo y publicado.' : 'Deshabilitado: se conserva como borrador privado y puede revisarse en la vista previa.', 'cooktop-hint'));
      const energyBox = el('div', '', 'cooktop-checks');
      Object.entries(energies).forEach(([energy, name]) => energyBox.append(check(name, config.energies.includes(energy), checked => {
        if (!checked && config.energies.length === 1) { render(); status.textContent = 'Conserva al menos un tipo de energía.'; return; }
        config.energies = toggle(config.energies, energy, checked); trimAnchors(config); commit('Energía actualizada. Revisa la compatibilidad de cada módulo antes de guardar.');
      }, `energy-${energy}`)));
      controls.append(el('h3', 'Energías compatibles', 'cooktop-section-title'), energyBox);
      const layouts = el('section', '', 'cooktop-section'); layouts.append(el('h3', 'Distribuciones de posiciones', 'cooktop-section-title'));
      config.layouts.forEach(layout => {
        const card = el('div', '', 'cooktop-card'), fields = el('div', '', 'cooktop-fields');
        fields.append(field('Nombre', layout.name, value => { layout.name = value; commit(); }, `layout-${layout.id}-name`));
        fields.append(numberField('Filas (fondo → frente)', layout.rows, 3, value => { layout.rows = value; trimAnchors(config); commit('Filas actualizadas. Revisa las posiciones permitidas de los módulos.'); }, `layout-${layout.id}-rows`));
        fields.append(numberField('Columnas (izquierda → derecha)', layout.columns, 12, value => { layout.columns = value; trimAnchors(config); commit('Columnas actualizadas. Revisa las posiciones permitidas de los módulos.'); }, `layout-${layout.id}-columns`));
        card.append(fields, el('p', `${layout.rows * layout.columns} posiciones en total.`, 'cooktop-hint'));
        card.append(button('Quitar distribución', () => { config.layouts = config.layouts.filter(item => item !== layout); trimAnchors(config); commit('Distribución quitada del borrador. Revisa los módulos asociados.'); }, config.layouts.length === 1)); layouts.append(card);
      });
      layouts.append(button('Añadir distribución', () => { config.layouts.push({ id: uniqueId('layout', config.layouts), name: 'Nueva distribución', rows: 2, columns: 3 }); commit('Distribución añadida. Elige qué módulos se podrán usar en ella.'); }, config.layouts.length >= 6)); controls.append(layouts);
      const modules = el('section', '', 'cooktop-section'); modules.append(el('h3', 'Hornillas y módulos opcionales', 'cooktop-section-title'));
      config.modules.forEach(module => {
        const base = module.id === config.defaultModuleId;
        const card = el('section', '', 'cooktop-card'); card.append(el('h3', base ? 'Hornilla base' : module.name || 'Nuevo módulo'));
        const fields = el('div', '', 'cooktop-fields'); fields.append(field('Nombre', module.name, value => { module.name = value; commit(); }, `module-${module.id}-name`));
        if (!base) {
          fields.append(field('Tipo', module.kind, value => { module.kind = value; commit(); }, `module-${module.id}-kind`, kinds));
          fields.append(numberField('Ancho en columnas', module.width, 12, value => { module.width = value; trimAnchors(config); commit('Ancho actualizado. Revisa las posiciones permitidas.'); }, `module-${module.id}-width`));
          fields.append(numberField('Fondo en filas', module.height, 3, value => { module.height = value; trimAnchors(config); commit('Fondo actualizado. Revisa las posiciones permitidas.'); }, `module-${module.id}-height`));
          fields.append(numberField('Cantidad máxima por cocina', module.maxQuantity, 12, value => { module.maxQuantity = value; commit(); }, `module-${module.id}-max`));
        }
        card.append(fields);
        if (base) card.append(el('p', 'Ocupa una posición. Completa automáticamente todos los espacios libres, en cada distribución y energía elegida.', 'cooktop-hint'));
        else {
          card.append(el('p', 'Energía compatible con este módulo'));
          const checks = el('div', '', 'cooktop-checks');
          config.energies.forEach(energy => checks.append(check(energies[energy], module.energies.includes(energy), checked => { module.energies = toggle(module.energies, energy, checked); commit(); }, `${module.id}-energy-${energy}`))); card.append(checks);
          config.layouts.forEach(layout => {
            const block = el('div', '', 'cooktop-anchor-block'), active = module.allowedLayouts.includes(layout.id);
            const layoutCheck = check(`Permitir en ${layout.name}`, active, checked => {
              module.allowedLayouts = toggle(module.allowedLayouts, layout.id, checked);
              if (checked) module.anchors[layout.id] = validAnchors(layout, module).slice(0, 1); else delete module.anchors[layout.id];
              commit();
            }, `${module.id}-layout-${layout.id}`); layoutCheck.className = 'cooktop-enable'; block.append(layoutCheck);
            if (active) {
              block.append(el('p', 'Marca dónde puede comenzar el módulo. Se extiende hacia la derecha y hacia el frente.', 'cooktop-hint'));
              const grid = el('div', '', 'cooktop-grid'); grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(44px, 1fr))`;
              cells(layout).forEach(anchor => {
                const label = check(positionName(layout, anchor), module.anchors[layout.id]?.includes(anchor), checked => { module.anchors[layout.id] = toggle(module.anchors[layout.id] || [], anchor, checked).sort((a, b) => a - b); commit(); }, `${module.id}-${layout.id}-${anchor}`);
                label.querySelector('input').disabled = !validAnchors(layout, module).includes(anchor); grid.append(label);
              }); block.append(grid);
            }
            card.append(block);
          });
          const actions = el('div', '', 'cooktop-toolbar'); actions.append(button('Quitar módulo', () => { config.modules = config.modules.filter(item => item !== module); commit(); })); card.append(actions);
        }
        modules.append(card);
      });
      modules.append(button('Añadir módulo', () => { const id = uniqueId('module', config.modules); config.modules.push({ id, name: 'Nuevo módulo', kind: 'other', width: 1, height: 1, maxQuantity: 1, energies: [...config.energies], allowedLayouts: config.layouts.map(layout => layout.id), anchors: Object.fromEntries(config.layouts.map(layout => [layout.id, [0]])) }); commit(); }, config.modules.length >= 12)); controls.append(modules);
      renderPreview(controls);
      const errors = problems(config);
      if (errors.length) { const list = el('ul', '', 'cooktop-errors'); list.setAttribute('role', 'alert'); errors.forEach(error => list.append(el('li', error))); controls.append(list); }
      controls.append(el('p', `${config.enabled ? 'Habilitado al guardar' : 'Borrador deshabilitado'} · ${config.energies.map(energy => energies[energy]).join(' / ')} · ${config.layouts.length} distribución(es) · ${config.modules.length - 1} módulo(s) opcional(es). Todos los importes se cotizan.`, 'cooktop-summary'));
      const actions = el('div', '', 'cooktop-toolbar'); actions.append(button('Quitar configuración de este equipo', () => { config = null; commit('Configuración quitada del borrador. Se aplicará cuando guardes.'); })); controls.append(actions);
      if (focused) [...controls.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === focused)?.focus();
    }
    source.form?.addEventListener('submit', event => {
      const errors = problems(config);
      if (!errors.length) return;
      event.preventDefault(); render(); status.textContent = 'Corrige las opciones indicadas antes de guardar.';
      const invalid = controls.querySelector('.cooktop-errors'); invalid.tabIndex = -1;
      const fieldset = root.closest('[data-inox-step]');
      if (fieldset) document.querySelector(`[data-inox-go-step="${fieldset.dataset.inoxStep}"]`)?.click();
      invalid.focus();
    });
    render();
  }
  if (typeof module === 'object' && module.exports) module.exports = { starterConfig, validAnchors, positionName, synchronizeBase, trimAnchors, problems, initialize };
  if (typeof document !== 'undefined') {
    const start = () => document.querySelectorAll('[data-cooktop-editor]').forEach(initialize);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
})();
