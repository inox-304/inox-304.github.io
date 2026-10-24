import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from '../src/data/products.ts';
import { catalogFamilyProducts, getProductFamily } from '../src/lib/product-families.ts';

const ids = list => list.map(product => product.id);
const sample = (id, extra = {}) => ({ id, name: id, category: 'linea-fria', ...extra });
const familyFor = id => getProductFamily(id, products);

test('all 61 SKUs remain intact while the catalog presents 36 entries with hidden immersion mixers and grouped blender and central-kitchen versions', () => {
  const before = structuredClone(products);
  const catalog = catalogFamilyProducts(products);
  assert.equal(products.length, 61);
  assert.equal(catalog.length, 36);
  assert.ok(catalog.some(product => product.id === 'INOX-COC-EMP'));
  assert.deepEqual(products, before);
  assert.deepEqual(ids(catalog.filter(product => /^P\d+$/.test(product.id))), ids(products.filter(product => /^P\d+$/.test(product.id) && product.visible !== false && !['P05', 'P26', 'P31'].includes(product.id))));
  const families = catalog.map(product => familyFor(product.id)).filter(Boolean);
  assert.equal(families.length, 10);
  assert.deepEqual(new Set(families.flatMap(family => ids(family.members.map(member => member.product)))), new Set(products.filter(product => product.visible !== false && (['P04', 'P05', 'P25', 'P26', 'P30', 'P31'].includes(product.id) || (product.id.startsWith('ILUMI-') && !['ILUMI-B-7LRE', 'ILUMI-OJM-01AI'].includes(product.id)))).map(product => product.id)));
  for (const card of catalog) assert.ok(products.includes(card), 'retain every subtype field and the original reference');
});

test('the largest visible equipment represents each family, with declared tie preferences', () => {
  for (const [first, expected] of [
    ['P05', 'P04'],
    ['P26', 'P25'],
    ['P31', 'P30'],
    ['ILUMI-DJ-181', 'ILUMI-DJ-183'],
    ['ILUMI-CR-121', 'ILUMI-CR-123'],
    ['ILUMI-VM-200T', 'ILUMI-VM-500T'],
    ['ILUMI-B-10L', 'ILUMI-B-30L'],
    ['ILUMI-AMA-15M', 'ILUMI-AMA-25M'],
    ['ILUMI-MHA-16S', 'ILUMI-MHA-20'],
    ['ILUMI-MHS-25', 'ILUMI-MHS-30PC'],
  ]) {
    assert.equal(familyFor(first).defaultProductId, expected, first);
    assert.equal(getProductFamily(first, [...products].reverse()).defaultProductId, expected, 'independent of API ordering');
  }
});

test('central-kitchen versions preserve individual SKU references and never combine their configuration rules', () => {
  const first = { ...products.find(product => product.id === 'P04'), cooktopConfig: { approvedFor: 'P04' } };
  const second = { ...products.find(product => product.id === 'P05'), cooktopConfig: { approvedFor: 'P05' } };
  const family = getProductFamily('P05', [first, second]);
  assert.equal(family.id, 'inox-cocinas-centrales');
  assert.equal(family.name, 'Cocina central configurable');
  assert.equal(family.selectorLabel, 'Versión');
  assert.equal(family.defaultProductId, 'P04');
  assert.deepEqual(family.members, [{ product: second, label: 'CÓD-CHI-04' }, { product: first, label: 'CIH-4P' }]);
  assert.equal(family.members[0].product.cooktopConfig, second.cooktopConfig);
  assert.equal(family.members[1].product.cooktopConfig, first.cooktopConfig);
  assert.notEqual(first.slug, second.slug);
  assert.notEqual(first.image, second.image);
  assert.notEqual(first.model3d, second.model3d);
  assert.deepEqual(catalogFamilyProducts([second, first]), [first]);
  assert.deepEqual(catalogFamilyProducts([{ ...first, visible: false }, second]), [second]);
  for (const id of ['P01', 'P02', 'P03', 'INOX-COC-EMP']) assert.equal(familyFor(id), null);
});

test('industrial blenders retain their two designs, documented capacity ranges, routes and media', () => {
  const industrial = products.find(product => product.id === 'P30');
  const withBase = products.find(product => product.id === 'P31');
  const family = familyFor('P31');
  assert.equal(family.name, 'Licuadora industrial');
  assert.equal(family.selectorLabel, 'Variación');
  assert.equal(family.cardAction, 'Elegir variación');
  assert.equal(family.cardSummary, '2 modelos · capacidades de 10 a 25 L');
  assert.equal(family.defaultProductId, 'P30');
  assert.deepEqual(family.members, [
    { product: withBase, label: 'Modelo con base' },
    { product: industrial, label: 'Modelo industrial' },
  ]);
  assert.notEqual(industrial.slug, withBase.slug);
  assert.notEqual(industrial.model3d, withBase.model3d);
  assert.notEqual(industrial.image, withBase.image);
  assert.ok(industrial.features.includes('Capacidades: 10, 15, 20 y 25 litros'));
  assert.ok(withBase.features.includes('Capacidades: 10, 15 y 20 L'));
  const source = [sample('before'), withBase, sample('between'), industrial, sample('after')];
  assert.deepEqual(ids(catalogFamilyProducts(source)), ['before', 'P30', 'between', 'after']);
  const remaining = getProductFamily('P31', [withBase, { ...industrial, visible: false }]);
  assert.equal(remaining.defaultProductId, 'P31');
  assert.equal(remaining.cardSummary, 'Modelo con base');
  assert.equal(familyFor('P29'), null);
});

test('all four immersion mixers are unpublished without removing their SKU, source metadata or assets', () => {
  const hiddenIds = ['ILUMI-BIT-270', 'ILUMI-BIT-350', 'ILUMI-BIT-500', 'ILUMI-BIT-750'];
  const catalog = catalogFamilyProducts(products);
  for (const id of hiddenIds) {
    const product = products.find(item => item.id === id);
    assert.ok(product);
    assert.equal(product.visible, false);
    assert.ok(product.slug && product.image && product.model3d && product.supplierModel);
    assert.equal(familyFor(id), null);
    assert.ok(!catalog.some(item => item.id === id));
  }
  const restored = products.map(product => hiddenIds.includes(product.id) ? { ...product, visible: true } : product);
  const family = getProductFamily(hiddenIds[0], restored);
  assert.equal(family.defaultProductId, 'ILUMI-BIT-750');
  assert.equal(family.label, 'Volumen máximo de mezclado');
  assert.equal(family.members.at(-1).label, 'Hasta 200 L de mezclado · 750 W');
});

test('the two-bowl sink has a drainer option, preserving both original assets and routes', () => {
  const withDrainer = products.find(product => product.id === 'P25');
  const withoutDrainer = products.find(product => product.id === 'P26');
  const family = familyFor('P26');
  assert.equal(family.name, 'Lavadero de 2 pozas');
  assert.equal(family.label, 'Adicional de escurridor');
  assert.equal(family.selectorLabel, 'Adicional de escurridor');
  assert.equal(family.cardAction, 'Elegir escurridor');
  assert.equal(family.cardSummary, 'Con o sin escurridor');
  assert.equal(family.defaultProductId, 'P25');
  assert.deepEqual(family.members, [
    { product: withoutDrainer, label: 'Sin escurridor' },
    { product: withDrainer, label: 'Con escurridor (vasos/platos/cubiertos)' },
  ]);
  assert.equal(family.members[0].product, withoutDrainer);
  assert.equal(family.members[1].product, withDrainer);
  assert.notEqual(withDrainer.slug, withoutDrainer.slug);
  assert.notEqual(withDrainer.model3d, withoutDrainer.model3d);
  assert.notEqual(withDrainer.image, withoutDrainer.image);
  for (const id of ['P24', 'P27']) assert.equal(familyFor(id), null, 'no other INOX designs are inferred');
  const source = [sample('P24'), { ...withDrainer, visible: false }, withoutDrainer, sample('P27')];
  assert.deepEqual(ids(catalogFamilyProducts(source)), ['P24', 'P26', 'P27']);
  const onlyWithout = getProductFamily('P26', source);
  assert.equal(onlyWithout.defaultProductId, 'P26');
  assert.equal(onlyWithout.members.length, 1);
  assert.equal(onlyWithout.cardSummary, 'Sin escurridor');
});

test('hidden or absent records never enter cards or selectors, even for the draft MHS-25S', () => {
  const source = [sample('ILUMI-DJ-181'), sample('ILUMI-DJ-182'), sample('ILUMI-DJ-183', { visible: false }), sample('hidden-original', { visible: false })];
  assert.deepEqual(ids(catalogFamilyProducts(source)), ['ILUMI-DJ-182']);
  assert.deepEqual(ids(getProductFamily('ILUMI-DJ-181', source).members.map(member => member.product)), ['ILUMI-DJ-181', 'ILUMI-DJ-182']);
  assert.equal(getProductFamily('ILUMI-DJ-183', source), null);
  assert.equal(getProductFamily('ILUMI-DJ-183', source.slice(0, 2)), null);
  const draft = sample('ILUMI-MHS-25S', { visible: false });
  const soft = getProductFamily('ILUMI-MHS-25', [...products, draft]);
  assert.ok(!soft.members.some(member => member.product.id === draft.id));
  assert.equal(getProductFamily(draft.id, [...products, draft]), null);
  assert.ok(!catalogFamilyProducts([...products, draft]).includes(draft));
  assert.deepEqual(catalogFamilyProducts([draft]), []);
});

test('single and two-member families work without creating missing models', () => {
  const small = sample('ILUMI-CR-121', { model3d: '/specific.glb', technicalSheet: '/specific.pdf' });
  const medium = sample('ILUMI-CR-122');
  const one = getProductFamily(small.id, [small]);
  assert.equal(one.members.length, 1);
  assert.equal(one.members[0].product, small);
  assert.equal(one.defaultProductId, small.id);
  assert.deepEqual(catalogFamilyProducts([small]), [small]);
  assert.equal(getProductFamily(small.id, [medium, small]).defaultProductId, medium.id);
  assert.deepEqual(ids(getProductFamily(small.id, [medium, small]).members.map(member => member.product)), [small.id, medium.id]);
  assert.deepEqual(catalogFamilyProducts([]), []);
});

test('family cards keep the first visible position and unrelated entries retain their order', () => {
  const source = [
    sample('ILUMI-DJ-183', { visible: false }), sample('P01'), sample('ILUMI-DJ-181'),
    sample('P02'), sample('ILUMI-CR-121'), sample('ILUMI-DJ-182'), sample('P03'), sample('ILUMI-CR-123'),
  ];
  assert.deepEqual(ids(catalogFamilyProducts(source)), ['P01', 'ILUMI-DJ-182', 'P02', 'ILUMI-CR-123', 'P03']);
});

test('capacity labels use real units and distinguish total volumes, mixing volumes and hourly output', () => {
  const label = id => familyFor(id).members.find(member => member.product.id === id).label;
  assert.equal(label('ILUMI-VM-200T'), '260 mm de sellado');
  assert.equal(label('ILUMI-CR-122'), '24 L · 2 tolvas');
  assert.equal(label('ILUMI-CR-123'), '36 L · 3 tolvas');
  assert.equal(label('ILUMI-DJ-183'), '54 L · 3 tolvas');
  assert.equal(label('ILUMI-AMA-15M'), 'Bowl de 45 L · hasta 16 kg de masa');
  assert.equal(label('ILUMI-MHA-20'), 'Hasta 20 L/h · de piso');
  assert.equal(label('ILUMI-MHS-30PC'), 'Hasta 30 L/h · de piso · Pre Cooling');
  assert.equal(familyFor('ILUMI-DJ-181').label, 'Capacidad total');
});

test('repostería, industrial and immersion mixers, and soft and artesanal ice cream remain distinct', () => {
  assert.equal(familyFor('ILUMI-B-7LRE'), null);
  assert.equal(familyFor('ILUMI-OJM-01AI'), null);
  assert.equal(familyFor('P32'), null, '25 L reference has no confirmed CR-122 SKU; do not infer identity from the photo');
  assert.notEqual(familyFor('ILUMI-B-10L').id, getProductFamily('ILUMI-BIT-270', [sample('ILUMI-BIT-270')]).id);
  assert.notEqual(familyFor('ILUMI-MHA-20').id, familyFor('ILUMI-MHS-25').id);
  const unknown = sample('OTHER-B-30L', { equipmentFamily: 'batidoras', brand: 'ILUMI' });
  assert.equal(getProductFamily(unknown.id, [...products, unknown]), null);
  assert.equal(catalogFamilyProducts([...products, unknown]).at(-1), unknown);
});
