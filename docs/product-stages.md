# Product display stages

The product detail stage uses the empty `stone-texture.webp` room and a separate rectangular Carrara marble pedestal. Its width follows each equipment silhouette. A fixed square stage keeps the equipment and its support aligned across desktop, tablet and mobile.

The 21 transparent catalog assets retain their original pixels. `src/data/product-image-bounds.ts` records their visible alpha bounds (threshold 16). `src/lib/product-stage.ts` uses those bounds to remove uneven transparent margins in CSS, preserve proportions, and align the visible base with the pedestal surface. Unknown CMS images use their natural dimensions once loaded; original JPEG photographs keep the existing photo presentation.

Validation: `node scripts/test-product-stage.mjs` checks all authored bounds, equipment containment, aspect ratios, deployment prefixes and replacement images.

## Generated pedestal asset

- Mode: new image generation, transparent background, no reference images.
- Production file: `public/images/brand/marble-plinth.webp`.
- Original generation size: 1916 × 821. Converted to WebP with alpha preserved. CSS crops the transparent margins; the top and front faces scale with the product support.
- Prompt:

> Use case: product-mockup. Create one high-quality photorealistic asset for a premium stainless-steel equipment catalog: an EMPTY low rectangular display plinth made of white Carrara marble with restrained fine charcoal-gray veins, isolated on a genuinely transparent alpha background. NOT a complete scene. There must be ONLY the marble pedestal and a subtle soft shadow immediately beneath it; absolutely no room, backdrop, floor plane, appliance, props, text, logo or watermark. Shape is a broad rectangular cuboid with perfectly straight front edge and square corners, not circular or oval. Camera precisely front centered, no sideways rotation, slightly above top surface so we see a trapezoidal top plane, with rear left and rear right corners inset symmetrically. Broad display top suitable to carry an industrial three-burner table cooker. Low block about 180 cm wide x 95 cm deep x 12 cm thick; approximate projected silhouette width-to-total-height ratio 4.2:1. Full block visible, tightly framed with minimal even transparent margins. Main soft light from high center above, ivory warm top, cool gray front face, realistic polished marble, calm restrained veining rather than very dark web of cracks. Straight front edge horizontally aligned, very slight bevel only. Transparent asset, landscape canvas, no white background or checkerboard painted in.
