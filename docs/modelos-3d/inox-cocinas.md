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

Los controles son detalles visuales sin simulación de gas, temperatura o encendido. Los interiores no visibles están simplificados. No se anima la puerta del horno porque no se ha confirmado su mecanismo en estas referencias. No se han inventado recetas, cantidades de materias primas ni variaciones comerciales.

Las geometrías de parrillas, quemadores, patas, controles y superficies son independientes en el generador; el GLB combina por material para reducir el costo del visor. No hay recursos externos ni servicios de suscripción.

## Generación

`node scripts/3d/build-inox-cocinas.mjs` genera los cuatro GLB en `public/models/inox/`. Se puede pasar `P02`, `P03`, `P04` o `P05` para generar uno. El script verifica los límites de tamaño y geometría con `inspectGlb`.
