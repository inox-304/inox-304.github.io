# Catálogo 360° de INOX 304

El sitio ya contiene más de 20 productos. Puede almacenar muchos modelos, pero abre **solo el modelo del producto que el visitante elige**. No descarga 20 escenas al abrir el catálogo. La fotografía aparece primero y el visor y el archivo 3D se descargan al pulsar **Ver 360°**. Sin modelo asignado, ese botón no aparece.

El catálogo ya contiene modelos interactivos aproximados preparados a partir de fotografías. Los diseños originales de SketchUp se incorporan después de comprobar su fidelidad, escala y piezas móviles. El 360° utiliza geometría real, no una secuencia de fotos ni un video.

## Preparar cada equipo

1. Conserva el diseño original editable fuera de la carpeta pública. Puedes subir un **SketchUp (.skp) de hasta 20 MB** para convertirlo en el servidor, o preparar una copia **GLB / glTF 2.0** con texturas y geometría incluidas en el mismo archivo.
2. Usa metros, apoya el equipo en el suelo y centra su geometría. Revisa la escala, las patas, puertas y etiquetas. Elimina tornillos y piezas internas que nunca se ven.
3. Objetivo práctico inicial: **2–5 MB y hasta 150 000 triángulos por producto**. La carga desde el panel admite hasta 8 MB por archivo; para archivos incluidos en el código, el validador admite hasta 12 MB. En ambos casos se rechazan más de 300 000 triángulos. Son presupuestos del proyecto, no garantía de rendimiento: se revisará cada modelo en un celular real.
4. Usa texturas de hasta 2048 × 2048 como punto de partida; 1024 suele bastar para superficies pequeñas. Reutiliza el material del acero y evita transparencias innecesarias. Los iconos o renders de 8K no deben convertirse en texturas 8K para cada equipo.
5. Exporta sin compresión de malla o con **Draco**. El visor incluye decodificadores locales Draco y KTX2/Basis. Por ahora no uses `EXT_meshopt_compression` obligatorio.
6. Crea un render WebP de portada, idealmente 1200–1600 px, para mantener la fotografía visible antes de cargar el visor.

## Asignar desde el panel

Abre **Catálogo → Productos → Añadir** en el panel. Completa nombre y línea; en **Fotos y archivos**, sube la imagen principal y el GLB. En **Variaciones** puedes asignar otra foto y otro GLB a cada capacidad o versión. Pulsa **Guardar y revisar**, comprueba la vista previa privada y después **Publicar en catálogo**. Un equipo nuevo queda como borrador al guardar y revisar.

Si trabajas con SKP, guarda primero el equipo y entra en **Subir SketchUp y preparar modelo 3D**. Elige el producto principal o una variación, sube el archivo y espera a **Listo para revisar**. Abre su vista previa privada y confirma **Aplicar modelo al equipo**. Un borrador conserva ese estado hasta que decidas publicarlo; un equipo publicado requiere confirmar el reemplazo de su modelo.

La conversión se ejecuta en el servidor y guarda el SKP original en privado. No depende de la PC del propietario. Render gratuito puede dormir y pausar la cola; al volver a estar activo se retoman los trabajos pendientes. No hay procesamiento ilimitado ni un plazo garantizado. Un fallo conserva el modelo actual y permite revisar el motivo o reintentar.

La web oficial consulta las publicaciones del panel, sin modificar código ni ejecutar un despliegue por cada equipo. Las fichas nuevas usan un enlace como `/equipo/?id=CODIGO`; las fichas existentes conservan sus enlaces. Abre **Ver en catálogo oficial** desde la vista previa para comprobar el resultado. Consulta [el flujo de publicación](PUBLICAR-CATALOGO.md) para los tiempos de actualización y el comportamiento ante fallos.

| Campo | Uso |
| --- | --- |
| Modelo GLB | Archivo subido o ruta existente `/models/P03.glb`; también admite URL HTTPS directa. |
| Poster 3D | Portada del visor; si queda vacía se usa la imagen principal. |
| Galería | Hasta ocho fotos extra; se descargan al seleccionar la vista. |
| Publicado en la web | Muestra u oculta el producto completo sin borrarlo. |

El panel guarda los archivos fuera del código y protege los borradores. Este flujo de modelos no sincroniza archivos con Sheets ni Drive. Un recurso alojado en otro dominio necesita permitir la descarga CORS. No pegues enlaces que contengan contraseñas o tokens. Las copias comerciales v2 incluyen los originales SKP y sus registros de importación; conserva esos respaldos en privado y organiza su frecuencia por separado.

Para mantener un archivo dentro del proyecto, guarda `P03.glb` en `public/models/` y escribe `/models/P03.glb` en el campo de URL existente. Puedes comprobar una carpeta antes de subirla:

```powershell
npm run check:models
node scripts/check-models.mjs "C:\ruta\a\mis-modelos"
```

La comprobación detecta formato, referencias externas, compresión y presupuestos básicos; no sustituye la inspección visual del equipo. Al actualizar un archivo conserva la ruta y publica otra versión, o cambia su nombre para evitar caché.

## Conversión SketchUp y fidelidad

El servidor usa **OpenSKP 1.4.0**, fijado en las dependencias, para leer el archivo. Un escritor GLB propio conserva metros, eje vertical Y, componentes, jerarquía, nombres y reutilización de geometría. Las texturas PNG/JPEG se integran en el GLB; se eliminan sus metadatos y se reducen las mayores a 2048 píxeles por lado. Los elementos marcados como ocultos se omiten. No se publican los diccionarios de atributos, rutas originales de texturas ni archivos auxiliares de metadatos.

Además del máximo de entrada de 20 MB y salida de 8 MB, se limita la expansión del contenedor, profundidad, nodos, materiales, texturas y geometría colocada a 300 000 triángulos. El proceso tiene límites de tiempo y memoria y un entorno separado sin credenciales de los servicios. **Esto no constituye un aislamiento completo del sistema operativo.** La validación del GLB existente se vuelve a aplicar antes de permitir su revisión y uso.

OpenSKP declara soporte del formato moderno 2021+. La suite prueba archivos sintéticos, incluida la rama VFF/ZIP, escala, componentes repetidos, transparencias y jerarquías. Todavía falta validar visualmente un SKP auténtico del propietario generado en **SketchUp 2023**. No se debe presentar el resultado como CAD certificado ni derivar automáticamente medidas de fabricación o recetas.

Las proyecciones de texturas y los materiales aplicados a un componente completo pueden variar respecto a SketchUp. El conversor conserva colores y texturas disponibles, pero no reconstruye el comportamiento físico del acero. No genera animaciones, fórmulas de componentes dinámicos, escenas, cotas ni interacciones de catálogo. Un producto con puertas, acabados o módulos ya configurados bloquea la aplicación directa hasta preparar la compatibilidad del nuevo modelo.

OpenSKP se utiliza bajo licencia MIT, sin API de conversión por suscripción; consulta [dependencias y licencia](THIRD-PARTY.md). Esta elección no elimina los límites o posibles costos futuros del alojamiento y almacenamiento.

## Controles y recuperación

Ratón o dedo para girar; pinza o rueda para zoom; flechas y + / − con teclado. Escape o **Volver a foto** cierra el visor. No hay giro automático. Si el modelo falla o tarda demasiado, se conserva la fotografía y se ofrece reintentar. Cambiar el producto desde el catálogo libera el visor anterior.

La implementación fija `@google/model-viewer` 4.3.1 y lo empaqueta con el sitio. Los recursos del visor y los modelos usan rutas compatibles con el dominio actual, una ruta de proyecto GitHub y un futuro `.com`. Copiar el proyecto a otra PC conserva esta configuración; consulta la guía de portabilidad para instalar Node y arrancarlo.

Documentación oficial usada: [carga diferida de model-viewer](https://modelviewer.dev/examples/loading/), [ejemplo de carga de la biblioteca al interactuar](https://modelviewer.dev/examples/lighthouse.html), [controles de cámara](https://modelviewer.dev/examples/stagingandcameras/).
