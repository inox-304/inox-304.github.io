# INOX 304 · Sitio web

Sitio estático en Astro y TypeScript para presentar el equipamiento comercial e industrial de INOX 304. Incluye portada animada, catálogo por categorías, fichas de productos, instalaciones y contacto para cotización por WhatsApp. La estructura de tarjetas parte de ScrewFast; su licencia se conserva en `LICENSE-SCREWFAST`.

## Ejecutar en tu laptop

Requisitos: una versión de Node.js compatible con la versión de Astro del proyecto y npm. El entorno de desarrollo utiliza Node.js 24.

```sh
npm ci
npm run dev
```

Abre la dirección local que imprime Astro en la terminal. Si el servidor queda en primer plano, se detiene con `Ctrl+C`; si Astro lo inicia en segundo plano, usa `npx astro dev stop` desde esta carpeta.

## Compilar y verificar

```sh
npm run build
npm test
```

`build` revisa los archivos de Astro y TypeScript y genera el sitio en `dist/`. `test` inspecciona ese resultado: comprueba las rutas principales y las fichas generadas, títulos únicos, un encabezado principal por página y la existencia de enlaces y recursos locales, incluidas imágenes, video, fuentes, JavaScript y CSS. La verificación funciona en Windows, no inicia servidores ni hace solicitudes externas.

Para revisar la compilación en el navegador:

```sh
npm run preview
```

`npm run check` permite revisar Astro y TypeScript sin generar la compilación.

## Contenido y recursos

| Ubicación | Contenido |
| --- | --- |
| `src/data/products.ts` | Archivo completo de 32 productos y sus cuatro categorías, transcrito de los PDF proporcionados. |
| `src/data/catalog.ts` | Selección pública `visibleProducts` utilizada por el catálogo y las fichas. |
| `src/data/site.ts` | Datos comerciales, contacto y enlace de WhatsApp. |
| `src/pages/` | Inicio, catálogo, fichas individuales y contacto. |
| `src/styles/global.css` | Estilos y adaptación a distintas pantallas. |
| `public/images/products/` | 21 recortes limpios WebP y fotografías originales extraídas del catálogo. |
| `public/images/brand/` | Logotipo oficial, fondos de estudio para escritorio/tablet/móvil y textura suministrados por el propietario. |
| `src/components/FlameLogo.astro` | Logo metálico con flama roja y copo azul animados a partir del HTML suministrado; se pausa fuera de pantalla y respeta movimiento reducido. Fuente en `docs/brand-logo.md`. |
| `src/components/Services.astro` | Instalación de equipos, extracción y ductería, redes de gas y mantenimiento, con desplegables accesibles. |
| `src/components/ProductStage.astro` | Presentación de recortes limpios sobre fondos de estudio adaptados a la pantalla. |
| `src/styles/motion.css`, `src/scripts/motion.ts` | Respuesta de botones, flechas, tarjetas, navegación y entradas al desplazarse. Sin dependencias adicionales; respeta movimiento reducido. |
| `public/media/hero-clean.mp4` | Video limpio preparado para la portada; se puede reemplazar conservando el nombre. |
| `public/media/hero-poster.jpg` | Imagen de apoyo para la carga del video y visualización estática. |
| `public/images/hero-studio.webp` | Imagen de estudio generada y optimizada para la web; no documenta una instalación real de la empresa. El original se conserva como `hero-studio.png`. |
| `docs/catalog-sources.md` | Correspondencia entre productos, imágenes y páginas del catálogo, con limitaciones de las fuentes. |
| `docs/resource-inventory.md` | Revisión de los 30 archivos de recursos noc, correspondencia con 21 equipos, variantes y originales conservados. |
| `scripts/verify-build.mjs` | Verificación local del resultado de compilación. |

Se muestran **los 32 productos archivados**. P01 vuelve al catálogo con la imagen limpia suministrada por el propietario. Hay 21 equipos con nuevos recortes transparentes; los otros 11 conservan su foto original hasta recibir un reemplazo del mismo modelo. No se inventaron precios; el panel permite añadir importes autorizados y elegir si se muestran. No hay disponibilidad en tiempo real.

Los nombres, modelos, características y datos comerciales proceden de los PDF entregados por el propietario, cuya fuente declarada es la página de Facebook de INOX 304, consultada el 18 de septiembre de 2026. No se han añadido reseñas, certificaciones ni plazos de garantía inventados. Las imágenes extraídas sirven para la primera versión; los originales de mayor resolución mejorarán las fichas.

## Contacto y cotizaciones

El administrador se organiza en tres pestañas privadas de Google Sheets: **Catalogo**, **Contactos** y **Ajustes**. Permite editar productos, precios, fotos, galerías, fichas PDF, modelos GLB y WhatsApp, con casillas para publicar o dejar borradores. La integración está preparada; **falta autorizar la cuenta de INOX y configurar `CMS_EXPORT_URL`**.

El flujo recomendado es **Sheets + Drive → Apps Script → GitHub Actions → web estática**. Solo se exportan filas publicadas y contactos activos. GitHub descarga los recursos referenciados, optimiza las imágenes y genera todas las rutas de producto. Un producto despublicado desaparece de la siguiente compilación. Las actualizaciones se pueden ejecutar manualmente; una vez configurada la URL también se revisan aproximadamente cada 30 minutos, sujeto a la cola de GitHub. La web y la sincronización no dependen de que esta PC esté encendida.

Lee [la puesta en marcha](docs/publicacion-sheets.md), [las columnas del panel](docs/cms.md) y [el prompt para ChatGPT o Gemini](docs/PROMPT-ADMINISTRAR-INOX304.md). Las plantillas iniciales contienen los 32 equipos actuales. El modo CSV público anterior se conserva por compatibilidad; no ofrece la misma retirada de rutas y no es la opción recomendada.

Para comprobar los datos y la importación, ejecuta `node scripts/test-cms.mjs` y `node scripts/test-cms-import.mjs`.

El sitio no tiene backend, pagos ni almacenamiento de formularios. El contacto prepara un mensaje con la consulta y abre WhatsApp hacia el número configurado en `src/data/site.ts`; el visitante revisa y envía ese mensaje desde WhatsApp. Abrir el enlace no confirma que la empresa haya recibido la consulta.

## Material pendiente

- Completar los 11 productos que todavía no tienen una imagen limpia del mismo modelo; están identificados en `docs/resource-inventory.md`.
- Incorporar fotografías de instalaciones y proyectos reales cuando se suministren.
- Confirmar la selección de equipos, características y datos comerciales antes del lanzamiento.
- Revisar los recortes suministrados que todavía conservan bordes o rótulos pequeños de las imágenes originales.
- Revisar el video final y su composición en móvil cuando se disponga del material definitivo.

## Publicación principal en GitHub Pages

La dirección de la web es **https://inox-304.github.io/** y su repositorio es **https://github.com/inox-304/inox-304.github.io**. El despliegue está configurado en `.github/workflows/deploy.yml`: cada push a `main` compila y verifica la web antes de publicar; también puede ejecutarse desde Actions. El propietario ya activó **Settings → Pages → Build and deployment → Source: GitHub Actions**.

El flujo calcula `PUBLIC_SITE_URL` a partir del usuario propietario y `PUBLIC_SITE_BASE_PATH` a partir del nombre del repositorio. Un repositorio llamado exactamente `<usuario>.github.io` usa `/`; los demás usan `/<repositorio>/`. Así, la publicación se adapta al renombrar la cuenta y el repositorio. En desarrollo, la base predeterminada sigue siendo `/`. Los enlaces, archivos multimedia, rutas de productos y datos de Sheets respetan esa base. `robots.txt`, el sitemap y los enlaces canónicos se generan con la dirección configurada.

Para comprobar localmente la compilación de GitHub Pages desde PowerShell:

```powershell
$env:PUBLIC_SITE_BASE_PATH = '/'
$env:PUBLIC_SITE_URL = 'https://inox-304.github.io'
npm run build
npm test
node scripts/test-cms.mjs
node scripts/test-paths.mjs
Remove-Item Env:PUBLIC_SITE_BASE_PATH
Remove-Item Env:PUBLIC_SITE_URL
```

Cuando se active Google Sheets, configura `CMS_EXPORT_URL` en las variables de GitHub Actions según `docs/publicacion-sheets.md`. El exportador es público solo para los datos comerciales marcados para publicar; la hoja maestra conserva sus permisos privados. Tras cambiar esa variable, ejecuta el flujo de despliegue. La cuenta propietaria puede configurar un dominio propio más adelante; GitHub usa `github.io`, no `github.com`, para las direcciones gratuitas de Pages.

El 19 de septiembre de 2026 la cuenta pasó de `inoxweb304-creator` a `inoxweb304` y finalmente a `inox-304`. El repositorio usa `inox-304.github.io` para publicar en la raíz del dominio, como Arenas. El remoto local y la dirección predeterminada de desarrollo usan los nombres actuales. GitHub redirige los enlaces antiguos del repositorio, pero no los del sitio de Pages: comparte la dirección nueva.

Se conserva el identificador de la copia anterior en Sites en `.openai/hosting.json`, pero GitHub Pages es el alojamiento elegido. Los pushes a GitHub no publican en Sites.

## Portabilidad, dominio propio y 360°

[LEEME-PRIMERO.md](LEEME-PRIMERO.md) explica cómo llevar esta carpeta en un pendrive, arrancar en otra PC y migrar a un dominio propio. `INICIAR-WEB.cmd` instala dependencias si faltan y abre el servidor; `ACTUALIZAR-Y-COMPILAR.cmd` sincroniza y compila sin publicar por su cuenta.

El visor de [modelos 3D](docs/modelos-3d.md) se carga solo al pulsar Ver 360°; cada equipo puede tener su propio GLB y galería. No se ha incorporado ningún modelo de muestra al catálogo público. Usa `npm run check:models` para validar archivos antes de publicar.
