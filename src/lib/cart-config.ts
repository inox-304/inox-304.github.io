export const CART_MODULE_IDS = ['broastera', 'freidora', 'conservadora', 'plancha'] as const;
export type CartModuleId = typeof CART_MODULE_IDS[number];
export type CartConfig = { version: 1; enabled: boolean; modules: { id: CartModuleId; label: string; defaultIncluded: boolean }[] };
export type CartSelection = { included: CartModuleId[]; order: CartModuleId[] };

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
  return { included: config.modules.filter(item => item.defaultIncluded).map(item => item.id), order: [...CART_MODULE_IDS] };
}
export function validateCartSelection(config: CartConfig, value: unknown): CartSelection {
  // Older links and clients omitted order; they keep the original photographed layout.
  const hasOrder = value !== null && typeof value === 'object' && Object.hasOwn(value, 'order');
  const selection = record(value, hasOrder ? ['included', 'order'] : ['included']);
  if (!Array.isArray(selection.included) || selection.included.length > 4 || new Set(selection.included).size !== selection.included.length || selection.included.some(id => !config.modules.some(item => item.id === id))) throw new Error('Esta opción no está autorizada para el carrito.');
  const order = hasOrder ? selection.order : CART_MODULE_IDS;
  if (!Array.isArray(order) || order.length !== CART_MODULE_IDS.length || new Set(order).size !== CART_MODULE_IDS.length || order.some(id => !CART_MODULE_IDS.includes(id))) throw new Error('Cada posición debe contener una estación del carrito, sin repetirla.');
  return { included: config.modules.filter(item => (selection.included as unknown[]).includes(item.id)).map(item => item.id), order: [...order] };
}

/** Swapping complete stations keeps every module's footprint and never creates overlap. */
export function moveCartModule(config: CartConfig, value: unknown, moduleId: CartModuleId, targetIndex: number): CartSelection {
  const selection = validateCartSelection(config, value);
  if (!config.modules.some(item => item.id === moduleId) || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= CART_MODULE_IDS.length) throw new Error('Elige una estación y una posición disponibles para el carrito.');
  const sourceIndex = selection.order.indexOf(moduleId);
  [selection.order[sourceIndex], selection.order[targetIndex]] = [selection.order[targetIndex], selection.order[sourceIndex]];
  return selection;
}

export function toggleCartModule(config: CartConfig, value: unknown, moduleId: CartModuleId, included: boolean): CartSelection {
  const selection = validateCartSelection(config, value);
  if (!config.modules.some(item => item.id === moduleId) || typeof included !== 'boolean') throw new Error('Esta opción no está autorizada para el carrito.');
  return { included: config.modules.filter(item => item.id === moduleId ? included : selection.included.includes(item.id)).map(item => item.id), order: selection.order };
}

/** An owner update removes revoked equipment, adds approved defaults, and keeps its arrangement. */
export function reconcileCartSelection(config: CartConfig, previousConfig: CartConfig, value: unknown): CartSelection {
  const selection = validateCartSelection(previousConfig, value);
  return { included: config.modules.filter(item => previousConfig.modules.some(prior => prior.id === item.id) ? selection.included.includes(item.id) : item.defaultIncluded).map(item => item.id), order: selection.order };
}
export function cartQuoteSummary(config: CartConfig, selection: CartSelection): string {
  const chosen = validateCartSelection(config, selection);
  const ids = new Set(chosen.included);
  const included = chosen.order.filter(id => ids.has(id)).map(id => config.modules.find(item => item.id === id)!.label);
  const omitted = config.modules.filter(item => !ids.has(item.id)).map(item => item.label);
  const positions = chosen.order.map((id, index) => `• Posición ${index + 1}: ${ids.has(id) ? config.modules.find(item => item.id === id)!.label : 'Superficie de trabajo'}.`);
  return `\nCarrito personalizado:\nEquipamiento: ${included.join(', ') || 'sin módulos de cocción / conservación'}.${omitted.length ? `\nSuperficie de trabajo en lugar de: ${omitted.join(', ')}.` : ''}\nDistribución de izquierda a derecha (mirando el frente):\n${positions.join('\n')}\nDistribución ilustrativa; medidas, conexiones y precio por confirmar con el taller.`;
}
