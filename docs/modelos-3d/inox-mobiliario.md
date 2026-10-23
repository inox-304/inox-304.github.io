# Mobiliario INOX 304: reconstrucciones visuales P23-P29

Siete modelos ligeros para presentar los muebles del catálogo del propietario. Son visualizaciones aproximadas obtenidas de sus fotografías, no archivos CAD de fabricación ni modelos de SketchUp proporcionados por el taller.

## Fuentes y alcance

Se inspeccionaron las páginas completas 15-18 del documento aportado `INOX304_catalogo_FINAL.pdf`, contrastadas con el texto de `INOX304_datos_y_catalogo.pdf`, y las fotos actuales del sitio. La procedencia de esas fotos y sus recortes está documentada en [catalog-sources.md](../catalog-sources.md) y [resource-inventory.md](../resource-inventory.md).

| Código | Modelo y foto de referencia en `public/images/products/` | Página | Rasgos representados |
| --- | --- | ---: | --- |
| P23 | `lavatorio-con-repisas-superiores.webp` | 15 | Una poza a la izquierda, superficie derecha, gabinete con cuatro puertas y dos frentes de cajón, respaldo, tres repisas superiores sobre tres montantes y grifería visible. |
| P24 | `lavatorio-de-1-poza.webp` | 15 | Una poza izquierda, escurridor derecho liso, respaldo, patas tubulares, repisa inferior y tubo de desagüe visible en la foto. |
| P25 | `lavatorio-de-2-pozas-escurridores.webp` | 16 | Dos pozas, descanso derecho con repisa inferior, respaldo alto, escurridor de platos, soportes de vasos y sector de utensilios. |
| P26 | `lavadero-de-2-pozas-con-descanso.webp` | 16 | Dos pozas, descanso derecho con división inferior, respaldo corto y bastidor abierto con travesaños. |
| P27 | `estante-de-5-niveles.jpg` | 17 | Cinco repisas planas, cuatro montantes, barandillas superiores y apoyos oscuros. |
| P28 | `mesa-central-de-trabajo.jpg` | 17 | Mesa central de superficie lisa, patas tubulares y una repisa inferior. |
| P29 | `estacion-bartender-profesional.jpg` | 18 | Mesa derecha con gabinete de dos puertas, hueco abierto inferior izquierdo, cuatro recipientes traseros, áreas empotradas y portabotellas frontal. |

Las fotografías son del catálogo del propietario, que identifica su procedencia como INOX 304 Perú. No se consultaron diseños genéricos para sustituirlas.

## Medidas verificadas y límites

- **P24:** el catálogo especifica una poza de **50 × 50 × 32 cm**. En este modelo la abertura interior mide 0,50 × 0,50 m y la profundidad interior 0,32 m. Las paredes tienen una ligera conicidad ilustrativa; el radio de las esquinas y el fondo no están acotados por la fuente.
- **P27:** se conserva la identificación de cinco niveles. El texto menciona estructura de 1,2 mm, pero este GLB representa superficies visibles y no un despiece con espesores constructivos.
- Ninguno de estos siete productos tiene ancho, fondo y alto exterior documentados en esas páginas. Los valores usados por el generador son **escala ilustrativa para la vista 3D**, no medidas comerciales. No se heredan las medidas de la poza P24 a otros lavaderos.
- El grifo de P23 y P24 se representa porque aparece en sus fotos; su forma y tamaño son aproximados y no acreditan que se incluya con la compra. Las conexiones internas, plomería posterior y fijaciones ocultas no están documentadas.
- P29 no incorpora las bebidas, alimentos, botellas ni utensilios removibles que aparecen en la fotografía. Sus recipientes se muestran vacíos y sin inventar perforaciones de drenaje.
- Las puertas y cajones se muestran cerrados, sin clips de movimiento. No se inventa un interior de gabinete ni un mecanismo de apertura.

Este material no permite calcular consumos de plancha, tubos, accesorios, costos, cortes ni recetas de fabricación. Las recetas reales deben definirse por separado con datos del taller. Para sustituir estas aproximaciones por modelos exactos se necesitan los archivos del diseñador o planos cotados aprobados por el propietario.

## Archivos y reproducción

Generador: `scripts/3d/build-inox-mobiliario.mjs`.

```powershell
& HERRAMIENTAS/node24/node.exe scripts/3d/build-inox-mobiliario.mjs
```

Salida en `public/models/inox/`, con el slug existente y sufijo `-v1.glb`:

- `lavatorio-con-repisas-superiores-v1.glb`
- `lavatorio-de-1-poza-v1.glb`
- `lavatorio-de-2-pozas-escurridores-v1.glb`
- `lavadero-de-2-pozas-con-descanso-v1.glb`
- `estante-de-5-niveles-v1.glb`
- `mesa-central-de-trabajo-v1.glb`
- `estacion-bartender-profesional-v1.glb`

Cada GLB es autónomo: geometría real, materiales PBR, unidades de escena en metros, suelo en Y=0, vista frontal hacia +Z y cero recursos externos. Las piezas se agrupan por material para reducir peso y llamadas de dibujo. `userData` conserva el código, la página de referencia, la distinción entre medidas verificadas y escala ilustrativa, y `manufacturingUse: false`.

Todos pasan el presupuesto automático de GLB del repositorio, muy por debajo de 8 MiB y 300 000 triángulos. La publicación debe conservar el aviso **«Visualización 3D aproximada a partir de fotografías»**; el archivo no cambia precios, existencias, variantes ni permisos del catálogo.
