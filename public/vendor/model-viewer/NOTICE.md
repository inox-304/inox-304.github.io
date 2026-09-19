# Local 3D decoders

These unmodified runtime files were copied from `three@0.183.2`, resolved by the lockfile for `@google/model-viewer@4.3.1`.

- `draco/`: Google Draco decoder and WebAssembly wrapper, Apache-2.0. Source: https://github.com/google/draco
- `basis/`: Basis Universal transcoder and WebAssembly binary, Apache-2.0. Source: https://github.com/BinomialLLC/basis_universal

License texts are included beside this notice. These assets are loaded only when an opened GLB requires the corresponding compression. The viewer library itself is bundled from npm by Vite and dynamically imported after the user selects the 360° view. No CDN script is required.

When updating the dependency, review and refresh these files from the matching Three.js package; do not edit their generated contents manually.
