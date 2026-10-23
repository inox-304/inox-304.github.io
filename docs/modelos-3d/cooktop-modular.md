# Cocinas con superficie modular en 3D

Los archivos `cooktop-p02-v1.glb` a `cooktop-p05-v1.glb` son bibliotecas de componentes para el configurador. Reutilizan las geometrías del chasis de las cocinas existentes P02–P05, incluidos patas, controles, repisas, carcasa hueca, puerta y animación. Se conservan los GLB anteriores y los registros del catálogo.

La geometría sigue siendo una reconstrucción de presentación basada en las fotografías documentadas en `inox-cocinas.md`. Las proporciones y alturas de los módulos son visuales; no son medidas comerciales, CAD certificados ni una aprobación de compatibilidad. El wok, la placa eléctrica y la parrilla son representaciones genéricas identificables, pendientes del diseño final del propietario. No se simulan llama, temperatura, energía consumida ni mecanismos ocultos. Los controles del chasis mantienen el aspecto fotografiado; no se rediseñan automáticamente para cada cantidad de módulos.

## Contrato del archivo

`GLTFLoader` entrega esta información en `gltf.scene.userData.cooktop`:

```json
{
  "version": 1,
  "surface": { "minX": -0.715, "maxX": 0.715, "minZ": -0.39, "maxZ": 0.39, "y": 0.819 },
  "templates": {
    "burnerGas": "BurnerGas",
    "burnerElectric": "BurnerElectric",
    "wok": "Wok",
    "griddle": "Griddle",
    "grill": "Grill"
  }
}
```

P02/P03 usan `minZ=-0.25`, `maxZ=0.25`; P04/P05 usan los valores del ejemplo. Son coordenadas del modelo ilustrativo, no dimensiones publicables de un producto. El eje Y apunta arriba, el frente es +Z, la fila cero comienza en `minZ` y las columnas aumentan hacia +X.

La escena contiene:

- `CooktopChassis`: chasis completo sin hornillas ni plancha prefijadas. P04/P05 contienen `Puerta_horno_P04` / `Puerta_horno_P05` y el clip `Abrir_puertas`. P02/P03 tienen bastidor abierto sin animaciones.
- `CooktopTemplates`: banco con `BurnerGas`, `BurnerElectric`, `Wok`, `Griddle`, `Grill`. El banco se exporta visible para conservar todos los componentes. **El visor debe ocultarlo antes del primer render**; no es una composición lista para abrir directamente en model-viewer.

Cada plantilla tiene transformación raíz identidad, base de apoyo Y=0 y huella normalizada dentro de X/Z ±0.5. Mantener las alturas Y sin escalar. Crear las instancias fuera de `CooktopTemplates` y establecer `clone.visible=true`. Los clones pueden compartir geometría/materiales mientras no los modifiquen; al borrar una instancia no deben liberarse esos recursos compartidos.

Para una base de `rows × columns`, calcular `cellW=(maxX-minX)/columns` y `cellD=(maxZ-minZ)/rows`. Un módulo de huella `width × height`, anclado en `row,col`, se coloca en:

```text
X = minX + (col + width/2) * cellW
Y = surface.y
Z = minZ + (row + height/2) * cellD
```

En hornillas y wok, escalar X/Z uniformemente por `min(cellW,cellD)` para conservar los círculos. En plancha y parrilla, escalar X por `width*cellW` y Z por `height*cellD`; Y permanece 1. La selección validada decide ocupación, anclajes y energía. Las celdas cubiertas por una plancha reciben una única instancia de plancha y ninguna hornilla debajo. Las celdas libres reciben la plantilla de hornilla correspondiente a la energía. El archivo no concede capacidades comerciales nuevas ni activa configuraciones.

## Generación y comprobación

```sh
node scripts/3d/build-inox-cooktop-modular.mjs
node scripts/test-cooktop-models.mjs
```

El generador modular importa `createKitchenScene(spec,{includeSurface:false})` del generador original. Importarlo no regenera modelos anteriores; ejecutar directamente `build-inox-cocinas.mjs` conserva su comportamiento previo. Se puede limitar el generador modular a `P02`, `P03`, `P04` o `P05`.

La prueba carga los cuatro archivos con GLTFLoader, comprueba el presupuesto y atributos finitos, bases Y=0, centrado y huellas de las cinco plantillas. Compara todos los vértices del chasis por debajo de la cubierta con el GLB anterior. También compara pivotes y keyframes de las puertas, prueba apertura/retorno y compone plancha+wok+hornillas dentro de la superficie. Los archivos pesan 3,0–3,35 MB y contienen 41.632–46.296 triángulos únicos. Las instancias comparten geometría; el número final de triángulos dibujados depende de la configuración.

No se actualizan rutas de producto, fichas, base de datos ni reglas del propietario desde estos scripts. El registro público del visor debe asociar explícitamente cada código con su biblioteca modular.
