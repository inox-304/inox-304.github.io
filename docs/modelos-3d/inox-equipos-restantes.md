# Equipos de catálogo P12–P15, P19 y P30–P32

Reconstrucciones visuales realizadas el 23/10/2026 a partir de las fotografías del catálogo entregado por el propietario. Son modelos de presentación, no CAD del fabricante ni planos para fabricar o calcular consumo de material.

## Fuentes y alcance

Se inspeccionaron las ocho fotos vigentes de `public/images/products/` y las páginas 9, 10, 12, 19 y 20 de `INOX304_datos_y_catalogo.pdf`. El PDF fuente tiene SHA-256 `b30d22ef613bd8118ba25dfbe51e727d6aac43b331274876b136052e707650ed`; sus copias privadas y renders se conservan fuera del producto público. No se extrajeron dimensiones de perspectiva.

**Ninguna de estas ocho referencias aporta medidas externas.** Todos los GLB llevan `dimensionsVerified: false` y `NORMALIZED_VISUAL_SCALE_NOT_PHYSICAL_DIMENSIONS`. La envolvente numérica interna sirve para componer la escena, no representa un tamaño comercial y no debe utilizarse para realidad aumentada a escala, instalación, fabricación o cómputo de litros.

| Código | Fotografía y GLB, mismo nombre base | Reconstrucción y límites |
| --- | --- | --- |
| P12 | `freidora-doble-profesional` | Dos cubas abiertas y canastillas de malla vacías, controles independientes, doble puerta, tiradores y ruedas. No se muestran papas, aceite ni quemadores ocultos. |
| P13 | `freidora-de-papa-profesional` | Gabinete estrecho con una puerta, cuba abierta, dos canastillas elevadas en pose estática, mando y respaldo. Recorridos o automatismos no documentados. |
| P14 | `freidora-automatica-de-papas` | Variante exterior fotografiada, frente redondeado, dos canastillas, mando negro y placa INOX. La palabra «automática» no se convierte en una animación mecánica inventada. |
| P15 | `modulo-de-comida-4-en-1` | Carrito con toldo rayado rojo/amarillo, postes, ruedas, puertas y ocho mandos visibles. Encimera con tapa de broastera, canastilla, tapas de conservadora y plancha. Formas ocultas genéricas, sin inferir tuberías ni presión. No se incorpora el precio histórico del PDF. |
| P19 | `visicooler-580-litros` | Gabinete claro, puerta de cristal cerrada, cinco parrillas visibles, cabecera ILUMI azul y rejilla negra inferior. El dato comercial de 580 L no permite obtener las medidas; tampoco identifica el SKU exacto de ILUMI. |
| P30 | `licuadora-industrial` | Vaso cónico cerrado, tapa y cierre, asa, motor lateral, bastidor tubular triangular y ruedas. La familia enumera 10/15/20/25 L sin indicar a cuál pertenece esta foto. No se crean cuatro versiones escaladas ni se simulan cuchillas o giro. |
| P31 | `licuadora-industrial-con-base` | Vaso cónico, tapa, caja de motor bajo el vaso, bastidor tubular, barra exterior y ruedas rojas como la referencia. La familia enumera 10/15/20 L sin asociar capacidad exacta a la foto. |
| P32 | `maquina-cremoladera-25-l` | Dos tolvas transparentes vacías, tapas, palancas y boquillas, carcasa ventilada y dos bandejas de goteo perforadas. El PDF dice «25 litros» y «2 tolvas», sin aclarar reparto; no se afirma 25 L por tolva ni 50 L totales. El mecanismo interno tapado por el producto de la foto no se inventa. |

Las fotografías de P12–P15 y P30–P32 tienen extensión `.jpg`; P19 usa `.webp`. Los GLB de la primera revisión se conservan en `public/models/inox/<nombre>-v1.glb`. Mantener las fotografías originales como referencia comercial permite contrastar las aproximaciones del 3D.

## Puertas interactivas v2

La ejecución actual genera únicamente P12, P13, P14 y P19 con sufijo `-v2.glb`, sin sobrescribir ningún v1 ni los otros productos. El clip `Abrir_puertas` dura 1,2 segundos y va de cerrado a abierto. La pose guardada es cerrada; hojas, tiradores, juntas, cristal y cerradura permanecen en el mismo conjunto articulado.

| Código | Archivo | Hojas | Bytes | Triángulos |
| --- | --- | ---: | ---: | ---: |
| P12 | `freidora-doble-profesional-v2.glb` | 2 | 2.660.616 | 36.588 |
| P13 | `freidora-de-papa-profesional-v2.glb` | 1 | 2.259.076 | 31.096 |
| P14 | `freidora-automatica-de-papas-v2.glb` | 1 | 2.357.444 | 32.448 |
| P19 | `visicooler-580-litros-v2.glb` | 1 | 3.789.744 | 52.370 |

Cada hoja abre 100°. Es un movimiento de presentación aproximado, no una especificación de bisagra ni recorrido del fabricante. Las freidoras tienen cuerpo hueco, con base, laterales y fondo simplificados; no se inventan quemadores, resistencias, conexiones o elevadores. «Automática» no implica animar las canastillas.

En P19 la fotografía confirma **laterales e interior blancos, marco metálico y base negra**. Se conservan esos acabados: el blanco no es un sustituto genérico del acero. La puerta acristalada se mueve con marco, juntas, uñero y cerradura; las cinco parrillas permanecen en el cuerpo. No se deriva un sistema frigorífico oculto.

## Generación y presupuesto

```sh
node scripts/3d/build-inox-equipos-restantes.mjs
node scripts/check-models.mjs public/models/inox
```

El generador funciona localmente con Three.js y el exportador estándar glTF. Los materiales son PBR, los rótulos y rejillas son geometría y no hay texturas o buffers externos. Las mallas se agrupan por material dentro de cada conjunto rígido para preservar las articulaciones. No requiere un servicio de generación ni una suscripción. La siguiente tabla corresponde a los archivos v1 conservados.

| Código | Bytes | Triángulos | Mallas |
| --- | ---: | ---: | ---: |
| P12 | 2.613.072 | 35.988 | 6 |
| P13 | 2.235.040 | 30.796 | 5 |
| P14 | 2.333.400 | 32.148 | 6 |
| P15 | 2.256.412 | 31.134 | 8 |
| P19 | 3.700.124 | 51.170 | 7 |
| P30 | 743.956 | 10.256 | 5 |
| P31 | 605.432 | 8.320 | 6 |
| P32 | 1.733.712 | 23.960 | 8 |

Todos quedan por debajo del presupuesto de 8 MiB y 300.000 triángulos. Los v1 no incluyen clips; los cuatro v2 incorporan solamente la apertura ilustrativa descrita. GLTFLoader comprobó sus poses cerrada, abierta y cerrada de nuevo, la unión de componentes a las hojas y la visibilidad hasta el fondo del gabinete con rayos. Se revisó también la carga y el renderizado en Chrome. Los 32 archivos v1 conservaron sus hashes. Un mecanismo fiel de fabricación exige fotos adicionales o el diseño original; el modelo no sirve como despiece ni receta de materiales.
