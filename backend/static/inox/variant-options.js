(() => {
  'use strict';
  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) && !reserved.has(value);
  const label = value => typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 120 && !/[\u0000-\u001f\ud800-\udfff]/u.test(value);
  const objectKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

  function validateAxes(axes, allowDraft = false) {
    if (!Array.isArray(axes) || axes.length > 3) throw new Error('Se permiten hasta 3 tipos de opción por equipo.');
    const ids = new Set();
    for (const axis of axes) {
      if (!objectKeys(axis, ['id', 'label', 'options']) || !identifier(axis.id) || ids.has(axis.id)) throw new Error('Un tipo de opción tiene un identificador inválido o repetido.');
      ids.add(axis.id);
      if (!(allowDraft && typeof axis.label === 'string') && !label(axis.label)) throw new Error('Escribe un nombre para cada tipo de opción (hasta 120 caracteres).');
      if (!Array.isArray(axis.options) || (!allowDraft && axis.options.length < 1) || axis.options.length > 10) throw new Error('Cada tipo necesita entre 1 y 10 valores permitidos.');
      const options = new Set();
      for (const option of axis.options) {
        if (!objectKeys(option, ['id', 'label']) || !identifier(option.id) || options.has(option.id)) throw new Error('Un valor permitido tiene un identificador inválido o repetido.');
        if (!(allowDraft && typeof option.label === 'string') && !label(option.label)) throw new Error('Completa el nombre de cada valor permitido (hasta 120 caracteres).');
        options.add(option.id);
      }
    }
    return axes;
  }

  function selectionStatus(axes, values, active) {
    validateAxes(axes);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('La combinación guardada no tiene un formato válido.');
    if (!Object.keys(values).length) {
      if (axes.length && active) throw new Error('Elige todas las opciones antes de activar esta variación.');
      return axes.length ? 'Borrador sin combinación. Completa todas las opciones antes de activarlo.' : 'Variación libre: el nombre identifica la capacidad, el tamaño o el modelo.';
    }
    if (!objectKeys(values, axes.map(axis => axis.id))) throw new Error('Revisa la combinación: los tipos permitidos cambiaron. Elige de nuevo todas las opciones.');
    for (const axis of axes) {
      if (!axis.options.some(option => option.id === values[axis.id])) throw new Error(`Elige un valor permitido de ${axis.label}.`);
    }
    return 'Combinación completa. Usa su foto, modelo 3D y ficha correspondientes.';
  }

  function writeValues(source, values) {
    source.value = JSON.stringify(values);
    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearAsDraft(source, active) {
    if (active) {
      active.checked = false;
      active.dispatchEvent(new Event('change', { bubbles: true }));
    }
    writeValues(source, {});
  }

  const initialized = new WeakSet();
  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function button(text, handler) {
    const item = element('button', text, 'inox-option-button');
    item.type = 'button'; item.addEventListener('click', handler); return item;
  }
  function status(root, message, error = false) {
    const node = root.querySelector('[data-variant-status]');
    node.textContent = message; node.dataset.error = String(error);
  }
  function controls(root) {
    root.querySelector('[data-variant-fallback]').hidden = true;
    const container = root.querySelector('[data-variant-controls]');
    container.hidden = false; container.replaceChildren(); return container;
  }
  const uniqueId = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
  function textInput(title, value, changed) {
    const wrapper = element('label', '', 'inox-option-field');
    const caption = element('span', title), input = element('input');
    input.type = 'text'; input.value = value; input.maxLength = 240;
    input.addEventListener('input', () => changed(input.value));
    wrapper.append(caption, input); return wrapper;
  }

  function initializeAxes(root) {
    const source = root.querySelector('textarea');
    if (!source || source.disabled || initialized.has(root)) return;
    initialized.add(root);
    let axes;
    try { axes = validateAxes(JSON.parse(source.value || '[]'), true); }
    catch (error) { status(root, `No se modificaron los datos: ${error.message}`, true); return; }
    function sync() {
      writeValues(source, axes);
      try {
        validateAxes(axes);
        status(root, axes.length ? 'Opciones propias de este equipo. Selecciona la combinación en cada variación; los cambios se guardan al guardar el equipo.' : 'Sin tipos definidos: se conservan las variaciones libres existentes.');
      } catch (error) { status(root, error.message, true); }
      root.dispatchEvent(new CustomEvent('inox:variant-axes-change', { bubbles: true }));
    }
    function render() {
      const container = controls(root);
      container.append(element('p', '1. Define los tipos y sus valores. 2. Asigna una combinación a cada variación. 3. Activa solo las que ya puedes ofrecer.', 'inox-option-help'));
      axes.forEach((axis, index) => {
        const card = element('section', '', 'inox-option-axis');
        const heading = element('div', '', 'inox-option-row');
        heading.append(textInput(`Tipo ${index + 1} · por ejemplo, Capacidad`, axis.label, value => { axis.label = value; sync(); }));
        heading.append(button('Quitar tipo', () => { axes.splice(index, 1); render(); sync(); }));
        card.append(heading);
        axis.options.forEach((option, optionIndex) => {
          const row = element('div', '', 'inox-option-row');
          row.append(textInput(`Valor permitido ${optionIndex + 1}`, option.label, value => { option.label = value; sync(); }));
          row.append(button('Quitar valor', () => { axis.options.splice(optionIndex, 1); render(); sync(); }));
          card.append(row);
        });
        const add = button('Añadir valor permitido', () => { axis.options.push({ id: uniqueId('value'), label: '' }); render(); sync(); });
        add.disabled = axis.options.length >= 10; card.append(add); container.append(card);
      });
      const addAxis = button('Añadir tipo de opción', () => { axes.push({ id: uniqueId('axis'), label: '', options: [{ id: uniqueId('value'), label: '' }] }); render(); sync(); });
      addAxis.disabled = axes.length >= 3; container.append(addAxis);
      container.append(element('p', 'Quitar un tipo o valor exige revisar las combinaciones que lo usan. No se borran ni reasignan automáticamente. Máximo: 3 tipos, 10 valores por tipo y 100 variaciones.', 'inox-option-help'));
    }
    render();
    // Initial rendering must not dirty the parent form or overwrite stored data.
    status(root, axes.length ? 'Cada combinación tendrá su propia foto, modelo 3D y ficha.' : 'Opcional: deja vacío para conservar variaciones libres.');
  }

  function initializeValues(root) {
    const source = root.querySelector('textarea');
    if (!source || source.disabled || source.name.includes('__prefix__') || initialized.has(root)) return;
    initialized.add(root);
    const form = source.closest('form');
    const active = form?.elements.namedItem(source.name.replace(/-option_values$/, '-is_active'));
    const axesSource = form?.querySelector('[data-variant-axes-editor] textarea');
    const originalAxes = root.querySelector('script[type="application/json"]')?.textContent || '[]';
    function render() {
      let axes, values;
      try {
        axes = validateAxes(JSON.parse(axesSource ? axesSource.value || '[]' : originalAxes));
        values = JSON.parse(source.value || '{}');
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('La combinación no tiene un formato válido.');
      } catch (error) {
        controls(root).append(element('p', 'Completa primero los tipos de opción. La combinación guardada se conserva.', 'inox-option-help'));
        status(root, error.message, true); return;
      }
      const container = controls(root), selectors = [];
      axes.forEach(axis => {
        const wrapper = element('label', '', 'inox-option-field');
        wrapper.append(element('span', axis.label));
        const select = element('select'), blank = element('option', 'Elige una opción');
        blank.value = ''; select.append(blank);
        axis.options.forEach(option => { const item = element('option', option.label); item.value = option.id; select.append(item); });
        select.value = Object.hasOwn(values, axis.id) ? values[axis.id] : '';
        selectors.push([axis.id, select]);
        select.addEventListener('change', () => {
          const selected = Object.fromEntries(selectors.filter(([, input]) => input.value).map(([id, input]) => [id, input.value]));
          writeValues(source, selected); refreshStatus(axes, selected);
        });
        wrapper.append(select); container.append(wrapper);
      });
      if (axes.length || Object.keys(values).length) container.append(button('Dejar como borrador sin combinación', () => { clearAsDraft(source, active); render(); }));
      refreshStatus(axes, values);
    }
    function refreshStatus(axes, values) {
      try { status(root, selectionStatus(axes, values, active?.checked)); }
      catch (error) { status(root, error.message, true); }
    }
    form?.addEventListener('inox:variant-axes-change', render);
    active?.addEventListener('change', render);
    render();
  }

  if (typeof module === 'object' && module.exports) module.exports = { validateAxes, selectionStatus, clearAsDraft };
  if (typeof document !== 'undefined') {
    const start = () => {
      document.querySelectorAll('[data-variant-axes-editor]').forEach(initializeAxes);
      document.querySelectorAll('[data-variant-values-editor]').forEach(initializeValues);
    };
    document.addEventListener('formset:added', start);
    if (typeof django !== 'undefined' && django.jQuery) django.jQuery(start);
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
