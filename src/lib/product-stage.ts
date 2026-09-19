import { productImageBounds } from '../data/product-image-bounds.ts';

type Dimensions = { width: number; height: number };
export type ProductStageProfile = {
  isCutout: boolean;
  shape: 'wide' | 'square' | 'tall';
  style: string;
  width: number;
  height: number;
};

function imagePath(image: string) {
  try { return new URL(image, 'https://product-stage.invalid').pathname; }
  catch { return ''; }
}

function validDimensions(value?: Dimensions): value is Dimensions {
  return !!value && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0;
}

/** Use asset-specific alpha bounds, then actual image dimensions for CMS replacements. */
export function getProductStage(image: string, natural?: Dimensions): ProductStageProfile {
  const pathname = imagePath(image);
  const isCutout = /\.(?:webp|png)$/i.test(pathname);
  const local = image.startsWith('/') && !image.startsWith('//');
  const assetPath = local ? pathname.match(/\/images\/products\/[^/]+$/)?.[0] : undefined;
  const authored = assetPath ? productImageBounds[assetPath] : undefined;
  const actual = validDimensions(natural) ? natural : undefined;
  const dimensions = actual || authored || { width: 800, height: 800 };
  // A CMS replacement at the same local URL must not inherit obsolete crop geometry.
  const matchingAsset = authored && (!actual || (actual.width === authored.width && actual.height === authored.height));
  const bounds = isCutout && matchingAsset ? authored.bounds : { x: 0, y: 0, ...dimensions };
  const ratio = bounds.width / bounds.height;
  const equipmentWidth = Math.min(76, 66 * ratio);
  const values: Record<string, number> = {
    '--equipment-width': equipmentWidth,
    '--equipment-height': equipmentWidth / ratio,
    '--pedestal-width': Math.max(46, equipmentWidth + 14),
    '--image-left': -bounds.x / bounds.width * 100,
    '--image-top': -bounds.y / bounds.height * 100,
    '--image-width': dimensions.width / bounds.width * 100,
    '--image-height': dimensions.height / bounds.height * 100,
  };
  return {
    isCutout,
    shape: ratio > 1.2 ? 'wide' : ratio < .8 ? 'tall' : 'square',
    style: Object.entries(values).map(([name, value]) => `${name}:${Number(value.toFixed(6))}%`).join(';'),
    width: dimensions.width,
    height: dimensions.height,
  };
}
