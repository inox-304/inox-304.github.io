import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductStage } from '../src/lib/product-stage.ts';
import { productImageBounds } from '../src/data/product-image-bounds.ts';
import { products } from '../src/data/products.ts';

function variables(profile) {
  return Object.fromEntries(profile.style.split(';').map(declaration => {
    const [name, value] = declaration.split(':');
    return [name, Number.parseFloat(value)];
  }));
}
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < .00001, `${message}: ${actual} versus ${expected}`); }
const asset = '/images/products/horno-ecologico-para-pollo-a-la-brasa.webp';

test('authored bounds cover all 21 catalog cutouts and stay inside their image canvases', () => {
  const cutouts = products.filter(product => /\.(?:webp|png)$/i.test(product.image)).map(product => product.image).sort();
  assert.equal(cutouts.length, 21);
  assert.deepEqual(Object.keys(productImageBounds).sort(), cutouts);
  for (const [file, metadata] of Object.entries(productImageBounds)) {
    const bounds = metadata.bounds;
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0, file);
    assert.ok(bounds.x + bounds.width <= metadata.width && bounds.y + bounds.height <= metadata.height, file);
  }
});

test('all authored images place visible center and feet exactly on the crop center and bottom', () => {
  for (const [file, metadata] of Object.entries(productImageBounds)) {
    const profile = getProductStage(file);
    const css = variables(profile);
    const bounds = metadata.bounds;
    const visibleLeft = css['--image-left'] + bounds.x / metadata.width * css['--image-width'];
    const visibleRight = css['--image-left'] + (bounds.x + bounds.width) / metadata.width * css['--image-width'];
    const visibleTop = css['--image-top'] + bounds.y / metadata.height * css['--image-height'];
    const visibleBottom = css['--image-top'] + (bounds.y + bounds.height) / metadata.height * css['--image-height'];
    near(visibleLeft, 0, `${file} left`);
    near(visibleRight, 100, `${file} right`);
    near((visibleLeft + visibleRight) / 2, 50, `${file} center`);
    near(visibleTop, 0, `${file} top`);
    near(visibleBottom, 100, `${file} bottom`);
    near(css['--equipment-width'] / css['--equipment-height'], bounds.width / bounds.height, `${file} undistorted ratio`);
    assert.ok(css['--equipment-width'] <= 76 && css['--equipment-height'] <= 66, file);
    assert.ok(css['--pedestal-width'] >= css['--equipment-width'] + 13.99999, `${file} pedestal contains equipment`);
    assert.ok(css['--pedestal-width'] >= 46 && css['--pedestal-width'] <= 90, file);
    assert.equal(profile.width, metadata.width);
    assert.equal(profile.height, metadata.height);
  }
});

test('shape follows visible equipment proportions instead of transparent canvas proportions', () => {
  assert.equal(getProductStage(asset).shape, 'tall');
  assert.equal(getProductStage('/images/products/cocina-industrial-de-3-parrillas.webp').shape, 'wide');
  assert.equal(getProductStage('/images/products/armario-refrigerado-de-2-puertas.webp').shape, 'square');
});

test('unknown CMS images adapt to their actual dimensions and preserve uncropped geometry', () => {
  for (const [width, height, shape] of [[1600, 600, 'wide'], [600, 1600, 'tall'], [800, 800, 'square']]) {
    const profile = getProductStage('https://cdn.example/new-equipment.webp', { width, height });
    const css = variables(profile);
    assert.equal(profile.shape, shape);
    assert.equal(profile.width, width);
    assert.equal(profile.height, height);
    near(css['--equipment-width'] / css['--equipment-height'], width / height, 'replacement ratio');
    assert.equal(css['--image-left'], 0);
    assert.equal(css['--image-top'], 0);
    assert.equal(css['--image-width'], 100);
    assert.equal(css['--image-height'], 100);
  }
});

test('unknown images use safe square geometry until valid natural dimensions are available', () => {
  const initial = getProductStage('/images/products/new.webp');
  assert.equal(initial.shape, 'square');
  assert.equal(initial.width, initial.height);
  for (const dimensions of [{ width: 0, height: 100 }, { width: -1, height: 100 }, { width: NaN, height: 100 }, { width: 100, height: Infinity }]) {
    assert.deepEqual(getProductStage('/images/products/new.webp', dimensions), initial);
  }
});

test('PNG and WebP detection uses the URL pathname, including uppercase, query strings and fragments', () => {
  for (const image of ['/images/new.PNG?revision=2#preview', 'https://cdn.example/new.WEBP#preview', '/images/new.webp?v=2']) {
    assert.equal(getProductStage(image).isCutout, true, image);
  }
  for (const image of ['/images/photo.jpg?copy=transparent.webp', '/images/photo.jpeg#cutout.png', '/images/vector.svg']) {
    const profile = getProductStage(image, { width: 1200, height: 900 });
    assert.equal(profile.isCutout, false, image);
    assert.equal(variables(profile)['--image-width'], 100);
    assert.equal(variables(profile)['--image-height'], 100);
  }
});

test('query strings and deployment base paths preserve local authored bounds without matching external filenames', () => {
  const expected = getProductStage(asset);
  assert.deepEqual(getProductStage(`${asset}?v=3#photo`), expected);
  assert.deepEqual(getProductStage(`/inox304${asset}`), expected);
  assert.deepEqual(getProductStage(`/projects/inox304${asset}?v=3`), expected);
  for (const image of [`https://cdn.example${asset}`, `//cdn.example${asset}`]) {
    const profile = getProductStage(image);
    assert.equal(profile.shape, 'square', image);
    assert.equal(variables(profile)['--image-left'], 0);
    const loaded = getProductStage(image, { width: 1600, height: 500 });
    assert.equal(loaded.shape, 'wide');
    assert.equal(variables(loaded)['--image-width'], 100);
  }
});

test('matching natural dimensions retain authored bounds while a same-path replacement resets them', () => {
  const metadata = productImageBounds[asset];
  assert.deepEqual(getProductStage(asset, metadata), getProductStage(asset));
  const replacement = getProductStage(asset, { width: 1600, height: 500 });
  const css = variables(replacement);
  assert.equal(replacement.shape, 'wide');
  assert.equal(replacement.width, 1600);
  assert.equal(replacement.height, 500);
  assert.equal(css['--image-left'], 0);
  assert.equal(css['--image-top'], 0);
  assert.equal(css['--image-width'], 100);
  assert.equal(css['--image-height'], 100);
});
