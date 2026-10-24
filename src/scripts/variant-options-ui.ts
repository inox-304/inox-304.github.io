import type { CmsProduct, CmsVariant } from '../lib/cms.ts';
import { chooseVariant } from '../lib/product-variant-options.ts';

export function renderVariantOptions(root: HTMLElement | null, product: CmsProduct, selectedId: string, onSelect: (id: string) => void): void {
  if (!root) return;
  const axes = product.variantAxes || [];
  const variants = product.variants || [];
  root.hidden = !axes.length || !variants.length;
  root.replaceChildren();
  if (root.hidden) return;
  let selected: CmsVariant = variants.find(variant => variant.id === selectedId) || variants[0];
  const legend = document.createElement('legend'); legend.textContent = 'Elige tu configuración';
  const hint = document.createElement('p'); hint.className = 'variant-options-hint'; hint.textContent = 'Cambia las opciones y explora el resultado en Ver 360°.';
  const grid = document.createElement('div'); grid.className = 'variant-options-grid';
  const status = document.createElement('p'); status.className = 'variant-options-status'; status.setAttribute('aria-live', 'polite');
  const controls = axes.map(axis => {
    const label = document.createElement('label');
    const title = document.createElement('span'); title.textContent = axis.label;
    const select = document.createElement('select'); select.dataset.variantAxis = axis.id; select.setAttribute('aria-label', axis.label);
    for (const option of axis.options) {
      const node = document.createElement('option'); node.value = option.id; node.textContent = option.label;
      node.disabled = !variants.some(variant => variant.optionValues?.[axis.id] === option.id);
      select.append(node);
    }
    select.value = selected.optionValues?.[axis.id] || '';
    select.onchange = () => {
      const next = chooseVariant(axes, variants, selected, axis.id, select.value);
      if (!next) { select.value = selected.optionValues?.[axis.id] || ''; return; }
      const adjusted = axes.some(other => other.id !== axis.id && selected.optionValues?.[other.id] !== next.optionValues?.[other.id]);
      selected = next;
      controls.forEach(control => { control.select.value = next.optionValues?.[control.axis.id] || ''; });
      status.textContent = `${adjusted ? 'Ajustamos las otras opciones a una combinación disponible. ' : ''}${next.name}`;
      onSelect(next.id);
    };
    label.append(title, select); grid.append(label);
    return { axis, select };
  });
  status.textContent = selected.name;
  root.append(legend, hint, grid, status);
}
