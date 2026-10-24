# Carrito salchipapero P15: estaciones visibles

El modelo `modulo-de-comida-4-en-1-configurable-v1.glb` conserva el carrito P15 del catálogo: gabinete, toldo rojo y amarillo, postes, ruedas y las cuatro estaciones de la fotografía. La broastera, freidora, conservadora y plancha son ensamblajes separados. Al retirar una estación, el visor debe mostrar su superficie lisa de acero y conservar las demás estaciones.

La fotografía y el PDF de INOX 304 (página 10) sustentan las cuatro funciones. Las dimensiones, el recorrido interno, la potencia, los costos y el consumo de materiales no se deducen del modelo. Las superficies sustitutas son una representación para cotizar, sujeta a confirmación de fabricación. No implican que una máquina comprada pueda intercambiar módulos físicamente.

El archivo original `modulo-de-comida-4-en-1-v1.glb` sigue disponible. El nuevo modelo usa la misma reconstrucción de la referencia y no modifica otros productos.

## Contrato de la escena

La escena exportada contiene `userData.cart` (extras de la escena glTF):

```json
{
  "version": 1,
  "productId": "P15",
  "modules": [
    { "id": "broastera", "node": "Broaster", "coverNode": "BroasterCover" },
    { "id": "freidora", "node": "Fryer", "coverNode": "FryerCover" },
    { "id": "conservadora", "node": "Warmer", "coverNode": "WarmerCover" },
    { "id": "plancha", "node": "Griddle", "coverNode": "GriddleCover" }
  ],
  "coverDefaultScale": "zero-until-configured"
}
```

- `CartChassis` conserva la estructura y el toldo.
- Su hijo `CartCanopy` separa la cubierta y sus travesaños de los postes verticales. Puede ocultarse para examinar la encimera sin modificar la configuración comercial del carrito.
- `CartModules` contiene los cuatro ensamblajes activos por defecto.
- `CartCovers` contiene las cuatro superficies lisas alternativas.
- Cada superficie tiene `userData.restScale = [1, 1, 1]`. Se exporta con escala cero para que un visor glTF común muestre correctamente la versión completa. El configurador restaura esa escala antes de controlar `visible`.
- La estación y su superficie alternativa tienen visibilidad opuesta. No se recalculan ni descargan nuevas geometrías al seleccionar.
- Las posiciones no cambian entre selecciones. La cámara no debe reiniciarse al activar un adicional.

Es necesario exportar con `trs: true`: así la escala cero se conserva como una transformación editable, sin una matriz estática que impida restaurarla en el visor.

## Regenerar y comprobar

```powershell
HERRAMIENTAS/node24/node.exe scripts/3d/build-inox-cart.mjs
HERRAMIENTAS/node24/node.exe --test scripts/test-cart-asset.mjs
```

El generador escribe únicamente este nuevo archivo de P15. Presupuesto actual: 2.35 MB, 32 334 triángulos, sin imágenes ni buffers externos. Las pruebas comprueban la separación de estaciones, la conservación de la estructura en las 16 combinaciones visuales, el cierre de la abertura de la freidora y el presupuesto de descarga.

Para añadir otro equipo al carrito se necesita una referencia aprobada, su geometría y reglas propias; no se deben reutilizar automáticamente los adicionales de las cocinas.
