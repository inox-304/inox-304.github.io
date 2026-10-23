# Hornos, parrillas y caja china INOX: P01 y P06-P11

Reconstrucciones visuales aproximadas a partir de las fotografías del catálogo aportado por el propietario. No son archivos CAD ni sustituyen los modelos o planos del taller. Las fuentes se inspeccionaron visualmente antes de generar cada modelo.

| Código | Archivo en `public/models/inox/` | Fuente: página de `INOX304_catalogo_FINAL.pdf` | Forma representada |
| --- | --- | ---: | --- |
| P01 | `cocina-semiindustrial-4-hornillas-horno-electrico-v1.glb` | 3 | Cuatro hornillas, cuatro mandos superiores, horno con dos rejillas y panel lateral de cuatro controles; puerta abatida en una posición fija como la foto. |
| P06 | `horno-multiuso-v1.glb` | 5 | Horno vertical, visor alto, cuatro rejillas visibles, consola derecha, bastidor inferior abierto y ruedas naranjas. |
| P07 | `horno-ecologico-para-pollo-a-la-brasa-v1.glb` | 6 | Horno pollero con compuerta elevada, soportes de asador en estrella, consola izquierda, gabinete inferior y ruedas. |
| P08 | `horno-pollero-ecologico-v1.glb` | 6 | Cámara frontal abierta, refractario, columnas cilíndricas, espadas y discos laterales del asador; puerta inferior abierta y silueta del motor, polea y correa visibles en la fotografía. |
| P09 | `parrilla-premium-plancha-y-parrilla-a-carbon-v1.glb` | 7 | Mitad parrilla y mitad plancha, conjunto elevado, brasero con refractario gris, dos mandos, manivela visible, repisa inferior y ruedas. |
| P10 | `parrilla-grande-v1.glb` | 7 | Parrilla completa elevada, brasero, respaldo, mando frontal derecho, manivela con empuñadura, repisa y ruedas naranjas. |
| P11 | `caja-china-grande-v1.glb` | 8 | Caja con visor frontal, tapa ahumadora levantada, bandeja superior, mitad parrilla/mitad plancha, asas laterales, manivela y ruedas. |

Las fotos actuales de referencia tienen los mismos slugs, con extensión `.webp`, dentro de `public/images/products/`. Su trazabilidad con las imágenes originales del PDF y los recortes aportados consta en [catalog-sources.md](../catalog-sources.md) y [resource-inventory.md](../resource-inventory.md).

## Lo que se puede y no se puede inferir

- La ficha P01 indica quemadores de 4 pulgadas. El diámetro exterior representado es 101,6 mm. La distribución de puertos, nervaduras y espesores es aproximada.
- Las fuentes no acotan el ancho, fondo y alto exterior de estos siete productos. Los tamaños del generador son **escala ilustrativa**, no medidas comerciales ni constructivas. Tampoco se afirman capacidades, potencia ni cantidad de alimentos por carga.
- Se conservan las posiciones abiertas o elevadas que aparecen en las fotos. Los archivos no tienen animaciones ni presuponen recorridos, relaciones de transmisión o comportamientos operativos.
- El motor y la correa del P08 son una silueta visual de lo expuesto por la puerta abierta. No se modela ni se afirma un tren de transmisión interno completo.
- Las llamas y los alimentos de las fotografías no se incorporan. Los controles no simulan encendido, temperatura ni funcionamiento de la máquina.
- Los visores transparentes permiten observar rejillas o interiores simplificados. No se infiere aislamiento, ventilación posterior, cableado, conductos de gas, especificaciones del vidrio ni certificaciones.
- El número y las medidas de varillas, ladrillos, tornillos, planchas y tubos no son un despiece aprobado. No deben usarse para calcular inventario ni recetas de fabricación.

## Archivos reproducibles y validación

Generador: `scripts/3d/build-inox-hornos-parrillas.mjs`.

```powershell
& HERRAMIENTAS/node24/node.exe scripts/3d/build-inox-hornos-parrillas.mjs
```

GLB autónomos con geometría, materiales PBR, eje Y vertical y frente hacia +Z. Se agrupan las piezas por material para limitar peso y llamadas de dibujo. La metainformación identifica el código del producto, la fuente, la escala ilustrativa y `manufacturingUse: false`.

Todos quedan por debajo de 1 MiB y 41 000 triángulos y pasan los límites automáticos del repositorio. No tienen texturas externas, recursos remotos ni clips. La integración pública debe mantener **«Visualización 3D aproximada a partir de fotografías»** y conservar las especificaciones ya verificadas del catálogo.
