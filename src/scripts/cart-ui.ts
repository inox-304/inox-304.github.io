import { cartQuoteSummary, initialCartSelection, validateCartSelection, type CartConfig, type CartSelection } from '../lib/cart-config.ts';
import { cartAssetFor } from '../lib/cart-assets.ts';

type View = { productId: string; key: string; config: CartConfig; selection: CartSelection; past: CartSelection[]; future: CartSelection[]; changed: (summary: string) => void; refresh: () => void };
const views = new WeakMap<HTMLElement, View>();
const copy = (value: CartSelection): CartSelection => ({ included: [...value.included] });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
export function readCart(root: HTMLElement | null, productId: string) {
  const view = root ? views.get(root) : null;
  return view?.productId === productId ? { config: view.config, selection: copy(view.selection) } : null;
}

/** Product-bound state survives network confirmation, slow requests and renderer retries. */
export function renderCart(root: HTMLElement, config: CartConfig | null, productId: string, onChange: (summary: string) => void, model3d = '', preview = false) {
  const emit = (interactive: boolean) => document.dispatchEvent(new CustomEvent('inox:cart-updated', { detail: { productId, interactive } }));
  if (!config || (!config.enabled && !preview) || !cartAssetFor(productId, model3d)) {
    views.delete(root); root.hidden = true; root.replaceChildren(); onChange(''); emit(false); return;
  }
  const key = `${productId}:${JSON.stringify(config)}`;
  const old = views.get(root);
  if (old?.key === key) { old.changed = onChange; old.changed(cartQuoteSummary(old.config, old.selection)); return; }
  const previous = old?.productId === productId ? old : null;
  let selection = initialCartSelection(config);
  let preserved = false;
  if (previous) {
    // Remove only options the owner actually revoked; keep the customer's other choices.
    selection = { included: config.modules.filter(item => previous.config.modules.some(prior => prior.id === item.id) ? previous.selection.included.includes(item.id) : item.defaultIncluded).map(item => item.id) };
    preserved = true;
  }
  const history = (values: CartSelection[]) => values.flatMap(value => { try { return [validateCartSelection(config, value)]; } catch { return []; } });
  const view: View = { productId, key, config, selection, past: preserved ? history(previous!.past) : [], future: preserved ? history(previous!.future) : [], changed: onChange, refresh: () => {} };
  views.set(root, view); root.hidden = false;
  const title = el('h2', 'Arma tu carrito');
  const intro = el('p', 'Elige qué equipos incluir. Al quitar uno, su espacio se convierte en una superficie de trabajo. Los cambios se ven al instante en el 3D.');
  const options = el('fieldset'); options.className = 'cart-options'; options.append(el('legend', 'Equipamiento del carrito'));
  const checks = new Map<string, { input: HTMLInputElement; hint: HTMLElement }>();
  const status = el('p'); status.className = 'cart-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const actions = el('div'); actions.className = 'cart-actions';
  const action = (label: string, fn: () => void) => { const button = el('button', label); button.type = 'button'; button.onclick = fn; actions.append(button); return button; };
  const apply = (next: CartSelection, message: string) => {
    next = validateCartSelection(config, next);
    if (JSON.stringify(next) === JSON.stringify(view.selection)) return;
    view.past.push(copy(view.selection)); view.past = view.past.slice(-30); view.future = [];
    view.selection = next; status.textContent = message; view.refresh(); emit(true);
  };
  for (const module of config.modules) {
    const label = el('label'); label.className = 'cart-option';
    const input = el('input'); input.type = 'checkbox'; input.value = module.id; input.dataset.cartModule = module.id; input.setAttribute('aria-label', module.label);
    const body = el('span'), name = el('strong', module.label), hint = el('small'); body.append(name, hint); label.append(input, body); options.append(label); checks.set(module.id, { input, hint });
    input.onchange = () => apply({ included: config.modules.filter(item => item.id === module.id ? input.checked : view.selection.included.includes(item.id)).map(item => item.id) }, input.checked ? `${module.label}: incluido en tu carrito.` : `${module.label}: reemplazado por superficie de trabajo.`);
  }
  const undo = action('Deshacer', () => { const next = view.past.pop(); if (!next) return; view.future.push(copy(view.selection)); view.selection = next; status.textContent = 'Cambio deshecho.'; view.refresh(); emit(true); });
  const redo = action('Rehacer', () => { const next = view.future.pop(); if (!next) return; view.past.push(copy(view.selection)); view.selection = next; status.textContent = 'Cambio recuperado.'; view.refresh(); emit(true); });
  action('Restablecer', () => apply(initialCartSelection(config), 'Restablecimos el equipamiento principal.'));
  const previewButton = action('Ver mi carrito en 3D', () => emit(true)); previewButton.dataset.cartPreview = '';
  const note = el('p', 'Configuración a cotizar. La foto muestra el equipo de referencia; medidas, conexiones y fabricación se confirman con el taller.');
  view.refresh = () => {
    for (const [id, { input, hint }] of checks) { input.checked = view.selection.included.some(value => value === id); hint.textContent = input.checked ? 'Incluido' : 'Superficie de trabajo'; }
    undo.disabled = !view.past.length; redo.disabled = !view.future.length;
    root.dataset.cartIncluded = view.selection.included.join(',');
    view.changed(cartQuoteSummary(config, view.selection));
  };
  root.replaceChildren(title, intro, options, actions, status, note);
  if (previous) status.textContent = 'El taller actualizó las opciones. Conservamos tus elecciones compatibles.';
  view.refresh(); emit(false);
}
