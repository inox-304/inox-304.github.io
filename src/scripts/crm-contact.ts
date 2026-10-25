import { currentAttribution } from '../lib/crm-attribution';

const form = document.querySelector<HTMLFormElement>('#quote-form[data-crm-form]');
if (form) {
  const status = form.querySelector<HTMLElement>('#form-status')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const fallback = form.querySelector<HTMLAnchorElement>('#quote-fallback')!;
  const phone = form.querySelector<HTMLInputElement>('[name="phone"]')!;
  button.disabled = false;
  let submissionId = '';
  let fingerprint = '';
  let sending = false;
  let delivered = false;
  const text = (data: FormData, name: string) => String(data.get(name) || '').trim();
  const params = new URLSearchParams(location.search);
  const selectedProduct = (params.get('product_code') || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 64);
  const selectedConfiguration = (params.get('configuration') || '').replace(/[\x00-\x08\x0e-\x1f]/g, '').trim().slice(0, 4000);
  (form.elements.namedItem('product_code') as HTMLInputElement).value = selectedProduct;
  (form.elements.namedItem('configuration') as HTMLInputElement).value = selectedConfiguration;
  if (selectedProduct || selectedConfiguration) {
    form.querySelector<HTMLElement>('[data-crm-selection]')!.hidden = false;
    form.querySelector<HTMLElement>('[data-crm-product]')!.textContent = selectedProduct ? `Equipo ${selectedProduct}` : 'Proyecto personalizado';
    form.querySelector<HTMLElement>('[data-crm-configuration]')!.textContent = selectedConfiguration;
    form.querySelector<HTMLDetailsElement>('[data-crm-selection] details')!.hidden = !selectedConfiguration;
  }

  function updateWhatsApp() {
    if (!form) return;
    const number = (form.dataset.whatsapp || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(number)) { fallback.hidden = true; fallback.removeAttribute('href'); return; }
    const data = new FormData(form);
    const name = text(data, 'name');
    const company = text(data, 'business');
    const message = text(data, 'message');
    const intro = form.dataset.contactMessage || `Hola ${form.dataset.company || 'INOX 304'}.`;
    const body = `${intro}${name ? `\nSoy ${name}.` : ''}${company ? `\nMi negocio: ${company}.` : ''}\nNecesito: ${text(data, 'need')}.${selectedProduct ? `\nEquipo: ${selectedProduct}` : ''}${selectedConfiguration ? `\nConfiguración:\n${selectedConfiguration}` : ''}${message ? `\n\n${message}` : ''}`;
    fallback.href = `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
    fallback.hidden = false;
  }

  form.addEventListener('inox:contact-updated', updateWhatsApp);
  form.addEventListener('input', () => {
    phone.setCustomValidity('');
    updateWhatsApp();
    if (delivered && !sending) {
      delivered = false;
      button.disabled = false;
      button.textContent = 'Enviar nueva solicitud';
      status.textContent = '';
      delete status.dataset.state;
    }
  });
  updateWhatsApp();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || delivered) return;
    const data = new FormData(form);
    phone.setCustomValidity(text(data, 'phone') || text(data, 'email') ? '' : 'Añade tu WhatsApp o tu correo para que podamos responderte.');
    if (!form.reportValidity()) return;
    if (!text(data, 'name') || !text(data, 'message')) {
      status.textContent = 'Completa tu nombre y cuéntanos qué necesitas.';
      status.dataset.state = 'error';
      return;
    }
    const payload = {
      name: text(data, 'name'), phone: text(data, 'phone'), email: text(data, 'email'),
      company: text(data, 'business'), city: text(data, 'city'),
      interest: `${text(data, 'need')}\n${text(data, 'message')}`,
      product_code: text(data, 'product_code'), configuration: text(data, 'configuration'),
      ...currentAttribution(), website: text(data, 'website'), consent: true,
    };
    const nextFingerprint = JSON.stringify(payload);
    if (!submissionId || nextFingerprint !== fingerprint) {
      submissionId = crypto.randomUUID();
      fingerprint = nextFingerprint;
    }
    updateWhatsApp();
    sending = true;
    const editableFields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]), textarea'));
    const selectors = Array.from(form.querySelectorAll<HTMLSelectElement>('select'));
    editableFields.forEach(field => { field.readOnly = true; });
    selectors.forEach(field => { field.disabled = true; });
    button.disabled = true;
    button.textContent = 'Enviando…';
    form.setAttribute('aria-busy', 'true');
    status.dataset.state = 'pending';
    status.textContent = 'Guardando tu consulta. Puede tardar unos segundos.';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(form.dataset.endpoint!, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, submission_id: submissionId }), signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error('wait');
        if (response.status === 400) throw new Error('invalid');
        throw new Error('unavailable');
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('reference' in result) || typeof result.reference !== 'string' || !/^CRM-\d{6,}$/.test(result.reference)) throw new Error('unavailable');
      delivered = true;
      status.dataset.state = 'success';
      status.textContent = `Solicitud recibida · ${result.reference}. Nuestro equipo la revisará y te contactará por el teléfono o correo que indicaste.`;
      button.textContent = 'Solicitud recibida';
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      status.dataset.state = 'error';
      status.textContent = reason === 'wait'
        ? 'Espera 15 minutos antes de reintentar. Si lo prefieres, continúa por WhatsApp.'
        : reason === 'invalid'
          ? 'Revisa tu nombre, el teléfono (con código de país) o correo y los detalles de tu consulta.'
          : 'Todavía no pudimos confirmar el envío. Tus datos siguen aquí: reintenta o continúa por WhatsApp. Reintentar la misma solicitud no la duplica.';
      button.textContent = 'Reintentar envío';
    } finally {
      window.clearTimeout(timeout);
      sending = false;
      editableFields.forEach(field => { field.readOnly = false; });
      selectors.forEach(field => { field.disabled = false; });
      button.disabled = delivered;
      form.removeAttribute('aria-busy');
    }
  });
}
