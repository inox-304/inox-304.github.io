# Administrar INOX 304

La nueva versión tiene una base de datos y un panel en **`/admin/`**, dentro del mismo dominio que la web. Guardar un producto o un contacto actualiza la fuente que consulta la página pública: no necesita recompilar ni publicar código. Una página recién abierta lee los datos actuales; una pestaña abierta los revisa cada 30 segundos y al recuperar el foco.

El catálogo se edita en el panel. El inventario y los costos usan una hoja privada y una copia en el panel: consulta [Inventario y fabricación](INVENTARIO-FABRICACION.md) para el flujo y la conexión de Google pendiente.

**Estado de alojamiento:** GitHub Pages solo puede servir la versión estática. Este panel necesita ejecutar Python y mantener una base de datos. La dirección `inox-304.github.io` no puede ejecutar Django ni alojar una base de datos propia. La implementación se prueba en esta computadora; la activación en Internet requiere un servidor y una dirección que apunte a él. No se ha contratado ningún servicio ni cambiado el dominio público.

## Instalación recuperada y acceso discreto

Esta copia ya conserva catálogo, cuentas y configuración privada de correo. Para iniciarla utiliza `INICIAR-PORTABLE.cmd`; no repitas los preparadores de instalación nueva, seed ni configuradores de cuentas. Las instrucciones de instalación siguientes son para instalaciones nuevas. Consulta `CONTEXTO/CONTINUAR_AQUI.txt` para la continuidad del respaldo.

El logo del pie conserva el atajo de seis toques, sin contador, avisos intermedios ni instrucciones públicas. Se reinicia tras cinco segundos sin tocarlo y admite teclado con Tab y Enter. El atajo abre el acceso; la contraseña y el segundo paso siguen siendo obligatorios para consultar o modificar el catálogo. La animación decorativa habitual de la marca se conserva.

En Django el atajo abre `/admin/auth/login/` en el mismo servidor. La versión estática puede enlazar a un panel publicado configurando `PUBLIC_ADMIN_URL=https://DOMINIO/admin/` al compilar, o la variable de repositorio del mismo nombre en GitHub Actions. Solo se admiten direcciones HTTPS que terminen en `/admin/`, sin credenciales ni parámetros. Sin esa variable conserva el acceso local; no existe un servidor remoto predeterminado.

Para que el catálogo público refleje lo guardado desde el panel, publica la web completa y Django juntos con `build:server` y el despliegue de `deploy/`. Configurar `PUBLIC_ADMIN_URL` en GitHub Pages solo conecta el acceso: no sincroniza su catálogo estático. El servidor y el dominio siguen pendientes de elección. Antes de trasladar datos se debe preparar y verificar una copia privada que conserve cuentas, hashes de contraseña, segundo factor, medios y claves de respaldo; el respaldo comercial por sí solo no incluye las cuentas. No uses seed ni recrees propietarios para sustituir la instalación recuperada.

La revisión local del 21/10/2026 encontró las dos cuentas con método correo, sin dispositivo confirmado ni autorización de primera activación vigente. La primera verificación debe habilitarse para la cuenta elegida al ponerla en servicio, conservando su contraseña y los dispositivos existentes; requiere que el propietario complete el código en privado. No se renuevan automáticamente autorizaciones al arrancar ni al compilar.

Para habilitar únicamente esa primera verificación desde el servidor, un operador puede ejecutar `python manage.py authorize_initial_enrollment --email CORREO` con el entorno de la instalación cargado. Requiere una cuenta administrativa activa, contraseña utilizable y método ya configurado; para correo también comprueba la configuración SMTP. Autoriza 24 horas y registra el evento, conservando contraseña, método, sesiones y dispositivos pendientes. Si la autorización ya está vigente, conserva su vencimiento. Rechaza cuentas con cualquier dispositivo confirmado o una inscripción ya consumida: no sustituye la recuperación de MFA. El comando no envía mensajes; el código se envía cuando el propietario ingresa su contraseña en el panel y debe confirmarlo en privado. Esta autorización sirve tanto para el catálogo como para el inventario dentro del mismo panel.

## Alojamiento gratuito evaluado (22/10/2026)

Se buscan exclusivamente opciones gratuitas. Una VM Oracle Always Free permite ejecutar el Compose existente y usar un subdominio DuckDNS para HTTPS, sin comprar dominio. La compatibilidad se deduce de la arquitectura; todavía no se ha desplegado ni probado en Oracle. Su registro requiere verificación de identidad con teléfono y tarjeta: no es una alternativa disponible si no se puede completar esa verificación.

La [documentación de Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) indica un cupo A1 de 2 OCPU y 12 GB de memoria, sujeto a disponibilidad regional, y permite recuperar instancias inactivas. Su [registro gratuito](https://www.oracle.com/cloud/free/faq/) exige tarjeta para verificar identidad y puede producir una retención temporal. El propietario debe completar ese registro en privado; no se ha creado cuenta ni contratado recursos. [DuckDNS](https://www.duckdns.org/faqs.jsp) ofrece DNS dinámico gratuito; el nombre disponible sigue pendiente.

[Render gratuito](https://render.com/docs/free) no encaja directamente: su disco es efímero, PostgreSQL gratuito vence a los 30 días y bloquea SMTP en 25/465/587. Requeriría otros servicios para conservar archivos y cambiar el transporte del correo. No se ha sustituido el Gmail existente.

Una alternativa en evaluación es Render para ejecutar Django con PostgreSQL y archivos privados en Supabase. Render se suspende tras 15 minutos sin tráfico y puede tardar alrededor de un minuto en reactivarse; [Supabase Free](https://supabase.com/pricing) puede pausar proyectos tras una semana de poca actividad. No debe presentarse como disponibilidad continua garantizada. Antes de trasladar datos hay que comprobar que las cuentas pueden utilizar esos planes sin tarjeta, adaptar el almacenamiento y el correo por HTTPS, y probar la restauración completa.

Cloudflare sirve AlRazz mediante su API propia. Su [adaptador Django para D1](https://developers.cloudflare.com/workers/languages/python/packages/django/) no admite las transacciones que utiliza este panel; cambiar únicamente la conexión de base de datos haría perder garantías de autenticación y guardado. Requiere una adaptación y validación específica, no una copia directa del despliegue.

## Una sola vez en esta PC

Requisitos: Node.js 24, Python 3.13 y `uv`. Las dependencias están fijadas en `package-lock.json` y `backend/uv.lock`.

1. Abre **`PREPARAR-PANEL.cmd`**. Compila la web para el servidor, instala el backend, aplica migraciones e importa los 32 equipos iniciales. La importación solo añade códigos que no existen: no reemplaza los productos, contactos ni ajustes que ya editaste.
2. El configurador de acceso muestra las cuentas existentes. Elige la tuya para conservar su contraseña o cambiarla en una entrada oculta. Si no hay cuenta, elige **N · Crear otro propietario** e introduce el correo y una contraseña propia de al menos 12 caracteres. No envíes la contraseña por chat. Para usar correo, configura primero **`CONFIGURAR-CORREO.cmd`** y vuelve a **`CONFIGURAR-ACCESO.cmd`**; también puedes elegir aplicación autenticadora al crear una cuenta.
3. Abre **`INICIAR-PANEL.cmd`** y entra en `http://127.0.0.1:8000/admin/`.
4. Introduce correo y contraseña. Si la cuenta está configurada para correo, recibe y confirma el código de seis dígitos. Si usa aplicación autenticadora, registra el QR en el primer acceso autorizado y confirma su código. Hasta completar el segundo paso no hay acceso administrativo.
5. Guarda los códigos de recuperación en un gestor de contraseñas. Cada uno funciona una vez y solo se muestran al generarlos.

El comando de preparación es una herramienta local; no crea ni paga un servidor. La web local funciona mientras el proceso está abierto. El sitio publicado en Internet seguirá usando su alojamiento actual hasta migrarlo.

## Si ya hay cuenta pero todavía no puedes entrar

Abre **`CONFIGURAR-ACCESO.cmd`** desde la misma carpeta que usas para iniciar el panel. Muestra las cuentas de esa instalación, si tienen contraseña, si ya verificaron el segundo paso y si su primera activación sigue vigente. No muestra contraseñas ni claves, no envía mensajes y no cambia permisos de una cuenta existente.

1. Elige tu cuenta. Responde **N** a cambiar contraseña si recuerdas la actual; responde **S** solo si quieres establecer una nueva, escrita dos veces de forma oculta. Cambiarla cierra las sesiones anteriores, sin borrar el segundo factor.
2. Si indica que falta el correo, ejecuta **`CONFIGURAR-CORREO.cmd`**. Después vuelve a **`CONFIGURAR-ACCESO.cmd`**. La primera activación no se abre mientras falte esa configuración, para que sus 24 horas no transcurran antes de poder recibir códigos.
3. Para una cuenta que nunca terminó su primer segundo paso, confirma **S** cuando pregunte si habilitas la primera verificación durante 24 horas. Conserva la contraseña y los dispositivos pendientes. Si ya hay un segundo factor confirmado, lo conserva y no pide volver a inscribirlo. Una cuenta que completó su activación anteriormente y perdió sus dispositivos necesita recuperación del operador.
4. Abre **`INICIAR-PANEL.cmd`** y entra en `http://127.0.0.1:8000/admin/`, o toca seis veces seguidas el logo del pie de la web local. Introduce correo, contraseña y después el código del método configurado.

En la web pública, tocar seis veces el logo abre el servidor configurado en `PUBLIC_ADMIN_URL`, o directamente `http://127.0.0.1:8000/admin/auth/login/` si todavía no hay servidor: **no es un inicio de sesión remoto mientras el servidor no esté publicado**. No introduzcas credenciales en la página estática. El atajo solo abre la dirección del panel; la contraseña y el segundo paso siguen siendo obligatorios.

Para revisar el estado sin preguntas ni cambios desde una terminal:

```powershell
uv run --project backend python backend/manage.py setup_access --status
```

“Correo configurado” significa que las variables necesarias están presentes; no comprueba la conexión ni confirma entrega. La contraseña elegida para AlRazz no se copia automáticamente a INOX. Las contraseñas guardadas en INOX no se pueden consultar en texto claro.

## Activar los códigos por correo

El servidor envía el código **después de comprobar la contraseña**, exclusivamente al correo guardado de esa cuenta autorizada. No se envía a todas las cuentas ni a una dirección elegida desde el navegador. No hay registro público.

1. En la cuenta Gmail que enviará los códigos, activa la verificación en dos pasos y crea una [contraseña de aplicación de Google](https://myaccount.google.com/apppasswords). Es diferente de la contraseña del panel y de tu contraseña habitual de Gmail. Consulta la [ayuda oficial](https://support.google.com/accounts/answer/185833?hl=es) si no aparece esa opción.
2. Abre **`CONFIGURAR-CORREO.cmd`** en la carpeta que ejecuta el panel. Introduce el Gmail remitente y esa contraseña de aplicación en la entrada oculta. El configurador comprueba la conexión cifrada con Gmail antes de guardar; no envía un mensaje de prueba. Si falla, conserva la configuración anterior.
3. Reinicia **`INICIAR-PANEL.cmd`**. Los secretos quedan en el archivo privado `backend/.env`, excluido de Git. No los pegues en el chat ni los subas al repositorio.
4. Abre **`CONFIGURAR-ACCESO.cmd`**, selecciona la cuenta y habilita su primera activación si está pendiente o vencida. La primera verificación debe completarse en 24 horas. Una vez confirmada, la cuenta conserva su acceso sin ese plazo de activación. Para cambiar de método en una cuenta ya activada, un operador utiliza `configure_mfa --email CORREO --method email`; ese comando de recuperación revoca las sesiones y los dispositivos anteriores, por lo que no debe usarse solo para renovar una primera activación.

Sin un remitente configurado, el acceso por correo se detiene con un mensaje claro: no se finge que el código fue enviado ni se concede acceso. Una aceptación SMTP confirma el envío al proveedor, no la recepción en la bandeja; revisa Spam si no aparece. Si usas otro proveedor, configura las variables `EMAIL_*` del ejemplo en el archivo privado en vez de utilizar el configurador de Gmail.

El transporte recomendado es `EMAIL_BACKEND=security.smtp_backend.EmailBackend`. Conserva la conexión SMTP cifrada de Django y deja que Python elija un nombre válido para presentarse ante el servidor de correo. Esto evita que Gmail rechace nombres de equipos Windows sin dominio, aunque la contraseña de aplicación sea correcta. Si actualizas una instalación que guardó `django.core.mail.backends.smtp.EmailBackend`, cambia solo esa variable privada al transporte recomendado y reinicia el panel; conserva las credenciales existentes.

Los códigos duran **5 minutos**, se usan una sola vez y admiten un máximo de **5 intentos**, además del límite compartido por cuenta y red. Reenviar exige esperar **60 segundos** e invalida el código anterior; no prolonga indefinidamente la etapa pendiente. Están vinculados a la cuenta, la sesión, el propósito y la versión de seguridad. La base conserva una huella protegida, nunca el código en texto claro. El primer acceso verificado genera los códigos de recuperación de un solo uso. Regenerarlos exige otra verificación reciente.

Un rechazo SMTP permanente (5xx) pausa nuevos envíos de esa cuenta, conserva sus códigos de recuperación y elimina la invitación a reintentar. No hay reintentos automáticos del transporte. La pausa se consulta con `python backend/manage.py email_delivery --email CORREO`; un operador puede usar `--action pause` tras un rebote confirmado o `--action resume` después de corregir la causa, con `--confirm-reviewed`. Estos controles sólo cambian la entrega y su auditoría: no reinician MFA, contraseñas, sesiones ni cuotas. Un rebote posterior a una aceptación SMTP no puede detectarse automáticamente sin integrar el buzón; el panel no lo interpreta como entrega garantizada. El Message-ID usa el dominio del remitente configurado, conservando From y envelope. Ninguno de estos ajustes garantiza pasar los filtros de Gmail.

## Llaves de acceso para propietario y gerencia

El panel permite conservar correo/TOTP y agregar llaves WebAuthn. El propietario se identifica explícitamente mediante `SECURITY_OWNER_USERNAME` en la configuración privada, sin deducirlo del indicador de superusuario. Puede registrar su propia llave y autorizar durante 24 horas un registro de un solo uso para una cuenta administrativa existente. Cada gerente completa su vinculación desde una sesión con MFA y revalida la contraseña; la autorización no sustituye esa autenticación. Se pueden registrar varias llaves en la cuenta compartida de gerencia, con etiquetas distintas.

Para aplicar los roles a cuentas existentes, un operador configura `SECURITY_OWNER_USERNAME` y ejecuta `python manage.py configure_business_roles --owner CORREO_PROPIETARIO --manager CORREO_GERENCIA`. Conserva al propietario que ya es superusuario y asigna a gerencia el grupo **INOX · Gerencia**, con permisos comerciales del catálogo y consulta de inventario. No cambia contraseñas, correo, segundo factor, recuperación ni sesiones. Si encuentra otros superusuarios o permisos de gerencia ajenos al catálogo, se detiene para revisarlos, sin eliminarlos automáticamente. Dar acceso al panel no concede permisos de edición en Google Sheets: estos se administran por separado en Google.

Para habilitar la vinculación, configura `SECURITY_PASSKEYS_ENABLED=1`, `SECURITY_PASSKEY_RP_ID` y `SECURITY_PASSKEY_ORIGIN` con el dominio y origen HTTPS estables del panel. El RP debe coincidir exactamente con el hostname del origen, sin rutas ni comodines. El desarrollo aislado admite `localhost` y `http://localhost:8000`; una dirección IP no es RP válido y las llaves de localhost no se trasladan al futuro dominio público. No registres los dispositivos definitivos antes de definir ese dominio. El servidor valida origen, RP, desafío de un uso, sesión, cuenta, firma y verificación local del usuario; no recibe PIN ni biometría.

En **Seguridad → Llaves de acceso**, el propietario ve llaves y autorizaciones pendientes, puede cancelarlas y revocar una llave concreta. La revocación detiene las sesiones que usaron esa credencial sin revocar las demás. La etiqueta identifica la llave elegida al registrarla; una cuenta compartida no identifica inequívocamente a la persona que la usa. Algunos gestores sincronizan passkeys entre dispositivos: revocar la credencial invalida también sus copias sincronizadas.

Después de validar contraseña, una cuenta con llaves activas recibe primero la opción WebAuthn sin enviar correo. Puede elegir explícitamente recuperación o su correo existente como alternativa durante la transición; cancelar el diálogo del dispositivo nunca envía un mensaje por sí solo. Los permisos de Google Sheets se administran independientemente en Google Drive. El lector del servidor conserva acceso de sólo lectura a la hoja autorizada; registrar llaves en el panel no concede permisos de edición de Sheets.

## Uso diario

### Crear un equipo, aunque sus archivos todavía no estén listos

1. En **Productos**, pulsa **Nuevo equipo**. El editor se organiza en **Datos del equipo**, **Fotos y archivos**, **Variaciones**, **Adicionales**, **Precio** y **Revisar y guardar**. Puedes recorrerlos con Anterior/Siguiente, saltar a un paso o mostrar todo el formulario.
2. Escribe el nombre y elige **Línea caliente**, **Línea fría** o **Línea neutra**. No tienes que inventar un código ni escribir una dirección: se generan al guardar y permanecen fijos al editar. Los productos antiguos de Mobiliario se conservan para reclasificarlos después.
3. En **Fotos y archivos**, cada botón recibe su archivo directamente: foto principal, ficha técnica PDF, modelo 3D GLB y portada opcional del 3D. Puedes dejarlos pendientes; seleccionar un archivo todavía no lo guarda. El límite es de 8 MB por archivo; el GLB debe incluir sus texturas. La galería permite hasta ocho fotos adicionales.
4. Añade **Variaciones** y **Adicionales** si ya los tienes definidos y configura **Precio**. Puedes completar los tres pasos después; deja desmarcado Mostrar precio si todavía cotizas por consulta. En Adicionales, pulsa **Agregar opción adicional** para preparar las opciones de ese equipo.
5. En **Revisar y guardar**, deja desmarcado **Publicado en la web** y pulsa **Guardar y volver al catálogo** o **Guardar y seguir editando**. El equipo queda como borrador privado, incluso sin fotos, PDF o 3D.
6. Cuando tengas los archivos definitivos, abre ese mismo equipo, entra a **Fotos y archivos**, selecciónalos y guarda. Verás el estado actual y podrás abrir los archivos guardados. Subir uno nuevo reemplaza su asociación en este producto; no elimina el archivo anterior de otros productos.
7. Revisa el equipo mediante **Abrir vista previa privada** y activa su publicación cuando corresponda. Solo un equipo activo y publicado aparece en la web servida por Django. Las animaciones y reglas de ubicación de adicionales se definirán con los diseños que entregues; cargar un GLB no las crea automáticamente.

Si el servidor indica un error después de enviar el formulario, corrige el paso marcado y vuelve a seleccionar los archivos nuevos antes de guardar: el navegador no permite conservar una subida pendiente después de recargar. Los archivos que ya estaban guardados permanecen asociados.

### Preparar los adicionales de cada equipo

En el paso **Adicionales**, escribe el nombre y, si hace falta, una descripción de cada opción (por ejemplo, ruedas o baranda). Elige cómo se cobra: **unidad**, **metro lineal**, **metro cuadrado** o **personalizada**, con su etiqueta (por ejemplo, juego). La moneda es la del producto.

El precio es opcional. Para mostrar una tarifa, escribe su importe y marca **Mostrar precio** en ese adicional. Si no lo marcas, se ofrece como **A cotizar**, aunque guardes una tarifa privada. Cada adicional controla su propia tarifa pública, independientemente del precio del equipo. El costo interno siempre es privado. Desmarca **Activo** para retirarlo de la web conservando sus datos, o cambia su orden para organizarlo.

El cliente puede seleccionar estas opciones en la ficha del equipo; sus nombres se incluyen en la solicitud de WhatsApp junto a la variación elegida. Las cantidades, medidas y compatibilidad se confirman al cotizar: no se suman automáticamente tarifas de distintas unidades. Los adicionales se ofrecen por equipo; todavía no hay reglas de compatibilidad por variación ni colocación dentro del modelo 3D. Las definiremos con tus diseños.

**Recargo fijo incluido**, en el paso Precio, sigue siendo una parte del precio base. No es una opción seleccionable. Los adicionales tienen su propio apartado y no se suman a ese recargo. Al duplicar un equipo se copian sus adicionales a un borrador; también se incluyen en el historial y en los respaldos comerciales.

En **Productos**, busca por código o nombre y filtra por categoría, publicación y disponibilidad. Puedes crear un equipo, duplicar uno como borrador, cambiar su orden y editar sus variantes. Ocultar desmarca la publicación y conserva los datos. El campo activo permite retirar temporalmente un equipo de toda la oferta.

Cada producto separa **precio de venta**, **costo interno** y **notas internas**. Los dos últimos nunca se incluyen en la API ni en el HTML públicos. El servidor calcula descuentos y adicionales con decimales; no confía en un total enviado desde el navegador. La unidad de cobro puede ser unidad, metro lineal, metro cuadrado u otra etiqueta. La vista previa permite revisar un borrador desde la sesión privada.

En **Archivos**, sube una foto, ficha PDF o modelo GLB y selecciónalo en el producto; también puedes conservar los archivos existentes de la web. Los archivos subidos se guardan fuera del código. El servidor solo entrega públicamente los archivos vinculados a un producto activo y publicado. Un borrador puede revisarse únicamente desde el panel. Máximo inicial: 8 MB por archivo. Las fotos se reducen para la web y se eliminan metadatos innecesarios.

En **Contactos** cambia teléfonos, WhatsApp y mensajes. En **Ajustes del negocio** cambia dirección, horarios, redes sociales, textos y qué contacto se utiliza en cada sección. Guardar no modifica la estructura visual de la web.

El panel avisa de cambios sin guardar. Los formularios validan en el servidor y las eliminaciones piden confirmación. Prefiere **ocultar** para conservar la información y el historial.

## Accesos del equipo

El propietario configurado dispone de **Accesos del equipo → Gestionar cuentas y permisos** en el inicio del panel, en `/admin/auth/accounts/`. La gerencia no puede abrir esa pantalla, crear cuentas ni conceder permisos. Cada cambio requiere la sesión con segundo factor, la contraseña actual del propietario y protección CSRF.

- **Agregar una cuenta:** indica correo, nombre, contraseña segura y acceso a catálogo, inventario o ambos. La cuenta no obtiene permisos de propietario. Tiene 24 horas para confirmar su propio segundo factor; hasta entonces no puede entrar al panel.
- **Cambiar permisos:** limita los módulos disponibles. El inventario permite consultar y actualizar la copia privada de Google Sheets; editar la hoja exige el permiso de editor otorgado por separado en Google.
- **Desactivar o reactivar:** conserva contraseña, segundo factor y datos. Desactivar bloquea la cuenta, sus llaves y sesiones; reactivar exige iniciar sesión nuevamente. Los cambios de permisos también invalidan las sesiones anteriores.
- **Renovar activación inicial:** aparece cuando vencieron las 24 horas de una cuenta activa que nunca confirmó su segundo factor y conserva una autorización sin usar. Renueva otras 24 horas, sin cambiar contraseña ni dispositivos ni enviar códigos. Rechaza cuentas ya activadas; la recuperación de MFA sigue siendo un procedimiento separado.

La cuenta del propietario y cualquier superusuario quedan protegidos frente a estas acciones. No se borran cuentas ni se permite elevarlas a superusuario. La sección **Seguridad y llaves** administra las autorizaciones de dispositivos por separado; el registro de llaves requiere la dirección HTTPS definitiva del panel. Todas las acciones que cambian accesos se registran sin contraseñas ni códigos.

## Cuentas y duración de sesiones

- No existe registro público. Solo un operador con acceso al servidor puede autorizar propietarios mediante `create_owner`.
- Primero correo y contraseña; después código de correo o TOTP según la cuenta. También se admite un código de recuperación previamente generado. La etapa pendiente dura **5 minutos**.
- Una sesión completa dura como máximo **8 horas**, con vencimiento tras **30 minutos sin actividad**. No se amplía el máximo absoluto navegando.
- Cerrar sesión revoca la sesión en el servidor. Una pestaña o cookie antigua no concede acceso de nuevo.
- Los intentos se limitan por cuenta y dirección de red durante ventanas de 15 minutos. Los códigos usados, vencidos o reemplazados no se aceptan de nuevo.
- Las contraseñas y códigos de recuperación se almacenan con hashes Argon2. Las claves TOTP y sesiones están en la base de datos privada, nunca en el repositorio ni en la página pública.
- El panel no permite desactivar la verificación en dos pasos. Si pierdes el autenticador y todos los códigos, un operador debe autorizar un nuevo registro con `authorize_enrollment --email CORREO`; esto revoca las sesiones anteriores. Cambiar de método se hace exclusivamente desde el servidor mediante `configure_mfa`.

## Datos que deben conservarse

En desarrollo, `backend/data/` contiene la base SQLite, archivos subidos y una clave local. Es una carpeta **privada**, excluida de Git. En producción se usa PostgreSQL y un volumen persistente para archivos, fuera de las imágenes del programa.

No borres la base de datos al instalar una nueva versión. Las modificaciones de estructura se hacen con migraciones. El servidor de producción no reimporta el catálogo inicial al arrancar. Actualizar el código y ejecutar `migrate` conserva el contenido comercial.

Para llevar el proyecto a otra PC, copia el código y un respaldo comercial; o copia `backend/data/` con el servidor apagado y guarda la carpeta de manera privada. Conserva también `backend/.env` de forma privada, o vuelve a configurar el correo en destino. No necesitas copiar `.venv` ni `node_modules`: se reconstruyen desde los archivos de versiones. Las cuentas y el autenticador no viajan en un respaldo solo comercial; se preparan de nuevo en el servidor de destino.

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

## Trasladar la instalación completa sin recrear cuentas

Los comandos `export_installation` e `import_installation` trasladan las cuentas existentes, hashes de contraseña, correo/TOTP/passkeys, recuperación, permisos y grupos, sesiones, historial, catálogo, medios y última copia del inventario. Conservan las identidades de los registros, incluidas las relaciones de permisos, y los contadores históricos para no reutilizar IDs borrados. El destino debe ejecutar el mismo código y tener exactamente las mismas migraciones y tablas, ya creadas, **sin cuentas ni datos comerciales**. Solo se admiten las filas de tipos de contenido y permisos generadas por una instalación vacía.

El paquete es privado: contiene secretos MFA y datos comerciales. Su firma HMAC y sus sumas SHA-256 detectan modificaciones, pero **el ZIP no está cifrado**. Guárdalo fuera de carpetas públicas, protégelo y transfiérelo por un canal seguro. No contiene `backend/.env`, la clave Django, la credencial Google ni otros archivos de secretos. Esos ajustes se trasladan por separado. La clave Django efectiva del destino debe ser idéntica a la del origen: su fingerprint y la firma se comprueban antes de importar. No reemplaces la clave existente por otra aleatoria durante este traslado.

Detén las escrituras en el origen durante la exportación y hasta completar el cambio de servidor. Los comandos bloquean las tablas durante su propia operación, pero no impiden que una web todavía abierta guarde cambios después. Usa nombres nuevos para los paquetes; nunca se sobrescriben.

```sh
python backend/manage.py export_installation /ruta/privada/instalacion-inox.zip
# En el destino migrado y vacío, con los secretos ya configurados:
python backend/manage.py import_installation /ruta/privada/instalacion-inox.zip --check
python backend/manage.py import_installation /ruta/privada/instalacion-inox.zip --confirm RESTORE_EMPTY_INSTALLATION
```

`--check` verifica el paquete, la clave, el esquema y que el destino esté vacío sin restaurar datos. La importación rechaza rutas inseguras, archivos faltantes, duplicados y paquetes que excedan los límites: 1 GiB comprimido, 2 GiB total, 128 MiB por archivo, 32 MiB por archivo de registros y 100.000 registros. Comprueba nuevamente los registros restaurados y sus relaciones antes de confirmar la transacción. Un error anterior a esa confirmación revierte los datos y retira los archivos recién creados. Si falla únicamente la limpieza del paquete temporal después de confirmar, conserva la instalación restaurada y avisa que hay un temporal privado por retirar; no se debe repetir la importación. PostgreSQL puede conservar contadores de secuencia adelantados tras un error; se mantienen seguros sin reutilizar IDs. Una interrupción del proceso o del equipo requiere revisar los directorios de destino antes de reintentar, porque la base y el sistema de archivos no comparten una transacción física.

Conserva la copia del origen hasta verificar login, catálogo, medios, inventario y permisos en el servidor nuevo. Las sesiones se preservan en la base, pero la cookie del navegador local no se traslada a otro dominio: se vuelve a entrar normalmente. Las passkeys siguen vinculadas a su dominio original; se registran para el dominio definitivo mediante el flujo autorizado, sin alterar las existentes. La credencial Google debe montarse en una ruta privada válida del servidor y configurarse en `GOOGLE_APPLICATION_CREDENTIALS`. No uses `seed_catalog`, `create_owner` ni preparadores de acceso para este traslado.

## Publicar en un servidor

Los archivos `Dockerfile`, `deploy/compose.yml` y `deploy/Caddyfile` preparan una instalación con Django, PostgreSQL y HTTPS. Necesitas un servidor con Docker y un dominio apuntando a su IP. Antes de contratar cualquier servicio se debe elegir proveedor y costo con el propietario.

Configura **fuera del repositorio** `INOX_DOMAIN`, `POSTGRES_PASSWORD` y `DJANGO_SECRET_KEY`. Genera ambos secretos aleatorios; usa una contraseña de PostgreSQL sin caracteres reservados de URL, por ejemplo 32 bytes hexadecimales. Ejecuta desde `deploy/`:

Para cuentas con verificación por correo configura también `SECURITY_EMAIL_ENABLED=1`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS` o `EMAIL_USE_SSL`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` y `DEFAULT_FROM_EMAIL` en el entorno privado de Compose. El archivo local `backend/.env` no se copia a la imagen de producción. Usa `create_owner --mfa email` para esos propietarios.

```sh
docker compose up -d --build
docker compose exec web backend/.venv/bin/python backend/manage.py seed_catalog
docker compose exec web backend/.venv/bin/python backend/manage.py create_owner
docker compose exec web backend/.venv/bin/python backend/manage.py check --deploy
```

La base y los archivos usan volúmenes persistentes. **No ejecutes `docker compose down -v`** sobre un negocio en uso: elimina los volúmenes. PostgreSQL no publica un puerto externo; el proceso web queda detrás de Caddy, que administra HTTPS. `DATABASE_SSLMODE=disable` en Compose solo corresponde a la red privada entre esos contenedores; una base externa debe usar TLS.

No se debe publicar el servidor de desarrollo de Django. En producción se exigen HTTPS, hosts explícitos, una clave privada y PostgreSQL. La integración continua ejecuta pruebas con PostgreSQL para comprobar el comportamiento transaccional, además de las pruebas locales con SQLite.
