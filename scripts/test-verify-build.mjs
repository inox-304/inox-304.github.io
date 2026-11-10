import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHtml } from './verify-build.mjs';

test('HTML inspection ignores markup-shaped script, style, comment and quoted attribute text', () => {
  const result = inspectHtml(`<!doctype html><html><head><title>Real &amp; title</title>
    <script src="/app.js">const fake = '<h1>Fake</h1><img src="/not-real.png">';</script>
    <style>.x::before { content: '<h1>fake</h1>'; } .x { background: url('/real.webp'); }</style>
    </head><body><!-- <h1>Another fake</h1><img src="/comment.png"> -->
    <main><h1 data-note="a > b <h1>fake">Real heading</h1><img alt="a > b" src="/photo.webp"></main></body></html>`);
  assert.deepEqual(result.titles, ['Real & title']);
  assert.equal(result.h1Count, 1);
  assert.equal(result.hasMain, true);
  assert.deepEqual(result.references.map(item => item.value).sort(), ['/app.js', '/photo.webp']);
  assert.match(result.styles[0], /real\.webp/);
});

test('entities are decoded once, including literal encoded entities and invalid code points', () => {
  const result = inspectHtml('<title>&amp;lt;title&amp;gt; &#x110000;</title><main><h1>Title</h1><a href="/catalogo/?q=&amp;lt;&amp;x=1">Link</a><img src="/a&amp;quot;b.webp"></main>');
  assert.deepEqual(result.titles, ['&lt;title&gt; \ufffd']);
  assert.deepEqual(result.references.map(item => item.value).sort(), ['/a&quot;b.webp', '/catalogo/?q=&lt;&x=1']);
});

test('template assets are checked but inert headings and SVG titles are not page landmarks', () => {
  const result = inspectHtml('<title>Page</title><main><h1>Visible</h1><svg><title>Icon description</title><use href="/icons.svg#check"/></svg><template><h1>Inert</h1><img src="/template.webp"></template></main>');
  assert.deepEqual(result.titles, ['Page']);
  assert.equal(result.h1Count, 1);
  assert.equal(result.hasMain, true);
  assert.deepEqual(result.references.map(item => item.value).sort(), ['/icons.svg#check', '/template.webp']);
  assert.equal(inspectHtml('<template><main><h1>Inert</h1></main></template>').hasMain, false);
});

test('malformed nested tags are parsed without deleting substrings into new HTML', () => {
  const result = inspectHtml('<title>Page</title><main><h1>Real</h1><scr<script>ignored</script>ipt><img src=/actual.webp></main>');
  assert.equal(result.h1Count, 1);
  assert.deepEqual(result.references.map(item => item.value), ['/actual.webp']);
});
