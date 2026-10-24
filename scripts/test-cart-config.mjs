import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCartConfig, validateCartSelection, initialCartSelection, cartQuoteSummary } from '../src/lib/cart-config.ts';
import { cartAssetFor, CART_ASSET } from '../src/lib/cart-assets.ts';
import { withPublishedCart } from '../src/data/cart-published.ts';
import { products } from '../src/data/products.ts';
const config = JSON.parse(readFileSync(new URL('../src/data/cart-published.json', import.meta.url))).cartConfig;

test('all 16 reviewed combinations are canonical, exact and named in quotes', () => {
  const rules = parseCartConfig(config);
  assert.equal(initialCartSelection(rules).included.length, 4);
  for (let mask = 0; mask < 16; mask++) {
    const included = rules.modules.filter((_, i) => mask & (1 << i)).map(m => m.id);
    const selected = validateCartSelection(rules, { included: [...included].reverse() });
    assert.deepEqual(selected, { included });
    const quote = cartQuoteSummary(rules, selected);
    assert.match(quote, /precio por confirmar/);
    for (const module of rules.modules) assert.ok(quote.includes(module.label));
  }
});
test('reject malformed controls and arbitrary module identifiers', () => {
  for (const bad of [{...config, version: 2}, {...config, enabled:'true'}, {...config, price: 1}, {...config, modules: []}, {...config, modules: [config.modules[0], config.modules[0]]}, {...config, modules: [{...config.modules[0], id:'wok'}]}, {...config, modules: [{...config.modules[0], label:'bad\u0000label'}]}]) assert.throws(() => parseCartConfig(bad));
  for (const bad of [{included:['wok']}, {included:['plancha','plancha']}, {included:[], price: 10}, {included:'plancha'}]) assert.throws(() => validateCartSelection(config, bad));
});
test('static rules are only attached to the reviewed manufactured P15 model', () => {
  const cart = products.find(p => p.id === 'P15');
  assert.equal(cart.model3d, CART_ASSET); assert.deepEqual(cart.cartConfig, config);
  assert.equal(cart.supplyType, 'manufactured'); assert.equal(cart.equipmentFamily, 'carritos-comida');
  assert.equal(products.filter(p => p.cartConfig).length, 1);
  assert.equal(cartAssetFor('P01', CART_ASSET), ''); assert.equal(cartAssetFor('P15', '/models/random.glb'), '');
  assert.throws(() => withPublishedCart([{...cart, supplyType: 'distributed'}]));
  assert.throws(() => withPublishedCart([{...cart, model3d:'/models/replacement.glb'}]));
});
