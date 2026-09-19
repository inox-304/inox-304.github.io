# Hero media

- `hero-clean.mp4`: cropped and trimmed derivative of the user-supplied `anima_esto_sera_el_hero_para.mp4`, not a newly generated video. Original interval 2.50–7.25 seconds; crop `1120:630:0:80`; playback speed 80%; 0.5-second crossfade around the loop; 24 fps; H.264; no audio; fast-start metadata.
- `hero-poster.jpg`: frame at original source timestamp 6.00 seconds with the same crop.

The crop removes the original navigation and right-side icons. The selected interval excludes the embedded headline and final logo. The clip retains the source's generated product transformations and must be treated as illustrative campaign artwork, not exact product documentation. Replace it with verified product media when available.

Use a muted, inline, looping player with the poster as fallback. Respect `prefers-reduced-motion` by showing the poster instead. The desktop clip retains full products; a separately composed vertical asset is preferable to aggressive `object-fit: cover` cropping on mobile.
