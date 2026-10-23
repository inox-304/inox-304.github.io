# ILUMI DJ-182 y DJ-183 · Reconstrucciones de presentación

Modelos visuales realizados a partir de fotografías y fichas técnicas oficiales de ILUMI, consultadas el **23/10/2026**. No son CAD suministrados o certificados por el fabricante ni planos de fabricación.

| Modelo | Capacidad declarada | Dimensiones externas, ancho × fondo × alto | Archivo |
| --- | --- | --- | --- |
| DJ-182 | 18 L × 2 tolvas, 36 L totales | 500 × 400 × 728 mm | `public/models/ilumi/dj-182-v1.glb` |
| DJ-183 | 18 L × 3 tolvas, 54 L totales | 725 × 400 × 728 mm | `public/models/ilumi/dj-183-v1.glb` |

Las dimensiones corresponden a los valores impresos en las fichas oficiales. Los archivos usan metros y eje Y vertical, con el frente hacia +Z y las patas apoyadas en Y=0. Las formas secundarias, espesor de pared, mecanismos internos y dimensiones útiles de tolva no se deben deducir de la reconstrucción.

## Fuentes primarias

**DJ-182**: [página del producto](https://ilumiperu.com/products/dispensador-de-jugos-de-36-litros-con-2-tolvas), [fotografía comercial](https://ilumiperu.com/cdn/shop/files/DJ-182_2_1_720x.jpg?v=1752876509), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_DJ-182.jpg?v=1790455369).

**DJ-183**: [página del producto](https://ilumiperu.com/products/dispensador-de-jugos-3-pozas-18l), [fotografía comercial](https://ilumiperu.com/cdn/shop/files/DJ-183_2_1_720x.jpg?v=1766509195), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_DJ-183.jpg?v=1790549161).

Se inspeccionaron las cuatro imágenes antes del modelado. Ambas referencias muestran una **carcasa común continua**, con tolvas, grifos y bandejas independientes. Por ello los modelos no son una agrupación de dispensadores de una sola tolva. No hay referencia suficiente de la parte posterior; se conserva discreta y no se inventan compresores, tuberías o mecanismos ocultos.

## Representación e interacción

- Carcasa inoxidable satinada, esquinas suavizadas, laterales con perforaciones reales y patas de apoyo.
- Dos o tres recipientes vacíos de policarbonato, con materiales transparentes compatibles con el visor existente; tubo de circulación visible.
- Un grifo con pulsador y una bandeja hueca con rejilla abierta por recipiente, siguiendo la fotografía.
- Acabado y tratamiento de transparencia derivados del DJ-181 ya revisado, sin modificar su archivo o generador.
- Clip **`Abrir_tapa`**, de 1,2 segundos, que levanta todas las tapas y permanece abierto en el fotograma final. El visor puede recorrerlo hacia atrás para cerrar. Las tapas se retiran verticalmente; no se representa una bisagra ni un mecanismo automático.
- La apertura conjunta es una función de visualización; no indica que el equipo tenga un mecanismo que una las tapas.

## Generación y presupuesto

Generador independiente y reproducible: `scripts/3d/build-ilumi-dj-multi.mjs`.

```sh
node scripts/3d/build-ilumi-dj-multi.mjs
node scripts/check-models.mjs public/models/ilumi
```

| Modelo | Tamaño inicial | Triángulos | Mallas | Materiales |
| --- | ---: | ---: | ---: | ---: |
| DJ-182 | 2.475.884 bytes, 2,36 MiB | 35.056 | 17 | 11 |
| DJ-183 | 3.168.536 bytes, 3,02 MiB | 45.084 | 20 | 11 |

Los GLB contienen toda la geometría, materiales y animaciones sin URLs, imágenes o buffers externos. No utilizan servicios de pago ni cuotas de generación. El presupuesto de tamaño no sustituye la revisión visual en el catálogo antes de publicar.
