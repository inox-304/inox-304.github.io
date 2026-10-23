# INOX · Reconstrucciones de línea fría P16, P17, P18, P21 y P22

Modelos visuales elaborados el **23/10/2026** a partir de las fotografías del catálogo y de `INOX304_datos_y_catalogo.pdf`, páginas 11–14. Las fotos limpias actuales se inspeccionaron antes del modelado. La revisión **v2** añade puertas articuladas a P16, P17, P18 y P21, cerradas por defecto. P22 conserva su GLB v1 sin cambios. No son CAD certificados ni planos de fabricación.

## Correspondencia y medidas disponibles

| Código | Producto y archivo GLB en `public/models/inox/` | Evidencia de medida |
| --- | --- | --- |
| P16 | Armario de dos puertas · `armario-refrigerado-de-2-puertas-v2.glb` | No hay dimensiones; escala visual aproximada. |
| P17 | Armario de cuatro puertas · `armarios-frigorificos-camara-frigorifica-v2.glb` | No hay dimensiones; escala visual aproximada. |
| P18 | Mesa fría con las repisas de la foto · `mesa-fria-v2.glb` | No hay dimensiones; escala visual aproximada. |
| P21 | Abatidor de cinco bandejas · `abatidor-de-temperatura-de-5-bandejas-v2.glb` | No hay dimensiones ni SKU verificable; escala visual aproximada. |
| P22 | Exhibidor refrigerado abierto · `exhibidor-refrigerado-abierto-v1.glb` | **Ancho de 116 cm** indicado en PDF. Alto y fondo aproximados. |

Los valores de envolvente contenidos en las mallas **no se deben presentar como medidas comerciales**, salvo el ancho documentado de P22. Abrir las puertas aumenta la envolvente visible; el ángulo ilustrativo de unos 100° no es una especificación de recorrido. Ninguno de estos modelos permite validar si el producto cabe en un local o presentarlo en realidad aumentada a escala. Todos incluyen `dimensionsVerified: false`; P22 también contiene `verifiedWidthMeters: 1.16`.

Las medidas de vitrinas para tortas mencionadas en el vídeo del cuaderno no identifican estos productos y no se usaron. El vídeo no proporciona vistas técnicas adicionales de sus mecanismos.

## Evidencia visual y alcance por modelo

**P16, página 11.** Foto `public/images/products/armario-refrigerado-de-2-puertas.webp`: dos puertas altas; la derecha aparece abierta y muestra tres parrillas, guías de altura y rejilla de ventilador interior. La v2 conserva cuerpo inoxidable, patas y cabecera con mando y permite abrir ambas puertas desde una pose inicial cerrada. La disposición complementaria de parrillas del lado no visible es ilustrativa. El ventilador se representa solo por sus elementos visibles; no se inventa el motor posterior. No se conoce la medida ni capacidad específica.

**P17, página 11.** Foto `public/images/products/armarios-frigorificos-camara-frigorifica.webp`: un armario de **cuatro puertas cortas, dos por dos**, con las dos izquierdas abiertas. La v2 abre las cuatro puertas y representa el cuerpo y las hojas con acero satinado; no aplica un material blanco de plástico al gabinete. Mantiene el acabado claro de las parrillas que sí aparece en la referencia. El aspecto claro de la fotografía no verifica por sí solo un recubrimiento o acabado comercial exacto; debe confirmarse al cotizar. La disposición del lado derecho es ilustrativa. El título del catálogo también menciona cámara frigorífica, pero la fotografía no representa una cámara transitable; este modelo no pretende representar una. No se inventan capacidades o dimensiones de las variantes mencionadas genéricamente.

**P18, página 12.** Foto `public/images/products/mesa-fria.webp`: mesa de dos puertas, compartimento lateral con rejilla, encimera y dos repisas superiores. La malla reproduce la configuración fotografiada, vacía, sin frascos, plantas, vasos, alimentos o utensilios decorativos. La inclusión comercial de las repisas debe confirmarse al cotizar; la foto no demuestra que estén incluidas en todas las versiones. La v2 reemplaza el bloque sólido detrás de las puertas por un casco hueco simple con una repisa interior ilustrativa. Las dos puertas se articulan por sus cantos exteriores; el cajón y el compartimento de equipos permanecen fijos. El interior no se presenta como configuración comercial confirmada.

**P21, página 13.** Foto `public/images/products/abatidor-de-temperatura-de-5-bandejas.webp`: equipo compacto de marca ILUMI visible, puerta cerrada, mando inferior, panel perforado y ruedas. La v2 permite abrir la puerta y reemplaza el bloque macizo por una cámara hueca con cinco posiciones y bandejas simples ilustrativas, coherentes con el número declarado en el catálogo. No se conocen su formato, medidas, guías reales ni distribución: la visualización no los verifica. El pivote derecho y su recorrido son una convención de interacción aproximada, pues la foto cerrada no documenta la articulación. No se inventan motores, refrigeración interna, capacidad por ciclo o SKU del fabricante. El display se deja sin temperatura simulada; la marca se mueve unida a la hoja.

**P22, página 14.** Foto `public/images/products/exhibidor-refrigerado-abierto.webp`: frente abierto, cuatro repisas, laterales acristalados, cuerpo grafito, cartel ILUMI azul y rejilla inferior. Se respeta el ancho documentado de 116 cm. La altura, profundidad y curvatura lateral se aproximan desde la fotografía. No se añade puerta frontal ni animación de un mecanismo que no aparece en la fuente.

Las vistas posteriores no documentadas se mantienen sencillas. Las letras de marca se generan como geometría. No se pintan reflejos de fotografías sobre superficies ni se requiere una textura externa.

## Interacción

P16, P17, P18 y P21 contienen un solo clip **`Abrir_puertas`**, de 1,2 segundos. El instante 0 mantiene todas las puertas cerradas; a 1 segundo se completa la apertura y el último fotograma conserva la pose abierta. El visor puede recorrer el mismo clip en sentido contrario para cerrar. No hay retorno automático ni animación de operación del equipo.

Cada puerta tiene un grupo con pivote en su canto lateral. Hoja, tirador o uñero, juntas, revestimiento interior y rótulos forman un conjunto rígido. Las geometrías se agrupan por material **dentro de cada grupo**, conservando los pivotes; no se funden puertas y gabinete en una malla inmóvil. P16 tiene dos pivotes, P17 cuatro, P18 dos y P21 uno.

P22 no tiene puertas y permanece estático con giro y zoom. Los cinco GLB v1 se preservan como versiones anteriores; el generador actualizado emite únicamente los cuatro archivos v2.

## Generación y presupuesto

Generador reproducible: `scripts/3d/build-inox-linea-fria.mjs`.

```sh
node scripts/3d/build-inox-linea-fria.mjs
node scripts/check-models.mjs public/models/inox
```

| Código | Tamaño | Triángulos | Mallas |
| --- | ---: | ---: | ---: |
| P16 v2 | 2.195.376 bytes, 2,09 MiB | 30.224 | 14 |
| P17 v2 | 1.635.880 bytes, 1,56 MiB | 22.328 | 25 |
| P18 v2 | 1.531.128 bytes, 1,46 MiB | 21.048 | 16 |
| P21 v2 | 2.237.788 bytes, 2,13 MiB | 30.920 | 11 |
| P22 | 1.628.732 bytes, 1,55 MiB | 22.482 | 10 |

glTF 2.0 binario autocontenido, eje Y vertical y frente +Z. La generación local no depende de una suscripción o cuota por modelo. Todos están por debajo de 8 MiB y 300.000 triángulos. Mantener en la interfaz una indicación de reconstrucción visual aproximada y medidas pendientes de confirmar.

## Comprobación v2

Los cuatro archivos se cargaron mediante `GLTFLoader` en Node. Se comprobaron posiciones y cuaterniones finitos, ausencia de valores NaN, cantidad y nombre de pistas, puertas cerradas inicialmente, pose final abierta y retorno a cerrado. Se verificó que los pivotes permanecen inmóviles y las matrices locales de todos los elementos de cada puerta permanecen unidas durante cinco muestras del recorrido.

Rayos frontales por el centro de cada acceso golpean la puerta cuando está cerrada y alcanzan la cámara interior cuando está abierta; el retroceso de superficie supera 25 cm de escala visual en las nueve aperturas. Esta prueba detecta bloques macizos ocultos detrás de una hoja, pero no certifica tolerancias ni ausencia de toda colisión mecánica. Los SHA-256 de los cinco GLB v1, incluido P22, se comprobaron sin cambios. Evidencias privadas: `.work/inox-cold-v2/geometry-validation.json` y `v1-preservation-hashes.json`.

La revisión visual final del visor corresponde al paso de integración. Las pruebas geométricas no se presentan como una inspección visual ya concluida.
