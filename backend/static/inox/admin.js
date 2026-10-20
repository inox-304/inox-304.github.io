(() => {
  const form = document.querySelector('body.change-form #content-main form, body.change-list #changelist-form');
  if (!form) return;
  let dirty = false;
  const status = document.createElement('div');
  status.id = 'inox-dirty-status'; status.hidden = true; status.setAttribute('role', 'status');
  status.textContent = 'Tienes cambios sin guardar'; document.body.append(status);
  const changed = event => {
    if (!(event.target instanceof Element) || event.target.matches('[name=csrfmiddlewaretoken]')) return;
    dirty = true; status.hidden = false;
  };
  form.addEventListener('input', changed); form.addEventListener('change', changed);
  form.addEventListener('submit', event => {
    if (form.querySelector('input[name$="-DELETE"]:checked') && !window.confirm('¿Eliminar las variaciones, los adicionales o las imágenes marcadas? El cambio quedará registrado en el historial.')) {
      event.preventDefault();
      return;
    }
    dirty = false; status.hidden = true;
  });
  window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
})();
