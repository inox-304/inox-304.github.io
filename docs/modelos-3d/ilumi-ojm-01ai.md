# ILUMI OJM-01AI — extractor de naranjas

Reconstrucción visual aproximada realizada el 23/10/2026. Se utiliza como presentación del modelo comercial distribuido, sin modificar su configuración y sin simular su funcionamiento.

## Fuentes oficiales

- [Producto OJM-01AI](https://ilumiperu.com/products/extractor-de-naranjas).
- [Fotografía oficial](https://ilumiperu.com/cdn/shop/files/OJM-01AI_2_720x.jpg?v=1729631918).
- [Ficha técnica con plano mecánico](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_OJM-01AI.jpg?v=1790910156).

La foto y la ficha se inspeccionaron visualmente. Las referencias de trabajo quedan en `.work/ilumi-next-20261023/references/ojm-01ai-photo.jpg` y `ojm-01ai-sheet.jpg`, fuera de los archivos públicos del producto.

El plano mecánico de la ficha declara **470 × 490 × 880 mm (ancho × fondo × alto)**. La tabla inferior incluye otras cifras rotuladas «medidas de empaque»; no se utilizaron para el modelo. El GLB ajusta su envolvente exterior a las dimensiones del plano, pero las proporciones de piezas secundarias, espesores y profundidades ocultas son estimadas a partir de fotografías. No es un archivo CAD de ingeniería, una receta de materiales o una garantía de holguras para instalación.

## Representación

- Carcasa inoxidable con esquinas suaves, hueco real inferior para el vaso y bandeja con rejilla geométrica perforada.
- Cuatro caras de rodillos naranjas y formas moldeadas visibles, con relieve central y guía; las piezas no son fruta y permanecen estáticas.
- Protector de acrílico transparente con cantos, laterales y alambres exteriores visibles.
- Canastillo superior de alambre vacío y carril de alimentación inclinado.
- Laterales y trasera discretos, sin inventar un motor, cableado o ventilación ocultos.
- No se añaden naranjas, vaso o jugo ni se infiere un ciclo de exprimido, desmontaje o apertura.

Los paneles transparentes usan mezcla alfa para que el interior siga visible en el visor con iluminación neutral. Los rótulos y rejillas son geometría, sin imágenes que simulen relieve.

## Archivo y reproducción

```sh
node scripts/3d/build-ilumi-ojm.mjs
node scripts/check-models.mjs public/models/ilumi
```

- Generador: `scripts/3d/build-ilumi-ojm.mjs`.
- Archivo: `public/models/ilumi/ojm-01ai-v1.glb`.
- Tamaño: 2.321.920 bytes, 2,21 MiB.
- Triángulos: 32.066.
- Mallas/materiales: 10.
- Animaciones: ninguna; el visor permite giro y zoom.
- Formato glTF 2.0 binario autocontenido, materiales PBR, sin URLs de texturas o buffers externos.

El generador y GLB son locales, reproducibles y no dependen de un servicio de modelado de pago. Las cuotas de almacenamiento y transferencia del alojamiento siguen siendo independientes del proceso de creación.
