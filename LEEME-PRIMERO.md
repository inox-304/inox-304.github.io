# Tu web INOX 304

La web pública está en https://inox-304.github.io/. Esta carpeta contiene su proyecto y se puede copiar en un pendrive. La web publicada sigue funcionando aunque apagues o cambies de PC.

## Abrir en otra PC

1. Copia **toda esta carpeta** al disco local de la otra computadora.
2. Instala Node.js 24 LTS desde https://nodejs.org/.
3. Abre `INICIAR-WEB.cmd`. La primera vez necesita Internet para instalar las dependencias; después abrirá el servidor local. Visita la dirección que aparece.
4. Para compilar la copia actual, abre `ACTUALIZAR-Y-COMPILAR.cmd`. El resultado queda en `dist/`; este comando no publica por sí solo.

El código, las fotos de la web, videos, iconos, fuentes, decodificadores 3D y documentación están dentro del proyecto. `node_modules` se reconstruye con `npm ci`; no necesitas llevarlo en el pendrive. No abras `index.html` con doble clic: usa el servidor local para las rutas y modelos 3D.

## Administrar productos

**Sheets fue reemplazado por un panel privado.** Lee `docs/PANEL-ADMINISTRACION.md`. Ejecuta `PREPARAR-PANEL.cmd` una sola vez e `INICIAR-PANEL.cmd` para abrir la web local con su administración. El código del panel está en `backend/`, la base de desarrollo y los archivos en la carpeta privada `backend/data/`.

No confundas llevar el código con llevar los datos. Para cambiar de PC conserva un respaldo comercial y los archivos, o copia `backend/data/` con el servidor apagado y protege esa copia. Las dependencias se reinstalan. La guía explica cómo autorizar al propietario y activar la aplicación autenticadora.

El nuevo panel no está alojado en GitHub Pages: necesita un servidor con Python, PostgreSQL y HTTPS. La versión pública estática continúa funcionando hasta preparar esa migración. No se contrató ningún servicio.

## Modelos 3D

Lee `docs/modelos-3d.md`. Se admiten archivos `.glb` preparados para web. Cada producto tiene foto primero y botón 360° solo si tiene un modelo asignado. No hay un límite de 20 modelos; la calidad depende del peso y complejidad de cada uno. Los originales CAD se conservan aparte y se exportan a GLB. Los modelos originales de INOX todavía deben incorporarse.

## Cambiar a dominio .com

Para utilizar el panel, apunta el dominio al servidor que ejecutará la web y la base de datos. No necesitas rehacer el diseño ni volver a cargar los productos. La configuración completa está en `docs/PANEL-ADMINISTRACION.md`.

Si primero quieres cambiar solo el dominio de la versión estática actual:

1. En GitHub Pages configura el dominio personalizado y sus DNS según el proveedor.
2. Establece la variable del repositorio `PUBLIC_SITE_URL` como `https://tudominio.com`.
3. Ejecuta el flujo `Deploy to GitHub Pages`. El proyecto genera `CNAME`, enlaces canónicos y sitemap para ese dominio; las imágenes internas usan rutas relativas a la web.
4. Activa y verifica HTTPS cuando GitHub lo permita.

Comprar el dominio y autorizar cambios DNS requiere acceso a la cuenta donde lo registres. En esta entrega no se ha registrado ningún dominio.

## Continuar programando

Repositorio: https://github.com/inox-304/inox-304.github.io. La copia portable conserva Git, pero las sesiones de GitHub y Google pertenecen a cada PC; inicia sesión en la nueva sin compartir contraseñas. Antes de editar en dos equipos, ejecuta `git pull --ff-only` y conserva tus cambios con commit y push.
