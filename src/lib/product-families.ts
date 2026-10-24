/**
 * Presentation groups only: the individual product objects, SKUs and routes remain
 * the source of truth. Membership is explicit so a shared category/equipmentFamily
 * never merges different designs (for example B-7LRE and the industrial mixers).
 * Capacities come from catalogs/ilumi/catalog.json and the verified technical-sheet
 * transcriptions in src/data/products.ts, never from a number in a model code.
 */
export type FamilyProduct = {
  id: string;
  name: string;
  category: string;
  visible?: boolean;
};

export type ProductFamilyMember<T extends FamilyProduct> = { product: T; label: string };
export type ProductFamily<T extends FamilyProduct> = {
  id: string;
  name: string;
  label: string;
  selectorLabel?: string;
  cardAction?: string;
  cardSummary?: string;
  members: ProductFamilyMember<T>[];
  defaultProductId: string;
};

type FamilyModel = {
  productId: string;
  label: string;
  capacity: number;
  /** At equal capacity prefer the equipped, floor-standing or Pre Cooling model. */
  priority?: number;
};
type FamilyDefinition = {
  id: string;
  name: string;
  label: string;
  selectorLabel?: string;
  cardAction?: string;
  cardSummary?: string;
  models: readonly FamilyModel[];
};

const definitions: readonly FamilyDefinition[] = [
  {
    // Owner-confirmed central-kitchen versions. Group listings only: each SKU
    // retains its own approved cooktop rules, photographs and model references.
    id: 'inox-cocinas-centrales', name: 'Cocina central configurable', label: 'Versión',
    selectorLabel: 'Versión', cardAction: 'Elegir versión', cardSummary: '2 versiones · de 4 a 10 posiciones',
    models: [
      { productId: 'P05', label: 'CÓD-CHI-04', capacity: 10 },
      { productId: 'P04', label: 'CIH-4P', capacity: 10, priority: 1 },
    ],
  },
  {
    // Owner-confirmed equivalent base sink: the drainers are an additional option.
    // Keep both original products, models and routes for their respective setup.
    id: 'inox-lavadero-dos-pozas', name: 'Lavadero de 2 pozas', label: 'Adicional de escurridor',
    selectorLabel: 'Adicional de escurridor', cardAction: 'Elegir escurridor', cardSummary: 'Con o sin escurridor',
    models: [
      { productId: 'P26', label: 'Sin escurridor', capacity: 2 },
      { productId: 'P25', label: 'Con escurridor (vasos/platos/cubiertos)', capacity: 2, priority: 1 },
    ],
  },
  {
    // Both original blender designs are owner-confirmed variations. The source
    // lists available capacities per design, not one exact volume for each GLB.
    id: 'inox-licuadoras-industriales', name: 'Licuadora industrial', label: 'Modelo',
    selectorLabel: 'Variación', cardAction: 'Elegir variación', cardSummary: '2 modelos · capacidades de 10 a 25 L',
    models: [
      { productId: 'P31', label: 'Modelo con base', capacity: 20 },
      { productId: 'P30', label: 'Modelo industrial', capacity: 25 },
    ],
  },
  {
    id: 'ilumi-dispensadores-jugo', name: 'Dispensador de jugos ILUMI', label: 'Capacidad total',
    models: [
      { productId: 'ILUMI-DJ-181', label: '18 L · 1 tolva', capacity: 18 },
      { productId: 'ILUMI-DJ-182', label: '36 L · 2 tolvas', capacity: 36 },
      { productId: 'ILUMI-DJ-183', label: '54 L · 3 tolvas', capacity: 54 },
    ],
  },
  {
    id: 'ilumi-cremoladeras', name: 'Cremoladera ILUMI', label: 'Capacidad total',
    models: [
      { productId: 'ILUMI-CR-121', label: '12 L · 1 tolva', capacity: 12 },
      { productId: 'ILUMI-CR-122', label: '24 L · 2 tolvas', capacity: 24 },
      { productId: 'ILUMI-CR-123', label: '36 L · 3 tolvas', capacity: 36 },
    ],
  },
  {
    id: 'ilumi-envasadoras-vacio', name: 'Envasadora al vacío ILUMI', label: 'Longitud de sellado',
    models: [
      { productId: 'ILUMI-VM-200T', label: '260 mm de sellado', capacity: 260 },
      { productId: 'ILUMI-VM-300T', label: '300 mm de sellado', capacity: 300 },
      { productId: 'ILUMI-VM-400T', label: '400 mm de sellado', capacity: 400 },
      { productId: 'ILUMI-VM-500T', label: '500 mm de sellado', capacity: 500 },
    ],
  },
  {
    id: 'ilumi-batidoras-industriales', name: 'Batidora industrial ILUMI', label: 'Capacidad del bowl',
    models: [
      { productId: 'ILUMI-B-10L', label: 'Bowl de 10 L', capacity: 10 },
      { productId: 'ILUMI-B-20L', label: 'Bowl de 20 L', capacity: 20 },
      { productId: 'ILUMI-B-30L', label: 'Bowl de 30 L', capacity: 30 },
    ],
  },
  {
    id: 'ilumi-amasadoras', name: 'Amasadora ILUMI', label: 'Capacidad del bowl',
    models: [
      { productId: 'ILUMI-AMA-15M', label: 'Bowl de 45 L · hasta 16 kg de masa', capacity: 45 },
      { productId: 'ILUMI-AMA-25M', label: 'Bowl de 68 L · hasta 25 kg de masa', capacity: 68 },
    ],
  },
  {
    id: 'ilumi-batidoras-inmersion', name: 'Batidora de inmersión ILUMI', label: 'Volumen máximo de mezclado',
    models: [
      { productId: 'ILUMI-BIT-270', label: 'Hasta 10 L de mezclado · 270 W', capacity: 10 },
      { productId: 'ILUMI-BIT-350', label: 'Hasta 30 L de mezclado · 350 W', capacity: 30 },
      { productId: 'ILUMI-BIT-500', label: 'Hasta 100 L de mezclado · 500 W', capacity: 100 },
      { productId: 'ILUMI-BIT-750', label: 'Hasta 200 L de mezclado · 750 W', capacity: 200 },
    ],
  },
  {
    id: 'ilumi-helado-artesanal', name: 'Máquina de helado artesanal ILUMI', label: 'Producción máxima / formato',
    models: [
      { productId: 'ILUMI-MHA-16S', label: 'Hasta 16 L/h · sobremesa', capacity: 16 },
      { productId: 'ILUMI-MHA-20S', label: 'Hasta 20 L/h · sobremesa', capacity: 20 },
      { productId: 'ILUMI-MHA-20', label: 'Hasta 20 L/h · de piso', capacity: 20, priority: 1 },
    ],
  },
  {
    id: 'ilumi-helado-soft', name: 'Máquina de helado soft ILUMI', label: 'Producción máxima / formato',
    models: [
      { productId: 'ILUMI-MHS-25', label: 'Hasta 25 L/h · de piso', capacity: 25 },
      // This known SKU is still a draft. It only appears if the caller supplies
      // it among visible products; definitions never create catalog records.
      { productId: 'ILUMI-MHS-25S', label: 'Hasta 25 L/h · sobremesa · Pre Cooling', capacity: 25, priority: 1 },
      { productId: 'ILUMI-MHS-25PC', label: 'Hasta 25 L/h · de piso · Pre Cooling', capacity: 25, priority: 2 },
      { productId: 'ILUMI-MHS-30S', label: 'Hasta 30 L/h · sobremesa', capacity: 30 },
      { productId: 'ILUMI-MHS-30PC', label: 'Hasta 30 L/h · de piso · Pre Cooling', capacity: 30, priority: 2 },
    ],
  },
];

const familyByProductId = new Map(definitions.flatMap(family => family.models.map(model => [model.productId, family] as const)));
const compareModels = (a: FamilyModel, b: FamilyModel) => a.capacity - b.capacity || (a.priority ?? 0) - (b.priority ?? 0);

/** Only supplied, visible products participate, including a family with one model. */
export function getProductFamily<T extends FamilyProduct>(productId: string, products: readonly T[]): ProductFamily<T> | null {
  const definition = familyByProductId.get(productId);
  if (!definition || !products.some(product => product.id === productId && product.visible !== false)) return null;
  const visibleById = new Map(products.filter(product => product.visible !== false).map(product => [product.id, product]));
  const models = definition.models.filter(model => visibleById.has(model.productId)).sort(compareModels);
  return {
    id: definition.id,
    name: definition.name,
    label: definition.label,
    selectorLabel: definition.selectorLabel,
    cardAction: definition.cardAction,
    cardSummary: definition.cardSummary ? (models.length > 1 ? definition.cardSummary : models[0].label) : undefined,
    members: models.map(model => ({ product: visibleById.get(model.productId)!, label: model.label })),
    defaultProductId: models[models.length - 1].productId,
  };
}

/**
 * Keep the first visible position of each family, using its highest-capacity
 * visible model (or most equipped at equal capacity) as the card.
 * All returned objects are original input references;
 * this does not edit products, routes, featured flags, prices or model assets.
 */
export function catalogFamilyProducts<T extends FamilyProduct>(products: readonly T[]): T[] {
  const visibleProducts = products.filter(product => product.visible !== false);
  const result: T[] = [];
  const seenFamilies = new Set<string>();
  for (const product of visibleProducts) {
    const family = getProductFamily(product.id, visibleProducts);
    if (!family) {
      result.push(product);
    } else if (!seenFamilies.has(family.id)) {
      seenFamilies.add(family.id);
      result.push(family.members.find(member => member.product.id === family.defaultProductId)!.product);
    }
  }
  return result;
}
