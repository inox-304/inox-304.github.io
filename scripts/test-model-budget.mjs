import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGlb } from './lib/model-budget.mjs';

function glb(overrides = {}, padding = 0) {
  const text = JSON.stringify({ asset: { version: '2.0' }, accessors: [{ count: 3000 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], ...overrides });
  const json = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const buffer = Buffer.alloc(20 + json.length + padding);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(json.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); json.copy(buffer, 20);
  return buffer;
}
test('embedded GLB records triangle and download budgets', () => {
  const buffer = glb({ buffers: [{ byteLength: 8 }], images: [{ bufferView: 0 }] });
  assert.deepEqual(inspectGlb(buffer), { errors: [], warnings: [], bytes: buffer.length, triangles: 1000 });
});
test('rejects non-GLB and truncated JSON before model loading', () => {
  assert.ok(inspectGlb(Buffer.from('<html>login</html>')).errors.length);
  const malformed = glb(); malformed.writeUInt32LE(malformed.length + 8, 12);
  assert.ok(inspectGlb(malformed).errors.length);
  assert.ok(inspectGlb(glb({ images: 'invalid' })).errors.length);
});
test('blocks external resources to keep the exported product portable', () => {
  for (const uri of ['texture.jpg', 'https://drive.google.com/file/d/secret/view']) assert.ok(inspectGlb(glb({ images: [{ uri }] })).errors.some(value => value.includes('externas')));
  assert.equal(inspectGlb(glb({ images: [{ uri: 'data:image/png;base64,test' }] })).errors.length, 0);
});
test('enforces hard model limits and reports practical optimization warnings', () => {
  assert.equal(inspectGlb(glb({ accessors: [{ count: 450003 }] })).warnings.length, 1);
  assert.ok(inspectGlb(glb({ accessors: [{ count: 900003 }] })).errors.length);
  assert.ok(inspectGlb(glb({}, 5 * 1024 * 1024)).warnings.length);
  assert.ok(inspectGlb(glb({}, 12 * 1024 * 1024)).errors.length);
});
test('accepts Draco and flags unsupported required Meshopt exports', () => {
  assert.equal(inspectGlb(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] })).errors.length, 0);
  assert.ok(inspectGlb(glb({ extensionsRequired: ['EXT_meshopt_compression'] })).errors.length);
});
