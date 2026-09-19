# Tu web INOX 304

La web pública está en https://inox-304.github.io/. Esta carpeta contiene su proyecto y se puede copiar en un pendrive. La web publicada sigue funcionando aunque apagues o cambies de PC.

## Abrir en otra PC

1. Copia **toda esta carpeta** al disco local de la otra computadora.
2. Instala Node.js 24 LTS desde https://nodejs.org/.
3. Abre `INICIAR-WEB.cmd`. La primera vez necesita Internet para instalar las dependencias; después abrirá el servidor local. Visita la dirección que aparece.
4. Para compilar la copia actual, abre `ACTUALIZAR-Y-COMPILAR.cmd`. El resultado queda en `dist/`; este comando no publica por sí solo.

El código, las fotos de la web, videos, iconos, fuentes, decodificadores 3D y documentación están dentro del proyecto. `node_modules` se reconstruye con `npm ci`; no necesitas llevarlo en el pendrive. No abras `index.html` con doble clic: usa el servidor local para las rutas y modelos 3D.

## Administrar productos

Lee `docs/publicacion-sheets.md` para activar **Sheets privado → Drive → GitHub**. El archivo `docs/PROMPT-ADMINISTRAR-INOX304.md` tiene el prompt de configuración y el prompt de uso diario. Las plantillas para importar están en `public/cms/plantillas/` y contienen los 32 productos actuales.

No hay una hoja de INOX conectada todavía. El diseño está publicado y la integración está preparada; la autorización de Google y la URL del exportador se configuran una sola vez desde la cuenta de INOX.

Para actualizar desde Sheets en esta PC, copia `.env.example` como `.env`, configura `CMS_EXPORT_URL` y ejecuta `npm run build:published`. La configuración de GitHub se guarda por separado en el repositorio y funciona aunque la laptop esté apagada. No copies contraseñas ni tokens al proyecto o al pendrive.

Si el proyecto contiene `.generated/` e imágenes importadas, conserva esas carpetas al trasladarlo: son la última copia publicada. Una clonación nueva puede reconstruirlas desde Sheets. Si aún no se activó Sheets, se usan los datos originales del catálogo.

## Modelos 3D

Lee `docs/modelos-3d.md`. Se admiten archivos `.glb` preparados para web. Cada producto tiene foto primero y botón 360° solo si tiene un modelo asignado. No hay un límite de 20 modelos; la calidad depende del peso y complejidad de cada uno. Los originales CAD se conservan aparte y se exportan a GLB. Los modelos originales de INOX todavía deben incorporarse.

## Cambiar a dominio .com

No necesitas rehacer la web ni cambiar las filas de Sheets. Cuando el dominio sea tuyo:

1. En GitHub Pages configura el dominio personalizado y sus DNS según el proveedor.
2. Establece la variable del repositorio `PUBLIC_SITE_URL` como `https://tudominio.com`.
3. Ejecuta el flujo `Deploy to GitHub Pages`. El proyecto genera `CNAME`, enlaces canónicos y sitemap para ese dominio; las imágenes internas usan rutas relativas a la web.
4. Activa y verifica HTTPS cuando GitHub lo permita.

Comprar el dominio y autorizar cambios DNS requiere acceso a la cuenta donde lo registres. En esta entrega no se ha registrado ningún dominio.

## Continuar programando

Repositorio: https://github.com/inox-304/inox-304.github.io. La copia portable conserva Git, pero las sesiones de GitHub y Google pertenecen a cada PC; inicia sesión en la nueva sin compartir contraseñas. Antes de editar en dos equipos, ejecuta `git pull --ff-only` y conserva tus cambios con commit y push.
