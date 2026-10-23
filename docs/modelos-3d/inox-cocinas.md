# Cocinas del catálogo INOX — P02, P03, P04 y P05

Modelos de presentación reconstruidos a partir de las fotografías existentes del catálogo del propietario. No son planos de fabricación ni archivos CAD del fabricante.

| Código | Referencia visual local | Detalles representados |
|---|---|---|
| P02 | `public/images/products/cocina-industrial-de-3-hornillas.jpg` | Tres quemadores, bastidor abierto, repisa continua y controles con aro azul |
| P03 | `public/images/products/cocina-industrial-de-3-parrillas.webp` | Tres parrillas, respaldo, repisa ranurada y placas azules de control |
| P04 | `public/images/products/cocina-industrial-4-hornillas-tipo-isla-plancha-ho.webp` | Cuatro parrillas, plancha, separador perforado, horno con visor y espacio lateral |
| P05 | `public/images/products/cocina-industrial-tipo-isla-4-parrillas-plancha-ho.webp` | Variante fotografiada del conjunto de cuatro parrillas, plancha y horno; interruptor rojo |

## Alcance

Las fotografías no aportan dimensiones exteriores verificables para estos códigos. La escala utilizada es ilustrativa, no permite medir el espacio de instalación ni deducir consumos de plancha o piezas. Las medidas finales deben confirmarse; los modelos de SketchUp del propietario podrán reemplazar esta reconstrucción conservando los códigos.

Los controles son detalles visuales sin simulación de gas, temperatura o encendido. P04 y P05 v2 incluyen una apertura ilustrativa del horno sobre una bisagra inferior: el tirador y el visor se mueven con la hoja. La carcasa es hueca, con un interior simplificado. El mecanismo exacto, el ángulo de apertura y los detalles interiores deben confirmarse con los modelos de SketchUp del propietario. No se han inventado recetas, cantidades de materias primas ni variaciones comerciales.

Las geometrías de parrillas, quemadores, patas, controles y superficies son independientes en el generador; el GLB combina por material dentro de cada conjunto fijo o móvil para reducir el costo del visor. La animación `Abrir_puertas` parte con la puerta cerrada y permite abrirla y cerrarla desde el catálogo. No hay recursos externos ni servicios de suscripción.

## Generación

`node scripts/3d/build-inox-cocinas.mjs` genera únicamente P04/P05 v2 en `public/models/inox/`. Se puede pasar `P04` o `P05` para generar uno; regenerar P02/P03 v1 requiere indicar ese código expresamente. Los v1 de P04/P05 se conservan como versiones anteriores. El script verifica los límites de tamaño y geometría con `inspectGlb`.
