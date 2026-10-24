import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CART_MODULE_IDS, parseCartConfig, validateCartSelection, initialCartSelection, cartQuoteSummary, moveCartModule, toggleCartModule, reconcileCartSelection } from '../src/lib/cart-config.ts';
import { cartAssetFor, CART_ASSET } from '../src/lib/cart-assets.ts';
import { withPublishedCart } from '../src/data/cart-published.ts';
import { products } from '../src/data/products.ts';
const config = JSON.parse(readFileSync(new URL('../src/data/cart-published.json', import.meta.url))).cartConfig;
const ids = [...CART_MODULE_IDS];
const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];

test('all 16 reviewed combinations are canonical, exact and named in quotes', () => {
  const rules = parseCartConfig(config);
  assert.equal(initialCartSelection(rules).included.length, 4);
  for (let mask = 0; mask < 16; mask++) {
    const included = rules.modules.filter((_, i) => mask & (1 << i)).map(m => m.id);
    const selected = validateCartSelection(rules, { included: [...included].reverse() });
    assert.deepEqual(selected, { included, order: ids });
    const quote = cartQuoteSummary(rules, selected);
    assert.match(quote, /precio por confirmar/);
    for (const module of rules.modules) assert.ok(quote.includes(module.label));
  }
});
test('all 24 arrangements × 16 inclusion combinations retain exact left-to-right positions', () => {
  let checked = 0;
  for (const order of permutations(ids)) for (let mask = 0; mask < 16; mask++) {
    const included = ids.filter((_, index) => mask & (1 << index));
    const input = { included: [...included].reverse(), order: [...order] };
    const selected = validateCartSelection(config, input);
    assert.deepEqual(selected, { included, order });
    const quote = cartQuoteSummary(config, selected);
    assert.match(quote, /izquierda a derecha \(mirando el frente\)/);
    order.forEach((id, index) => assert.ok(quote.includes(`Posición ${index + 1}: ${included.includes(id) ? config.modules.find(m => m.id === id).label : 'Superficie de trabajo'}.`)));
    selected.order.reverse(); selected.included.reverse();
    assert.deepEqual(input.order, order); assert.deepEqual(input.included, [...included].reverse());
    checked++;
  }
  assert.equal(checked, 384);
});
test('moving swaps complete stations without duplication, and toggle retains their new positions', () => {
  const source = initialCartSelection(config), expected = structuredClone(source);
  const moved = moveCartModule(config, source, 'plancha', 0);
  assert.deepEqual(moved.order, ['plancha','freidora','conservadora','broastera']);
  assert.deepEqual(source, expected);
  const without = toggleCartModule(config, moved, 'freidora', false);
  assert.deepEqual(without.order, moved.order); assert.equal(without.included.includes('freidora'), false);
  const movedBlank = moveCartModule(config, without, 'freidora', 3);
  assert.deepEqual(movedBlank.order, ['plancha','broastera','conservadora','freidora']);
  assert.equal(movedBlank.included.includes('freidora'), false);
  assert.deepEqual(toggleCartModule(config, movedBlank, 'freidora', true).order, movedBlank.order);
  assert.deepEqual(moveCartModule(config, movedBlank, 'plancha', 0), movedBlank);
  for (const index of [-1, 4, 0.5, NaN, Infinity, '1']) assert.throws(() => moveCartModule(config, source, 'plancha', index));
  assert.throws(() => moveCartModule(config, source, 'wok', 0));
  assert.throws(() => toggleCartModule(config, source, 'wok', true));
  assert.throws(() => toggleCartModule(config, source, 'plancha', 'true'));
});
test('owner updates keep the arrangement, drop revoked equipment and add approved defaults', () => {
  const previousConfig = { ...config, modules: config.modules.slice(0,3) };
  const selection = { included: ['broastera','freidora'], order: ['plancha','conservadora','freidora','broastera'] };
  const nextConfig = { ...config, modules: [config.modules[0],config.modules[2],config.modules[3]] };
  const reconciled = reconcileCartSelection(nextConfig, previousConfig, selection);
  assert.deepEqual(reconciled, { included: ['broastera','plancha'], order: selection.order });
  assert.deepEqual(validateCartSelection(nextConfig, reconciled), reconciled);
  assert.throws(() => toggleCartModule(nextConfig, reconciled, 'freidora', true));
  assert.throws(() => moveCartModule(nextConfig, reconciled, 'freidora', 0));
  const quote = cartQuoteSummary(nextConfig, reconciled);
  assert.ok(!quote.includes('Freidora')); assert.match(quote, /Posición 3: Superficie de trabajo/);
});
test('reject malformed controls and arbitrary module identifiers', () => {
  for (const bad of [{...config, version: 2}, {...config, enabled:'true'}, {...config, price: 1}, {...config, modules: []}, {...config, modules: [config.modules[0], config.modules[0]]}, {...config, modules: [{...config.modules[0], id:'wok'}]}, {...config, modules: [{...config.modules[0], label:'bad\u0000label'}]}]) assert.throws(() => parseCartConfig(bad));
  for (const bad of [{included:['wok']}, {included:['plancha','plancha']}, {included:[], price: 10}, {included:'plancha'}]) assert.throws(() => validateCartSelection(config, bad));
  for (const order of [null, undefined, {}, 'plancha', [], ids.slice(1), [...ids,'plancha'], ['plancha','plancha','freidora','conservadora'], ['wok',...ids.slice(1)], [0,...ids.slice(1)], [[ids[0]],...ids.slice(1)]]) assert.throws(() => validateCartSelection(config, {included:[],order}));
  assert.throws(() => validateCartSelection(config, {included:[],order:ids,price:1}));
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
