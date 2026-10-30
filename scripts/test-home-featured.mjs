import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from '../src/data/products.ts';
import { getProductFamily } from '../src/lib/product-families.ts';
import { selectHomeFeatured } from '../src/lib/home-featured.ts';

test('the real showcase fills ten positions with public, distinct catalog families', () => {
  const before = JSON.stringify(products);
  const items = selectHomeFeatured(products);
  assert.equal(items.length, 10);
  const identities = items.map(product => getProductFamily(product.id, products)?.id || product.id);
  assert.equal(new Set(identities).size, 10);
  assert.ok(items.every(product => product.visible !== false && products.includes(product)));
  assert.equal(JSON.stringify(products), before);
});

test('a highlighted secondary variant promotes its visible family rather than a duplicate card', () => {
  const input = ['P31','P30','P01'].map(id => ({...products.find(product => product.id === id), featured:id==='P31',visible:true}));
  const output = selectHomeFeatured(input);
  assert.equal(output.length, 2);
  assert.equal(output[0].id, 'P30');
  assert.equal(getProductFamily(output[0].id, input).members.length, 2);
});

test('draft highlights never leak; sparse catalogs are not padded with invented products', () => {
  const input = [{id:'private',name:'Draft',category:'linea-fria',featured:true,visible:false},{id:'public',name:'Public',category:'linea-caliente',visible:true}];
  assert.deepEqual(selectHomeFeatured(input).map(product=>product.id), ['public']);
  assert.deepEqual(selectHomeFeatured(input,0), []);
});

test('duplicate records and variant families cannot fill the requested eight slots twice', () => {
  const input = [...products, ...products];
  const output = selectHomeFeatured(input,8);
  assert.equal(output.length,8);
  assert.equal(new Set(output.map(product=>getProductFamily(product.id,input)?.id||product.id)).size,8);
});

test('published fallback rotates categories instead of using only the first product line', () => {
  const input = ['hot','hot','hot','cold','neutral','furniture'].map((category,i)=>({id:`item-${i}`,name:`Item ${i}`,category,visible:true,featured:false}));
  assert.deepEqual(selectHomeFeatured(input,4).map(product=>product.category), ['hot','cold','neutral','furniture']);
});
