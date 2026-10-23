# ILUMI B-10L, B-20L y B-30L · Modelos de presentación

Reconstrucciones visuales creadas a partir de las fotografías comerciales y fichas oficiales de ILUMI, examinadas el **23/10/2026**. No son CAD certificados por el fabricante ni planos de fabricación.

| Modelo | Bowl nominal | Dimensiones exteriores, ancho × fondo × alto | Medidas de bowl declaradas, diámetro × profundidad |
| --- | --- | --- | --- |
| B-10L | 10 L | 440 × 340 × 650 mm | 270 × 250 mm |
| B-20L | 20 L | 540 × 430 × 770 mm | 340 × 290 mm |
| B-30L | 30 L | 570 × 450 × 780 mm | 360 × 340 mm |

Las fichas distinguen el volumen del bowl de la capacidad de masa. El tamaño del recipiente no indica que pueda procesarse ese mismo volumen de masa.

## Fuentes oficiales

- **B-10L**: [producto](https://ilumiperu.com/products/batidora-industrial-de-10-litros), [fotografía](https://ilumiperu.com/cdn/shop/files/B-10L_378ae76e-1edb-4908-99f8-013d5be93c90_720x.jpg?v=1705350910), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_B-10L.jpg?v=1790089774).
- **B-20L**: [producto](https://ilumiperu.com/products/batidora-industrial-de-20-litros), [fotografía](https://ilumiperu.com/cdn/shop/files/B-20L_720x.jpg?v=1705350937), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_B-20L.jpg?v=1789956753).
- **B-30L**: [producto](https://ilumiperu.com/products/batidora-industrial-de-30-litros), [fotografía](https://ilumiperu.com/cdn/shop/files/B-30L_f9eb118d-6457-40a5-9fe4-ef1626d97236_720x.jpg?v=1705350949), [ficha técnica](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_B-30L.jpg?v=1792576448).

Las seis imágenes fueron descargadas e inspeccionadas antes del modelado. Comparten un cabezal blanco redondeado, columna trasera, base en U, bowl de inoxidable, resguardo de varillas y mandos laterales. Las dimensiones de cada bowl se parametrizan por separado; no se limita a escalar una máquina completa.

## Representación y límites

- Bowl abierto y hueco con fondo redondeado, pared interior y labio; no se tapa con un disco.
- Rejilla de protección realizada con varillas y aros, dejando huecos reales.
- Globo batidor interior representado en reposo, siguiendo la herramienta montada en la fotografía.
- Cabezal, collar, tapa frontal, columna, soportes y base de apariencia pintada; acero con materiales PBR y reflejos diferenciados.
- Volante negro, manivela, selector metálico e interruptor rojo visibles. Las inscripciones secundarias ilegibles no se inventan.
- El usuario puede girar y acercar el modelo en el visor. **No hay animaciones** de apertura, rotación, descenso de bowl o funcionamiento: las referencias no documentan suficientemente sus recorridos o mecanismos.
- La trasera se mantiene sencilla. No se modelan engranajes, motores o conexiones ocultas.

Las proporciones secundarias son aproximadas. Las dimensiones impresas sirven como envolvente de presentación, con una corrección final inferior al 0,1 % para incluir pequeños salientes de placas. El modelo no sirve para inferir espesores de chapa, tolerancias, distancias de seguridad o capacidad útil.

## Reproducción y archivos

Generador: `scripts/3d/build-ilumi-batidoras.mjs`.

```sh
node scripts/3d/build-ilumi-batidoras.mjs
node scripts/check-models.mjs public/models/ilumi
```

| Modelo | GLB | Tamaño | Triángulos | Mallas/materiales |
| --- | --- | ---: | ---: | ---: |
| B-10L | `public/models/ilumi/b-10l-v1.glb` | 2.938.736 bytes, 2,80 MiB | 40.692 | 8/8 |
| B-20L | `public/models/ilumi/b-20l-v1.glb` | 2.938.724 bytes, 2,80 MiB | 40.692 | 8/8 |
| B-30L | `public/models/ilumi/b-30l-v1.glb` | 2.938.728 bytes, 2,80 MiB | 40.692 | 8/8 |

Los archivos glTF 2.0 binarios usan metros, eje Y vertical y frente +Z. Son autocontenidos, sin imágenes, buffers o URLs externas. La generación local no depende de servicios de pago ni modifica los modelos DJ ya entregados. La comprobación de presupuesto debe complementarse con revisión visual del catálogo antes de publicar.
