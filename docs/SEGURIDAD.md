# Revisión de seguridad de INOX 304

El catálogo público y el panel privado tienen límites diferentes. Los visitantes pueden consultar productos publicados y sus archivos aprobados. Los costos, inventario, proveedores, cuentas, llaves y respaldos requieren autorización en el servidor. Ocultar un botón o conocer el gesto del logo no sustituye esa autorización.

## Antes de publicar cambios

- Revisar el diff y comprobar que no incluye credenciales, bases, exportaciones, historiales privados ni archivos de entorno.
- Ejecutar las pruebas de permisos y segundo factor con datos sintéticos. Verificar también los POST directos: un usuario de lectura no debe publicar, ocultar, duplicar ni editar mediante acciones masivas.
- Conservar cuentas y factores existentes al desplegar; las migraciones aditivas requieren respaldo. No ejecutar semillas ni preparadores de acceso.
- Comprobar el resultado de `Private administration checks` y `Source security analysis` en GitHub. CodeQL analiza Python, JavaScript/TypeScript y los workflows; sus resultados aparecen en la sección Security del repositorio.
- Revisar alertas antes de integrarlas. Un análisis aprobado no garantiza ausencia de vulnerabilidades; las pruebas funcionales y la revisión humana siguen siendo necesarias. El workflow no configura por sí solo protección de ramas ni revisión obligatoria.

CodeQL se ejecuta ante pushes, pull requests y ejecuciones manuales. Usa el token temporal de GitHub con lectura del código y escritura de resultados de seguridad; no necesita secretos de producción. Nunca añadir secretos a los permisos de un workflow de contribuciones externas ni cambiarlo a `pull_request_target` para ejecutar código de un PR.

## Accesos y archivos

El propietario controla los permisos para añadir llaves a las cuentas de gerencia. Cada usuario registra personalmente su llave desde el dominio HTTPS definitivo. El servidor verifica firma, origen, caducidad y uso único; el PIN o la biometría permanecen en el dispositivo. Los métodos de recuperación se conservan y no se incluyen en respuestas, logs ni commits.

Las acciones masivas del catálogo comprueban permisos tanto al mostrarse como al ejecutarse. Duplicar exige permiso para crear el producto y los componentes que se copian. Los archivos privados se sirven mediante vistas autorizadas, con tipos permitidos y encabezados de protección; el almacén de datos y los respaldos nunca se publican como directorio estático.

La restauración del historial exige permiso para consultar el historial y para modificar el objeto; las variaciones, adicionales e imágenes también exigen permiso sobre su producto. Los eventos de seguridad quedan reservados al propietario, incluso frente a otros superusuarios del catálogo.

Al consumir un segundo factor se vuelve a verificar la cuenta, su contraseña, la caducidad y la versión de sesión dentro de la transacción. Los flujos bloquean primero el estado de seguridad y después la cuenta para coordinar los cambios concurrentes. Una cuenta revocada o una contraseña cambiada durante la solicitud no debe completar el acceso ni regenerar códigos de recuperación.

## Finanzas

Los permisos financieros son independientes de los permisos del catálogo y se comprueban por empresa en cada solicitud, incluidos los adjuntos, las exportaciones y los enlaces directos. Solo el propietario administra las delegaciones. Una revocación o una reducción de permisos debe aplicarse también a sesiones ya iniciadas. Las pruebas cubren usuarios anónimos, cuentas sin acceso financiero, empresas ajenas y solicitudes POST sin CSRF.

Los importes confirmados y sus precios históricos se conservan. Vincular un mensaje a un borrador exige que su grupo de origen coincida con el medio de pago de la cuenta; editar o confirmar ese borrador vuelve a comprobarlo. Las operaciones relacionadas bloquean empresa, movimiento y mensaje en un orden consistente para evitar conflictos concurrentes.

El lector comprueba tamaño y dimensiones de JPG/PNG antes de decodificar la foto y conserva el control del worker desde su creación para terminarlo también durante la carga de idiomas. Los recursos siguen en el mismo origen; la lectura no confirma movimientos automáticamente. Los campos deben revisarse y corregirse antes de guardar.

## Contención de solicitudes y dependencias

Los formularios multipart del panel tienen límites antes de CSRF y del guardado temporal. Las pantallas sin carga de archivos rechazan cualquier archivo, incluso si llega con un campo inesperado. Catálogo admite hasta 8 MiB por archivo y 64 MiB acumulados por solicitud; para galerías grandes se puede guardar por lotes. SketchUp conserva su límite configurado y comprobantes su límite propio. Superar el presupuesto rechaza la solicitud completa antes de persistir una parte. Estos controles no sustituyen autenticación, MFA ni CSRF.

Una IP bloqueada no puede seguir creando cuotas para correos nuevos ni consumir la cuota de otras cuentas. El primer bloqueo se registra por IP y ventana de 15 minutos; los rechazos repetidos se suprimen para acotar el crecimiento del registro. El cierre de sesión autenticado sigue auditado; una petición de cierre anónima no crea eventos.

Las versiones se fijan en lockfiles. La auditoría de npm falla ante avisos conocidos de cualquier gravedad y la de Python verifica los requisitos fijados. Actualizar dependencias requiere pruebas funcionales y revisión del resultado: un informe sin avisos conocidos no demuestra ausencia de fallos. Los directorios privados de finanzas y las salidas locales quedan fuera del contexto de Docker.

## Límites de la revisión

La revisión de código y las pruebas aisladas no certifican las ACL reales del almacenamiento, la restauración de copias externas ni la seguridad de las cuentas del proveedor. Las pruebas de concurrencia deben ejecutarse también sobre PostgreSQL. Los límites por petición y por IP no son protección completa frente a un ataque distribuido; esa capa requiere controles en la infraestructura.

La conversión de SketchUp limita recursos y reduce el entorno del proceso, pero no constituye un aislamiento completo de sistema operativo y red. Se deben aceptar modelos solo de personal autorizado y evaluar un trabajador aislado antes de abrir cargas a terceros. Ningún lenguaje ni motor OCR garantiza seguridad o exactitud del 100 %.

## Configuración del alojamiento

`DEBUG` debe estar desactivado en producción. El dominio, cookies seguras, CSRF y RP de passkeys deben corresponder a la dirección pública definitiva. `TRUST_REVERSE_PROXY` solo se habilita detrás de un proxy controlado que reemplace el encabezado de IP configurado; una plataforma distinta de Caddy requiere verificar sus encabezados antes de reutilizar esa opción.

Los límites gratuitos deben comprobarse antes de desplegar. Cambiar de alojamiento no debe eliminar transacciones de base de datos, controles de segundo factor ni la persistencia de medios e inventario. La exportación completa y la configuración de servidor están descritas en [Panel de administración](PANEL-ADMINISTRACION.md).

La integración de Codex Code Review es independiente de CodeQL. Requiere conectar explícitamente el repositorio a Codex y habilitar la revisión en la cuenta; este workflow no realiza esa conexión.
