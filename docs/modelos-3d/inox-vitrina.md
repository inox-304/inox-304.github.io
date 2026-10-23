# INOX P20 · Vitrina refrigerada CÓD-VRC-1

Reconstrucción visual de la vitrina del catálogo de INOX 304. Se creó a partir de la fotografía suministrada y de la página 13 de **`INOX304_datos_y_catalogo.pdf`**, revisadas el **23/10/2026**.

**No hay dimensiones físicas verificadas para este producto.** El ancho de la malla se normaliza a una unidad exclusivamente para presentarla en el visor. Esa unidad no significa que la vitrina real mida un metro. La altura y profundidad son aproximaciones visuales. No debe usarse para medir un local, fabricar el mueble, cotizar por dimensiones ni mostrar realidad aumentada a escala.

## Evidencia utilizada

- Código del catálogo: **P20**, referencia **CÓD-VRC-1**, slug `vitrina-refrigerada`.
- Foto vigente: `public/images/products/vitrina-refrigerada.webp`; foto anterior `public/images/products/vitrina-refrigerada.jpg`.
- El inventario de recursos `docs/resource-inventory.md` vincula el original N07 a este mismo producto.
- La página 13 del PDF muestra esa fotografía y describe exhibición refrigerada para carnes, embutidos y lácteos. No aporta medidas o vistas traseras/laterales adicionales.
- El vídeo compartido menciona otra vitrina **para tortas**, curva/cuadrada, de 100/120/150 cm. No existe evidencia suficiente para vincular esas medidas a P20; **no se trasladaron al modelo**.

## Geometría y límites

El frente de cristal curvo, los marcos negros, los laterales transparentes, la base de acero, la inscripción INOX304 y las cuatro bandejas superficiales siguen los elementos visibles en la foto. Las rejillas tienen aberturas reales, y los reflejos proceden de materiales PBR e iluminación del visor, sin reflejos o fotografías pintados sobre la geometría.

La curvatura, profundidad, grosor de vidrio, dimensiones de bandejas y apoyos pequeños son aproximaciones. La trasera es sencilla; no se inventan motores, tuberías, compresores, controles o puertas que no se observan. La división central de los cristales superiores reproduce una línea visible en la fotografía, sin afirmar un mecanismo de apertura.

El modelo es estático y se puede girar o acercar. No tiene animaciones de puertas o desmontaje. El catálogo debe mantener la indicación de **reconstrucción visual aproximada, medidas pendientes de confirmar**. La información `dimensionsVerified: false` también está embebida en el archivo.

## Archivos y reproducción

- Modelo: `public/models/inox/vitrina-refrigerada-v1.glb`.
- Generador reproducible: `scripts/3d/build-inox-vitrina.mjs`.
- Tamaño inicial: **2.596.728 bytes, 2,48 MiB**.
- Geometría: **35.966 triángulos**, seis mallas/materiales.
- glTF 2.0 binario autocontenido: no requiere texturas, buffers o URLs externas.
- Eje Y vertical, frente hacia +Z. Envolvente normalizada aproximada: ancho 1, alto 0,7084, fondo 0,5690; **no son medidas comerciales**.

```sh
node scripts/3d/build-inox-vitrina.mjs
node scripts/check-models.mjs public/models/inox
```

La generación local no depende de suscripciones o cuotas por modelo. Antes de añadir medidas reales o personalización dimensional, se deben obtener ancho, fondo y altura confirmados, además de vistas lateral y posterior del equipo que se pretende vender.
