# Administrar INOX 304 con Google Sheets

## La idea, en palabras simples

**Sheets es el panel, Drive es el almacén y GitHub publica la web.** Cada equipo tiene una fila y un código permanente como `P03`. Cambias su nombre, precio, fotos, ficha PDF, modelo 3D o contacto en esa fila. La casilla `publicar` decide si sale en la página.

La opción recomendada mantiene la hoja privada: un pequeño programa de Google Apps Script entrega únicamente las filas marcadas para publicar y los archivos que esas filas usan. Al publicar la web, el importador descarga y optimiza esos recursos; los clientes reciben copias alojadas junto a la página. Por eso las fotos no dependen de tener Drive abierto, ni de iniciar sesión en Google.

**Estado:** el catálogo y la integración están preparados en el proyecto. Falta crear o elegir la hoja dentro de `inoxweb304@gmail.com`, autorizar su script y configurar `CMS_EXPORT_URL`. No se ha creado una hoja en otra cuenta ni se ha activado una conexión real con Google. Los precios, PDF y modelos 3D vacíos siguen sin mostrarse.

## Qué hace cada herramienta

| Herramienta | Para qué sirve |
| --- | --- |
| Google Sheets | Editar productos, códigos, precios, publicación y contactos. Es la fuente principal. |
| Google Drive | Guardar fotos, fichas PDF y modelos GLB ordenados por código. |
| Apps Script | Leer la hoja autorizada y exportar exclusivamente contenido publicable. |
| GitHub | Construir y alojar la web y sus archivos optimizados. |
| ChatGPT o Gemini | Ayudarte a redactar y ordenar la hoja mediante las acciones y permisos disponibles. |

Tener ChatGPT Plus no conecta por sí solo Sheets con esta web. En este proyecto, esa tarea la realizan Apps Script y la publicación de GitHub; no requiere llamadas a la API de OpenAI. Si tu ChatGPT permite conectar Google Drive y modificar Sheets, puedes pedirle cambios sobre la hoja autorizada. Comprueba qué cuenta está conectada y qué acciones ofrece: no se ha verificado esa conexión personal aquí. La documentación de OpenAI describe el uso de complementos con fuentes de Drive: [primeros pasos y complementos](https://developers.openai.com/es-419/docs/get-started-with-work).

## Preparar la hoja una sola vez

1. Entra en Google Sheets con `inoxweb304@gmail.com` y crea **INOX 304 — Catálogo y contactos**.
2. Importa las plantillas del proyecto: `public/cms/plantillas/Catalogo.csv`, `Contactos.csv` y `Ajustes.csv`, cada archivo en una pestaña del mismo nombre. Incluyen los 32 productos actuales y los contactos comerciales ya publicados; no contienen precios ni fichas inventados.
3. Inmoviliza la primera fila, activa filtros y configura las columnas `publicar`, `destacado`, `mostrar_precio` y `activo` como casillas. Los valores del CSV son `TRUE`/`FALSE`.
4. En `categoria`, usa una lista desplegable con `linea-fria`, `linea-caliente`, `linea-neutra`, `mobiliario`. En `moneda`, `PEN` o `USD`.
5. Mantén `id`, `contacto_id`, `whatsapp` y `telefono` en formato de texto. No cambies un código porque cambia el nombre del producto.
6. Organiza Drive con carpetas `INOX304/Productos/P01`, `P02`, etc. Dentro de cada una: imágenes, ficha PDF y modelo GLB. Pega los enlaces correspondientes en la fila. Con el modo de importación desde Apps Script, el servidor resuelve los enlaces de Drive; no se usan como enlaces de imagen en el navegador.
7. Instala `integration/google-apps-script/Code.gs`, configura la propiedad `SPREADSHEET_ID`, autorízalo con la cuenta propietaria y despliega su versión web siguiendo [la guía de publicación](publicacion-sheets.md). La hoja maestra no necesita publicarse como CSV.
8. Configura la URL del exportador en `CMS_EXPORT_URL` y ejecuta una publicación de prueba. Comprueba un precio, una fotografía, una ficha PDF y un producto desmarcado antes de trabajar diariamente.

Google documenta las [aplicaciones web de Apps Script](https://developers.google.com/apps-script/guides/web) y la [entrega de datos mediante Content Service](https://developers.google.com/apps-script/guides/content). El exportador usa los permisos de quien lo instala; sus respuestas deben limitarse al contenido que se desea publicar.

## Columnas de Catalogo

```text
id,slug,nombre,categoria,descripcion,caracteristicas,imagen,publicar,destacado,orden,contacto_id,precio,moneda,mostrar_precio,ficha_tecnica,modelo_3d,poster_3d,galeria
```

| Columna | Qué colocar |
| --- | --- |
| `id` | Código único estable, por ejemplo `P03`. Letras, números, guion o guion bajo; máximo 64 caracteres. |
| `slug` | Nombre de URL único, minúsculas y guiones: `cocina-industrial-de-3-parrillas`. |
| `nombre` | Nombre público del producto. |
| `categoria` | Una de las cuatro líneas. Los nombres antiguos siguen siendo compatibles. |
| `descripcion` | Resumen comercial real. |
| `caracteristicas` | Datos técnicos separados por ` | `. No completar medidas o potencias sin fuente. |
| `imagen` | Imagen principal. En importación: enlace de Drive autorizado; también admite ruta existente `/images/...` o URL HTTPS directa. |
| `publicar` | Casilla marcada: publicar. Vacía o desmarcada: borrador. |
| `destacado` | Casilla para aparecer entre los destacados de la portada. |
| `orden` | Número para ordenar el catálogo. |
| `contacto_id` | Código de Contactos al que enviará la cotización por WhatsApp, por ejemplo `ventas`. |
| `precio` | Número sin símbolo ni separador de miles: `1250.50` o `1250,50`. Vacío si aún no está definido. |
| `moneda` | `PEN` para soles o `USD` para dólares. |
| `mostrar_precio` | Marcar solo cuando el precio deba verse públicamente. También debe existir un precio válido. |
| `ficha_tecnica` | PDF del producto: Drive mediante importación, `/documents/...pdf` o enlace HTTPS directo terminado en `.pdf`. |
| `modelo_3d` | Archivo GLB optimizado: Drive mediante importación, `/models/...glb` o enlace HTTPS directo terminado en `.glb`. |
| `poster_3d` | Imagen ligera que representa al modelo antes de abrir el visor. |
| `galeria` | Hasta 8 imágenes adicionales, separadas por ` | `. |

Las nuevas filas incompletas con `publicar` desmarcado se pueden guardar como borradores. Una fila marcada debe tener un código, URL, nombre, categoría e imagen válidos. Si mantienes una hoja antigua con la columna `visible`, se respeta por compatibilidad; cuando existe `publicar`, esta tiene prioridad y una celda vacía significa no publicar.

El importador necesita entregar al navegador rutas de archivos reales. Un enlace como `https://drive.google.com/file/d/ID/view` es una página de Drive, no una imagen ni un modelo: el lector CSV directo lo rechaza. No hay que cambiarlo a una URL improvisada; usa la importación desde Apps Script.

## Contactos y Ajustes

Pestaña **Contactos**:

```text
id,nombre,whatsapp,telefono,correo,mensaje,activo
```

`whatsapp` incluye el código de país; por ejemplo `51964270406`. Se admiten espacios y `+`; un móvil peruano de nueve cifras se convierte a formato internacional. `telefono` es el texto que ve el visitante. `mensaje` es la introducción de la consulta. `activo` desmarcado evita enviar clientes a ese contacto. Si un producto no tiene un contacto activo, se usa el principal y después el primer contacto activo disponible. Si no queda ninguno, se desactivan los enlaces de contacto.

Pestaña **Ajustes**:

```text
clave,valor,descripcion
```

Claves admitidas: `empresa`, `direccion`, `referencia_direccion`, `facebook`, `contacto_principal`, `contacto_instalaciones`, `contacto_medida`, `contacto_formulario`. Las cuatro últimas contienen códigos de Contactos. El catálogo no contiene listas de clientes ni conversaciones: aquí solo van los datos comerciales que verá el público.

## Uso diario recomendado

1. Subes la nueva foto, PDF o GLB a la carpeta del código en Drive.
2. Editas la fila de Sheets y sus enlaces. Puedes seguir trabajando con `publicar` desmarcado.
3. Cuando esté listo, marcas `publicar`. Para retirar un equipo, lo desmarcas.
4. Ejecutas **Run workflow** en la publicación de GitHub para aplicarlo en ese momento. Si está configurada la actualización programada, la próxima ejecución recoge el cambio; la hora exacta depende de GitHub. La actualización no es instantánea al escribir una celda.
5. La publicación valida todo antes de sustituir la web. Si un archivo o una fila falla, se corrige en Sheets y se vuelve a publicar; la versión ya desplegada continúa disponible.

ChatGPT puede ayudarte con una instrucción como «Cambia el precio de P03 a 1250 soles y deja mostrar_precio marcado» o «Prepara P33 con estas características, pero déjalo sin publicar». No debe inventar medidas, precios ni garantizar que algo se publicó sin revisar el resultado.

## Construcción y compatibilidad técnica

El modo recomendado ejecuta `node scripts/sync-cms.mjs` con `CMS_EXPORT_URL` antes de construir. Produce `.generated/cms-snapshot.json` y copias de los recursos publicables. La construcción usa esa instantánea para generar las páginas de todos los productos publicados, su catálogo y sus enlaces. La URL del dominio se configura aparte; el contenido y los archivos no dependen de una carpeta concreta de esta laptop.

Se conserva el modo anterior de **CSV publicado por Google** para quien ya lo usa. Requiere configurar las tres variables públicas y reconstruir una vez:

```dotenv
PUBLIC_CMS_CATALOG_URL=https://docs.google.com/spreadsheets/d/e/PUBLISHED_ID/pub?gid=CATALOG_GID&single=true&output=csv
PUBLIC_CMS_CONTACTS_URL=https://docs.google.com/spreadsheets/d/e/PUBLISHED_ID/pub?gid=CONTACTS_GID&single=true&output=csv
PUBLIC_CMS_SETTINGS_URL=https://docs.google.com/spreadsheets/d/e/PUBLISHED_ID/pub?gid=SETTINGS_GID&single=true&output=csv
```

En ese modo antiguo, el navegador lee las tres pestañas al abrir la página y conserva el contenido estático si hay un error. Las URLs, el HTML inicial y los resultados de buscadores no cambian hasta reconstruir; los productos nuevos pueden usar `/equipo/?id=...`. **Ocultar una fila en la web no la vuelve privada si publicas toda la pestaña CSV.** Para guardar borradores o archivos privados, usa el modo recomendado de Apps Script, que exporta solo lo publicable.

La validación admite también las instantáneas locales `/cms/live/catalogo.csv`, `/cms/live/contactos.csv` y `/cms/live/ajustes.csv`. Las plantillas de `public/cms/plantillas` no se activan automáticamente como fuente.

## Verificación

`node scripts/test-cms.mjs` cubre compatibilidad CSV, categorías, publicación optativa, borradores, precios, enlaces de recursos, contactos y rutas. `node scripts/export-cms-template.mjs` regenera las tres plantillas a partir del catálogo real y valida su contenido. La publicación completa debe pasar también las comprobaciones del proyecto.
