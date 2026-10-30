import { normalizeCategory, type ProductCategory } from '../data/categories.ts';

export type CatalogType = { id: string; label: string; category: ProductCategory };
type TypedProduct = { id: string; name: string; category: string; equipmentFamily?: string };

/** Navigation labels describe actual equipment, never implied capacity or stock. */
export const catalogTypes: readonly CatalogType[] = [
  { id: 'armarios-frigorificos', label: 'Armarios frigoríficos', category: 'linea-fria' },
  { id: 'mesas-refrigeradas', label: 'Mesas refrigeradas', category: 'linea-fria' },
  { id: 'vitrinas-refrigeradas', label: 'Vitrinas refrigeradas', category: 'linea-fria' },
  { id: 'dispensadores-jugo', label: 'Dispensadores de jugos', category: 'linea-fria' },
  { id: 'cremoladeras', label: 'Cremoladeras', category: 'linea-fria' },
  { id: 'helado-artesanal', label: 'Helado artesanal', category: 'linea-fria' },
  { id: 'helado-soft', label: 'Helado soft', category: 'linea-fria' },
  { id: 'extractores-naranja', label: 'Extractores de naranja', category: 'linea-fria' },
  { id: 'abatidores', label: 'Abatidores de temperatura', category: 'linea-fria' },
  { id: 'congeladoras', label: 'Congeladoras', category: 'linea-fria' },
  { id: 'cocinas-lineales', label: 'Cocinas lineales', category: 'linea-caliente' },
  { id: 'cocinas-centrales', label: 'Cocinas centrales', category: 'linea-caliente' },
  { id: 'cocinas-empotradas', label: 'Cocinas empotradas', category: 'linea-caliente' },
  { id: 'cocinas-casa', label: 'Cocinas de casa', category: 'linea-caliente' },
  { id: 'cocinas', label: 'Cocinas industriales', category: 'linea-caliente' },
  { id: 'hornos-polleros', label: 'Hornos polleros', category: 'linea-caliente' },
  { id: 'hornos-pizza', label: 'Hornos para pizza', category: 'linea-caliente' },
  { id: 'hornos-multiuso', label: 'Hornos multiuso', category: 'linea-caliente' },
  { id: 'hornos', label: 'Otros hornos', category: 'linea-caliente' },
  { id: 'parrillas', label: 'Parrillas y planchas', category: 'linea-caliente' },
  { id: 'freidoras', label: 'Freidoras', category: 'linea-caliente' },
  { id: 'carritos-comida', label: 'Carritos salchipaperos', category: 'linea-caliente' },
  { id: 'cajas-chinas', label: 'Cajas chinas', category: 'linea-caliente' },
  { id: 'tavolas', label: 'Távolas calientes', category: 'linea-caliente' },
  { id: 'lavaderos', label: 'Lavaderos y lavatorios', category: 'linea-neutra' },
  { id: 'licuadoras', label: 'Licuadoras industriales', category: 'linea-neutra' },
  { id: 'envasadoras-vacio', label: 'Envasadoras al vacío', category: 'linea-neutra' },
  { id: 'batidoras', label: 'Batidoras', category: 'linea-neutra' },
  { id: 'amasadoras', label: 'Amasadoras', category: 'linea-neutra' },
  { id: 'estantes', label: 'Estantes', category: 'mobiliario' },
  { id: 'mesas-trabajo', label: 'Mesas de trabajo', category: 'mobiliario' },
  { id: 'estaciones-bartender', label: 'Estaciones bartender', category: 'mobiliario' },
  { id: 'linea-fria-otros', label: 'Otros equipos de frío', category: 'linea-fria' },
  { id: 'linea-caliente-otros', label: 'Otros equipos de cocción', category: 'linea-caliente' },
  { id: 'linea-neutra-otros', label: 'Otros equipos de preparación', category: 'linea-neutra' },
  { id: 'mobiliario-otros', label: 'Otros muebles', category: 'mobiliario' },
];

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function catalogTypeById(id: string, category?: string): CatalogType | undefined {
  return catalogTypes.find(type => type.id === id && (!category || type.category === category));
}

/** Match the product identity/name, not its features (an oven in a cooker is still a cooker). */
export function getCatalogType(product: TypedProduct): CatalogType | null {
  const category = normalizeCategory(product.category);
  if (!category) return null;
  const name = fold(product.name || '');
  const family = fold(product.equipmentFamily || '');
  let id = `${category}-otros`;
  if (category === 'linea-fria') {
    if (/dispensador.*jugo/.test(name) || family === 'dispensadores-jugo') id = 'dispensadores-jugo';
    else if (/cremol/.test(name) || family === 'cremoladeras') id = 'cremoladeras';
    else if (/helado.*soft/.test(name)) id = 'helado-soft';
    else if (/helado.*artesanal/.test(name)) id = 'helado-artesanal';
    else if (/extractor.*naranja/.test(name) || family === 'extractores-naranja') id = 'extractores-naranja';
    else if (/abatidor/.test(name)) id = 'abatidores';
    else if (/congelador/.test(name)) id = 'congeladoras';
    else if (/vitrina/.test(name)) id = 'vitrinas-refrigeradas';
    else if (/mesa/.test(name)) id = 'mesas-refrigeradas';
    else if (/armario|camara.*frigor|refrigerador/.test(name)) id = 'armarios-frigorificos';
  } else if (category === 'linea-caliente') {
    if (/carrito|modulo de comida/.test(name) || family === 'carritos-comida') id = 'carritos-comida';
    else if (/tavola|mesa caliente/.test(name)) id = 'tavolas';
    else if (/cocina/.test(name) || family === 'cocinas') {
      id = /empotr/.test(name) ? 'cocinas-empotradas' : /central|isla/.test(name) ? 'cocinas-centrales'
        : /casa|semiindustrial|semi-industrial/.test(name) ? 'cocinas-casa' : /lineal/.test(name) ? 'cocinas-lineales' : 'cocinas';
    } else if (/horno/.test(name)) {
      id = /pollo|pollero/.test(name) ? 'hornos-polleros' : /pizza/.test(name) ? 'hornos-pizza' : /multiuso/.test(name) ? 'hornos-multiuso' : 'hornos';
    } else if (/freidora/.test(name)) id = 'freidoras';
    else if (/caja china/.test(name)) id = 'cajas-chinas';
    else if (/parrilla|plancha/.test(name)) id = 'parrillas';
  } else if (category === 'linea-neutra') {
    if (/lavadero|lavatorio/.test(name)) id = 'lavaderos';
    else if (/licuadora/.test(name)) id = 'licuadoras';
    else if (/envasad.*vacio/.test(name) || family === 'envasadoras-vacio') id = 'envasadoras-vacio';
    else if (/batidora/.test(name) || family === 'batidoras') id = 'batidoras';
    else if (/amasadora/.test(name) || family === 'amasadoras') id = 'amasadoras';
  } else {
    if (/bartender/.test(name)) id = 'estaciones-bartender';
    else if (/estante|estanteria/.test(name)) id = 'estantes';
    else if (/mesa/.test(name)) id = 'mesas-trabajo';
  }
  return catalogTypeById(id, category) || null;
}
