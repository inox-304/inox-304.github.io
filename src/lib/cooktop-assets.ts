// Explicitly authored modular counterparts. An unrelated/newly uploaded GLB
// must never inherit another stove's chassis just because its SKU matches.
const assets: Record<string, { model: string; source: string; media: string }> = {
  P02: { model: '/models/inox/cooktop-p02-v1.glb', source: 'cocina-industrial-de-3-hornillas-v1.glb', media: 'b542d7c9-c8c4-5611-b737-062c76fdcecb' },
  P03: { model: '/models/inox/cooktop-p03-v1.glb', source: 'cocina-industrial-de-3-parrillas-v1.glb', media: '43865e50-eceb-5b9f-ad52-2a39854c7b54' },
  P04: { model: '/models/inox/cooktop-p04-v1.glb', source: 'cocina-industrial-4-hornillas-tipo-isla-plancha-ho-v2.glb', media: 'a5c077e3-be87-5d5a-9aaf-1ebcced04330' },
  P05: { model: '/models/inox/cooktop-p05-v1.glb', source: 'cocina-industrial-tipo-isla-4-parrillas-plancha-ho-v2.glb', media: '0f0fe0e2-d223-5614-bf22-85250fcd972f' },
};

export function cooktopAssetFor(productId: string, model: string): string {
  const entry = Object.hasOwn(assets, productId) ? assets[productId] : undefined;
  if (!entry) return '';
  let path: string;
  try { path = new URL(model, 'https://inox.invalid').pathname; } catch { return ''; }
  return path.endsWith(`/models/inox/${entry.source}`) || path === `/media/${entry.media}/` || path === `/admin/catalog/mediaasset/${entry.media}/file/` ? entry.model : '';
}

export function hasCooktopAsset(productId: string): boolean { return Object.hasOwn(assets, productId); }
