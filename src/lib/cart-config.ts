export const CART_MODULE_IDS = ['broastera', 'freidora', 'conservadora', 'plancha'] as const;
export type CartModuleId = typeof CART_MODULE_IDS[number];
export type CartConfig = { version: 1; enabled: boolean; modules: { id: CartModuleId; label: string; defaultIncluded: boolean }[] };
export type CartSelection = { included: CartModuleId[] };

function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Configuración de carrito incompleta.');
  return value as Record<string, unknown>;
}
export function parseCartConfig(value: unknown): CartConfig | null {
  if (value == null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return null;
  const data = record(value, ['version', 'enabled', 'modules']);
  if (data.version !== 1 || typeof data.enabled !== 'boolean' || !Array.isArray(data.modules) || !data.modules.length || data.modules.length > 4) throw new Error('Configuración de carrito inválida.');
  const modules = data.modules.map(value => {
    const item = record(value, ['id', 'label', 'defaultIncluded']);
    if (!CART_MODULE_IDS.includes(item.id as CartModuleId) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80 || /[\u0000-\u001f\u007f]/.test(item.label) || typeof item.defaultIncluded !== 'boolean') throw new Error('Equipamiento del carrito inválido.');
    return { id: item.id as CartModuleId, label: item.label.trim(), defaultIncluded: item.defaultIncluded };
  });
  if (new Set(modules.map(item => item.id)).size !== modules.length) throw new Error('Equipamiento repetido.');
  return { version: 1, enabled: data.enabled, modules };
}
export function initialCartSelection(config: CartConfig): CartSelection {
  return { included: config.modules.filter(item => item.defaultIncluded).map(item => item.id) };
}
export function validateCartSelection(config: CartConfig, value: unknown): CartSelection {
  const selection = record(value, ['included']);
  if (!Array.isArray(selection.included) || selection.included.length > 4 || new Set(selection.included).size !== selection.included.length || selection.included.some(id => !config.modules.some(item => item.id === id))) throw new Error('Esta opción no está autorizada para el carrito.');
  return { included: config.modules.filter(item => (selection.included as unknown[]).includes(item.id)).map(item => item.id) };
}
export function cartQuoteSummary(config: CartConfig, selection: CartSelection): string {
  const ids = new Set(validateCartSelection(config, selection).included);
  const included = config.modules.filter(item => ids.has(item.id)).map(item => item.label);
  const omitted = config.modules.filter(item => !ids.has(item.id)).map(item => item.label);
  return `\nCarrito personalizado:\nEquipamiento: ${included.join(', ') || 'sin módulos de cocción / conservación'}.${omitted.length ? `\nSuperficie de trabajo en lugar de: ${omitted.join(', ')}.` : ''}\nDistribución ilustrativa; medidas, conexiones y precio por confirmar con el taller.`;
}
