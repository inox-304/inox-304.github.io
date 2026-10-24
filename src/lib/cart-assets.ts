export const CART_ASSET = '/models/inox/modulo-de-comida-4-en-1-configurable-v2.glb';
/** Only the reviewed P15 geometry has the four independent station nodes. */
export function cartAssetFor(productId: string, model: string): string {
  if (productId !== 'P15' || !model) return '';
  let path = model;
  try { if (model.startsWith('https://')) path = new URL(model).pathname; } catch { return ''; }
  if (['/admin/catalog/mediaasset/cbcabe10-4d12-4850-a85b-4a1806ef1024/file/', '/admin/catalog/mediaasset/bba353ca-2e6d-43aa-b71d-af8bf5c21e84/file/'].includes(path)) return CART_ASSET;
  return [CART_ASSET, '/models/inox/modulo-de-comida-4-en-1-configurable-v1.glb', '/models/inox/modulo-de-comida-4-en-1-v1.glb', '/media/5d302554-9c6f-5523-a8f1-cf26d6fb8539/', '/media/cbcabe10-4d12-4850-a85b-4a1806ef1024/', '/media/bba353ca-2e6d-43aa-b71d-af8bf5c21e84/'].includes(path) ? CART_ASSET : '';
}
