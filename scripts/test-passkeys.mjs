import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { decodeBase64url, encodeBase64url, credentialOptions, serializeCredential, authenticationError } from '../backend/security/static/security/passkeys.js';

const bytes = (...values) => new Uint8Array(values).buffer;

test('base64url round-trips binary challenges without padding', () => {
  const data = bytes(0, 1, 127, 128, 250, 255);
  const encoded = encodeBase64url(data);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeBase64url(encoded), data);
  assert.deepEqual(decodeBase64url('AQI='), bytes(1, 2));
  for (const invalid of ['', null, 'bad value', '*', 'A', 'AQ==extra']) assert.throws(() => decodeBase64url(invalid));
});

test('encoding a typed array uses only the selected view', () => {
  const view = new Uint8Array([99, 1, 2, 88]).subarray(1, 3);
  assert.equal(encodeBase64url(view), 'AQI');
});

test('registration converts binary fields and preserves constraints without mutating input', () => {
  const source = { challenge: 'AQI', user: { id: 'AwQ', name: 'user@example.com' }, excludeCredentials: [{ id: 'BQY', type: 'public-key', transports: ['internal'] }], authenticatorSelection: { userVerification: 'required' }, timeout: 120000 };
  const original = JSON.stringify(source);
  const options = credentialOptions(source, true);
  assert.deepEqual(options.challenge, bytes(1, 2));
  assert.deepEqual(options.user.id, bytes(3, 4));
  assert.deepEqual(options.excludeCredentials[0].id, bytes(5, 6));
  assert.deepEqual(options.excludeCredentials[0].transports, ['internal']);
  assert.equal(options.authenticatorSelection.userVerification, 'required');
  assert.equal(JSON.stringify(source), original);
});

test('authentication decodes allowCredentials and supports discoverable credentials', () => {
  const options = credentialOptions({ challenge: 'AQI', allowCredentials: [{ id: 'AwQ', type: 'public-key' }], userVerification: 'required' });
  assert.deepEqual(options.allowCredentials[0].id, bytes(3, 4));
  assert.equal(options.userVerification, 'required');
  assert.equal(credentialOptions({ challenge: 'AQI' }).allowCredentials, undefined);
});

test('registration serializes only the server verification payload', () => {
  const credential = { id: 'AQI', rawId: bytes(1, 2), type: 'public-key', authenticatorAttachment: 'platform', response: { clientDataJSON: bytes(3, 4), attestationObject: bytes(5, 6), getTransports: () => ['internal'] }, getClientExtensionResults: () => ({ unrequestedSecret: 'must-not-serialize' }) };
  assert.deepEqual(serializeCredential(credential), { id: 'AQI', rawId: 'AQI', type: 'public-key', response: { clientDataJSON: 'AwQ', attestationObject: 'BQY', transports: ['internal'] }, authenticatorAttachment: 'platform', clientExtensionResults: {} });
  assert.throws(() => serializeCredential(null));
  assert.throws(() => serializeCredential({ type: 'password' }));
});

test('authentication serializes signature and nullable userHandle', () => {
  const credential = { id: 'AQI', rawId: bytes(1, 2), type: 'public-key', response: { clientDataJSON: bytes(3), authenticatorData: bytes(4), signature: bytes(5), userHandle: null } };
  assert.deepEqual(serializeCredential(credential).response, { clientDataJSON: 'Aw', authenticatorData: 'BA', signature: 'BQ', userHandle: null });
  credential.response.userHandle = bytes(6);
  assert.equal(serializeCredential(credential).response.userHandle, 'Bg');
});

test('browser failures are actionable and do not echo internal errors', () => {
  assert.match(authenticationError({ name: 'NotAllowedError' }), /intentarlo otra vez/);
  assert.match(authenticationError({ name: 'InvalidStateError' }), /ya está registrada/);
  assert.match(authenticationError({ name: 'SecurityError' }), /dominio/);
  assert.match(authenticationError({ name: 'NotSupportedError' }), /otro dispositivo/);
  assert.match(authenticationError({ name: 'ConstraintError' }), /PIN/);
  assert.doesNotMatch(authenticationError(new Error('private diagnostic')), /private diagnostic/);
  assert.equal(authenticationError({ name: 'PasskeyResponseError', message: 'Confirma tu contraseña.' }), 'Confirma tu contraseña.');
});

function screen({ configured = true, supported = true, responseError = false, redirect = '/admin/', registration = false, cancelled = false } = {}) {
  let listener;
  let capture;
  const button = { disabled: !configured };
  const status = { textContent: '', classList: { toggle() {} } };
  const password = { value: 'test-password' };
  const requests = [];
  const navigations = [];
  let authenticatorCalls = 0;
  const attributes = new Map();
  const form = {
    dataset: { passkeyForm: registration ? 'register' : 'login', configured: String(configured), optionsUrl: '/options/', verifyUrl: '/verify/' },
    querySelector(selector) {
      return ({ '[data-passkey-submit]': button, '[data-passkey-status]': status, '[name="csrfmiddlewaretoken"]': { value: 'test-csrf' }, '[name="password"]': password, '[name="label"]': { value: 'Test laptop' }, '[name="grant_id"]': { value: '3' } })[selector];
    },
    addEventListener(event, callback, useCapture) { assert.equal(event, 'submit'); listener = callback; capture = useCapture; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
  };
  const assertion = { id: 'AQI', rawId: bytes(1, 2), type: 'public-key', response: { clientDataJSON: bytes(3, 4), authenticatorData: bytes(5), signature: bytes(6), userHandle: null } };
  const authenticator = async () => {
    authenticatorCalls++;
    if (cancelled) throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    return assertion;
  };
  const context = {
    window: { isSecureContext: supported, PublicKeyCredential: supported ? function () {} : undefined, location: { href: 'https://panel.example/admin/auth/', origin: 'https://panel.example', assign: target => navigations.push(target) } },
    document: { querySelectorAll: () => [form] }, navigator: { credentials: { get: authenticator, create: authenticator } },
    URL, ArrayBuffer, Uint8Array, atob, btoa,
    fetch: async (url, init) => {
      requests.push({ url, ...init, parsed: JSON.parse(init.body) });
      if (responseError) return { ok: false, json: async () => ({ error: 'Confirma tu contraseña.' }) };
      return { ok: true, json: async () => requests.length === 1 ? { publicKey: { challenge: 'AQI', user: { id: 'AwQ' } }, challengeId: 'challenge-id' } : { redirect } };
    },
  };
  runInNewContext(readFileSync(new URL('../backend/security/static/security/passkeys.js', import.meta.url), 'utf8').replace(/^export /gm, ''), context);
  return { button, status, password, requests, navigations, attributes, form, capture, get authenticatorCalls() { return authenticatorCalls; }, submit: () => listener({ preventDefault() {} }) };
}

test('registration sends CSRF-protected requests, clears the password and redirects on success', async () => {
  const view = screen({ registration: true });
  assert.equal(view.capture, true, 'handler must prevent native auth.js locking before the async prompt');
  await view.submit();
  assert.equal(view.requests.length, 2);
  assert.equal(view.requests[0].headers['X-CSRFToken'], 'test-csrf');
  assert.equal(view.requests[0].credentials, 'same-origin');
  assert.equal(view.requests[0].cache, 'no-store');
  assert.deepEqual(view.requests[0].parsed, { password: 'test-password', label: 'Test laptop', grant_id: '3' });
  assert.equal(view.requests[1].parsed.challenge_id, 'challenge-id');
  assert.equal(view.password.value, '');
  assert.deepEqual(view.navigations, ['https://panel.example/admin/']);
  assert.equal(view.button.disabled, false);
  assert.equal(view.attributes.has('aria-busy'), false);
});

test('unsupported or unconfigured screens cannot start a request', async () => {
  for (const options of [{ supported: false }, { configured: false }]) {
    const view = screen(options);
    await view.submit();
    assert.equal(view.requests.length, 0);
    assert.equal(view.button.disabled, true);
  }
});

test('failed options clear the password and restore a usable form', async () => {
  const view = screen({ registration: true, responseError: true });
  await view.submit();
  assert.equal(view.requests.length, 1);
  assert.equal(view.authenticatorCalls, 0);
  assert.equal(view.password.value, '');
  assert.equal(view.status.textContent, 'Confirma tu contraseña.');
  assert.equal(view.button.disabled, false);
});

test('cancelled prompts do not send assertions and can be retried', async () => {
  const view = screen({ cancelled: true });
  await view.submit();
  assert.equal(view.requests.length, 1);
  assert.match(view.status.textContent, /intentarlo otra vez/);
  assert.equal(view.button.disabled, false);
  await view.submit();
  assert.equal(view.requests.length, 2);
});

test('cross-origin options and redirects are rejected', async () => {
  const view = screen();
  view.form.dataset.optionsUrl = 'https://untrusted.example/options/';
  await view.submit();
  assert.equal(view.requests.length, 0);
  const redirected = screen({ redirect: 'https://untrusted.example/' });
  await redirected.submit();
  assert.equal(redirected.requests.length, 2);
  assert.deepEqual(redirected.navigations, []);
});

test('two submit events produce one verification flow', async () => {
  const view = screen();
  await Promise.all([view.submit(), view.submit()]);
  assert.equal(view.requests.length, 2);
  assert.equal(view.authenticatorCalls, 1);
});
