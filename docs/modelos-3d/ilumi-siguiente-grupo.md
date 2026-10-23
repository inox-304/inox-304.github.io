# Amasadoras, batidora compacta, inmersión y VM-200T

Ocho reconstrucciones visuales preparadas el 23/10/2026 para el catálogo del distribuidor INOX. **No son archivos CAD entregados por ILUMI ni planos de fabricación.** Geometría exterior, interiores visibles y herrajes se interpretan de fotografías; no generan consumos de material, recetas, costos ni compatibilidades.

Las fotografías y fichas del sitio oficial fueron descargadas e inspeccionadas antes de modelar. Los originales y sus URLs exactas se conservan en `.work/ilumi-next-20261023/references/download-sources.json`. Las fichas son imágenes JPEG; los modelos no incluyen texturas externas ni dependen de esos archivos privados.

## Fuente y escala

| Modelo | Fuente oficial inspeccionada | Dimensiones o referencia usada | Límites |
| --- | --- | --- | --- |
| AMA-15M | [Foto](https://ilumiperu.com/cdn/shop/products/AMA-15M-1_720x.jpg?v=1673472480), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_AMA-15M.jpg?v=1791231823) | Envolvente de producto 700 × 530 × 800 mm; bowl nominal 45 L | El título comercial dice 15 kg; la ficha especifica 16 kg de masa y 10 kg de harina con hidratación del 60 %. No se deduce capacidad a partir de la geometría. |
| AMA-25M | [Foto](https://ilumiperu.com/cdn/shop/products/AMA-25M-1_720x.jpg?v=1673540200), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_AMA-25M.jpg?v=1792685542) | Envolvente 880 × 590 × 940 mm; bowl nominal 68 L | La ficha indica 25 kg de masa y 15 kg de harina, hidratación 60–65 %. El diámetro interior, transmisión y herramienta son aproximados. |
| B-7LRE | [Foto roja](https://ilumiperu.com/cdn/shop/files/B-7LRE_-_ROJA_2_720x.jpg?v=1773430879), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_B-7LRE.jpg?v=1791386935) | Envolvente 410 × 230 × 441 mm; bowl nominal 7 L | La ficha indica harina 0,5 kg y masa 0,8 kg. Solo se representa el equipo rojo. No se crea un SKU blanco, una opción de color ni una animación de inclinación. |
| BIT-270 | [Foto](https://ilumiperu.com/cdn/shop/files/BIT-270_2_720x.png?v=1778278283), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_BIT-270.jpg?v=1792737973), [producto](https://ilumiperu.com/collections/batidoras/products/batidora-de-inmersion-de-270w) | Brazo 226 mm y diámetro publicado 28 mm | La ficha contiene la errata «226 m»; la página del producto confirma 226 mm. Mango negro macizo. Dimensiones exteriores totales no verificadas. |
| BIT-350 | [Foto](https://ilumiperu.com/cdn/shop/files/BIT-350_2_720x.png?v=1778278421), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_BIT-350.jpg?v=1787858487) | Brazo 300 mm, diámetro publicado 35 mm | Mango azul abierto. Carcasa y campana se interpretan visualmente; medidas de embalaje excluidas. |
| BIT-500 | [Foto](https://ilumiperu.com/cdn/shop/files/BIT-500_2_720x.png?v=1778278471), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_BIT-500.jpg?v=1791322484) | Brazo 400 mm, diámetro publicado 35 mm | Conserva la forma de esta familia observada en su propia foto; no se escala uniformemente el brazo con la carcasa. |
| BIT-750 | [Foto](https://ilumiperu.com/cdn/shop/files/BIT-750_2_720x.png?v=1778278500), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_BIT-750.jpg?v=1792737974) | Brazo 500 mm, diámetro publicado 35 mm | Carcasa y mango ligeramente mayores según la proporción de su foto. Altura total ilustrativa, sin usar las dimensiones del embalaje. |
| VM-200T | [Foto](https://ilumiperu.com/cdn/shop/files/VM-200T_2_720x.jpg?v=1729634114), [ficha con plano](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_VM-200T.jpg?v=1783209411) | Plano mecánico 500 × 340 × 360 mm; barra 260 × 8 mm | Una barra de sellado, manómetro izquierdo y panel frontal bajo. Cuba, agujeros, tapa y bisagra aproximados. No es el mismo modelo que VM-300T ni una copia de sus tres pantallas. |

Para AMA y B-7LRE, la forma se construye con el eje longitudinal más largo y se orienta luego para que el ancho/fondo nominal de la ficha coincida con los ejes X/Z del archivo. El factor final de ajuste de envolvente no convierte los detalles internos en medidas técnicas. La capacidad nominal del bowl no se calcula ni garantiza con su malla.

En las BIT, solo el tubo mantiene sus medidas documentadas. La envolvente total del modelo es ilustrativa; no debe mostrarse como especificación comercial. El mango macizo de BIT-270 y la abertura real en los mangos de BIT-350/500/750 son geometrías distintas. No se modela la cuchilla oculta, ni se incluye el batidor globo BG-185/BG-250 vendido por separado.

## Archivos y reproducción

```sh
node scripts/3d/build-ilumi-amasadoras.mjs
node scripts/3d/build-ilumi-batidoras-compactas.mjs
node scripts/3d/build-ilumi-vm200t.mjs
```

Los dos primeros generadores comparten `scripts/3d/ilumi-next-geometry.mjs`. Salidas:

- `public/models/ilumi/ama-15m-v1.glb`
- `public/models/ilumi/ama-25m-v1.glb`
- `public/models/ilumi/b-7lre-v1.glb`
- `public/models/ilumi/bit-270-v1.glb`
- `public/models/ilumi/bit-350-v1.glb`
- `public/models/ilumi/bit-500-v1.glb`
- `public/models/ilumi/bit-750-v1.glb`
- `public/models/ilumi/vm-200t-v1.glb`

Solo VM-200T contiene el clip **`Abrir_tapa_bisagra`**, de 1,2 segundos; conserva la posición abierta al final. La fotografía oficial documenta la existencia de la tapa articulada, mientras que el ángulo de apertura representado es ilustrativo. Los siete modelos restantes son estáticos y pueden girarse en el visor; no simulan motores, seguridad ni funcionamiento del equipo.

## Verificación

Los ocho archivos pasaron el inspector GLB del proyecto sin errores ni advertencias de presupuesto; cada archivo está por debajo de 8 MiB y 30.000 triángulos. Se cargaron simultáneamente en `model-viewer` con Chrome sin errores JavaScript y se revisaron visualmente las siluetas y materiales. También se comprobó el estado abierto de la tapa VM-200T. Evidencia privada: `.work/ilumi-next-20261023/qa-grid.png` y `qa-vm200-open.png`.

Esta entrega solo incorpora geometría y documentación. Dar de alta imágenes/fichas públicas, textos del catálogo, medios en el servidor y publicación exige la revisión final del lote correspondiente.
