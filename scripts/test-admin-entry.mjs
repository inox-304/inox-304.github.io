import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { adminEntryUrl } from '../src/lib/admin-entry.ts';

test('Django stays on its origin; Pages can open the configured HTTPS panel', () => {
  assert.equal(adminEntryUrl(false, '', '/inox/'), 'http://127.0.0.1:8000/admin/auth/login/');
  assert.equal(adminEntryUrl(false, ' https://panel.example/admin/ '), 'https://panel.example/admin/auth/login/');
  assert.equal(adminEntryUrl(true, 'https://old.example/admin/'), '/admin/auth/login/');
  for (const url of ['http://panel.example/admin/', 'javascript:alert(1)', '//panel.example/admin/', 'https://user:secret@panel.example/admin/', 'https://panel.example/', 'https://panel.example/admin/?token=secret', 'https://panel.example/admin/#secret']) {
    assert.throws(() => adminEntryUrl(false, url));
  }
});

test('the shortcut stays silent through five taps, opens on six and resets after inactivity', () => {
  let click;
  let timer;
  const destinations = [];
  const button = {
    dataset: { adminEntry: 'https://panel.example/admin/' },
    addEventListener: (event, listener) => { assert.equal(event, 'click'); click = listener; },
  };
  const source = readFileSync(new URL('../src/scripts/admin-entry.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    document: { querySelectorAll: () => [button] },
    window: { location: { assign: url => destinations.push(url) } },
    setTimeout: (callback, delay) => { assert.equal(delay, 5000); timer = callback; return 1; },
    clearTimeout: () => { timer = undefined; },
  });
  // The mock has no visual/status APIs: intermediate taps cannot reveal a hint.
  for (let index = 0; index < 5; index++) click();
  assert.deepEqual(destinations, []);
  timer();
  click();
  assert.deepEqual(destinations, []);
  for (let index = 0; index < 5; index++) click();
  assert.deepEqual(destinations, ['https://panel.example/admin/']);
  click();
  assert.equal(destinations.length, 1);
});
