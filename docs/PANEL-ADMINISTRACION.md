# Administrar INOX 304 sin Sheets

La nueva versión tiene una base de datos y un panel en **`/admin/`**, dentro del mismo dominio que la web. Guardar un producto o un contacto actualiza la fuente que consulta la página pública: no necesita recompilar ni publicar código. Una página recién abierta lee los datos actuales; una pestaña abierta los revisa cada 30 segundos y al recuperar el foco.

**Estado de alojamiento:** GitHub Pages solo puede servir la versión estática. Este panel necesita ejecutar Python y mantener una base de datos. La dirección `inox-304.github.io` no puede ejecutar Django ni alojar una base de datos propia. La implementación se prueba en esta computadora; la activación en Internet requiere un servidor y una dirección que apunte a él. No se ha contratado ningún servicio ni cambiado el dominio público.

## Una sola vez en esta PC

Requisitos: Node.js 24, Python 3.13 y `uv`. Las dependencias están fijadas en `package-lock.json` y `backend/uv.lock`.

1. Abre **`PREPARAR-PANEL.cmd`**. Compila la web para el servidor, instala el backend, aplica migraciones e importa los 32 equipos iniciales. La importación solo añade códigos que no existen: no reemplaza los productos, contactos ni ajustes que ya editaste.
2. Al crear el propietario, escribe el correo autorizado y una contraseña propia de al menos 12 caracteres. No envíes la contraseña por chat.
3. Abre **`INICIAR-PANEL.cmd`** y entra en `http://127.0.0.1:8000/admin/`.
4. Introduce correo y contraseña. En el primer acceso autorizado, registra el QR en una aplicación autenticadora y confirma su código. Hasta completar este paso no hay acceso administrativo.
5. Guarda los códigos de recuperación en un gestor de contraseñas. Cada uno funciona una vez y solo se muestran al generarlos.

El comando de preparación es una herramienta local; no crea ni paga un servidor. La web local funciona mientras el proceso está abierto. El sitio publicado en Internet seguirá usando su alojamiento actual hasta migrarlo.

## Uso diario

En **Productos**, busca por código o nombre y filtra por categoría, publicación y disponibilidad. Puedes crear un equipo, duplicar uno como borrador, cambiar su orden y editar sus variantes. Ocultar desmarca la publicación y conserva los datos. El campo activo permite retirar temporalmente un equipo de toda la oferta.

Cada producto separa **precio de venta**, **costo interno** y **notas internas**. Los dos últimos nunca se incluyen en la API ni en el HTML públicos. El servidor calcula descuentos y adicionales con decimales; no confía en un total enviado desde el navegador. La unidad de cobro puede ser unidad, metro lineal, metro cuadrado u otra etiqueta. La vista previa permite revisar un borrador desde la sesión privada.

En **Archivos**, sube una foto, ficha PDF o modelo GLB y selecciónalo en el producto; también puedes conservar los archivos existentes de la web. Los archivos subidos se guardan fuera del código. El servidor solo entrega públicamente los archivos vinculados a un producto activo y publicado. Un borrador puede revisarse únicamente desde el panel. Máximo inicial: 8 MB por archivo. Las fotos se reducen para la web y se eliminan metadatos innecesarios.

En **Contactos** cambia teléfonos, WhatsApp y mensajes. En **Ajustes del negocio** cambia dirección, horarios, redes sociales, textos y qué contacto se utiliza en cada sección. Guardar no modifica la estructura visual de la web.

El panel avisa de cambios sin guardar. Los formularios validan en el servidor y las eliminaciones piden confirmación. Prefiere **ocultar** para conservar la información y el historial.

## Cuentas y duración de sesiones

- No existe registro público. Solo un operador con acceso al servidor puede autorizar propietarios mediante `create_owner`.
- Primero correo y contraseña; después TOTP o un código de recuperación. La etapa pendiente dura **5 minutos**.
- Una sesión completa dura como máximo **8 horas**, con vencimiento tras **30 minutos sin actividad**. No se amplía el máximo absoluto navegando.
- Cerrar sesión revoca la sesión en el servidor. Una pestaña o cookie antigua no concede acceso de nuevo.
- Los intentos se limitan por cuenta y dirección de red durante ventanas de 15 minutos. Los códigos TOTP ya utilizados no se aceptan de nuevo.
- Las contraseñas y códigos de recuperación se almacenan con hashes Argon2. Las claves TOTP y sesiones están en la base de datos privada, nunca en el repositorio ni en la página pública.
- El panel no permite desactivar la verificación en dos pasos. Si pierdes el autenticador y todos los códigos, un operador debe autorizar un nuevo registro con `authorize_enrollment --email CORREO`; esto revoca las sesiones anteriores.

## Datos que deben conservarse

En desarrollo, `backend/data/` contiene la base SQLite, archivos subidos y una clave local. Es una carpeta **privada**, excluida de Git. En producción se usa PostgreSQL y un volumen persistente para archivos, fuera de las imágenes del programa.

No borres la base de datos al instalar una nueva versión. Las modificaciones de estructura se hacen con migraciones. El servidor de producción no reimporta el catálogo inicial al arrancar. Actualizar el código y ejecutar `migrate` conserva el contenido comercial.

Para llevar el proyecto a otra PC, copia el código y un respaldo comercial; o copia `backend/data/` con el servidor apagado y guarda la carpeta de manera privada. No necesitas copiar `.venv` ni `node_modules`: se reconstruyen desde los archivos de versiones. Las cuentas y el autenticador no viajan en un respaldo solo comercial; se preparan de nuevo en el servidor de destino.

## Respaldos e historial

El historial privado registra autor, fecha y cambios. Abre **Historial de cambios** para revisar una edición y restaurar su estado anterior con confirmación. Los respaldos completos incluyen datos comerciales y archivos, pero no cuentas ni claves de autenticación. Desde la carpeta del proyecto:

```powershell
uv run --project backend python backend/manage.py backup_catalog backend/data/backups/catalogo.zip
uv run --project backend python backend/manage.py restore_catalog backend/data/backups/catalogo.zip --check
uv run --project backend python backend/manage.py restore_catalog backend/data/backups/catalogo.zip --confirm RESTAURAR
```

Usa un nombre nuevo para cada copia. `--check` solo verifica; `--confirm RESTAURAR` reemplaza el catálogo y crea automáticamente una copia del estado anterior. Hazlo en una ventana de mantenimiento. La firma rechaza archivos modificados; **no cifra el contenido**, que incluye costos privados. No copies respaldos a `public/`, `dist/` ni a un repositorio público.

Para restaurar en otra instalación conserva de forma privada la misma `CATALOG_BACKUP_KEY` (al menos 32 caracteres). Si no la configuraste, se utiliza `DJANGO_SECRET_KEY`; en desarrollo es el archivo privado `backend/data/.development-secret`. La clave no está dentro del ZIP. No cambies esta clave sin conservar la anterior para tus respaldos.

Para producción, programa un respaldo diario y una copia cifrada fuera del servidor. Haz una prueba de restauración antes del uso real y repítela periódicamente. Además del respaldo comercial, conserva un respaldo PostgreSQL y los secretos del servidor en almacenamiento privado para recuperación completa, sin dejarlos en Git.

## Publicar en un servidor

Los archivos `Dockerfile`, `deploy/compose.yml` y `deploy/Caddyfile` preparan una instalación con Django, PostgreSQL y HTTPS. Necesitas un servidor con Docker y un dominio apuntando a su IP. Antes de contratar cualquier servicio se debe elegir proveedor y costo con el propietario.

Configura **fuera del repositorio** `INOX_DOMAIN`, `POSTGRES_PASSWORD` y `DJANGO_SECRET_KEY`. Genera ambos secretos aleatorios; usa una contraseña de PostgreSQL sin caracteres reservados de URL, por ejemplo 32 bytes hexadecimales. Ejecuta desde `deploy/`:

```sh
docker compose up -d --build
docker compose exec web backend/.venv/bin/python backend/manage.py seed_catalog
docker compose exec web backend/.venv/bin/python backend/manage.py create_owner
docker compose exec web backend/.venv/bin/python backend/manage.py check --deploy
```

La base y los archivos usan volúmenes persistentes. **No ejecutes `docker compose down -v`** sobre un negocio en uso: elimina los volúmenes. PostgreSQL no publica un puerto externo; el proceso web queda detrás de Caddy, que administra HTTPS. `DATABASE_SSLMODE=disable` en Compose solo corresponde a la red privada entre esos contenedores; una base externa debe usar TLS.

No se debe publicar el servidor de desarrollo de Django. En producción se exigen HTTPS, hosts explícitos, una clave privada y PostgreSQL. La integración continua ejecuta pruebas con PostgreSQL para comprobar el comportamiento transaccional, además de las pruebas locales con SQLite.
