# Carrito salchipapero P15: estaciones y distribución

El modelo `modulo-de-comida-4-en-1-configurable-v2.glb` conserva el carrito P15 del catálogo: gabinete, toldo rojo y amarillo, postes, ruedas y las cuatro estaciones de la fotografía. La broastera, freidora, conservadora y plancha son ensamblajes separados. Al retirar una estación, el visor muestra su superficie lisa de acero. Al cambiar su posición, intercambia la estación completa con su destino, conservando sus dimensiones.

La fotografía y el PDF de INOX 304 (página 10) sustentan las cuatro funciones. Las dimensiones, el recorrido interno, la potencia, los costos y el consumo de materiales no se deducen del modelo. Las superficies sustitutas son una representación para cotizar, sujeta a confirmación de fabricación. No implican que una máquina comprada pueda intercambiar módulos físicamente.

El archivo original `modulo-de-comida-4-en-1-v1.glb` y la primera versión configurable siguen disponibles. El nuevo modelo usa la misma reconstrucción de la referencia y no modifica otros productos.

## Uso

Pulsa **Mover** en un equipo y elige una de las cuatro posiciones en el esquema o directamente en el 3D. También puedes usar el selector de posición de cada equipo. **Ver encimera** oculta el toldo para inspeccionar las estaciones. Las posiciones se leen de izquierda a derecha mirando el frente. La cotización incluye ese mismo orden, también los espacios libres. Deshacer, Rehacer y Restablecer conservan juntos la distribución y los adicionales.

La selección contiene `included` y `order`. `order` siempre incluye los cuatro identificadores una sola vez, incluso cuando una estación queda como superficie de trabajo. Se mantienen 24 distribuciones y 16 combinaciones de equipamiento. El servidor acepta selecciones antiguas sin `order` con el orden original. El esquema publicado permite seguir personalizando si el servidor falla; una revocación explícita del propietario sí se respeta.

## Contrato de la escena

La escena exportada contiene `userData.cart` (extras de la escena glTF):

```json
{
  "version": 2,
  "productId": "P15",
  "modules": [
    { "id": "broastera", "node": "Broaster", "coverNode": "BroasterCover", "deckNode": "BroasterDeck", "centerX": -0.425, "width": 0.365 },
    { "id": "freidora", "node": "Fryer", "coverNode": "FryerCover", "deckNode": "FryerDeck", "centerX": -0.1375, "width": 0.210 },
    { "id": "conservadora", "node": "Warmer", "coverNode": "WarmerCover", "deckNode": "WarmerDeck", "centerX": 0.1075, "width": 0.280 },
    { "id": "plancha", "node": "Griddle", "coverNode": "GriddleCover", "deckNode": "GriddleDeck", "centerX": 0.4275, "width": 0.360 }
  ],
  "coverDefaultScale": "zero-until-configured",
  "layout": { "minX": -0.6075, "maxX": 0.6075, "minZ": -0.2875, "maxZ": 0.2875, "surfaceY": 0.785 }
}
```

- `CartChassis` conserva la estructura y el toldo.
- Su hijo `CartCanopy` separa la cubierta y sus travesaños de los postes verticales. Puede ocultarse para examinar la encimera sin modificar la configuración comercial del carrito.
- `CartModules` contiene los cuatro ensamblajes activos por defecto.
- `CartCovers` contiene las cuatro superficies lisas alternativas.
- `CartDecks` contiene la encimera de cada estación. El hueco de la freidora se desplaza junto con ella; no permanece una abertura en su lugar anterior.
- Cada superficie tiene `userData.restScale = [1, 1, 1]`. Se exporta con escala cero para que un visor glTF común muestre correctamente la versión completa. El configurador restaura esa escala antes de controlar `visible`.
- La estación y su superficie alternativa tienen visibilidad opuesta. No se recalculan ni descargan nuevas geometrías al seleccionar.
- Cada intercambio traslada el módulo, su superficie sustituta y su encimera. No escala el equipamiento ni reinicia la cámara. Los anchos del contrato son unidades visuales normalizadas, no medidas de fabricación.

Es necesario exportar con `trs: true`: así la escala cero se conserva como una transformación editable, sin una matriz estática que impida restaurarla en el visor.

## Regenerar y comprobar

```powershell
HERRAMIENTAS/node24/node.exe scripts/3d/build-inox-cart-layout.mjs
HERRAMIENTAS/node24/node.exe --test scripts/test-cart-config.mjs scripts/test-cart-ui.mjs scripts/test-cart-scene.mjs scripts/test-cart-sync.mjs scripts/test-cooktop-media.mjs
```

El generador escribe únicamente el modelo v2 de P15. Presupuesto actual: 2.42 MB, 33 234 triángulos, sin imágenes ni buffers externos. Las pruebas cubren las 384 combinaciones de distribución y equipamiento, los límites de la encimera, la abertura móvil de la freidora, selección por rayos, cámara estable, cotización y recuperación del visor.

Para añadir otro equipo al carrito se necesita una referencia aprobada, su geometría y reglas propias; no se deben reutilizar automáticamente los adicionales de las cocinas.
