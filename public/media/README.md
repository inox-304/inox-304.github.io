# Hero media

- `hero-clean.mp4`: cropped and trimmed derivative of the user-supplied `anima_esto_sera_el_hero_para.mp4`, not a newly generated video. Original interval 2.50–7.25 seconds; crop `1120:630:0:80`; playback speed 80%; 0.5-second crossfade around the loop; 24 fps; H.264; no audio; fast-start metadata.
- `hero-poster.jpg`: frame at original source timestamp 6.00 seconds with the same crop.

The crop removes the original navigation and right-side icons. The selected interval excludes the embedded headline and final logo. The clip retains the source's generated product transformations and must be treated as illustrative campaign artwork, not exact product documentation. Replace it with verified product media when available.

Use a muted, inline, looping player with the poster as fallback. Respect `prefers-reduced-motion` by showing the poster instead. The desktop clip retains full products; a separately composed vertical asset is preferable to aggressive `object-fit: cover` cropping on mobile.

## Responsive versions (2026-11-02)

- `hero-mobile.mp4` and `hero-mobile-poster.jpg`: 720 × 1280 (9:16), with quiet texture above the equipment for the mobile heading and controls.
- `hero-tablet.mp4` and `hero-tablet-poster.jpg`: 960 × 720 (4:3), reframed around the complete equipment.
- Both are edits of `hero-clean.mp4` made with Higgsfield's media-processing tools, **not new AI generations**. They retain the original roughly 5.4-second movement, with deep-blue color grading baked into the files. H.264/yuv420p, 24 fps, no audio, fast-start metadata; each video is under 800 KB.
- The responsive player chooses one source at a time (mobile ≤600 px, tablet ≤1100 px, desktop above). It preserves manual pause across viewport changes and keeps video downloads deferred for reduced motion or data saving until the visitor presses play. Do not apply the desktop color filter to the already graded mobile/tablet files.
- These files are served with the site; playback does not require a Higgsfield account, connection, or subscription. The same illustrative-media limitations above apply.
