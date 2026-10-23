# Máquinas de helado ILUMI: siete visualizaciones 3D aproximadas

Modelos generados a partir de las fotografías y fichas técnicas oficiales, inspeccionadas antes del modelado. Son reconstrucciones visuales propias, no archivos CAD suministrados por ILUMI. El diseño del producto distribuido es fijo: no se presenta como una máquina fabricada a medida por INOX.

## Referencias y dimensiones

Medidas de **producto** publicadas en las fichas, en milímetros y orden ancho × fondo × alto. Se usan para escalar la envolvente de presentación; la colocación y dimensiones individuales de los accesorios son aproximadas. No se usan las medidas de embalaje.

| Modelo | Medidas de producto | Fotografía / ficha oficial | Diferencia visual |
| --- | --- | --- | --- |
| MHA-16S | 500 × 650 × 800 | [Producto](https://ilumiperu.com/products/maquina-de-helado-artesanal-de-16-litros), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHA-16S.jpg?v=1791235376) | Sobremesa, panel superior negro, cilindro frontal con cierres claros y tolva transparente. |
| MHA-20S | 535 × 535 × 840 | [Producto](https://ilumiperu.com/products/maquina-de-helado-artesanal-de-sobremesa-de-20-litros-por-hora), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHA-20S.jpg?v=1792123087) | Sobremesa, frente metálico, control vertical derecho, cilindro con cuatro cierres negros. |
| MHA-20 | 535 × 535 × 1370 | [Producto](https://ilumiperu.com/products/maquina-de-helado-artesanal-de-hasta-20-litros-por-hora), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHA-20.jpg?v=1791915679) | Máquina de piso, ruedas, apoyo frontal y recipiente de recepción vacío. |
| MHS-25 | 540 × 575 × 1370 | [Producto](https://ilumiperu.com/products/maquina-de-helado-soft-de-25-litros-por-hora), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHS-25.jpg?v=1791334613) | Soft de piso, cabecera metálica, cabezal claro, tres palancas, ruedas y dos portaconos. |
| MHS-25PC | 540 × 735 × 1430 | [Producto](https://ilumiperu.com/products/maquina-de-helado-soft-de-hasta-25-litros-por-hora-con-pre-cooling), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHS-25PC.jpg?v=1791742218) | Pre Cooling, panel negro alto, tres palancas, relieve curvo frontal, portaconos lateral y ruedas. |
| MHS-30S | 540 × 615 × 780 | [Producto](https://ilumiperu.com/products/maquina-de-helado-soft-de-sobremesa-de-30-litros-por-hora), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHS-30S.jpg?v=1792007728) | Soft de sobremesa, cabecera y cabezal negros, tres palancas, bandeja baja y portaconos. |
| MHS-30PC | 540 × 735 × 1430 | [Producto](https://ilumiperu.com/products/maquina-de-helado-soft-pre-cooling-de-25-litros), [ficha](https://ilumiperu.com/cdn/shop/files/Ficha_Tecnica_MHS-30PC.jpg?v=1791304680) | Misma forma y dimensiones exteriores documentadas que 25PC; conserva identidad SKU propia. |

Las siete fotos oficiales se guardaron para comparación junto a las fichas en el espacio de trabajo privado. La fuente de investigación conserva las URL y especificaciones por SKU.

## Límites de la representación

- Las capacidades 16, 20, 25 o 30 **L/h** son producción máxima declarada por el fabricante, no volumen del depósito. No se dibuja un depósito con ese volumen supuesto.
- No hay comida, helado servido ni conos dentro de la geometría. El cilindro, los recipientes y los portaconos se presentan vacíos.
- Se omiten las gráficas promocionales de helados impresas en las fotos de MHS-25 y MHS-30S. No se sustituyen por texturas comerciales inventadas. Las fotografías originales siguen siendo la referencia para el acabado comercial real.
- Los mandos y pantallas son representaciones estáticas. No simulan funcionamiento, temperatura ni rendimiento. No se incluyen animaciones operativas, mecanismos interiores, compresores, cableado ni circulación de refrigerante.
- El cilindro artesanal y sus tapas, tolvas, cierres, boquillas y soportes siguen la forma visible. No se documentan tolerancias, piezas de repuesto ni dimensiones individuales. No se deben usar estos modelos para instalar equipos, fabricar componentes o calcular una receta de materiales.
- En MHS-25 la ficha indica un embalaje de 525 mm de ancho, inferior a los 540 mm declarados para el producto. Se usa la medida de producto y se mantiene esa inconsistencia pendiente de confirmación con ILUMI para decisiones logísticas.
- La URL de MHS-30PC conserva «25-litros», pero el SKU, título y ficha identifican MHS-30PC y 30 L/h. Se conserva el SKU de la ficha.

## Reproducción y archivos

```powershell
& HERRAMIENTAS/node24/node.exe scripts/3d/build-ilumi-helados.mjs
```

El generador produce `public/models/ilumi/<sku-en-minusculas>-v1.glb`: `mha-16s`, `mha-20s`, `mha-20`, `mhs-25`, `mhs-25pc`, `mhs-30s` y `mhs-30pc`.

Los siete archivos son GLB autónomos, sin recursos externos ni clips, con materiales PBR y eje Y vertical. Miden menos de 0,75 MiB y 24 000 triángulos cada uno. Pasan el presupuesto automático del repositorio y el generador verifica la envolvente contra la tabla de dimensiones de producto. Esta verificación de escala no implica precisión CAD de sus piezas.

La publicación debe mantener el aviso **«Visualización 3D aproximada a partir de fotografías»**, sin modificar precios, capacidades comerciales ni opciones del equipo.
