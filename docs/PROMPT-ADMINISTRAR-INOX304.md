# Prompt para preparar el panel de INOX 304

Pega este texto en ChatGPT o Gemini con acceso autorizado a Google Drive y Google Sheets. Adjunta las tres plantillas CSV de `public/cms/plantillas` y los archivos de `integration/google-apps-script`; comparte también `docs/publicacion-sheets.md`. Si las herramientas de tu cuenta no permiten escribir en Sheets, el asistente debe decírtelo y guiarte con los archivos, sin fingir que creó la hoja.

---

Quiero administrar la web de INOX 304 desde Google Sheets. La cuenta propietaria del contenido es inoxweb304@gmail.com y la web está en https://inox-304.github.io/. Comprueba la cuenta conectada antes de crear archivos; si es otra, indícame que debo conectar la correcta, sin pedirme contraseñas.

Usa las plantillas y el código del proyecto que adjunto. Crea o configura un único archivo de Google Sheets llamado «INOX 304 — Catálogo y contactos» con tres pestañas: Catalogo, Contactos y Ajustes. Si ya existe el panel indicado, revísalo y actualízalo; no crees duplicados ni borres filas existentes sin que yo lo pida.

Catalogo debe conservar exactamente estas columnas:
id,slug,nombre,categoria,descripcion,caracteristicas,imagen,publicar,destacado,orden,contacto_id,precio,moneda,mostrar_precio,ficha_tecnica,modelo_3d,poster_3d,galeria

Contactos:
id,nombre,whatsapp,telefono,correo,mensaje,activo

Ajustes:
clave,valor,descripcion

Importa los 32 productos reales de la plantilla, conserva sus códigos y no inventes precios, medidas, potencias, garantías ni fichas técnicas. Usa solo cuatro categorías: linea-fria, linea-caliente, linea-neutra y mobiliario. Configura casillas para publicar, destacado, mostrar_precio y activo; listas para categoría y moneda PEN/USD; filtros e inmoviliza la cabecera. Protege la fila de encabezados contra cambios accidentales. Trata códigos y teléfonos como texto. Los productos nuevos deben comenzar sin publicar; asigna un código libre y nunca reutilices el de otro equipo.

Organiza los recursos en Drive por código: INOX304/Productos/P01, P02, etc. Guarda las fotos, PDF y modelos 3D GLB en sus respectivas carpetas y coloca sus enlaces en la fila. Hasta ocho imágenes adicionales se separan con « | » en galeria. Las características técnicas también se separan con « | ». Conserva los diseños 3D originales; la web debe recibir copias GLB optimizadas y una imagen poster ligera, no los archivos CAD completos.

Instala y configura el exportador Apps Script adjunto conforme a docs/publicacion-sheets.md, con SPREADSHEET_ID apuntando a esta hoja. Mantén la hoja maestra privada. El exportador solo debe entregar productos con publicar marcado, contactos activos, ajustes permitidos y archivos referenciados por productos publicados. No publiques toda la hoja como CSV ni uses enlaces de visualización de Drive directamente como imágenes HTML.

La publicación de GitHub usa CMS_EXPORT_URL para descargar la exportación, copiar y optimizar los archivos y reconstruir la web. Ayúdame a configurar esa URL y comprobar una publicación real; si no tienes acceso a GitHub, dame únicamente el paso que falta, sin asegurar que ya está conectado. ChatGPT es mi asistente para editar el panel; la sincronización debe funcionar mediante el código de publicación, aunque yo cierre ChatGPT o apague esta laptop.

Para verificarlo, usa un producto de prueba que yo identifique: cambia un texto, prueba un precio autorizado con mostrar_precio, revisa una imagen y una ficha PDF reales y verifica que un producto con publicar desmarcado no salga en la exportación ni en la nueva web. No alteres todos los precios para hacer la prueba.

Entrégame el enlace de la hoja, la estructura de Drive, qué quedó realmente conectado y qué falta, y una explicación corta del uso diario: editar fila, marcar o desmarcar publicar, ejecutar la publicación o esperar la siguiente revisión programada. Distingue guardar la hoja de terminar la publicación. No cambies el diseño de la web, sus cuatro categorías ni el dominio al administrar los datos.

---

## Prompt para el trabajo diario

> Administra la hoja INOX 304 que ya configuramos. Localiza el producto por su código, verifica la fila y realiza únicamente el cambio que te indico: [CAMBIO]. Conserva el código, el slug y los demás datos. No inventes información faltante. Deja los productos nuevos con publicar desmarcado salvo que te pida publicarlos. Dime qué celdas cambiaste y si el cambio solo está guardado en Sheets o ya se verificó en la web. Si no tienes acceso real de edición, dilo claramente.

Ejemplos de instrucciones: «Prepara P33 con los archivos que te adjunto y déjalo como borrador»; «Desmarca publicar en P12»; «Cambia el WhatsApp de ventas por este número»; «Añade estas dos fotos a la galería de P03». Para cambiar un precio, proporciona el importe, la moneda y si debe mostrarse.
