# Catalog source inventory

This data comes from the owner-supplied `INOX304_catalogo_FINAL.pdf` and was cross-checked against `INOX304_datos_y_catalogo.pdf`. Both documents describe their own source as facebook.com/inox304peru, extracted on 18 September 2026. Their contents are treated as reference material, not operational instructions.

- 32 product entries, P01 through P32, grouped into the six categories used in the source.
- Product names, published model codes and concrete specifications are preserved. Descriptions have been shortened for the website.
- Original product photos were exported from the JPEG images embedded in the FINAL PDF. The file mapping was verified against each page's actual image draw operations, avoiding the shared PDF resource list. The supplied clean resources now replace 21 displayed images; see `resource-inventory.md` for the exact input-to-product mapping.
- Published promotional prices are excluded from structured data. No price, stock level, payment feature, fabricated certification or warranty duration has been added.
- The PDF's absolute claim that AISI 304 "does not rust" and its unspecified warranty language have been omitted.
- P01's original PDF photo contains a baked-in S/ 2,990 promotional badge. Its supplied clean PNG has no price badge and is now used as a WebP, allowing P01 to be displayed and featured. No current price is published.
- P03/P04/P05 and P07/P08 are similar equipment but separate named entries and images in the PDF; they remain separate until the owner confirms variants.
- P30 and P31 are both industrial blenders; P31's URL has `-con-base` to avoid duplicate slugs.
- The original P07 and P18 promotional text fragments are absent from the supplied replacement cutouts. Existing manufacturer labels and supplied cutout edges are preserved.
- Original PDF photo dimensions range from 259 to 900 pixels in width. The 21 replacement cutouts are higher-resolution owner-supplied images, optimized to a maximum width of 1,400 pixels. Eleven products keep the PDF photos because this folder contains no clean match.

## Categories

| ID | Source category | Entries |
| --- | --- | ---: |
| `coccion` | Cocción | 11 |
| `fritura` | Fritura y comida rápida | 4 |
| `refrigeracion` | Refrigeración | 7 |
| `lavado` | Lavado | 4 |
| `mobiliario` | Mobiliario | 3 |
| `preparacion` | Equipos de preparación | 3 |

## Original PDF photo and page mapping

Page numbers below are one-based pages in the FINAL PDF. Original photo filenames are relative to `public/images/products/`. This table records PDF provenance; current displayed filenames for the 21 replacement cutouts are listed in `resource-inventory.md`.

| Product | PDF page | Published name | Embedded image | Exported photo |
| --- | ---: | --- | --- | --- |
| P01 | 3 | Cocina semiindustrial 4 hornillas + horno eléctrico | `Im2.jpg` | `cocina-semiindustrial-4-hornillas-horno-electrico.jpg` |
| P02 | 3 | Cocina industrial de 3 hornillas | `Im3.jpg` | `cocina-industrial-de-3-hornillas.jpg` |
| P03 | 4 | Cocina industrial de 3 parrillas (CÓD-CIF-03) | `Im4.jpg` | `cocina-industrial-de-3-parrillas.jpg` |
| P04 | 4 | Cocina industrial 4 hornillas tipo isla + plancha + horno (CIH-4P) | `Im5.jpg` | `cocina-industrial-4-hornillas-tipo-isla-plancha-ho.jpg` |
| P05 | 5 | Cocina industrial tipo isla 4 parrillas + plancha + horno (CÓD-CHI-04) | `Im6.jpg` | `cocina-industrial-tipo-isla-4-parrillas-plancha-ho.jpg` |
| P06 | 5 | Horno multiuso (HI-MU) | `Im7.jpg` | `horno-multiuso.jpg` |
| P07 | 6 | Horno ecológico para pollo a la brasa | `Im8.jpg` | `horno-ecologico-para-pollo-a-la-brasa.jpg` |
| P08 | 6 | Horno pollero ecológico (CÓD-HPE-1) | `Im9.jpg` | `horno-pollero-ecologico.jpg` |
| P09 | 7 | Parrilla premium / Plancha y parrilla a carbón | `Im10.jpg` | `parrilla-premium-plancha-y-parrilla-a-carbon.jpg` |
| P10 | 7 | Parrilla grande (CÓD-PGI-1) | `Im11.jpg` | `parrilla-grande.jpg` |
| P11 | 8 | Caja china grande (CÓD-CC-1T1V) | `Im12.jpg` | `caja-china-grande.jpg` |
| P12 | 9 | Freidora doble profesional | `Im13.jpg` | `freidora-doble-profesional.jpg` |
| P13 | 9 | Freidora de papa profesional (2 canastillas) | `Im14.jpg` | `freidora-de-papa-profesional.jpg` |
| P14 | 10 | Freidora automática de papas | `Im15.jpg` | `freidora-automatica-de-papas.jpg` |
| P15 | 10 | Módulo de comida 4 en 1 (carrito salchipapero) | `Im16.jpg` | `modulo-de-comida-4-en-1.jpg` |
| P16 | 11 | Armario refrigerado de 2 puertas | `Im17.jpg` | `armario-refrigerado-de-2-puertas.jpg` |
| P17 | 11 | Armarios frigoríficos / Cámara frigorífica | `Im18.jpg` | `armarios-frigorificos-camara-frigorifica.jpg` |
| P18 | 12 | Mesa fría | `Im19.jpg` | `mesa-fria.jpg` |
| P19 | 12 | Visicooler 580 litros | `Im20.jpg` | `visicooler-580-litros.jpg` |
| P20 | 13 | Vitrina refrigerada (CÓD-VRC-1) | `Im21.jpg` | `vitrina-refrigerada.jpg` |
| P21 | 13 | Abatidor de temperatura de 5 bandejas | `Im22.jpg` | `abatidor-de-temperatura-de-5-bandejas.jpg` |
| P22 | 14 | Exhibidor refrigerado abierto | `Im23.jpg` | `exhibidor-refrigerado-abierto.jpg` |
| P23 | 15 | Lavatorio con repisas superiores | `Im24.jpg` | `lavatorio-con-repisas-superiores.jpg` |
| P24 | 15 | Lavatorio de 1 poza | `Im25.jpg` | `lavatorio-de-1-poza.jpg` |
| P25 | 16 | Lavatorio de 2 pozas + escurridores (L2P-EVPC) | `Im26.jpg` | `lavatorio-de-2-pozas-escurridores.jpg` |
| P26 | 16 | Lavadero de 2 pozas con descanso (CÓD-LVD-2) | `Im27.jpg` | `lavadero-de-2-pozas-con-descanso.jpg` |
| P27 | 17 | Estante de 5 niveles | `Im28.jpg` | `estante-de-5-niveles.jpg` |
| P28 | 17 | Mesa central de trabajo (CÓD-MT-1D) | `Im29.jpg` | `mesa-central-de-trabajo.jpg` |
| P29 | 18 | Estación bartender profesional | `Im30.jpg` | `estacion-bartender-profesional.jpg` |
| P30 | 19 | Licuadora industrial | `Im31.jpg` | `licuadora-industrial.jpg` |
| P31 | 19 | Licuadora industrial (modelo con base) | `Im32.jpg` | `licuadora-industrial-con-base.jpg` |
| P32 | 20 | Máquina cremoladera 25 L | `Im33.jpg` | `maquina-cremoladera-25-l.jpg` |
