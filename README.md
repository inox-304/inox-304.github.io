# INOX 304 · Sitio web

Sitio estático en Astro y TypeScript para presentar el equipamiento comercial e industrial de INOX 304. Incluye portada animada, catálogo por categorías, fichas de productos, instalaciones y contacto para cotización por WhatsApp. La estructura de tarjetas parte de ScrewFast; su licencia se conserva en `LICENSE-SCREWFAST`.

## Ejecutar en tu laptop

Requisitos: una versión de Node.js compatible con la versión de Astro del proyecto y npm. El entorno de desarrollo utiliza Node.js 24.

```sh
npm install
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
| `src/data/products.ts` | Archivo completo de 32 productos y sus seis categorías, transcrito de los PDF proporcionados. |
| `src/data/catalog.ts` | Selección pública `visibleProducts` utilizada por el catálogo y las fichas. |
| `src/data/site.ts` | Datos comerciales, contacto y enlace de WhatsApp. |
| `src/pages/` | Inicio, catálogo, fichas individuales y contacto. |
| `src/styles/global.css` | Estilos y adaptación a distintas pantallas. |
| `public/images/products/` | 21 recortes limpios WebP y fotografías originales extraídas del catálogo. |
| `public/images/brand/` | Logotipo oficial, fondos de estudio para escritorio/tablet/móvil y textura suministrados por el propietario. |
| `src/components/Services.astro` | Instalación de equipos, extracción y ductería, redes de gas y mantenimiento, con desplegables accesibles. |
| `src/components/ProductStage.astro` | Presentación de recortes limpios sobre fondos de estudio adaptados a la pantalla. |
| `src/styles/motion.css`, `src/scripts/motion.ts` | Respuesta de botones, flechas, tarjetas, navegación y entradas al desplazarse. Sin dependencias adicionales; respeta movimiento reducido. |
| `public/media/hero-clean.mp4` | Video limpio preparado para la portada; se puede reemplazar conservando el nombre. |
| `public/media/hero-poster.jpg` | Imagen de apoyo para la carga del video y visualización estática. |
| `public/images/hero-studio.webp` | Imagen de estudio generada y optimizada para la web; no documenta una instalación real de la empresa. El original se conserva como `hero-studio.png`. |
| `docs/catalog-sources.md` | Correspondencia entre productos, imágenes y páginas del catálogo, con limitaciones de las fuentes. |
| `docs/resource-inventory.md` | Revisión de los 30 archivos de recursos noc, correspondencia con 21 equipos, variantes y originales conservados. |
| `scripts/verify-build.mjs` | Verificación local del resultado de compilación. |

Se muestran **los 32 productos archivados**. P01 vuelve al catálogo con la imagen limpia suministrada por el propietario. Hay 21 equipos con nuevos recortes transparentes; los otros 11 conservan su foto original hasta recibir un reemplazo del mismo modelo. No hay precios de venta ni disponibilidad en tiempo real.

Los nombres, modelos, características y datos comerciales proceden de los PDF entregados por el propietario, cuya fuente declarada es la página de Facebook de INOX 304, consultada el 18 de septiembre de 2026. No se han añadido reseñas, certificaciones ni plazos de garantía inventados. Las imágenes extraídas sirven para la primera versión; los originales de mayor resolución mejorarán las fichas.

## Contacto y cotizaciones

El administrador de catálogo y contactos está preparado para Google Sheets. Sus tres pestañas de datos son `Catalogo`, `Contactos` y `Ajustes`; permiten editar equipos, visibilidad, destacados y el contacto de WhatsApp de cada producto o tipo de botón. **Todavía falta conectar la cuenta de INOX y configurar las tres fuentes CSV publicadas.** La web conserva sus datos actuales hasta completar ese paso. La configuración y sus límites se explican en `docs/cms.md`; las variables públicas de conexión están en `.env.example`.

Los cambios de la hoja se consultan al recargar la web. Las nuevas filas se pueden mostrar sin editar código; las rutas individuales destinadas a buscadores se generan al reconstruir el sitio. El formato de imágenes y el logo se mantienen como recursos de la web.

Para comprobar la lectura del catálogo y los contactos, ejecuta `node scripts/test-cms.mjs`.

El sitio no tiene backend, pagos ni almacenamiento de formularios. El contacto prepara un mensaje con la consulta y abre WhatsApp hacia el número configurado en `src/data/site.ts`; el visitante revisa y envía ese mensaje desde WhatsApp. Abrir el enlace no confirma que la empresa haya recibido la consulta.

## Material pendiente

- Completar los 11 productos que todavía no tienen una imagen limpia del mismo modelo; están identificados en `docs/resource-inventory.md`.
- Incorporar fotografías de instalaciones y proyectos reales cuando se suministren.
- Confirmar la selección de equipos, características y datos comerciales antes del lanzamiento.
- Revisar los recortes suministrados que todavía conservan bordes o rótulos pequeños de las imágenes originales.
- Revisar el video final y su composición en móvil cuando se disponga del material definitivo.

Esta primera versión es local. El dominio, alojamiento y despliegue público todavía no están configurados. Antes de publicarla, confirma el dominio canónico de `astro.config.mjs` y la configuración de indexación del sitio.
