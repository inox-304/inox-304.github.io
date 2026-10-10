# Catálogo 360° de INOX 304

El sitio ya contiene más de 20 productos. Puede almacenar muchos modelos, pero abre **solo el modelo del producto que el visitante elige**. No descarga 20 escenas al abrir el catálogo. La fotografía aparece primero y el visor y el archivo 3D se descargan al pulsar **Ver 360°**. Sin modelo asignado, ese botón no aparece.

Todavía hacen falta los modelos originales de INOX: no se ha publicado ningún objeto de demostración como si fuera un equipo real. El 360° será una vista interactiva del diseño 3D, no una secuencia de fotos ni un video.

## Preparar cada equipo

1. Conserva el diseño original editable fuera de la carpeta pública. Exporta una copia **GLB / glTF 2.0** con texturas y geometría incluidas en el mismo archivo.
2. Usa metros, apoya el equipo en el suelo y centra su geometría. Revisa la escala, las patas, puertas y etiquetas. Elimina tornillos y piezas internas que nunca se ven.
3. Objetivo práctico inicial: **2–5 MB y hasta 150 000 triángulos por producto**. La carga desde el panel admite hasta 8 MB por archivo; para archivos incluidos en el código, el validador admite hasta 12 MB. En ambos casos se rechazan más de 300 000 triángulos. Son presupuestos del proyecto, no garantía de rendimiento: se revisará cada modelo en un celular real.
4. Usa texturas de hasta 2048 × 2048 como punto de partida; 1024 suele bastar para superficies pequeñas. Reutiliza el material del acero y evita transparencias innecesarias. Los iconos o renders de 8K no deben convertirse en texturas 8K para cada equipo.
5. Exporta sin compresión de malla o con **Draco**. El visor incluye decodificadores locales Draco y KTX2/Basis. Por ahora no uses `EXT_meshopt_compression` obligatorio.
6. Crea un render WebP de portada, idealmente 1200–1600 px, para mantener la fotografía visible antes de cargar el visor.

## Asignar desde el panel

Abre el producto en `/admin/` y despliega **Ficha y modelo 3D**. Sube el GLB y, opcionalmente, una portada. En la sección de galería puedes añadir hasta ocho fotos. Guarda y usa **Abrir vista previa privada**; marca **Publicado en la web** cuando esté listo.

| Campo | Uso |
| --- | --- |
| Modelo GLB | Archivo subido o ruta existente `/models/P03.glb`; también admite URL HTTPS directa. |
| Poster 3D | Portada del visor; si queda vacía se usa la imagen principal. |
| Galería | Hasta ocho fotos extra; se descargan al seleccionar la vista. |
| Publicado en la web | Muestra u oculta el producto completo sin borrarlo. |

El panel guarda los archivos fuera del código y protege los borradores. No hay sincronización con Sheets ni Drive. Un recurso alojado en otro dominio necesita permitir la descarga CORS. No pegues enlaces que contengan contraseñas o tokens.

Para mantener un archivo dentro del proyecto, guarda `P03.glb` en `public/models/` y escribe `/models/P03.glb` en el campo de URL existente. Puedes comprobar una carpeta antes de subirla:

```powershell
npm run check:models
node scripts/check-models.mjs "C:\ruta\a\mis-modelos"
```

La comprobación detecta formato, referencias externas, compresión y presupuestos básicos; no sustituye la inspección visual del equipo. Al actualizar un archivo conserva la ruta y publica otra versión, o cambia su nombre para evitar caché.

## Controles y recuperación

Ratón o dedo para girar; pinza o rueda para zoom; flechas y + / − con teclado. Escape o **Volver a foto** cierra el visor. No hay giro automático. Si el modelo falla o tarda demasiado, se conserva la fotografía y se ofrece reintentar. Cambiar el producto desde el catálogo libera el visor anterior.

La implementación fija `@google/model-viewer` 4.3.1 y lo empaqueta con el sitio. Los recursos del visor y los modelos usan rutas compatibles con el dominio actual, una ruta de proyecto GitHub y un futuro `.com`. Copiar el proyecto a otra PC conserva esta configuración; consulta la guía de portabilidad para instalar Node y arrancarlo.

Documentación oficial usada: [carga diferida de model-viewer](https://modelviewer.dev/examples/loading/), [ejemplo de carga de la biblioteca al interactuar](https://modelviewer.dev/examples/lighthouse.html), [controles de cámara](https://modelviewer.dev/examples/stagingandcameras/).
