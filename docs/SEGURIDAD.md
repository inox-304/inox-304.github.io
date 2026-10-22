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

## Alojamiento

`DEBUG` debe estar desactivado en producción. El dominio, cookies seguras, CSRF y RP de passkeys deben corresponder a la dirección pública definitiva. `TRUST_REVERSE_PROXY` solo se habilita detrás de un proxy controlado que reemplace el encabezado de IP configurado; una plataforma distinta de Caddy requiere verificar sus encabezados antes de reutilizar esa opción.

Los límites gratuitos deben comprobarse antes de desplegar. Cambiar de alojamiento no debe eliminar transacciones de base de datos, controles de segundo factor ni la persistencia de medios e inventario. La exportación completa y la configuración de servidor están descritas en [Panel de administración](PANEL-ADMINISTRACION.md).

La integración de Codex Code Review es independiente de CodeQL. Requiere conectar explícitamente el repositorio a Codex y habilitar la revisión en la cuenta; este workflow no realiza esa conexión.
