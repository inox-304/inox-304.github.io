# Publicar equipos y modelos desde el panel

## Un equipo nuevo

1. En el panel alojado, abre **Catálogo → Productos → Añadir**.
2. Completa nombre, línea y descripción. Los identificadores se generan al guardar y se conservan al editar.
3. En **Fotos y archivos**, añade la foto principal. Si ya tienes un modelo preparado, admite **GLB 2.0** con texturas incluidas, hasta **8 MB y 300 000 triángulos**. Para un archivo **SketchUp (.skp)**, guarda primero el equipo y sigue el flujo de conversión indicado más abajo. El PDF y el precio son opcionales; también puedes publicar con fotografía y añadir el 3D después.
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

El panel permite subir el **`.skp` directamente**, sin exportar primero a DAE y sin que la PC del propietario ejecute la conversión. El servidor prepara una copia GLB y conserva el original en almacenamiento privado.

1. Crea el equipo como borrador o abre su ficha existente. Pulsa **Subir SketchUp y preparar modelo 3D**.
2. Selecciona el equipo principal o una de sus variaciones. Adjunta un **SKP de hasta 20 MB** y pulsa **Preparar modelo para revisar**.
3. Consulta el estado: **En cola → Preparando modelo → Listo para revisar**. Puedes cerrar la pestaña y volver a **Ver conversiones de este equipo**.
4. Abre la **vista previa privada**. Comprueba la escala, geometría, texturas y piezas; lee los avisos del conversor.
5. Pulsa **Aplicar modelo al equipo**. Si sigue siendo borrador, revisa el conjunto y pulsa después **Publicar en catálogo**. Aplicar no publica por sí solo un borrador.

En un equipo **ya publicado**, aplicar reemplaza el modelo visible después de confirmar la casilla correspondiente. El archivo anterior se conserva, pero no se crea una revisión pública independiente. Si el equipo o el resultado cambió desde que abriste la vista previa, vuelve a revisarlo antes de aplicar.

**Equipos con interacciones preparadas:** la importación permite revisar la nueva geometría, pero bloquea la sustitución si el destino tiene módulos configurables, animaciones de puertas o acabados que dependen del modelo actual. Hace falta preparar esa compatibilidad antes de reemplazarlo; no se trasplantan las reglas a un archivo arbitrario. Subir geometría tampoco crea recetas ni determina consumos de fabricación.

### Si tarda o falla

La conversión usa una cola persistente y procesa un modelo cada vez. El alojamiento gratuito puede suspender el servicio por inactividad: mientras esté dormido, la cola no avanza. Al despertar se retoma el trabajo pendiente; una conversión interrumpida puede volver a intentarse. No es una garantía de conversión continua ni inmediata.

Si aparece **Necesita atención**, consulta el motivo. Puedes reintentar o subir una copia más ligera. Una conversión fallida, en cola o cancelada no sustituye el modelo actual. Los modelos demasiado complejos, las texturas excesivas o los archivos que no se interpretan correctamente requieren simplificación y otra revisión. El resultado debe quedar dentro de **8 MB y 300 000 triángulos colocados**, incluidas las repeticiones de componentes.

### Fidelidad y conservación

El conversor independiente OpenSKP declara compatibilidad con el formato moderno de SketchUp 2021 y posteriores. Se probaron geometría, instancias, texturas, escala y la rama moderna ZIP con archivos sintéticos. **Falta comprobar un archivo auténtico del propietario guardado con SketchUp 2023**; esas pruebas no garantizan que todos sus modelos se reproduzcan sin diferencias.

Se mantienen componentes y posiciones, y se optimizan las texturas para la web. Las texturas proyectadas o aplicadas al componente completo pueden diferir. Los acabados físicos del acero, las animaciones, las escenas guardadas y las funciones de componentes dinámicos necesitan preparación adicional. Conserva también una copia propia del SKP editable y usa nombres claros para puertas, hornillas y módulos.

El original SKP se descarga únicamente desde la importación privada con permisos del catálogo. No se publica como medio ni se envía a un servicio externo de conversión. Las copias de seguridad comerciales **v2** incluyen las importaciones y sus originales; esto no activa una programación automática de respaldos. Las copias contienen información privada y deben guardarse fuera de la web pública.

La conversión utiliza software con licencia MIT y no exige una suscripción de conversión. El alojamiento, almacenamiento y tiempo de procesamiento sí tienen límites; no se promete capacidad ilimitada. La exportación manual DAE con texturas y posterior preparación GLB sigue siendo una alternativa para archivos que necesiten correcciones especializadas.
