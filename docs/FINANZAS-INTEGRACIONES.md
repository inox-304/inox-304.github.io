# Recepción financiera por WhatsApp

El módulo de Finanzas está dentro del administrador de INOX. La recepción preparada aquí tiene un operador humano y un número técnico de Cloud API en tres grupos compartidos: **Yapes**, **Efectivo** y **Transacciones**. Las cuatro empresas se identifican en cada registro; no se crean grupos por empresa.

## Estado implementado

- Callback `GET/POST /api/finanzas/whatsapp/`, desactivado por defecto.
- Verificación de firma HMAC SHA-256 sobre los bytes originales, verificación inicial del callback y listas permitidas de número técnico, operador y tres grupos.
- Recepción durable en PostgreSQL antes de responder a Meta. Deduplícación por ID de mensaje; un reintento no genera otra entrada. Un ID repetido con contenido distinto se rechaza.
- Bandeja privada de mensajes pendientes, referencias de archivos y revisión humana. El propietario puede vincular un mensaje a un borrador o descartarlo con motivo, conservando el original y el historial.
- No se confirma ningún movimiento a partir de un mensaje. El propietario selecciona empresa/cuenta y revisa el borrador antes de confirmarlo.

## Pendiente de activación

La cuenta OBA, el número Cloud API y los tres grupos oficiales aún deben estar habilitados y verificarse con una entrega real. Este cambio de código no los crea ni concede elegibilidad. La recepción de mensajes queda cerrada mientras falte configuración.

La descarga de adjuntos de Meta, el análisis con OpenAI y las respuestas automáticas aún no se ejecutan. El texto o pie de foto se guarda; para un adjunto solo se conserva su referencia privada. Hay que descargarlo mediante la API autorizada e inspeccionarlo antes de usarlo como comprobante. La interfaz distingue este estado de un archivo ya cargado al movimiento. No hay tokens de OpenAI/Meta en el navegador ni llamadas facturables en este módulo.

## Configuración del servidor

Guardar valores únicamente en secretos del alojamiento:

| Variable | Uso |
|---|---|
| `FINANCE_WHATSAPP_ENABLED=1` | Activa la recepción solo cuando el resto está completo. |
| `FINANCE_WHATSAPP_APP_SECRET` | Secreto de la aplicación Meta para verificar la firma. |
| `FINANCE_WHATSAPP_VERIFY_TOKEN` | Valor aleatorio privado para comprobar el callback. |
| `FINANCE_WHATSAPP_PHONE_NUMBER_ID` | Identificador del número técnico, no su número visible. |
| `FINANCE_WHATSAPP_OPERATOR_ID` | Identificador del único operador permitido. |
| `FINANCE_WHATSAPP_OPERATOR_ID_KIND=bsuid` | Usa `from_user_id`, preferido por Meta. `phone` solo para una configuración explícita que use `from`. No existe fallback automático. |
| `FINANCE_WHATSAPP_GROUP_YAPE` | ID del grupo Yapes. |
| `FINANCE_WHATSAPP_GROUP_CASH` | ID del grupo Efectivo. |
| `FINANCE_WHATSAPP_GROUP_TRANSFER` | ID del grupo Transacciones. |

Los tres IDs de grupo deben ser distintos. La bandeja no muestra secretos ni la configuración completa. El panel compartido entre empresas no da a un gerente acceso automático a mensajes aún sin empresa: esa bandeja queda reservada al propietario configurado.

## Límites y decisiones de seguridad

- Máximo 3 MiB por callback y 1000 mensajes por lote; solo JSON. Se rechazan firmas inválidas antes de interpretar el contenido.
- Los estados de envío/lectura son notificaciones, no ingresos ni egresos.
- Se conserva un máximo de 16 000 caracteres de texto; si se recorta, se marca para revisión. Los metadatos de adjuntos se limitan a ID, MIME, huella y nombre; no se sigue ninguna URL recibida.
- La recepción no decide empresa por el grupo, no toma el importe de la descripción como dinero confirmado y no usa precios de catálogo para completar importes históricos.
- Un fallo de base de datos no recibe una respuesta de éxito; Meta puede reintentar. El alojamiento que se suspende o una caída prolongada puede agotar el plazo del proveedor: activar monitorización, revisar pendientes y probar recuperación antes del uso cotidiano.
- El cierre financiero, los snapshots, los permisos por empresa y la confirmación corresponden al módulo `finance`, no al webhook.
- Un CSV, factura, imagen o mensaje puede contener instrucciones maliciosas. Un futuro extractor debe tratarlo como datos, producir un esquema estricto y carecer de herramientas de envío, SQL y confirmación.
- La futura IA debe pedir solo lo faltante, con presupuesto de consumo y auditoría. No se debe activar envío automático sin reglas de destinatarios, correlación de respuestas y prevención de duplicados.

## Activación y comprobación

1. Verificar acceso OBA y Groups API del número técnico. Configurar los tres grupos oficiales con el único operador humano.
2. Añadir secretos en el servidor y el callback HTTPS en la aplicación Meta. Suscribir el campo `messages`.
3. Enviar una referencia sintética por cada grupo, sin documentos personales. Verificar una recepción por mensaje y ningún movimiento confirmado automáticamente.
4. Repetir una notificación sintética y verificar la deduplicación. Probar firma incorrecta y grupos/remitentes ajenos; no deben almacenarse.
5. Revisar un borrador, vincularlo al mensaje, confirmar sus importes y comprobar el resumen. Probar restauración de una copia de seguridad.
6. Activar por separado el procesador IA y la descarga de medios cuando estén configurados, probados y autorizados. Este documento no afirma que ya estén funcionando.

## Documentación oficial consultada

- [Creación y validación del callback de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/): verificación GET, firma HMAC, lotes y reintentos.
- [Mensajes de grupos](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/): `group_id`, `from_user_id`, número técnico y estados de salida.
- [Webhooks de WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/): tamaño, entrega, tipos de evento y recuperación.
- [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/): requisitos y capacidades del servicio.

Consulta: 9 de noviembre de 2026. Las condiciones del proveedor pueden cambiar; verificar antes de activar.
