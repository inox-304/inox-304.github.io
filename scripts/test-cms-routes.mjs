import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { cmsProductRoute } from '../src/lib/cms.ts';
import { apiProductRoute } from '../src/lib/cms-api.ts';
import { withBase } from '../src/lib/paths.ts';
import { catalogListingHref } from '../src/lib/catalog-listings.ts';

const source = ts.createSourceFile('cms.ts', readFileSync(new URL('../src/scripts/cms.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const routeNode = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'route');
const linkNode = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'setCatalogLink');
assert.ok(routeNode, 'the real browser route function must be tested');
assert.ok(linkNode, 'the real final link assignment must be tested');
const compiled = ts.transpileModule(routeNode.getText(source) + '\n' + linkNode.getText(source) + '\nthis.route = route; this.setCatalogLink = setCatalogLink;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function destination(candidate, { base = '/', apiMode = false, product = { id: 'P26', slug: 'lavadero' } } = {}) {
  const context = { apiMode, apiProductRoute, cmsProductRoute: (p, routes) => cmsProductRoute(p, routes, base),
    payload: { routes: { [product.id]: candidate } }, location: new URL('https://example.test/'), URL,
    withBase: value => withBase(value, base), encodeURIComponent };
  runInNewContext(compiled, context);
  return context.route(product);
}

test('untrusted bootstrap product routes cannot execute script or redirect externally', () => {
  for (const candidate of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
    '//attacker.invalid/product', '/\\attacker.invalid/product', 'https://attacker.invalid/catalogo/item/',
    'https://example.test/catalogo/item/', '/catalogo/../admin/', '/admin/auth/accounts/', '/catalogo/%2e%2e/admin/',
    '/catalogo/\nitem/', '/catalogo/%2F%2Fattacker.invalid/', '/catalogo/<img-onerror>/']) {
    assert.equal(destination(candidate), '/equipo/?id=P26', candidate);
  }
});

test('valid product links preserve base, category/variant queries and fragments', () => {
  assert.equal(destination('/catalogo/lavadero/?categoria=linea-neutra&variant=grande#modelo'), '/catalogo/lavadero/?categoria=linea-neutra&variant=grande#modelo');
  assert.equal(destination('/catalogo/lavadero/?variant=grande', { base: '/inox/' }), '/inox/catalogo/lavadero/?variant=grande');
  assert.equal(destination('/inox/catalogo/lavadero/', { base: '/inox/' }), '/inox/catalogo/lavadero/');
  assert.equal(destination(undefined, { base: '/inox/', product: { id: 'P&<26', slug: 'lavadero' } }), '/inox/equipo/?id=P%26%3C26');
  assert.equal(destination('javascript:alert(1)', { apiMode: true }), '/catalogo/lavadero/');
});

function finalLink(target, base = '/') {
  const context = { location: new URL('https://example.test/'), URL, withBase: value => withBase(value, base) };
  runInNewContext(compiled, context);
  // URL and HTMLAnchorElement expose the same WHATWG URL component setters.
  const anchor = new URL('https://previous.invalid/');
  context.setCatalogLink(anchor, target);
  return anchor;
}

test('final anchor assignment keeps hostile variant values inside the query without double encoding', () => {
  const variantId = '%2F & <img onerror=alert(1)> + é';
  const route = destination('/catalogo/lavadero/?q=%252F#modelo%20con%25', { base: '/inox/' });
  const target = catalogListingHref({ variant: { id: variantId } }, route);
  const anchor = finalLink(target, '/inox/');
  assert.equal(anchor.origin, 'https://example.test');
  assert.equal(anchor.pathname, '/inox/catalogo/lavadero/');
  assert.equal(anchor.searchParams.get('variant'), variantId);
  assert.equal(anchor.searchParams.get('q'), '%2F');
  assert.equal(anchor.hash, '#modelo%20con%25');
  assert.equal(anchor.href, new URL(target, 'https://example.test').href);
});

test('final anchor assignment cannot replace origin or protocol even if called with a hostile target', () => {
  for (const target of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//attacker.invalid/catalogo/item/',
    '/admin/auth/accounts/', '/catalogo/../admin/', 'https://attacker.invalid/catalogo/item/']) {
    assert.equal(finalLink(target).href, 'https://example.test/catalogo/', target);
  }
  const anchor = finalLink('/catalogo/item/?next=javascript:alert(1)#javascript:alert(2)');
  assert.equal(anchor.protocol, 'https:');
  assert.equal(anchor.searchParams.get('next'), 'javascript:alert(1)');
  assert.equal(anchor.hash, '#javascript:alert(2)');
  assert.equal(finalLink('/equipo/?id=P%26%3C26').searchParams.get('id'), 'P&<26');
});
