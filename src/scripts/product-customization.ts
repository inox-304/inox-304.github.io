type DisclosureState = { productId: string; open: boolean; detailed: boolean };
const states = new WeakMap<HTMLElement, DisclosureState>();

/** Called after the actual product controls have rendered; no inferred options. */
export function syncCustomization(detail: HTMLElement, productId: string, supplyType?: string) {
  const root = detail.querySelector<HTMLElement>('[data-product-customization]');
  const button = root?.querySelector<HTMLButtonElement>('[data-customization-toggle]');
  const panel = root?.querySelector<HTMLElement>('[data-customization-panel]');
  if (!root || !button || !panel) return;
  let state = states.get(root);
  const emit = () => document.dispatchEvent(new CustomEvent('inox:customization-visibility', {
    detail: { productId: state!.productId, open: state!.open && !root.hidden },
  }));
  const show = (open: boolean, restoreFocus = false) => {
    state!.open = open;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (restoreFocus) button.focus();
    emit();
  };
  if (!state) {
    state = { productId, open: false, detailed: false };
    states.set(root, state);
    button.addEventListener('click', () => show(!state!.open));
    root.querySelector<HTMLButtonElement>('[data-customization-close]')?.addEventListener('click', () => show(false, true));
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && state!.open) { event.preventDefault(); show(false, true); }
    });
  }
  const changedProduct = state.productId !== productId;
  state.productId = productId;
  const visible = (selector: string) => {
    const node = root.querySelector<HTMLElement>(selector);
    return !!node && !node.hidden;
  };
  const family = root.querySelector<HTMLSelectElement>('[data-product-family-select]');
  const variants = root.querySelector<HTMLSelectElement>('[data-product-variant]');
  const hasFamily = visible('[data-product-family]') && !!family && family.options.length > 1;
  const hasVariants = !!variants && variants.options.length > 1;
  const hasExtras = visible('[data-product-extras]') && !!root.querySelector('[data-product-extra-options] input');
  const hasDetailed = visible('[data-cooktop-root]') || visible('[data-cart-root]') || hasExtras;
  state.detailed = supplyType === 'manufactured' && hasDetailed;
  const available = !!productId && (hasFamily || hasVariants || hasDetailed);
  const wasAvailable = !root.hidden;
  root.hidden = !available;
  const label = root.querySelector<HTMLElement>('[data-customization-label]');
  if (label) label.textContent = state.detailed ? 'Personalizar' : 'Cambiar versión';
  const intro = root.querySelector<HTMLElement>('[data-customization-intro]');
  if (intro) intro.textContent = state.detailed
    ? 'Ajusta las opciones disponibles y revisa el resultado en el equipo.'
    : 'Elige la versión que necesitas para tu negocio.';
  const summary = root.querySelector<HTMLElement>('[data-customization-selection]');
  if (summary) {
    const variantLabel = variants?.value ? variants.selectedOptions[0]?.textContent?.trim() : '';
    const familyLabel = visible('[data-product-family]') ? root.querySelector<HTMLElement>('[data-product-family-selection]')?.textContent?.trim() : '';
    summary.textContent = variantLabel ? `Versión seleccionada: ${variantLabel}` : familyLabel || '';
    summary.hidden = !summary.textContent;
  }
  if (changedProduct || !available) {
    const focusInside = panel.contains(document.activeElement);
    show(false, focusInside && available);
    if (focusInside && !available) {
      const fallback = ['[data-product-quote]', '[data-product-inquiry]', '[data-product-category-link]']
        .map(selector => detail.querySelector<HTMLElement>(selector)).find(node => node && !node.hidden);
      fallback?.focus();
    }
  } else {
    panel.hidden = !state.open;
    button.setAttribute('aria-expanded', String(state.open));
    if (wasAvailable !== available) emit();
  }
}
