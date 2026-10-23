# Envasadoras ILUMI VM-300T, VM-400T y VM-500T

Reconstrucciones visuales aproximadas para el catálogo de INOX 304. Son equipos de distribución de diseño fijo. No son archivos CAD del fabricante ni planos de fabricación.

## Referencias verificadas

Fotografías y fichas técnicas oficiales consultadas el 23/10/2026:

| Modelo | Página oficial | Medidas nominales, ancho × fondo × alto | Sellado |
|---|---|---|---|
| VM-300T | [Producto](https://ilumiperu.com/products/maquina-de-envasado-al-vacio-vm-300t) | 460 × 390 × 400 mm | 300 × 8 mm |
| VM-400T | [Producto](https://ilumiperu.com/products/maquina-de-envasado-al-vacio-vm-400t) | 540 × 490 × 450 mm | 400 × 10 mm |
| VM-500T | [Producto](https://ilumiperu.com/products/maquina-de-envasado-al-vacio-vm-500t) | 650 × 575 × 480 mm | 500 × 10 mm |

Las medidas proceden del plano mecánico de cada ficha, no de las dimensiones de embalaje. Las cotas interiores de la cámara no están confirmadas. El plano genérico de controles de las fichas difiere de la foto; para el panel se toma la fotografía de cada producto.

Fotografías: [VM-300T](https://ilumiperu.com/cdn/shop/files/VM-300T-27_720x.png?v=1720564083), [VM-400T](https://ilumiperu.com/cdn/shop/files/VM-400T-29_720x.png?v=1720564070), [VM-500T](https://ilumiperu.com/cdn/shop/files/VM-500T-31_720x.png?v=1720564040).

Fichas originales: [VM-300T](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_VM-300T.jpg?v=1783209411), [VM-400T](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_VM-400T.jpg?v=1791325708), [VM-500T](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_VM-500T.jpg?v=1791036323).

## Representación

Carcasa de acero satinada, cámara hueca, borde superior, tapa transparente con junta y bisagras, panel de control, manómetro, tornillería y patas. La VM-300T tiene tres indicadores y manómetro a la derecha; las mayores llevan el manómetro a la izquierda y perforaciones laterales visibles en las fotos. Las fotos oficiales de VM-400T y VM-500T muestran prácticamente la misma carcasa; el modelo adapta las cotas nominales de cada ficha.

El clip `Abrir_tapa_bisagra` levanta la tapa sobre el eje posterior y mantiene el final abierto. La apertura es ilustrativa: el ángulo y las medidas de herrajes son aproximados. Las bandas de sellado reproducen las longitudes y anchos nominales de las fichas: 300 × 8, 400 × 10 y 500 × 10 mm. Su ubicación, altura y soportes se estimaron visualmente; las dimensiones internas de la cámara no están confirmadas y la malla no sirve para calcular el tamaño máximo de bolsa. No se modela ni se simula la bomba de vacío, el ciclo térmico o mecanismos ocultos. Las lecturas del panel son decorativas.

## Fuente y exportación

Ejecutar `node scripts/3d/build-ilumi-vacuum.mjs` desde la raíz. Genera tres archivos autocontenidos en `public/models/ilumi/`, con unidades en metros, vertical Y y frente +Z. No requiere un servicio de generación por créditos. Conservar este generador junto con los GLB y las referencias; revisar en el visor web cada exportación antes de publicarla.
