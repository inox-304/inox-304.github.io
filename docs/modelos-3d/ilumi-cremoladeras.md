# ILUMI CR-121, CR-122 y CR-123 · Modelos de presentación

Reconstrucciones visuales aproximadas de las cremoladeras ILUMI de una, dos y tres tolvas. Se elaboraron a partir de las fotografías y fichas oficiales consultadas el 23/10/2026. No son archivos CAD proporcionados por ILUMI ni planos para fabricar o reparar los equipos.

| Modelo | Tolvas | Capacidad total declarada | Medidas exteriores, ancho × fondo × alto | Archivo |
| --- | ---: | ---: | --- | --- |
| CR-121 | 1 | 12 L | 240 × 530 × 800 mm | `public/models/ilumi/cr-121-v1.glb` |
| CR-122 | 2 | 24 L | 430 × 530 × 800 mm | `public/models/ilumi/cr-122-v1.glb` |
| CR-123 | 3 | 36 L | 620 × 530 × 800 mm | `public/models/ilumi/cr-123-v1.glb` |

Las capacidades de las fichas de CR-122 y CR-123 son **12 L por tolva**. Los títulos comerciales que mencionan 24 o 36 litros describen la capacidad total del equipo; no se multiplicaron nuevamente por el número de tolvas. El volumen geométrico aproximado no sirve para medir la capacidad útil.

## Fuentes primarias examinadas

- **CR-121:** [producto oficial](https://ilumiperu.com/collections/maquinas-cremoladeras/products/cremoladera-de-12-litros-con-1-tolva), [fotografía](https://ilumiperu.com/cdn/shop/files/CR-121_2_720x.jpg?v=1730213279), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_CR-121.jpg?v=1791640814).
- **CR-122:** [producto oficial](https://ilumiperu.com/collections/bodegas/products/cremoladera-de-24-litros-con-2-tolvas), [fotografía](https://ilumiperu.com/cdn/shop/files/CR-122_2_720x.jpg?v=1730214202), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_CR-122.jpg?v=1791934294).
- **CR-123:** [producto oficial](https://ilumiperu.com/collections/maquinas-cremoladeras/products/cremoladera-de-36-litros-con-3-tolvas), [fotografía](https://ilumiperu.com/cdn/shop/files/CR-123_2_720x.jpg?v=1728060806), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_CR-123.jpg?v=1791251827).

Las seis imágenes se examinaron antes de modelar. La forma exterior de los recipientes es distinta de los dispensadores DJ: la parte inferior tiene perfil semicilíndrico horizontal, con un depósito superior alto. Los cuerpos se ampliaron según las medidas oficiales y se representaron las diferencias visibles entre los paneles del equipo individual y los múltiples.

## Alcance visual y límites

- Chapa satinada, cantos doblados, rejillas laterales con aberturas reales, patas y tapa superior de apoyo.
- Una, dos o tres tolvas transparentes con el fondo semicilíndrico, reborde frontal circular, nervaduras superiores y tapa negra/traslúcida, siguiendo la silueta fotografiada.
- Manijas negras de dispensación, boquillas, bandejas de goteo individuales con rejillas abiertas y soportes metálicos. El distintivo azul de CR-122 se representa como en su fotografía; no se añadió a los otros dos modelos.
- Panel digital y placa de marca mediante geometría. Los segmentos del visor son ilustrativos y no muestran una lectura de temperatura real.
- Las bebidas amarillas, rojas o naranjas son **contenido ilustrativo**, como en las fotografías, y no implican ingredientes incluidos, accesorios ni una receta. Su nivel no representa un aforo calibrado.
- La parte posterior se conserva sencilla por falta de fotografías suficientes. No se inventaron motores, conexiones eléctricas ni mecanismos internos. Aunque las fichas describen un agitador, no especifican su geometría completa; no se reconstruyó a ciegas.
- **Sin animaciones.** Las referencias examinadas identifican la tapa, pero no documentan suficientemente su sujeción o recorrido. No se añadieron bisagras ni movimientos que pudieran interpretarse como instrucciones de desmontaje. El visor permite rotación y acercamiento del equipo completo.

Las medidas totales delimitan la presentación; las proporciones secundarias, perforaciones, controles, letras y accesorios se estimaron visualmente. No usar la malla para planos de instalación, fabricación, limpieza o mantenimiento.

## Reproducción y verificación

```sh
node scripts/3d/build-ilumi-cremoladeras.mjs
node scripts/3d/build-ilumi-cremoladeras.mjs CR-122
node scripts/check-models.mjs public/models/ilumi
```

El generador usa Three.js ya instalado con `@google/model-viewer`, sin descargar mallas de terceros. Los tres GLB contienen geometría y materiales PBR, sin texturas ni enlaces a recursos externos. Las piezas rígidas se agrupan por material y los vértices idénticos se comparten para reducir descarga y llamadas de dibujo. Unidades: metros; eje Y vertical; frente hacia +Z; suelo en Y=0.

Presupuesto verificado del primer lote: aproximadamente 1,0 / 1,35 / 1,60 MiB y 33.196 / 45.792 / 56.852 triángulos. El propio generador rechaza dimensiones fuera de tolerancia, errores estructurales del presupuesto, archivos de más de 8 MiB o mallas de más de 300.000 triángulos. Los modelos requieren además revisión visual en el visor antes de publicarlos.
