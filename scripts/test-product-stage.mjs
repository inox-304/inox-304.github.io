import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductStage } from '../src/lib/product-stage.ts';
import { productImageBounds } from '../src/data/product-image-bounds.ts';
import { products } from '../src/data/products.ts';

function variables(profile, key = 'style') {
  return Object.fromEntries(profile[key].split(';').map(declaration => {
    const [name, value] = declaration.split(':');
    return [name, Number.parseFloat(value)];
  }));
}
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < .00001, `${message}: ${actual} versus ${expected}`); }
const asset = '/images/products/horno-ecologico-para-pollo-a-la-brasa.webp';

test('authored bounds cover every catalog photo and stay inside their image canvases', () => {
  const photos = products.map(product => product.image).sort();
  assert.ok(photos.length > 0);
  assert.deepEqual(Object.keys(productImageBounds).sort(), photos);
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

test('confirmed white JPG photos use their visible equipment bounds with a safe replacement fallback', () => {
  const file = '/images/products/freidora-automatica-de-papas.jpg';
  const metadata = productImageBounds[file];
  const profile = getProductStage(file);
  assert.equal(profile.isCutout, false);
  assert.equal(profile.shape, 'tall');
  assert.ok(metadata.bounds.width < metadata.width * .7, 'white side margins are excluded');
  assert.equal(profile.width, metadata.width);
  assert.deepEqual(getProductStage(`/inox304${file}?v=reviewed`, metadata), profile);
  assert.deepEqual(getProductStage(file, { width: 1000, height: 1000 }), getProductStage('/images/products/new-photo.jpg', { width: 1000, height: 1000 }));
});

test('white photo frames center visible equipment on both axes without stretching or clipping it', () => {
  for (const [file, metadata] of Object.entries(productImageBounds)) {
    const css = variables(getProductStage(file), 'photoStyle'), bounds = metadata.bounds;
    const left = css['--photo-image-left'] + bounds.x / metadata.width * css['--photo-image-width'];
    const top = css['--photo-image-top'] + bounds.y / metadata.height * css['--photo-image-height'];
    const width = bounds.width / metadata.width * css['--photo-image-width'];
    const height = bounds.height / metadata.height * css['--photo-image-height'];
    near(left + width / 2, 50, `${file} horizontal center`);
    near(top + height / 2, 50, `${file} vertical center`);
    near(width / height, bounds.width / bounds.height, `${file} original geometry`);
    near(Math.max(width, height), 88, `${file} consistent longest dimension`);
    assert.ok(left >= 5.99999 && top >= 5.99999, `${file} clear margin`);
    assert.ok(left + width <= 94.00001 && top + height <= 94.00001, `${file} full equipment remains visible`);
  }
});

test('white photo frames retain complete unknown and replaced images instead of inheriting another crop', () => {
  for (const image of [asset, 'https://cdn.example/owner-photo.jpg']) {
    const css = variables(getProductStage(image, { width: 1600, height: 500 }), 'photoStyle');
    near(css['--photo-image-left'], 6, 'complete photo starts within the frame');
    near(css['--photo-image-top'], 36.25, 'complete photo stays vertically centered');
    near(css['--photo-image-width'], 88, 'complete width');
    near(css['--photo-image-height'], 27.5, 'complete height');
  }
});
