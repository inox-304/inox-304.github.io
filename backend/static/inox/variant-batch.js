(() => {
  'use strict';

  const nameKey = value => value.trim().replace(/\s+/gu, ' ').normalize('NFKC').toLocaleLowerCase('es');
  function parseVariantNames(text, existing = [], remaining = 100) {
    const names = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!names.length) throw new Error('Escribe al menos una opción, una por línea.');
    if (names.length > 20) throw new Error('Prepara hasta 20 opciones por lote.');
    if (names.length > remaining) throw new Error('No hay espacio para todas estas opciones. Revisa las filas existentes.');
    const seen = new Set(existing.map(nameKey));
    for (const name of names) {
      if (name.length > 180 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(name)) throw new Error('Cada opción debe tener hasta 180 caracteres, sin caracteres de control.');
      if (seen.has(nameKey(name))) throw new Error(`La opción «${name}» ya existe o está repetida en este lote.`);
      seen.add(nameKey(name));
    }
    return names;
  }

  function prepareVariantRows(form, group, names) {
    const field = name => form.elements.namedItem(name);
    const add = group.querySelector('.add-row a');
    let prepared = 0, error = '';
    const orders = [...group.querySelectorAll('input[name$="-order"]')].filter(input => !input.name.includes('__prefix__')).map(input => Number(input.value)).filter(value => Number.isInteger(value) && value >= 0);
    const lastOrder = Math.max(-1, ...orders);
    for (const name of names) {
      const before = Number(field('variants-TOTAL_FORMS')?.value);
      if (!add || !Number.isInteger(before) || before < 0) { error = 'El formulario no permite añadir esta opción.'; break; }
      try { add.click(); } catch { error = 'No se pudo añadir otra fila. Los nombres pendientes se conservan.'; break; }
      const label = field(`variants-${before}-name`), active = field(`variants-${before}-is_active`), order = field(`variants-${before}-order`);
      if (Number(field('variants-TOTAL_FORMS')?.value) !== before + 1 || !label || !active) { error = 'No se pudo preparar la siguiente fila. Puedes usar «Añadir variación» y conservar los nombres pendientes.'; break; }
      active.checked = false;
      label.value = name;
      if (order) order.value = String(Math.min(2147483647, lastOrder + prepared + 1));
      [label, active, order].filter(Boolean).forEach(input => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      prepared++;
    }
    return { prepared, remaining: names.slice(prepared), error };
  }

  function initialize(root) {
    const form = root.closest('form'), group = form?.querySelector('#variants-group');
    const names = root.querySelector('[data-inox-variant-names]'), create = root.querySelector('[data-inox-variant-create]'), status = root.querySelector('[data-inox-variant-status]');
    if (!group?.querySelector('.add-row a') || !names || !create || !status) return;
    root.hidden = false;
    create.addEventListener('click', () => {
      status.dataset.error = 'false';
      try {
        const existing = [...group.querySelectorAll('input[name$="-name"]')].filter(input => !input.name.includes('__prefix__') && !form.elements.namedItem(input.name.replace(/-name$/, '-DELETE'))?.checked).map(input => input.value).filter(Boolean);
        const total = Number(form.elements.namedItem('variants-TOTAL_FORMS')?.value);
        const limit = Math.min(100, Number(form.elements.namedItem('variants-MAX_NUM_FORMS')?.value ?? 100));
        if (!Number.isInteger(total) || !Number.isInteger(limit) || total < 0 || limit < total) throw new Error('El límite es de 100 variaciones por equipo. Las filas existentes se conservan; revísalas antes de añadir más.');
        const entries = parseVariantNames(names.value, existing, limit - total);
        const result = prepareVariantRows(form, group, entries);
        names.value = result.remaining.join('\n');
        status.textContent = `${result.prepared} ${result.prepared === 1 ? 'variación preparada' : 'variaciones preparadas'}, inactivas y todavía sin guardar. Revisa sus datos y activa las que quieras ofrecer.${result.error ? ` ${result.error}` : ''}`;
        status.dataset.error = String(Boolean(result.error));
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'No se pudieron preparar las opciones. Los nombres se conservan.';
        status.dataset.error = 'true';
      }
    });
  }

  if (typeof module === 'object' && module.exports) module.exports = { parseVariantNames, prepareVariantRows, initialize };
  if (typeof document !== 'undefined') {
    const start = () => document.querySelectorAll('[data-inox-variant-batch]').forEach(initialize);
    // Django adds its inline button in its earlier jQuery ready callback.
    // Queue behind that callback, even when this deferred script sees interactive.
    if (typeof django !== 'undefined' && django.jQuery) django.jQuery(start);
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
