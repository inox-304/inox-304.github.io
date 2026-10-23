# ILUMI DJ-181 · Modelo 3D de presentación

Primera reconstrucción visual realizada para el catálogo de INOX 304 a partir de la fotografía comercial y la ficha técnica del dispensador de jugos ILUMI DJ-181. No es un archivo CAD proporcionado o certificado por ILUMI, ni un plano para fabricar el equipo.

## Evidencia y alcance

- Producto: dispensador de jugos DJ-181, una tolva, capacidad nominal de 18 litros.
- Dimensiones externas declaradas en la ficha: **250 mm de ancho × 386 mm de fondo × 728 mm de alto**.
- Referencias de trabajo: fotografía comercial frontal en tres cuartos y ficha técnica con la misma vista y detalles de carcasa, circulación y tolva. Proceden del catálogo oficial de ILUMI.
- Fuentes oficiales consultadas el 23/10/2026: [producto DJ-181](https://ilumiperu.com/products/dispensador-de-jugos-1-poza-18l), [fotografía comercial](https://ilumiperu.com/cdn/shop/files/DJ-181_2_720x.jpg?v=1766509167) y [ficha técnica original](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_DJ-181.jpg?v=1791058997).
- La ficha describe base, válvula y dispensador push de acero inoxidable 304; tolva y tapa de policarbonato. El modelo representa esos acabados con materiales PBR.
- Las proporciones y piezas secundarias se reconstruyen visualmente. La parte posterior se mantiene sencilla al no existir una referencia posterior suficiente. No se representan mecanismos internos ocultos.
- La tolva se muestra vacía. No se pretende deducir sus dimensiones interiores o capacidad útil mediante la malla.
- La animación **`Abrir_tapa`** levanta la tapa y permanece abierta en el último fotograma. El control reversible del visor vuelve al inicio para colocarla. Ilustra que es extraíble para limpieza; no simula una bisagra ni un mecanismo automático.

## Archivos y reproducción

- Archivo público autocontenido: `public/models/ilumi/dj-181-v1.glb`.
- Fuente de geometría: `scripts/3d/build-ilumi-dj181.mjs`.
- Regenerar desde la raíz del repositorio: `node scripts/3d/build-ilumi-dj181.mjs`.
- Comprobar el presupuesto de carga: `node scripts/check-models.mjs public/models/ilumi`.
- Unidades glTF: metros; eje vertical Y; frente orientado hacia +Z. El modelo descansa en Y=0.

La malla incluye esquinas biseladas, chapa lateral perforada con aberturas reales, patas, grifo con pulsador, bandeja hueca y rejilla abierta, tolva transparente ligeramente cónica, tapa y tubo de circulación. Las piezas rígidas se agrupan por material para limitar las llamadas de dibujo. Las letras de la placa son geometría, sin imágenes o recursos externos.

La dependencia Three.js ya forma parte de las dependencias instaladas de `@google/model-viewer`. No se instala Blender ni se descarga una malla de terceros para generar este archivo. La validación de presupuesto debe complementarse con revisión visual en el visor del catálogo antes de publicarlo.
