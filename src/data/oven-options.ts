import type { Product } from './products.ts';
import type { CmsVariant, CmsVariantAxis } from '../lib/cms.ts';

// Owner-confirmed choices (23 October 2026). Geometry is illustrative; these
// capacities do not claim commercial dimensions, tray formats or heat ratings.
const capacityAxis = (counts: number[], unit: string): CmsVariantAxis => ({
  id: 'capacity', label: 'Capacidad', options: counts.map(count => ({ id: String(count), label: `${count} ${unit}` })),
});
const energyAxis: CmsVariantAxis = { id: 'energy', label: 'Energía', options: [{ id: 'gas', label: 'A gas' }, { id: 'electric', label: 'Eléctrico' }] };
const energyName = (energy: string) => energy === 'gas' ? 'a gas' : 'eléctrico';
const variant = (stem: string, name: string, optionValues: Record<string, string>, doorAnimation = ''): CmsVariant => ({
  id: stem, name, optionValues, availability: 'made_to_order',
  model3d: `/models/inox/${stem}.glb`, image: `/images/products/${stem}.webp`, doorAnimation,
});

export function ovenOptions(products: Product[]): Product[] {
  const existing = products.map(product => {
    if (product.id === 'P06') {
      const variants = [10, 8, 6, 4].flatMap(count => ['convencional', 'conveccion'].map(mode => variant(
        `multiuso-config-p06-${mode}-${count}-v1`, `${count} bandejas · ${mode === 'conveccion' ? 'con convección' : 'convencional'}`,
        { capacity: String(count), mode }, 'Abrir_puertas',
      )));
      return { ...product, name: 'Horno multiuso configurable', supplyType: 'manufactured' as const, brand: 'INOX 304',
        summary: 'Elige 4, 6, 8 o 10 bandejas y cocción convencional o con convección. El visor cambia las bandejas y añade el ventilador cuando corresponde. Visualización ilustrativa; medidas y formato de bandejas a confirmar al cotizar.',
        features: ['4, 6, 8 o 10 bandejas', 'Convencional o con convección', 'Puerta articulada en el visor 3D', 'Fabricación a pedido'],
        capacity: '4, 6, 8 o 10 bandejas', variantAxes: [capacityAxis([4, 6, 8, 10], 'bandejas'), { id: 'mode', label: 'Cocción', options: [{ id: 'convencional', label: 'Convencional' }, { id: 'conveccion', label: 'Con convección' }] }], variants };
    }
    if (product.id === 'P07' || product.id === 'P08') {
      const variants = [30, 24, 18, 12].flatMap(count => ['carbon', 'lena'].map(fuel => variant(
        `pollero-config-${product.id.toLowerCase()}-${fuel}-${count}-v1`, `${count} pollos · ${fuel === 'carbon' ? 'carbón (ecológico)' : 'leña'}`,
        { capacity: String(count), fuel }, 'Abrir_puertas',
      )));
      return { ...product, name: `Horno pollero configurable · ${product.id === 'P07' ? 'diseño frontal' : 'HPE-1'}`, supplyType: 'manufactured' as const, brand: 'INOX 304',
        summary: 'Configura la capacidad para 12, 18, 24 o 30 pollos y elige leña o carbón (ecológico). Cada selección muestra esa cantidad de pollos en el 3D. Diseño y distribución ilustrativos; medidas y fabricación final a confirmar.',
        features: ['12, 18, 24 o 30 pollos', 'Leña o carbón (ecológico)', 'Cantidad de pollos visible en el modelo 3D', 'Estructura de acero inoxidable'],
        capacity: '12, 18, 24 o 30 pollos', variantAxes: [capacityAxis([12, 18, 24, 30], 'pollos'), { id: 'fuel', label: 'Combustible', options: [{ id: 'lena', label: 'Leña' }, { id: 'carbon', label: 'Carbón (ecológico)' }] }], variants };
    }
    return product;
  });
  const pizza = ['gas', 'electric'].map(energy => variant(`pizza-config-2-${energy}-v1`, `2 bandejas · ${energyName(energy)}`, { capacity: '2', energy }, 'Abrir_puertas'));
  // Owner's 2020 photograph documents the gas version; the electric render is
  // illustrative. The historical advertisement is not a current price/stock source.
  pizza[0].image = '/images/products/horno-pizza-referencia-facebook.webp';
  const tavola = [10, 8, 6, 4].flatMap(count => ['gas', 'electric'].flatMap(energy => ['glass', 'open'].map(cover => variant(
    `tavola-config-${count}-${energy}-${cover}-v1`, `${count} bandejas · ${energyName(energy)} · ${cover === 'glass' ? 'con vidrio' : 'sin vidrio'}`,
    { capacity: String(count), energy, cover },
  ))));
  return [...existing, {
    id: 'INOX-HOR-PIZZA', slug: 'horno-pizza-configurable', name: 'Horno para pizza · 2 bandejas', category: 'linea-caliente',
    supplyType: 'manufactured', brand: 'INOX 304', featured: false, capacity: '2 bandejas',
    summary: 'Horno para pizza de dos bandejas, a gas o eléctrico. Visualización 3D ilustrativa de la configuración; el diseño, las medidas y el formato de bandejas se confirman al cotizar.',
    features: ['2 niveles para hornear', 'A gas o eléctrico', 'Gabinete con vidrio', 'Fabricación a pedido'],
    image: pizza[0].image!, modelPoster: pizza[0].image!, model3d: pizza[0].model3d!, doorAnimation: 'Abrir_puertas',
    variantAxes: [capacityAxis([2], 'bandejas'), energyAxis], variants: pizza,
  }, {
    id: 'INOX-TAVOLA', slug: 'tavola-caliente-configurable', name: 'Távola caliente configurable', category: 'linea-caliente',
    supplyType: 'manufactured', brand: 'INOX 304', featured: false, capacity: '4, 6, 8 o 10 bandejas',
    summary: 'Mantén tus preparaciones calientes con 4, 6, 8 o 10 bandejas. Elige gas o electricidad y añade una cubierta de vidrio si la necesitas. Visualización ilustrativa; diseño, medidas y formato de bandejas a confirmar.',
    features: ['4, 6, 8 o 10 bandejas', 'A gas o eléctrico', 'Con o sin cubierta de vidrio', 'Equipo para mantener alimentos calientes'],
    image: tavola[0].image!, modelPoster: tavola[0].image!, model3d: tavola[0].model3d!,
    variantAxes: [capacityAxis([4, 6, 8, 10], 'bandejas'), energyAxis, { id: 'cover', label: 'Cubierta', options: [{ id: 'open', label: 'Sin vidrio' }, { id: 'glass', label: 'Con vidrio' }] }], variants: tavola,
  }];
}
