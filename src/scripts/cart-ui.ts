import { cartQuoteSummary, initialCartSelection, validateCartSelection, moveCartModule, toggleCartModule, reconcileCartSelection, type CartConfig, type CartSelection, type CartModuleId } from '../lib/cart-config.ts';
import { cartAssetFor } from '../lib/cart-assets.ts';

type View = { productId: string; key: string; config: CartConfig; selection: CartSelection; armed: CartModuleId | null; past: CartSelection[]; future: CartSelection[]; changed: (summary: string) => void; refresh: () => void; pick?: (index: number) => void };
const views = new WeakMap<HTMLElement, View>();
const copy = (value: CartSelection): CartSelection => ({ included: [...value.included], order: [...value.order] });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
export function readCart(root: HTMLElement | null, productId: string) {
  const view = root ? views.get(root) : null;
  return view?.productId === productId ? { config: view.config, selection: copy(view.selection), activePosition: view.armed ? view.selection.order.indexOf(view.armed) : null } : null;
}
export function pickCartPosition(root: HTMLElement | null, productId: string, position: number) {
  const view = root ? views.get(root) : undefined;
  if (view?.productId === productId && Number.isInteger(position) && position >= 0 && position < 4) view.pick?.(position);
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
    selection = reconcileCartSelection(config, previous.config, previous.selection);
    preserved = true;
  }
  const history = (values: CartSelection[]) => values.flatMap(value => { try { return [validateCartSelection(config, value)]; } catch { return []; } });
  const view: View = { productId, key, config, selection, armed: previous?.armed || null, past: preserved ? history(previous!.past) : [], future: preserved ? history(previous!.future) : [], changed: onChange, refresh: () => {} };
  views.set(root, view); root.hidden = false;
  const title = el('h2', 'Arma tu carrito');
  const intro = el('p', 'Elige el equipamiento y acomódalo a tu manera. Pulsa Mover en un equipo y después toca su nueva posición, aquí o en el 3D. Si hay otro equipo, intercambian lugares.');
  const distribution = el('div'); distribution.className = 'cart-distribution';
  const board = el('div'); board.className = 'cart-layout'; board.setAttribute('role', 'group'); board.setAttribute('aria-label', 'Distribución del carrito, mirando el frente');
  distribution.append(el('h3', 'Distribución de izquierda a derecha'), el('p', 'Mirando el frente del carrito. Cada equipo conserva su espacio; no se enciman las piezas.'), board);
  const positions: { button: HTMLButtonElement; name: HTMLElement }[] = [];
  const options = el('fieldset'); options.className = 'cart-options'; options.append(el('legend', 'Equipamiento del carrito'));
  const checks = new Map<CartModuleId, { input: HTMLInputElement; hint: HTMLElement; move: HTMLButtonElement; position: HTMLSelectElement }>();
  const status = el('p'); status.className = 'cart-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const actions = el('div'); actions.className = 'cart-actions';
  const action = (label: string, fn: () => void) => { const button = el('button', label); button.type = 'button'; button.onclick = fn; actions.append(button); return button; };
  const apply = (next: CartSelection, message: string) => {
    next = validateCartSelection(config, next);
    if (JSON.stringify(next) === JSON.stringify(view.selection)) return;
    view.past.push(copy(view.selection)); view.past = view.past.slice(-30); view.future = [];
    view.selection = next; status.textContent = message; view.refresh(); emit(true);
  };
  const labelFor = (id: CartModuleId) => config.modules.find(module => module.id === id)?.label || 'Superficie de trabajo';
  const focus = () => document.dispatchEvent(new CustomEvent('inox:cart-focus', { detail: { productId, position: view.armed ? view.selection.order.indexOf(view.armed) : null } }));
  const arm = (id: CartModuleId) => {
    if (!view.selection.included.includes(id)) return;
    view.armed = id; status.textContent = `Mover ${labelFor(id)}: elige una de las cuatro posiciones, en el esquema o en el 3D.`;
    view.refresh(); focus(); emit(true);
  };
  const move = (id: CartModuleId, index: number) => {
    if (!view.selection.included.includes(id)) return;
    const occupied = view.selection.order[index];
    const next = moveCartModule(config, view.selection, id, index);
    view.armed = id;
    apply(next, `${labelFor(id)} ahora está en la posición ${index + 1}.${occupied !== id && view.selection.included.includes(occupied) ? ` Intercambió lugar con ${labelFor(occupied)}.` : ''}`);
    view.refresh(); focus();
  };
  view.pick = index => {
    if (view.armed) move(view.armed, index);
    else {
      const id = view.selection.order[index];
      if (view.selection.included.includes(id)) arm(id);
      else status.textContent = 'Primero pulsa Mover en el equipo que quieres colocar en este espacio.';
    }
  };
  for (let index = 0; index < 4; index++) {
    const button = el('button'); button.type = 'button'; button.dataset.cartPosition = String(index);
    const number = el('small', `Posición ${index + 1}`), name = el('strong'); button.append(number, name);
    button.onclick = () => view.pick?.(index); board.append(button); positions.push({ button, name });
  }
  for (const module of config.modules) {
    const card = el('div'); card.className = 'cart-option';
    const label = el('label'); label.className = 'cart-check';
    const input = el('input'); input.type = 'checkbox'; input.value = module.id; input.dataset.cartModule = module.id; input.setAttribute('aria-label', module.label);
    const body = el('span'), name = el('strong', module.label), hint = el('small'); body.append(name, hint); label.append(input, body); card.append(label);
    const tools = el('div'); tools.className = 'cart-module-tools';
    const moveButton = el('button', 'Mover'); moveButton.type = 'button'; moveButton.dataset.cartArm = module.id; moveButton.setAttribute('aria-label', `Mover ${module.label}`); moveButton.onclick = () => arm(module.id);
    const position = el('select'); position.dataset.cartPositionSelect = module.id; position.setAttribute('aria-label', `Posición de ${module.label}`);
    for (let index = 0; index < 4; index++) { const option = el('option', `Posición ${index + 1}`); option.value = String(index); position.append(option); }
    position.onchange = () => move(module.id, Number(position.value)); tools.append(moveButton, position); card.append(tools); options.append(card); checks.set(module.id, { input, hint, move: moveButton, position });
    input.onchange = () => apply(toggleCartModule(config, view.selection, module.id, input.checked), input.checked ? `${module.label}: incluido en la posición ${view.selection.order.indexOf(module.id) + 1}.` : `${module.label}: reemplazado por superficie de trabajo.`);
  }
  const undo = action('Deshacer', () => { const next = view.past.pop(); if (!next) return; view.future.push(copy(view.selection)); view.selection = next; status.textContent = 'Cambio deshecho.'; view.refresh(); emit(true); });
  const redo = action('Rehacer', () => { const next = view.future.pop(); if (!next) return; view.past.push(copy(view.selection)); view.selection = next; status.textContent = 'Cambio recuperado.'; view.refresh(); emit(true); });
  action('Restablecer', () => apply(initialCartSelection(config), 'Restablecimos el equipamiento principal.'));
  const previewButton = action('Ver mi carrito en 3D', () => emit(true)); previewButton.dataset.cartPreview = '';
  const note = el('p', 'Configuración a cotizar. La foto muestra el equipo de referencia; medidas, conexiones y fabricación se confirman con el taller.');
  view.refresh = () => {
    if (view.armed && !view.selection.included.includes(view.armed)) view.armed = null;
    for (const [id, { input, hint, move, position }] of checks) {
      input.checked = view.selection.included.includes(id); const index = view.selection.order.indexOf(id);
      hint.textContent = input.checked ? `Incluido · posición ${index + 1}` : 'Sin incluir';
      move.disabled = !input.checked; move.setAttribute('aria-pressed', String(view.armed === id)); position.disabled = !input.checked; position.value = String(index);
    }
    positions.forEach(({ button, name }, index) => {
      const id = view.selection.order[index]; name.textContent = view.selection.included.includes(id) ? labelFor(id) : 'Superficie de trabajo';
      button.setAttribute('aria-label', `Posición ${index + 1}: ${name.textContent}`); button.setAttribute('aria-pressed', String(view.armed === id));
    });
    undo.disabled = !view.past.length; redo.disabled = !view.future.length;
    root.dataset.cartIncluded = view.selection.included.join(',');
    root.dataset.cartOrder = view.selection.order.join(',');
    view.changed(cartQuoteSummary(config, view.selection));
  };
  root.replaceChildren(title, intro, distribution, options, actions, status, note);
  if (previous) status.textContent = 'El taller actualizó las opciones. Conservamos tus elecciones compatibles.';
  view.refresh(); emit(false);
}
