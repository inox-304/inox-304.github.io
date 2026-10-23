# INOX · Reconstrucciones de línea fría P16, P17, P18, P21 y P22

Modelos visuales elaborados el **23/10/2026** a partir de las fotografías del catálogo y de `INOX304_datos_y_catalogo.pdf`, páginas 11–14. Las fotos limpias actuales se inspeccionaron antes del modelado. No son CAD certificados ni planos de fabricación.

## Correspondencia y medidas disponibles

| Código | Producto y archivo GLB en `public/models/inox/` | Evidencia de medida |
| --- | --- | --- |
| P16 | Armario de dos puertas · `armario-refrigerado-de-2-puertas-v1.glb` | No hay dimensiones; escala visual aproximada. |
| P17 | Armario de cuatro puertas · `armarios-frigorificos-camara-frigorifica-v1.glb` | No hay dimensiones; escala visual aproximada. |
| P18 | Mesa fría con las repisas de la foto · `mesa-fria-v1.glb` | No hay dimensiones; escala visual aproximada. |
| P21 | Abatidor de cinco bandejas · `abatidor-de-temperatura-de-5-bandejas-v1.glb` | No hay dimensiones ni SKU verificable; escala visual aproximada. |
| P22 | Exhibidor refrigerado abierto · `exhibidor-refrigerado-abierto-v1.glb` | **Ancho de 116 cm** indicado en PDF. Alto y fondo aproximados. |

Los valores de envolvente contenidos en las mallas **no se deben presentar como medidas comerciales**, salvo el ancho documentado de P22. Las puertas abiertas de P16 y P17 aumentan la envolvente visible. Ninguno de estos modelos permite validar si el producto cabe en un local o presentarlo en realidad aumentada a escala. Todos incluyen `dimensionsVerified: false`; P22 también contiene `verifiedWidthMeters: 1.16`.

Las medidas de vitrinas para tortas mencionadas en el vídeo del cuaderno no identifican estos productos y no se usaron. El vídeo no proporciona vistas técnicas adicionales de sus mecanismos.

## Evidencia visual y alcance por modelo

**P16, página 11.** Foto `public/images/products/armario-refrigerado-de-2-puertas.webp`: dos puertas altas; la derecha aparece abierta y muestra tres parrillas, guías de altura y rejilla de ventilador interior. La reconstrucción mantiene esa pose estática, el cuerpo inoxidable, patas y cabecera con mando. El ventilador se representa solo por sus elementos visibles; no se inventa el motor posterior. No se conoce la medida ni capacidad específica.

**P17, página 11.** Foto `public/images/products/armarios-frigorificos-camara-frigorifica.webp`: un armario de **cuatro puertas cortas, dos por dos**, con las dos izquierdas abiertas. La reconstrucción sigue ese equipo y sus parrillas visibles. El título del catálogo también menciona cámara frigorífica, pero la fotografía no representa una cámara transitable; este modelo no pretende representar una. No se inventan capacidades o dimensiones de las variantes mencionadas genéricamente.

**P18, página 12.** Foto `public/images/products/mesa-fria.webp`: mesa de dos puertas, compartimento lateral con rejilla, encimera y dos repisas superiores. La malla reproduce la configuración fotografiada, vacía, sin frascos, plantas, vasos, alimentos o utensilios decorativos. La inclusión comercial de las repisas debe confirmarse al cotizar; la foto no demuestra que estén incluidas en todas las versiones. Puertas y cajón permanecen cerrados al no existir referencia del interior.

**P21, página 13.** Foto `public/images/products/abatidor-de-temperatura-de-5-bandejas.webp`: equipo compacto de marca ILUMI visible, puerta cerrada, mando inferior, panel perforado y ruedas. La malla representa el exterior. El catálogo indica cinco bandejas, pero no se inventan bandejas interiores, recorridos de puerta, capacidad por ciclo o SKU del fabricante. El display se deja sin temperatura simulada.

**P22, página 14.** Foto `public/images/products/exhibidor-refrigerado-abierto.webp`: frente abierto, cuatro repisas, laterales acristalados, cuerpo grafito, cartel ILUMI azul y rejilla inferior. Se respeta el ancho documentado de 116 cm. La altura, profundidad y curvatura lateral se aproximan desde la fotografía. No se añade puerta frontal ni animación de un mecanismo que no aparece en la fuente.

Las vistas posteriores no documentadas se mantienen sencillas. Las letras de marca se generan como geometría. No se pintan reflejos de fotografías sobre superficies ni se requiere una textura externa.

## Interacción

Los cinco modelos son estáticos y se pueden girar y acercar. P16 y P17 muestran las puertas en la posición de referencia para permitir inspeccionar el interior. **No tienen clips de animación** ni controles de apertura simulados. La ubicación de bisagras observables y las poses son aproximaciones visuales, no mediciones de recorrido o autorización para inferir mecanismos.

## Generación y presupuesto

Generador reproducible: `scripts/3d/build-inox-linea-fria.mjs`.

```sh
node scripts/3d/build-inox-linea-fria.mjs
node scripts/check-models.mjs public/models/inox
```

| Código | Tamaño | Triángulos | Mallas/materiales |
| --- | ---: | ---: | ---: |
| P16 | 1.779.436 bytes, 1,70 MiB | 24.584 | 6 |
| P17 | 1.082.556 bytes, 1,03 MiB | 14.888 | 8 |
| P18 | 1.106.108 bytes, 1,05 MiB | 15.264 | 7 |
| P21 | 1.562.768 bytes, 1,49 MiB | 21.620 | 6 |
| P22 | 1.628.732 bytes, 1,55 MiB | 22.482 | 10 |

glTF 2.0 binario autocontenido, eje Y vertical y frente +Z. La generación local no depende de una suscripción o cuota por modelo. Los archivos deben revisarse visualmente en el catálogo antes de publicarse; el presupuesto de carga no sustituye esa revisión. Mantener en la interfaz una indicación de reconstrucción visual aproximada y medidas pendientes de confirmar.
