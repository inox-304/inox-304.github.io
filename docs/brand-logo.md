# Blue flame logo

Source: user-provided `logo-inox-flama-azul.html` from Downloads, supplied on 2026-09-19.

`public/images/brand/inox304-flame-metal.webp` is the exact embedded transparent WebP (1400 × 560, 104,556 bytes). The earlier logo files are retained unchanged. The reference is a raster logo with a canvas effect, not a vector SVG.

`FlameLogo.astro` isolates the original visual treatment: a blue gradient and ascending noise field are clipped to the largest connected opaque component on the left, identifying the outer flame. The metallic lettering and inner snowflake remain unchanged. No iframe, exporter runtime, remote script, demonstration backdrop, or tracking code is included.

The effect runs at up to 24 frames per second, uses 700 × 280 drawing buffers, pauses while its instance is outside the viewport or the document is hidden, and remains still with `prefers-reduced-motion`. Header and footer are independent instances without shared DOM IDs. The source image remains usable if JavaScript is unavailable.

The brand asset URL is generated with `withBase`, preserving the GitHub Pages project path. The existing favicon is retained because the supplied file has no separate vector isotipo.
