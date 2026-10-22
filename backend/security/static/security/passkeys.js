// Credentials stay in the authenticator. Responses are sent only to this origin.
export function decodeBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error('Invalid binary challenge');
  const plain = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const decoded = atob(plain + '='.repeat((4 - plain.length % 4) % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0)).buffer;
}

export function encodeBase64url(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let plain = '';
  for (const byte of bytes) plain += String.fromCharCode(byte);
  return btoa(plain).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function credentialOptions(publicKey, registration = false) {
  const options = { ...publicKey, challenge: decodeBase64url(publicKey.challenge) };
  const descriptors = registration ? 'excludeCredentials' : 'allowCredentials';
  if (publicKey[descriptors]) options[descriptors] = publicKey[descriptors].map(item => ({ ...item, id: decodeBase64url(item.id) }));
  if (registration) options.user = { ...publicKey.user, id: decodeBase64url(publicKey.user.id) };
  return options;
}

export function serializeCredential(credential) {
  if (!credential || credential.type !== 'public-key') throw new Error('No credential received');
  const response = {};
  for (const key of ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle']) {
    if (credential.response[key] != null) response[key] = encodeBase64url(credential.response[key]);
  }
  if ('userHandle' in credential.response && credential.response.userHandle == null) response.userHandle = null;
  if (typeof credential.response.getTransports === 'function') response.transports = credential.response.getTransports();
  const result = { id: credential.id, rawId: encodeBase64url(credential.rawId), type: credential.type, response };
  if (credential.authenticatorAttachment) result.authenticatorAttachment = credential.authenticatorAttachment;
  // No extensions are requested. Do not persist arbitrary extension payloads.
  result.clientExtensionResults = {};
  return result;
}

export function authenticationError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return 'No se completó la verificación. Puedes intentarlo otra vez o usar otro método.';
  if (error?.name === 'InvalidStateError') return 'Esta llave ya está registrada. Usa otra llave o revisa las que aparecen abajo.';
  if (error?.name === 'SecurityError') return 'Este dominio no está habilitado para llaves de acceso. Abre la dirección segura del panel.';
  if (error?.name === 'NotSupportedError') return 'Este dispositivo no admite la llave solicitada. Prueba con otro dispositivo o método de acceso.';
  if (error?.name === 'ConstraintError') return 'La llave debe permitir confirmar tu identidad con PIN, huella o reconocimiento facial.';
  if (error?.name === 'PasskeyResponseError') return error.message;
  return 'No pudimos completar la solicitud. Comprueba tu conexión e inténtalo otra vez.';
}

function safeEndpoint(value) {
  const url = new URL(value, window.location.href);
  if (url.origin !== window.location.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid endpoint');
  return url.href;
}

async function post(form, endpoint, body) {
  const csrf = form.querySelector('[name="csrfmiddlewaretoken"]')?.value;
  if (!csrf) throw new Error('Missing CSRF token');
  const response = await fetch(safeEndpoint(endpoint), {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch {
    const error = new Error('La sesión ha vencido o el servidor no está disponible. Vuelve a entrar al panel.');
    error.name = 'PasskeyResponseError';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : 'No se pudo validar la solicitud. Vuelve a intentarlo.');
    error.name = 'PasskeyResponseError';
    throw error;
  }
  return data;
}

function initialize() {
  const supported = Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
  for (const form of document.querySelectorAll('[data-passkey-form]')) {
    const button = form.querySelector('[data-passkey-submit]');
    const status = form.querySelector('[data-passkey-status]');
    const configured = form.dataset.configured === 'true';
    const available = form.dataset.available !== 'false';
    button.disabled = !(configured && available && supported);
    let busy = false;
    const say = (message, failed = false) => {
      status.textContent = message;
      status.classList.toggle('is-error', failed);
    };
    if (!supported && configured && available) {
      button.disabled = true;
      say('Tu navegador no puede usar llaves de acceso en esta dirección. Usa un navegador actualizado y la dirección HTTPS del panel.', true);
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !configured || !available || !supported) return;
      busy = true;
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      const registration = form.dataset.passkeyForm === 'register';
      const password = form.querySelector('[name="password"]');
      say(registration ? 'Preparando el registro…' : 'Preparando la verificación…');
      try {
        let options;
        try {
          options = await post(form, form.dataset.optionsUrl, registration ? {
            password: password.value,
            label: form.querySelector('[name="label"]')?.value.trim() || '',
            grant_id: form.querySelector('[name="grant_id"]')?.value || '',
          } : {});
        } finally {
          if (password) password.value = '';
        }
        if (!options.publicKey || !options.challengeId) throw new Error('Incomplete server response');
        say(registration ? 'Sigue las indicaciones de tu dispositivo para guardar la llave.' : 'Confirma tu identidad en la ventana de tu dispositivo.');
        const credential = await navigator.credentials[registration ? 'create' : 'get']({ publicKey: credentialOptions(options.publicKey, registration) });
        say(registration ? 'Guardando tu llave…' : 'Verificando tu acceso…');
        const result = await post(form, form.dataset.verifyUrl, { challenge_id: options.challengeId, credential: serializeCredential(credential) });
        if (typeof result.redirect !== 'string' || !result.redirect) throw new Error('Missing redirect');
        window.location.assign(safeEndpoint(result.redirect));
      } catch (error) {
        say(authenticationError(error), true);
      } finally {
        busy = false;
        button.disabled = false;
        form.removeAttribute('aria-busy');
      }
    }, true);
  }
}

if (typeof document !== 'undefined') initialize();
