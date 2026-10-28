# Publicar equipos y modelos desde el panel

## Un equipo nuevo

1. En el panel alojado, abre **Catálogo → Productos → Añadir**.
2. Completa nombre, línea y descripción. Los identificadores se generan al guardar y se conservan al editar.
3. En **Fotos y archivos**, añade la foto principal y el modelo **GLB 2.0**, con sus texturas incluidas, de hasta **8 MB**. El PDF y el precio son opcionales. También puedes publicar equipos con fotografía y añadir el modelo después.
4. Si hay capacidades o versiones, usa **Variaciones** dentro del mismo equipo. Cada variación puede tener su propia foto, GLB, ficha y disponibilidad; activa sólo las que estén revisadas. Los tipos de opción y las reglas de personalización los define el propietario.
5. Pulsa **Guardar y revisar**. El equipo nuevo se guarda como borrador y se abre una **vista previa privada**. Revisa la foto, pulsa **Ver 360°** y comprueba las variaciones.
6. Pulsa **Publicar en catálogo**. Abre el enlace al catálogo oficial para comprobar el equipo.

Para publicar, el equipo debe estar activo, tener foto principal y superar las validaciones de datos. Si alguien lo cambió después de abrir la vista previa, vuelve a revisarlo antes de publicar. Los borradores y sus archivos privados no se entregan por la API pública.

## Cambios y retirada

Guardar un equipo **ya publicado** actualiza sus datos públicos; no crea una segunda versión privada. Para preparar una revisión sin modificar la versión que ven los clientes, usa **Duplicar como borrador** y revisa cómo sustituir la ficha original antes de publicar la copia; no publiques ambos si son el mismo equipo.

Para retirar un equipo, desmarca **Publicado en la web** y guarda, o utiliza la acción **Ocultar seleccionados**. Se conserva el producto y sus archivos. La siguiente actualización válida del catálogo retira la tarjeta y deshabilita su ficha. Las variaciones se retiran desmarcando **Activa** dentro del equipo.

## Actualización de la web

La web estática mantiene su catálogo incorporado como respaldo y consulta el catálogo público del panel al abrirse, al volver a la pestaña y periódicamente mientras está visible. Los cambios aparecen cuando llega una respuesta completa y válida; no hace falta volver a compilar por cada producto.

Un fallo de red, una respuesta incompleta o un servidor lento no elimina los equipos ni sus configuradores. Se conserva la última respuesta válida, también entre visitas en el mismo navegador durante un máximo de siete días. Sólo se guarda información pública, nunca vistas previas, sesiones ni credenciales. Una respuesta válida vacía sí significa que el catálogo fue retirado completo.

El alojamiento gratuito puede tardar en despertar. La página muestra un aviso y permite reintentar; los productos nuevos necesitan una primera conexión correcta para aparecer. Este respaldo no garantiza que un archivo remoto que aún no se descargó pueda abrirse sin conexión, ni que una retirada llegue a un dispositivo desconectado. Las fichas nuevas tienen un enlace estable `/equipo/?id=CODIGO`, sin necesitar un HTML nuevo por producto.

## SketchUp 2023

Conserva el `.skp` original. En SketchUp exporta **Archivo → Exportar → Modelo 3D → COLLADA (.dae)** y activa **Exportar mapas de textura**. Conserva el DAE y su carpeta de texturas juntos para preparar una copia GLB optimizada.

El panel recibe el **GLB preparado**: no convierte automáticamente archivos SKP o DAE. Puertas, hornillas y otros módulos deben mantenerse separados y con nombres claros. Las animaciones y los configuradores requieren preparar las piezas, ejes y reglas compatibles; subir geometría no inventa medidas, recetas ni compatibilidades de fabricación.
