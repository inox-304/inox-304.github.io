# Conectar la hoja privada con la web

La hoja sigue privada. El exportador entrega solamente productos con `publicar` marcado, contactos con `activo` marcado y ajustes comerciales permitidos. GitHub importa ese contenido y copia las fotos, fichas y modelos desde Drive a la propia web.

**Todavía falta configurar la hoja y autorizar el exportador en la cuenta del negocio.** El código y las pruebas están preparados; no se ha conectado una cuenta ni desplegado un script en Google.

## Instalación una sola vez

1. Con `inoxweb304@gmail.com`, crea la hoja e importa las tres plantillas de `public/cms/plantillas`: pestañas exactas **Catalogo**, **Contactos**, **Ajustes**. Sigue [la guía de columnas y casillas](cms.md). Si desactivas el contacto principal, se usa otro contacto activo; si desactivas todos, la siguiente publicación desactiva las consultas por WhatsApp.
2. Abre **Extensiones → Apps Script**. Sustituye el contenido de `Code.gs` por `integration/google-apps-script/Code.gs` de este proyecto.
3. En la configuración del proyecto, activa la visualización de `appsscript.json` y copia el manifiesto de `integration/google-apps-script/appsscript.json`. Solicita permisos de lectura de Sheets y Drive, sin escribir ni cambiar permisos de archivos.
4. En **Configuración del proyecto → Propiedades de la secuencia de comandos**, agrega `SPREADSHEET_ID`. El valor es el identificador de la hoja que aparece entre `/d/` y `/edit` en su URL.
5. Elige **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: **Yo**, desde la cuenta dueña. Acceso: **Cualquier persona**, para que el servidor de GitHub pueda recibir la exportación sin iniciar sesión. Autoriza el acceso de lectura solicitado.
6. Copia la URL de implementación que termina en `/exec`; no uses la de prueba `/dev`. Abre esa URL y comprueba que devuelve JSON, que solo aparecen productos marcados y que no hay un mensaje `error`.
7. En el repositorio GitHub, abre **Settings → Secrets and variables → Actions → Variables → New repository variable**. Nombre: `CMS_EXPORT_URL`. Valor: la URL `/exec`. No debe llevar contraseña ni token. La URL no se incrusta en la página.
8. En **Actions → Deploy to GitHub Pages → Run workflow**, ejecuta una publicación. El flujo configurado también comprueba cambios aproximadamente cada 30 minutos cuando existe `CMS_EXPORT_URL`; el horario de GitHub puede demorarse. Para cambios urgentes, usa **Run workflow**. GitHub documenta esos [retrasos y la suspensión tras 60 días sin actividad en repositorios públicos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Google documenta [cómo publicar una aplicación web y con qué identidad se ejecuta](https://developers.google.com/apps-script/guides/web). `ContentService` entrega JSON y redirige su respuesta a `script.googleusercontent.com`; el importador contempla ese comportamiento [documentado por Google](https://developers.google.com/apps-script/guides/content#redirects).

## Qué se vuelve público

La respuesta del exportador es pública. Solo devuelve las columnas permitidas de las filas publicadas y los contactos comerciales activos. Una casilla `publicar` vacía significa borrador. Columnas adicionales como costos internos no se exportan.

Pegar un archivo de Drive en `imagen`, `galeria`, `ficha_tecnica`, `modelo_3d` o `poster_3d` y marcar el producto para publicar autoriza que ese archivo aparezca públicamente en la web. El archivo original no cambia sus permisos; el script lee su contenido con la cuenta propietaria y entrega una copia únicamente si está referenciado por una fila publicada. No permite descargar archivos arbitrarios de Drive.

Desmarcar `publicar` lo retira en la **siguiente publicación correcta**. No es instantáneo: hasta que termine, sigue visible la versión anterior. Los archivos antes publicados pueden permanecer en cachés de navegadores o copias de terceros; usa exclusivamente materiales comerciales destinados al público.

## Uso cotidiano

1. Sube cada foto, ficha PDF o modelo GLB a la carpeta de Drive de su código, por ejemplo `INOX304/Productos/P03`.
2. Copia el enlace normal del archivo de Drive en la columna correspondiente. En `galeria`, separa hasta ocho enlaces con ` | `. No pegues enlaces de carpetas.
3. Revisa nombre, precio, datos técnicos y WhatsApp; marca `mostrar_precio` solo cuando corresponda. Marca `publicar` cuando esté listo.
4. Espera la próxima publicación o ejecútala desde GitHub. Si un dato o recurso falla, el proceso se detiene y conserva la web ya publicada. El registro de Actions indica el tipo de problema.

No necesitas ChatGPT abierto, un ordenador encendido ni compartir tu contraseña. ChatGPT o Gemini pueden ayudarte a editar la hoja autorizada; la sincronización funciona mediante este exportador y GitHub.

## Límites actuales

- Hasta 2.000 filas por pestaña y 500 archivos únicos por importación: suficiente para empezar con 20 productos y ampliar el catálogo.
- Máximo **8 MB por archivo de Drive** y **200 MB de archivos originales por importación**. Optimiza modelos y fotos grandes antes de subirlos.
- Imágenes PNG, JPEG o WebP, reducidas a un máximo de 1.600 px en su lado mayor. Los recortes transparentes quedan como WebP y usan pedestal; las fotografías con fondo quedan como JPEG y conservan su presentación fotográfica. No se procesan SVG, HTML ni animaciones.
- Fichas en PDF y modelos **GLB 2.0 autocontenidos**. Un GLB no debe depender de texturas o archivos externos; exporta todo dentro del modelo. Objetivo práctico para móvil: alrededor de 2–5 MB por modelo.
- La importación revisa tipo, tamaño y encabezados de archivos. Si falla una descarga o validación, no publica una actualización parcial.
- La vista previa 3D se carga cuando el visitante la solicita, no descarga todos los modelos al abrir el catálogo.

Los límites definidos son del proyecto; también se aplican las cuotas de la cuenta de Google y de GitHub. Si se agotan, la versión actual de la web continúa disponible. Si GitHub suspende un flujo programado por inactividad, se puede reactivar desde Actions.

## Comprobación local para quien mantiene la web

Con Node.js 24 y las dependencias instaladas, desde la carpeta del proyecto en PowerShell:

```powershell
$env:CMS_EXPORT_URL = 'https://script.google.com/macros/s/ID_IMPLEMENTACION/exec'
node scripts/sync-cms.mjs
npm run build
```

Sin `CMS_EXPORT_URL`, el comando no hace solicitudes ni modifica el catálogo local existente. Con ella, genera `.generated/cms-snapshot.json`, el inventario `.generated/cms-assets.json` y archivos con nombres derivados de su contenido en `public/images/cms`, `public/documents/cms` y `public/models/cms`. Esas carpetas son para recursos importados; no deben usarse para añadir archivos a mano. Al importar de nuevo, elimina únicamente recursos anteriores registrados en ese inventario que ya no se usan.

Estos archivos generados se mantienen fuera de Git; el sitio público solo recibe el catálogo publicado. Conserva la hoja y los originales de Drive como fuente principal. El mecanismo sirve igual cuando el sitio tenga un dominio `.com`.

Pruebas sin cuentas ni conexiones externas:

```powershell
node scripts/test-cms-import.mjs
```
