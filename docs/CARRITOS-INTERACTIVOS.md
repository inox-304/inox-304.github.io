# Carrito P15: equipamiento que cambia en 3D

La ficha del carrito salchipapero ofrece broastera, freidora, conservadora y plancha, inicialmente incluidas como en el modelo de referencia. Cada casilla retira o coloca la geometría de esa estación; al retirarla aparece una superficie de acero. No cambia la estructura, las ruedas ni el toldo. Hay deshacer, rehacer y restablecer. La cotización enumera lo incluido y lo sustituido por superficie de trabajo, sin calcular precios inventados.

«Ocultar toldo» y «Ver encimera» son controles de inspección, no adicionales comerciales. El toldo permanece incluido. El modelo es ilustrativo y no certifica medidas, conexiones, presión, capacidades ni viabilidad de fabricación.

## Administración

El propietario entra a Catálogo → Productos → P15 → Configurador del carrito. Selecciona fabricación propia, línea caliente y familia **Carritos de comida**. Puede activar el configurador y marcar qué estaciones ofrecer y cuáles aparecen incluidas inicialmente. Una estación no ofrecida queda como superficie de trabajo. Las opciones no se heredan a productos distribuidos ni a otras familias. Los adicionales con tarifa siguen siendo independientes de este equipamiento base configurable.

El editor requiere permisos del propietario. La migración `0011_product_cart_config` agrega el campo vacío y la familia; no activa productos ni modifica cuentas. El despliegue de esta entrega activa únicamente P15 tras un respaldo. Para otro carrito hace falta revisar su geometría y ampliar explícitamente el registro `src/lib/cart-assets.ts`; habilitar controles sin preparar el modelo no produce un 3D compatible.

## Carga y publicación

`src/data/cart-published.json` contiene las cuatro opciones revisadas para la web estática. Se puede personalizar desde que carga la página, sin esperar a Render. La comprobación pública `/api/catalog/P15/cart/` confirma las reglas del propietario. Error de red, respuesta inválida, timeout o reintento conservan selección, historial y modelo. Una respuesta válida que deshabilita las reglas, o un 404/410, retira el configurador. Una respuesta antigua nunca pisa una posterior.

Tras cambiar las reglas del panel, actualizar también el JSON publicado con la proyección validada de ese endpoint y publicar la web para renovar su copia sin conexión. El dispositivo sin conexión no puede conocer una revocación nueva hasta conectarse. No almacenar precios, contactos privados ni credenciales en este archivo.

`/api/catalog/P15/cart/check/?selection={"included":["freidora","plancha"]}` valida una solicitud contra las reglas actuales; no guarda pedidos ni descuenta inventario. No se deducen consumos de las mallas 3D. Recetas, costos y medidas requieren datos del taller.

El GLB modular se carga una vez al abrir el 3D o elegir una opción. Los cambios posteriores alternan nodos en memoria, conservando cámara y zoom. El motor deja de dibujar cuando está quieto y libera recursos al volver a la foto. Fotos, GLB original, rutas y códigos se conservan.

## Verificación

Ejecutar los tests `test-cart-{config,ui,sync,asset,scene}.mjs`, los casos de carrito en `test-cooktop-media.mjs` y `backend/catalog/test_cart.py`. Incluyen las 16 combinaciones, mallas reales, foco, historial, producto ajeno, permisos, fallos de red y WebGL. Probar además la ficha construida en navegador, selección durante la carga, inspección del toldo, cotización y reintento sin servidor.
