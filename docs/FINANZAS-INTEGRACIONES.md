# Recepción financiera por WhatsApp

Un operador humano y un número técnico Cloud API participan en tres grupos: **Yapes**, **Efectivo** y **Transacciones**. Cada mensaje identifica su empresa; no se crean grupos por empresa. Los nombres, empresas y cuentas se administran desde Finanzas → Configuración.

## Flujo implementado

1. Meta verifica `GET /api/finanzas/whatsapp/` con la integración habilitada y el token correcto. Esta etapa funciona aunque aún falten los IDs de los grupos.
2. El `POST` sigue cerrado hasta completar secreto, número receptor, operador y tres grupos distintos. Verifica HMAC SHA-256 sobre el cuerpo original y las listas autorizadas antes de guardar.
3. Una foto nueva JPEG/PNG se encola cuando se habilita el procesamiento. El webhook responde después de persistir el mensaje; no espera al OCR.
4. Un trabajador descarga el medio autenticándose con Meta, verifica tamaño, tipo y SHA-256, conserva el original privado y lo lee con **Tesseract español/inglés en el servidor**. No necesita una API de IA de pago. PaddleOCR sigue disponible para carga manual desde el navegador.
5. El mensaje identifica explícitamente empresa y tipo. La cuenta debe coincidir con empresa, medio y moneda. Se crea un **borrador** con comprobante solo si los campos necesarios son válidos y no hay ambigüedad, conflicto, baja confianza o duplicado.
6. Lo incompleto queda en **Recepción y conexiones → Revisar y completar datos**. El propietario compara la foto, elige empresa y corrige campos. Guardar prepara un borrador; confirmar el movimiento es otra acción.

Los borradores automáticos también aparecen en **Por revisar**; no suman a gráficos ni totales confirmados. **Corregir la empresa** anula un borrador automático aún sin editar y permite reclasificar la foto conservando el historial. Nunca cambia una empresa confirmada ni recalcula sus precios históricos.

## Lo que requiere configuración externa

Meta debe habilitar OBA, Cloud API y Groups API. El código no concede elegibilidad ni crea grupos. Los 30 días exigidos para OBA corresponden al registro en **WhatsApp Business Platform**, no a la antigüedad de WhatsApp del teléfono. La aprobación no es automática.

No se envían respuestas del bot, no se leen grupos ordinarios ajenos a la integración ni se usa OpenAI. Texto, PDF y otros adjuntos quedan como referencias para gestión manual; esta versión automatiza solo fotos JPEG/PNG. Tampoco importa masivamente el histórico Excel.

## Configuración privada del servidor

Guardar valores solo en secretos del alojamiento, nunca en Git, el navegador ni el chat compartido.

| Variable | Uso |
|---|---|
| `FINANCE_WHATSAPP_ENABLED=1` | Habilita la verificación inicial; recibir exige configuración completa. |
| `FINANCE_WHATSAPP_VERIFY_TOKEN` | Valor aleatorio privado igual al registrado al verificar el callback. |
| `FINANCE_WHATSAPP_APP_SECRET` | Secreto de la app Meta; valida la firma del POST. |
| `FINANCE_WHATSAPP_PHONE_NUMBER_ID` | ID numérico del bot, no su teléfono visible. |
| `FINANCE_WHATSAPP_OPERATOR_ID` | Identificador del único operador permitido. |
| `FINANCE_WHATSAPP_OPERATOR_ID_KIND=bsuid` | Usa `from_user_id`; `phone` solo si se configura expresamente `from`. Sin fallback. |
| `FINANCE_WHATSAPP_GROUP_YAPE` | ID del grupo Yapes. |
| `FINANCE_WHATSAPP_GROUP_CASH` | ID del grupo Efectivo. |
| `FINANCE_WHATSAPP_GROUP_TRANSFER` | ID del grupo Transacciones. |
| `FINANCE_WHATSAPP_ACCESS_TOKEN` | Token privado con acceso a medios del número autorizado. |
| `FINANCE_WHATSAPP_GRAPH_API_VERSION` | Versión explícita Meta; predeterminado `v27.0`. |
| `FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED=1` | Encola fotos nuevas y arranca trabajador. Predeterminado `0`. |
| `FINANCE_WHATSAPP_TESSERACT_COMMAND` | Ejecutable local; predeterminado `tesseract`, incluido en Docker con español/inglés. |

Solo el propietario ve la bandeja sin clasificar y sus originales. Los gerentes conservan sus permisos por empresa. El panel muestra preparación de la configuración, no garantiza una entrega real de Meta.

## Cómo escribir cada registro

Pie de foto recomendado, usando el código real de Configuración:

```text
INOX304 | EGRESO | S/ 118.00 | Fecha: 2026-11-17 | Detalle: materiales
```

También admite etiquetas `Empresa: INOX304`, `Tipo: ingreso`, `Importe: S/ 118.00`, `Fecha: 2026-11-17` y `Cuenta: CAJA`. Si hay varias cuentas del mismo medio y moneda, indicar código o elegirla después. La empresa no se deduce del proveedor impreso.

**Transacciones** es el medio bancario; no implica traslado entre cuentas propias. Un traslado necesita origen y destino revisados manualmente. La fecha e importe corresponden al dinero realmente cobrado o pagado; adjuntar una factura no demuestra un segundo pago.

## Despliegue y activación

1. Con respaldo del destino confirmado, aplicar expresamente `finance_intake.0002_receipt_processing`. Es aditiva: conserva mensajes anteriores como manuales y no crea usuarios, empresas, saldos ni movimientos. El contenedor no migra al arrancar.
2. Publicar el commit probado en Render. Para revertir código, conservar columnas nuevas; no revertir la migración borrando evidencia.
3. Guardar ENABLED y VERIFY_TOKEN y verificar el callback HTTPS en Meta. Resuelve el bloqueo de necesitar grupos antes de verificar.
4. Crear grupos con la API oficial habilitada, obtener IDs e invitaciones por endpoints de grupos y añadir al operador. No usar IDs ficticios. Suscribir la app a la WABA, `messages` y eventos de grupos indicados por Meta.
5. Completar APP_SECRET, PHONE_NUMBER_ID, OPERATOR_ID/KIND y los tres GROUP; el POST solo funciona con todos.
6. Completar ACCESS_TOKEN, activar AUTO_PROCESS y reiniciar/desplegar para arrancar trabajador.
7. Enviar una foto **sintética** por grupo con empresa, importe, fecha y tipo. Verificar original privado y borrador correcto; no confirmar pruebas como dinero real.
8. Probar datos incompletos, reintentos y duplicados. Verificar restauración de respaldo antes de uso intensivo.

El supervisor alterna fotos y SketchUp en un único trabajador: no ejecuta ambos procesos pesados a la vez. `MODEL_IMPORT_WORKER=0` deshabilita conversiones sin impedir OCR. Los reinicios recuperan trabajos mediante leases de 10 minutos e identificadores de ejecución; hay hasta tres intentos automáticos y reintento explícito del propietario. Instalar no procesa el histórico.

## Límites y seguridad

- Callback: JSON hasta 3 MiB/1000 mensajes, ID único. Reintentos idénticos no duplican; ID repetido con contenido distinto se rechaza.
- Medios: JPEG/PNG estáticos, hasta 10 MiB/24 megapíxeles. Consulta a Meta por ID; HTTPS y destino restringido, sin redirects ni proxies heredados. No sigue URLs aportadas en mensajes. Verifica hash contra metadatos.
- OCR: una imagen por vez, hasta 2200 px tras validación, 45 segundos, un hilo y salida acotada. El subproceso no recibe secretos. No envía fotos a otro proveedor de IA.
- Confianza del OCR **no equivale a exactitud contable**. No hay garantía de 100 % ni 99,99 %. Borrosidad, manuscritos, reflejos, recortes, formatos nuevos y ambigüedad requieren corrección.
- Revalida propietario, origen, empresa, cuenta y periodo abierto antes de crear borrador. Revocar configuración detiene trabajos pendientes. Ningún extractor confirma dinero o envía mensajes.
- Originales privados detrás del acceso del propietario, sin URL pública y con `no-store`. Respaldo financiero incluye fotos pendientes, fallidas o descartadas y verifica hashes.
- El ZIP del panel tiene límite de 256 MB y puede incluir tanto el original recibido como su adjunto financiero. Para volúmenes de decenas de fotos diarias, preparar respaldo operativo de base y objetos privados; el ZIP manual no sustituye ese respaldo.
- Un fallo entre escritura de objeto y transacción puede dejar un objeto privado huérfano. Se intenta limpiar; almacenamiento requiere supervisión y política de retención.
- Render Free puede suspenderse y retrasar recepción/lectura; no garantiza ejecución continua ni capacidad ilimitada. Tesseract es gratuito; Meta, alojamiento y almacenamiento pueden tener costos.

## Referencias oficiales

- [Verificación y firma](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/)
- [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/)
- [Cuentas oficiales y antigüedad](https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts)
- [Medios de WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)
- [Tesseract](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)

Consulta: 17 de noviembre de 2026. Verificar condiciones antes de activar.
