(() => {
  const panel = document.querySelector('[data-import-status]');
  if (!panel || panel.dataset.active !== 'true') return;
  const endpoint = new URL(panel.dataset.statusUrl, location.href);
  if (endpoint.origin !== location.origin) return;
  const field = (name) => panel.querySelector(`[data-${name}]`);
  const initialState = panel.dataset.state;
  let active = true;
  let stopped = false;
  let pending = false;
  let timer;
  let controller;
  let failures = 0;

  const message = (text) => {
    field('poll-message').hidden = false;
    field('poll-message').textContent = text;
  };
  const schedule = () => {
    clearTimeout(timer);
    if (active && !stopped && !document.hidden) timer = setTimeout(poll, Math.min(30000, 5000 * (failures + 1)));
  };
  async function poll() {
    clearTimeout(timer);
    if (pending || stopped || !active || document.hidden) return;
    pending = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    field('poll-retry').disabled = true;
    try {
      const response = await fetch(endpoint.href, {headers: {'Accept': 'application/json', 'X-Inox-Automatic': '1'}, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal});
      if (response.status === 401 || response.status === 403) {
        stopped = true;
        message(response.status === 401 ? 'Tu sesión venció. Abre de nuevo el detalle e inicia sesión para continuar.' : 'Ya no tienes permiso para consultar esta importación.');
        field('detail-link').hidden = false;
        field('review-link').hidden = true;
        field('job-actions').hidden = true;
        field('poll-retry').hidden = true;
        return;
      }
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!data || !['queued', 'running', 'ready', 'failed', 'applied', 'cancelled'].includes(data.state) || typeof data.label !== 'string' || typeof data.notice !== 'string' || typeof data.progress !== 'string' || typeof data.error !== 'string') throw new Error('Invalid status');
      failures = 0;
      active = data.state === 'queued' || data.state === 'running';
      panel.dataset.state = data.state;
      field('status-label').textContent = data.label;
      field('status-notice').textContent = data.notice;
      field('status-progress').textContent = data.progress;
      field('status-error').textContent = data.error;
      field('status-error').hidden = !data.error;
      field('poll-retry').hidden = true;
      field('review-link').hidden = !['ready', 'applied'].includes(data.state);
      if (!active) {
        // Do not reload automatically: background navigation would renew an
        // unattended MFA session. The user opens the reviewed state explicitly.
        message('Estado actualizado. Puedes continuar con las opciones de abajo.');
        field('detail-link').hidden = data.state === initialState;
        field('job-actions').hidden = data.state !== initialState;
      } else {
        message('El estado se actualiza automáticamente mientras esta página está visible.');
      }
    } catch {
      if (!stopped && !document.hidden) {
        failures += 1;
        message('No pudimos consultar el estado. Tu archivo sigue guardado; volveremos a intentar.');
        field('poll-retry').hidden = false;
      }
    } finally {
      clearTimeout(timeout);
      pending = false;
      field('poll-retry').disabled = false;
      schedule();
    }
  }
  field('poll-retry').addEventListener('click', () => { failures = 0; poll(); });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.hidden) controller?.abort();
    else schedule();
  });
  window.addEventListener('pagehide', () => { clearTimeout(timer); controller?.abort(); });
  window.addEventListener('pageshow', schedule);
  schedule();
})();
