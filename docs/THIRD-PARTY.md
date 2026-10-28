# Dependencias y avisos de terceros

## Conversión de SketchUp

- **OpenSKP 1.4.0**, de Ahsan Mehmood, licencia MIT. Fuente: [repositorio oficial del proyecto](https://github.com/iamahsanmehmood/openskp); distribución: [PyPI 1.4.0](https://pypi.org/project/openskp/1.4.0/).
- El backend fija `openskp[textures]==1.4.0` en `backend/pyproject.toml`; `backend/uv.lock` registra las versiones y hashes resueltos. Antes de actualizar, revisar las APIs de lectura e instancias y repetir las pruebas de conversión y fidelidad.
- El conversor INOX usa el lector de geometría de OpenSKP y su propio escritor GLB. No redistribuye SketchUp, el SDK de Trimble ni una instalación de Blender. OpenSKP es un proyecto independiente, no avalado por Trimble.
- Se conserva el [texto de licencia MIT de OpenSKP](../licenses/OpenSKP-MIT.txt). Las dependencias transitivas mantienen sus licencias y metadatos distribuidos por sus respectivos paquetes; este aviso no las sustituye.
- Los archivos de prueba se generan con geometría sintética. No se incorporan modelos de clientes ni muestras externas de autoría desconocida al repositorio.

## Visor web

Los avisos de los decodificadores locales Draco y Basis están en [public/vendor/model-viewer/NOTICE.md](../public/vendor/model-viewer/NOTICE.md), junto con sus textos de licencia. Las dependencias del visor se resuelven mediante el archivo de bloqueo de npm.
