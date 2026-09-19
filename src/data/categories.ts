export const categories = [
  { id: 'linea-fria', name: 'Línea fría', shortName: 'Línea fría' },
  { id: 'linea-caliente', name: 'Línea caliente', shortName: 'Línea caliente' },
  { id: 'linea-neutra', name: 'Línea neutra', shortName: 'Línea neutra' },
  { id: 'mobiliario', name: 'Mobiliario', shortName: 'Mobiliario' },
] as const;

export type ProductCategory = (typeof categories)[number]['id'];

// Keep existing links and spreadsheets compatible with the four product lines.
const aliases: Record<string, ProductCategory> = {
  'linea-fria': 'linea-fria', fria: 'linea-fria', refrigeracion: 'linea-fria',
  'linea-caliente': 'linea-caliente', caliente: 'linea-caliente', coccion: 'linea-caliente', fritura: 'linea-caliente',
  'fritura-y-comida-rapida': 'linea-caliente',
  'linea-neutra': 'linea-neutra', neutra: 'linea-neutra', lavado: 'linea-neutra', preparacion: 'linea-neutra',
  'equipos-de-preparacion': 'linea-neutra', mobiliario: 'mobiliario',
};

export function normalizeCategory(value: unknown): ProductCategory | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined;
}
