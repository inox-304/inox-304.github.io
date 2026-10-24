import type { CmsVariant, CmsVariantAxis } from './cms.ts';

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('Invalid variant options object');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error('Invalid variant option ID');
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > 120 || /[\u0000-\u001f\ud800-\udfff]/u.test(value)) throw new Error('Invalid variant option label');
  return value.trim();
}
function unique(ids: string[]) { if (new Set(ids).size !== ids.length) throw new Error('Duplicate variant options'); }

export function parseVariantAxes(value: unknown = []): CmsVariantAxis[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error('Invalid variant axes');
  const axes = value.map(raw => {
    const axis = object(raw, ['id', 'label', 'options']);
    if (!Array.isArray(axis.options) || axis.options.length < 1 || axis.options.length > 10) throw new Error('Invalid variant options');
    const options = axis.options.map(raw => { const option = object(raw, ['id', 'label']); return { id: identifier(option.id), label: label(option.label) }; });
    unique(options.map(option => option.id));
    return { id: identifier(axis.id), label: label(axis.label), options };
  });
  unique(axes.map(axis => axis.id));
  return axes;
}

/** Public variations must be complete and belong exclusively to this product. */
export function parseOptionValues(axes: CmsVariantAxis[], value: unknown = {}): Record<string, string> {
  const raw = object(value, axes.map(axis => axis.id));
  return Object.fromEntries(axes.map(axis => {
    const selected = raw[axis.id];
    if (typeof selected !== 'string' || !axis.options.some(option => option.id === selected)) throw new Error('Unauthorized variant option');
    return [axis.id, selected];
  }));
}

export function validateVariantCombinations(axes: CmsVariantAxis[], variants: CmsVariant[]): void {
  if (!axes.length) return;
  unique(variants.map(variant => {
    const values = parseOptionValues(axes, variant.optionValues);
    return JSON.stringify(axes.map(axis => values[axis.id]));
  }));
}

/** Select an existing combination, preserving as many other choices as possible. */
export function chooseVariant(axes: CmsVariantAxis[], variants: CmsVariant[], current: CmsVariant | undefined, axisId: string, optionId: string): CmsVariant | undefined {
  if (!axes.some(axis => axis.id === axisId && axis.options.some(option => option.id === optionId))) return undefined;
  return variants.filter(variant => variant.optionValues?.[axisId] === optionId)
    .map((variant, index) => ({ variant, index, score: axes.filter(axis => axis.id !== axisId && current?.optionValues?.[axis.id] === variant.optionValues?.[axis.id]).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.variant;
}
