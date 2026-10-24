(() => {
  'use strict';
  const energies = { gas: 'Gas', electric: 'Eléctrica' };
  const kinds = { burner: 'Hornilla', wok: 'Quemador wok', griddle: 'Plancha', grill: 'Parrilla', fryer: 'Freidora', other: 'Otro módulo' };
  const kitchenFamilies = { linear: 'Lineal', central: 'Central', builtin: 'Empotrada', home: 'Casa / semiindustrial' };
  const kitchenChoices = { ovens: { none: 'Sin horno', gas: 'Horno a gas', electric: 'Horno eléctrico' }, structures: { open: 'Estructura abierta', cabinet: 'Mueble cerrado' }, supports: { feet: 'Patas', wheels: 'Ruedas' } };
  const dimensionNames = { widthMm: 'Ancho', depthMm: 'Fondo', heightMm: 'Alto' };
  const blankKitchen = family => ({ family, ovens: [], structures: [], supports: [], materials: [], dimensions: null });
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const editableKitchen = value => exactKeys(value, ['family', 'ovens', 'structures', 'supports', 'materials', 'dimensions']) && Object.hasOwn(kitchenFamilies, value.family)
    && ['ovens', 'structures', 'supports'].every(key => Array.isArray(value[key]) && value[key].every(item => Object.hasOwn(kitchenChoices[key], item)))
    && Array.isArray(value.materials) && value.materials.length <= 24 && value.materials.every(item => exactKeys(item, ['id', 'name', 'steel', 'thicknessMm']) && ['id', 'name', 'steel'].every(key => typeof item[key] === 'string') && (item.thicknessMm === null || typeof item.thicknessMm === 'number'))
    && (value.dimensions === null || (exactKeys(value.dimensions, Object.keys(dimensionNames)) && Object.values(value.dimensions).every(bounds => exactKeys(bounds, ['min', 'max', 'step']) && Object.values(bounds).every(number => number === null || typeof number === 'number'))));
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
  function familyConfig(family) {
    if (!Object.hasOwn(kitchenFamilies, family)) return null;
    const config = starterConfig(), counts = { linear: [1, 2, 3, 4, 5], central: [4, 6, 8, 10], builtin: [2, 4, 6], home: [4] }[family];
    config.kitchen = blankKitchen(family);
    config.layouts = counts.map(count => { const rows = family === 'linear' || count === 2 ? 1 : 2; return { id: `${family}${count}`, name: `${count} hornilla${count === 1 ? '' : 's'} · ${kitchenFamilies[family]}`, rows, columns: count / rows }; });
    config.modules = [config.modules[0]]; synchronizeBase(config);
    if (family === 'home') config.kitchen.ovens = ['none', 'gas', 'electric'];
    else {
      const wok = modulePreset(config, 'wok'); wok.maxQuantity = family === 'linear' ? Math.max(...counts) : 1;
      wok.anchors = Object.fromEntries(config.layouts.map(layout => [layout.id, cells(layout)])); config.modules.push(wok);
      if (family === 'central') ['griddle', 'grill', 'fryer'].forEach(kind => {
        const piece = modulePreset(config, kind);
        piece.anchors = Object.fromEntries(config.layouts.map(layout => [layout.id, validAnchors(layout, piece)])); config.modules.push(piece);
      });
    }
    return config;
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
    if (config.kitchen) {
      const kitchen = config.kitchen;
      kitchen.materials.forEach(material => {
        if (!material.name.trim() || !material.steel.trim()) errors.push('Completa el nombre y la calidad de acero de cada material de cubierta.');
        if (!Number.isFinite(material.thicknessMm) || material.thicknessMm <= 0 || material.thicknessMm > 20) errors.push('El espesor de la cubierta debe ser mayor que 0 y hasta 20 mm.');
      });
      if (kitchen.dimensions) Object.entries(kitchen.dimensions).forEach(([axis, bounds]) => {
        if (![bounds.min, bounds.max, bounds.step].every(value => Number.isInteger(value) && value >= 1 && value <= 10000)
          || bounds.max < bounds.min || bounds.step > Math.max(1, bounds.max - bounds.min)) errors.push(`${dimensionNames[axis]}: define mínimo, máximo y paso válidos en milímetros. Si la medida es fija, usa el mismo mínimo y máximo y paso 1.`);
      });
    }
    return errors;
  }
  const uniqueId = (prefix, entries) => { let index = 1; while (entries.some(entry => entry.id === `${prefix}${index}`)) index++; return `${prefix}${index}`; };
  const occupiedCells = (layout, module, anchor) => validAnchors(layout, module).includes(anchor)
    ? Array.from({ length: module.height }, (_, row) => Array.from({ length: module.width }, (_, column) => anchor + row * layout.columns + column)).flat() : [];
  function previewPlacement(config, state, moduleId, cell) {
    const layout = config.layouts.find(item => item.id === state.layoutId);
    const module = config.modules.find(item => item.id === moduleId);
    if (!layout || !module || !cells(layout).includes(cell)) throw new Error('Elige una posición de esta distribución.');
    const existing = state.placements.find(item => occupiedCells(layout, config.modules.find(candidate => candidate.id === item.moduleId), item.anchor).includes(cell));
    const placements = state.placements.filter(item => item !== existing);
    if (moduleId !== config.defaultModuleId) placements.push({ moduleId, anchor: existing?.anchor ?? cell });
    const covered = new Set(), counts = {};
    placements.forEach(item => {
      const piece = config.modules.find(candidate => candidate.id === item.moduleId);
      if (!piece || !piece.allowedLayouts.includes(layout.id) || !piece.energies.includes(state.energy)) throw new Error('Este módulo no admite la distribución o energía elegida.');
      const footprint = occupiedCells(layout, piece, item.anchor);
      if (!footprint.length || !piece.anchors[layout.id]?.includes(item.anchor)) throw new Error('No permitiste este módulo en esa posición.');
      if (footprint.some(index => covered.has(index))) throw new Error('Retira primero el módulo que ocupa las posiciones vecinas.');
      footprint.forEach(index => covered.add(index));
      counts[piece.id] = (counts[piece.id] || 0) + 1;
      if (counts[piece.id] > piece.maxQuantity) throw new Error(`Solo permites ${piece.maxQuantity} de ${piece.name}.`);
    });
    return { ...state, placements };
  }
  function modulePreset(config, kind) {
    const width = ['griddle', 'grill'].includes(kind) && !config.layouts.some(layout => layout.rows >= 2) ? 2 : 1;
    const height = ['griddle', 'grill'].includes(kind) && width === 1 ? 2 : 1;
    const layouts = config.layouts.filter(layout => validAnchors(layout, { width, height }).length);
    if (!layouts.length) return null;
    return { id: uniqueId(kind, config.modules), name: kinds[kind], kind, width, height, maxQuantity: 1,
      energies: [...config.energies], allowedLayouts: layouts.map(layout => layout.id),
      anchors: Object.fromEntries(layouts.map(layout => [layout.id, validAnchors(layout, { width, height }).slice(0, 1)])) };
  }
  const editableShape = value => value && value.version === 1 && value.kind === 'cooktop' && typeof value.enabled === 'boolean'
    && Array.isArray(value.energies) && value.energies.every(energy => Object.hasOwn(energies, energy))
    && Array.isArray(value.layouts) && value.layouts.length > 0 && value.layouts.length <= 6
    && value.layouts.every(layout => typeof layout.id === 'string' && typeof layout.name === 'string' && Number.isInteger(layout.rows) && layout.rows >= 1 && layout.rows <= 3 && Number.isInteger(layout.columns) && layout.columns >= 1 && layout.columns <= 12 && layout.rows * layout.columns <= 12)
    && Array.isArray(value.modules) && value.modules.length > 0 && value.modules.length <= 12
    && value.modules.every(module => typeof module.id === 'string' && typeof module.name === 'string' && Object.hasOwn(kinds, module.kind)
      && Number.isInteger(module.width) && module.width >= 1 && module.width <= 12 && Number.isInteger(module.height) && module.height >= 1 && module.height <= 3
      && Array.isArray(module.energies) && Array.isArray(module.allowedLayouts) && module.anchors
      && module.allowedLayouts.every(id => value.layouts.some(layout => layout.id === id) && Array.isArray(module.anchors[id])))
    && value.modules.some(module => module.id === value.defaultModuleId)
    && (!Object.hasOwn(value, 'kitchen') || editableKitchen(value.kitchen));

  function initialize(root) {
    const source = root.querySelector('textarea');
    const controls = root.querySelector('[data-cooktop-controls]');
    const status = root.querySelector('[data-cooktop-status]');
    if (!source || !controls || !status || source.disabled) return;
    const original = source.value;
    let config = null, previewState = null, previewModule = '', previewHistory = [], previewMessage = '';
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
      input.value = String(value ?? ''); input.addEventListener('change', () => action(input.value)); label.append(input); return label;
    }
    const numberField = (name, value, max, action, key) => field(name, value, raw => action(Number(raw)), key, Object.fromEntries(Array.from({ length: max }, (_, i) => [i + 1, String(i + 1)])));
    function commit(message = 'Cambios preparados. Pulsa Guardar para conservarlos.') {
      if (config) synchronizeBase(config);
      previewState = null; previewHistory = []; previewMessage = '';
      source.value = JSON.stringify(config || {});
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
      render(); status.textContent = message;
    }
    const toggle = (array, item, selected) => selected ? [...new Set([...array, item])] : array.filter(value => value !== item);
    function renderKitchen(parent) {
      const section = el('section', '', 'cooktop-section'); section.append(el('h3', 'Horno, estructura, medidas y cubierta', 'cooktop-section-title'));
      if (!config.kitchen) {
        section.append(el('p', 'Puedes definir estas opciones por separado de las hornillas. Se ofrecerán solo las que autorices para este equipo.', 'cooktop-hint'));
        section.append(button('Definir opciones de cocina', () => { config.kitchen = blankKitchen(config.layouts.every(layout => layout.rows === 1) ? 'linear' : 'central'); commit(); }, false, 'kitchen-prepare'));
        parent.append(section); return;
      }
      const kitchen = config.kitchen;
      const family = el('div', '', 'cooktop-fields'); family.append(field('Familia de cocina', kitchen.family, value => { kitchen.family = value; commit('Familia actualizada. Las distribuciones y los módulos existentes se conservan.'); }, 'kitchen-family', kitchenFamilies)); section.append(family);
      section.append(el('p', 'Marca únicamente las opciones que fabricas. Si no marcas ninguna en una sección, el cliente no podrá cambiarla. Son independientes de las posiciones de hornillas.', 'cooktop-hint'));
      [['ovens', 'Tipos de horno'], ['structures', 'Estructuras'], ['supports', 'Patas y ruedas']].forEach(([key, title]) => {
        const card = el('section', '', 'cooktop-card'); card.append(el('h3', title)); const checks = el('div', '', 'cooktop-checks');
        Object.entries(kitchenChoices[key]).forEach(([value, label]) => checks.append(check(label, kitchen[key].includes(value), checked => { kitchen[key] = toggle(kitchen[key], value, checked); commit(); }, `kitchen-${key}-${value}`)));
        card.append(checks); section.append(card);
      });
      const materials = el('section', '', 'cooktop-card'); materials.append(el('h3', 'Material de la cubierta'), el('p', 'Define las combinaciones de calidad y espesor permitidas para la cubierta. No se aplican automáticamente a todas las piezas ni descuentan inventario.', 'cooktop-hint'));
      kitchen.materials.forEach(material => {
        const fields = el('div', '', 'cooktop-fields cooktop-material-fields');
        fields.append(field('Nombre visible', material.name, value => { material.name = value; commit(); }, `material-${material.id}-name`));
        fields.append(field('Calidad / acabado', material.steel, value => { material.steel = value; commit(); }, `material-${material.id}-steel`));
        fields.append(field('Espesor (mm)', material.thicknessMm, value => { material.thicknessMm = Number(value.replace(',', '.')); commit(); }, `material-${material.id}-thickness`));
        fields.append(button('Quitar material', () => { kitchen.materials = kitchen.materials.filter(item => item !== material); commit(); })); materials.append(fields);
      });
      materials.append(button('Añadir material de cubierta', () => { kitchen.materials.push({ id: uniqueId('material', kitchen.materials), name: '', steel: '', thicknessMm: null }); commit('Completa el nombre, la calidad y el espesor del material que permites.'); }, kitchen.materials.length >= 24)); section.append(materials);
      const dimensions = el('section', '', 'cooktop-card'); dimensions.append(el('h3', 'Medidas permitidas'));
      const enableDimensions = check('Permitir elegir medidas', kitchen.dimensions !== null, checked => {
        kitchen.dimensions = checked ? Object.fromEntries(Object.keys(dimensionNames).map(axis => [axis, { min: null, max: null, step: null }])) : null;
        commit(checked ? 'Completa los rangos reales en milímetros. No se proponen medidas de fabricación.' : 'El cliente ya no podrá cambiar las medidas.');
      }, 'kitchen-dimensions'); enableDimensions.className = 'cooktop-enable'; dimensions.append(enableDimensions);
      if (kitchen.dimensions) Object.entries(dimensionNames).forEach(([axis, name]) => {
        const fields = el('div', '', 'cooktop-fields cooktop-material-fields');
        [['min', 'Mínimo'], ['max', 'Máximo'], ['step', 'Incremento']].forEach(([key, label]) => fields.append(field(`${name}: ${label} (mm)`, kitchen.dimensions[axis][key], value => { kitchen.dimensions[axis][key] = Number(value); commit(); }, `dimension-${axis}-${key}`))); dimensions.append(fields);
      });
      dimensions.append(el('p', 'Para una medida fija, escribe el mismo mínimo y máximo y un incremento de 1. Los límites deben corresponder a lo que puedes fabricar.', 'cooktop-hint')); section.append(dimensions);
      section.append(el('p', 'La representación 3D de horno, estructura, apoyos y medidas depende del modelo preparado para ese equipo. Los materiales y medidas son especificaciones para cotizar; no reemplazan su receta de fabricación.', 'cooktop-hint'));
      section.append(button('Quitar opciones de cocina', () => { delete config.kitchen; commit('Opciones de cocina retiradas del borrador. Las reglas de hornillas se conservan.'); })); parent.append(section);
    }
    function renderPreview(parent) {
      const box = el('section', '', 'cooktop-card cooktop-preview'); box.append(el('h3', 'Prueba las combinaciones que permites'));
      if (!previewState) previewState = { layoutId: config.layouts[0].id, energy: config.energies[0], placements: [] };
      const layout = config.layouts.find(item => item.id === previewState.layoutId);
      const candidates = config.modules.filter(module => module.allowedLayouts.includes(layout.id) && module.energies.includes(previewState.energy) && validAnchors(layout, module).some(anchor => module.anchors[layout.id]?.includes(anchor)));
      const module = candidates.find(item => item.id === previewModule) || candidates[0]; previewModule = module?.id || '';
      const resetTrial = message => { previewState.placements = []; previewHistory = []; previewMessage = message; render(); };
      const choices = el('div', '', 'cooktop-fields');
      choices.append(field('Distribución de prueba', layout.id, id => { previewState.layoutId = id; resetTrial('Nueva base de prueba: todas sus posiciones vuelven a ser hornillas.'); }, 'preview-layout', Object.fromEntries(config.layouts.map(item => [item.id, item.name]))));
      choices.append(field('Energía de prueba', previewState.energy, energy => { previewState.energy = energy; resetTrial('Energía cambiada. Prueba los módulos compatibles.'); }, 'preview-energy', Object.fromEntries(config.energies.map(energy => [energy, energies[energy]]))));
      choices.append(field('1. Elige qué colocar', module?.id || '', id => { previewModule = id; previewMessage = ''; render(); }, 'preview-module', Object.fromEntries(candidates.map(item => [item.id, item.id === config.defaultModuleId ? 'Restaurar hornillas' : `${item.name} · ocupa ${item.width * item.height} posición(es)`]))));
      box.append(choices);
      if (module) {
        box.append(el('p', '2. Pulsa una zona disponible. Combina varios módulos y comprueba qué hornillas reemplazan.', 'cooktop-hint'));
        const grid = el('div', '', 'cooktop-grid'); grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(44px, 1fr))`;
        let available = 0;
        cells(layout).forEach(anchor => {
          const placed = previewState.placements.find(item => occupiedCells(layout, config.modules.find(candidate => candidate.id === item.moduleId), item.anchor).includes(anchor));
          const piece = config.modules.find(item => item.id === (placed?.moduleId || config.defaultModuleId));
          let next, reason = '';
          try { next = previewPlacement(config, previewState, module.id, anchor); available++; } catch (error) { reason = error.message; }
          const cell = button('', () => {
            if (JSON.stringify(next) === JSON.stringify(previewState)) return;
            previewHistory.push(previewState); previewHistory = previewHistory.slice(-20); previewState = next;
            previewMessage = module.id === config.defaultModuleId ? 'Hornillas restauradas en el espacio que ocupaba ese módulo.' : `${module.name} colocado. Puedes combinarlo con otros módulos permitidos.`;
            render();
          }, !next, `preview-${anchor}`);
          cell.append(el('span', `${anchor + 1} · ${positionName(layout, anchor)}`, 'cooktop-preview-position'), el('strong', piece.name));
          cell.dataset.covered = String(Boolean(placed)); cell.dataset.kind = piece.kind;
          cell.title = reason || `Colocar ${module.name} en ${positionName(layout, anchor)}`;
          cell.setAttribute('aria-label', `${positionName(layout, anchor)}: ${piece.name}. ${cell.title}`);
          grid.append(cell);
        });
        box.append(grid);
        if (!available) box.append(el('p', 'No hay posiciones disponibles para este módulo con las reglas y la combinación actuales. Restaura hornillas o revisa sus límites y posiciones permitidas.', 'cooktop-hint'));
      }
      const occupied = previewState.placements.reduce((total, item) => { const piece = config.modules.find(candidate => candidate.id === item.moduleId); return total + piece.width * piece.height; }, 0);
      const counts = config.modules.map(item => ({ name: item.name, count: previewState.placements.filter(placement => placement.moduleId === item.id).length })).filter(item => item.count);
      box.append(el('p', `${layout.rows * layout.columns - occupied} hornillas comunes${counts.map(item => ` · ${item.count} ${item.name}`).join('')}`, 'cooktop-trial-summary'));
      const actions = el('div', '', 'cooktop-toolbar');
      actions.append(button('Deshacer prueba', () => { previewState = previewHistory.pop(); previewMessage = 'Último cambio de la prueba deshecho.'; render(); }, !previewHistory.length, 'preview-undo'));
      actions.append(button('Restaurar todas las hornillas', () => resetTrial('Prueba reiniciada con todas las hornillas.'), !previewState.placements.length, 'preview-reset')); box.append(actions);
      const feedback = el('p', previewMessage, 'cooktop-trial-status'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); box.append(feedback);
      box.append(el('p', 'Esta prueba no cambia el producto ni guarda una combinación inicial. El cliente elegirá su combinación; las reglas de abajo se conservan al pulsar Guardar. Los cambios 3D requieren un modelo preparado con piezas intercambiables.', 'cooktop-hint')); parent.append(box);
    }
    function render() {
      const focused = document.activeElement?.dataset?.focus;
      controls.replaceChildren();
      controls.append(el('p', 'Para cocinas de fabricación propia en Línea caliente. Define sus opciones compatibles; los cambios se aplican únicamente a este equipo cuando pulses Guardar.', 'cooktop-hint'));
      controls.append(el('p', 'Define aquí los módulos que sustituyen hornillas y las opciones de horno, estructura, patas o ruedas, cubierta y medidas de esta cocina. Los accesorios comerciales independientes se agregan en Adicionales. Estas reglas corresponden al equipo base; las variaciones independientes no las heredan.', 'cooktop-hint'));
      if (!config) {
        controls.append(el('p', 'Este equipo todavía no tiene configurador.'));
        const starters = el('div', '', 'cooktop-toolbar');
        Object.entries(kitchenFamilies).forEach(([family, name]) => starters.append(button(`Preparar cocina ${name.toLowerCase()}`, () => { config = familyConfig(family); commit('Base preparada y deshabilitada. Revisa sus módulos y opciones antes de guardar o habilitarla.'); }, false, `prepare-${family}`))); controls.append(starters);
        controls.append(button('Preparar ejemplo de 6 posiciones', () => { config = starterConfig(); commit('Ejemplo preparado y deshabilitado. Revisa sus opciones antes de guardar o habilitarlo.'); }, false, 'prepare'));
        if (original && original !== '{}') controls.append(button('Restaurar configuración inicial', () => { config = JSON.parse(original); commit('Configuración inicial recuperada.'); }));
        return;
      }
      controls.append(check('Habilitar configurador en este equipo', config.enabled, checked => { config.enabled = checked; commit(); }, 'enabled'));
      controls.lastElementChild.className = 'cooktop-enable';
      controls.append(el('p', config.enabled ? 'Al guardar, se mostrará si el producto también está activo y publicado.' : 'Deshabilitado: se conserva como borrador privado y puede revisarse en la vista previa.', 'cooktop-hint'));
      renderPreview(controls);
      renderKitchen(controls);
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
          if (module.kind === 'other') card.append(el('p', 'Módulo personalizado de la superficie: define su nombre, el espacio que ocupa y dónde lo permites. Necesita su propia pieza 3D para visualizarse con fidelidad. Horno, estructura y medidas generales no ocupan posiciones en este esquema.', 'cooktop-hint'));
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
      const presets = el('div', '', 'cooktop-toolbar');
      [['wok', 'Añadir wok'], ['griddle', 'Añadir plancha de 2 posiciones'], ['grill', 'Añadir parrilla de 2 posiciones'], ['fryer', 'Añadir freidora']].forEach(([kind, label]) => presets.append(button(label, () => {
        const preset = modulePreset(config, kind); if (!preset) return;
        config.modules.push(preset); commit(`${preset.name} añadido. Revisa la energía, el máximo y las posiciones permitidas antes de guardar.`);
      }, config.modules.length >= 12 || !modulePreset(config, kind))));
      modules.append(presets);
      modules.append(button('Añadir módulo', () => { const id = uniqueId('module', config.modules); config.modules.push({ id, name: 'Nuevo módulo', kind: 'other', width: 1, height: 1, maxQuantity: 1, energies: [...config.energies], allowedLayouts: config.layouts.map(layout => layout.id), anchors: Object.fromEntries(config.layouts.map(layout => [layout.id, [0]])) }); commit(); }, config.modules.length >= 12)); controls.append(modules);
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
  if (typeof module === 'object' && module.exports) module.exports = { starterConfig, familyConfig, validAnchors, positionName, synchronizeBase, trimAnchors, problems, previewPlacement, modulePreset, initialize };
  if (typeof document !== 'undefined') {
    const start = () => document.querySelectorAll('[data-cooktop-editor]').forEach(initialize);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
})();
