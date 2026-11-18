# Ventas y seguimiento de INOX 304

El CRM está en `/admin/crm/`. Usa las mismas cuentas, verificación en dos pasos y llaves del panel. El propietario entra directamente; para autorizar al equipo, en **Seguridad → Cuentas** elige un permiso que incluya **ventas · CRM**. Los permisos existentes no se amplían automáticamente.

## Rutina de trabajo

1. **Hoy:** comienza por los seguimientos vencidos y las consultas sin responsable. Busca por nombre, teléfono, correo, código CRM o producto. Usa **Mis consultas** para trabajar tu agenda.
2. **Nueva consulta:** registra nombre y teléfono o correo. Añade qué necesita, quién lo atenderá y cuándo volver a contactarlo. Empresa, configuración e importe son opcionales.
3. **Ficha:** después de atender al cliente, pulsa **Registrar contacto**, anota lo acordado y programa el siguiente paso. Abrir WhatsApp no registra automáticamente una conversación.
4. **Oportunidades:** organiza el avance en Nuevo, En evaluación, Cotizado, En seguimiento, Venta confirmada, Entregado o No concretado. Una consulta perdida necesita motivo. Cambiar una oportunidad cerrada requiere una explicación.
5. **Resultados:** revisa los canales y campañas que generan consultas y ventas, el tiempo hasta el primer contacto y los motivos por los que no se concretaron.
6. **Canales:** prepara enlaces para la web, Facebook, Instagram, TikTok, Google y WhatsApp. Desde **Consultas nuevas** revisa lo recibido y asigna un responsable. El origen también aparece en la agenda.

El cierre quita el seguimiento pendiente. El historial conserva autor y fecha. Si dos personas editan una misma ficha, se rechaza la versión antigua: revisa la ficha actual antes de volver a guardar.

## Consultas de la web

**Cotizar**, en las tarjetas y fichas del catálogo, lleva al formulario con el producto, capacidad y distribución seleccionados. El envío explícito crea una consulta y devuelve un código CRM. Los reintentos del mismo envío no crean duplicados. Después del registro, el cliente puede continuar por WhatsApp con ese código en el mensaje; editar los datos inicia una solicitud distinta, sin reutilizar la referencia anterior.

WhatsApp sigue disponible como vía independiente. El CRM no lee conversaciones ni envía mensajes, correos masivos o recordatorios automáticos. Las consultas recibidas por teléfono, tienda o WhatsApp se registran manualmente. La agenda muestra cuándo contactar; no es un sistema de notificaciones externas.

## Centralizar solicitudes desde las redes

En **Ventas y seguimiento → Canales** (`/admin/crm/canales/`) hay un enlace por origen, listo para copiar al perfil, publicación, anuncio o respuesta a un interesado. Opcionalmente añade una campaña general, como «cocinas noviembre». Son enlaces públicos: no incluyas datos personales ni secretos en la campaña.

El cliente llega al formulario de INOX y, al enviarlo, su consulta entra como **Nuevo**, con el origen y campaña indicados y sin responsable asignado. El equipo puede filtrar por origen, abrir la ficha, programar el siguiente contacto y seguir la cotización hasta la entrega. Las etiquetas de origen son información de atribución aportada por el navegador, no identidad verificada por una red social.

Si un interesado escribe directamente al dueño por WhatsApp personal o por un mensaje privado de una red social, se le puede enviar el enlace correspondiente o usar **Registrar conversación**. Este acceso prepara el origen, y el vendedor completa solo los datos comerciales. No se importan contactos, historiales personales ni conversaciones completas. El teléfono de cada ficha siempre pertenece al **cliente**.

El botón **Abrir WhatsApp** de una ficha abre el número del cliente. La cuenta remitente la determina WhatsApp en ese dispositivo: no queda forzada por el CRM al número del dueño. La conexión automática con WhatsApp, Facebook o Instagram requeriría sus APIs, permisos y una configuración posterior; preparar un enlace no activa esas conexiones. Abrir un enlace, hacer clic en WhatsApp o registrar una cotización no crea un cobro ni altera Finanzas o inventario.

Esta ampliación reutiliza el esquema de CRM existente y no requiere una migración nueva. Los permisos de lectura del CRM protegen Canales; el registro manual exige además permiso de creación. No habilita nuevos accesos a usuarios existentes.

## Cómo interpretar Resultados

- El periodo se refiere a consultas **creadas** en esos días. Su conversión se actualiza mientras avanzan; no representa todas las ventas cerradas durante el periodo.
- Las ventas confirmadas son las que actualmente están en **Venta confirmada** o **Entregado**. Reabrirlas o cancelarlas las retira del total, conservando sus hitos históricos.
- «Llegaron a cotización» cuenta consultas que pasaron por **Cotizado**. Si saltas directamente a venta, no se inventa una cotización previa.
- Los importes son valores cotizados actuales, separados por PEN y USD. No representan cobros, facturas, rentabilidad ni stock reservado.
- El tiempo de respuesta es la **mediana** entre creación y primer contacto registrado. No mide mensajes de WhatsApp que no hayas registrado.
- Los clics son eventos agregados por día y origen. No son personas únicas, mensajes recibidos ni ventas; no se suman a las consultas. Pueden faltar eventos por privacidad del navegador, problemas de red o límites contra abuso.
- Los filtros activos se indican en pantalla. Los eventos de la web se filtran por periodo y origen, nunca por responsable o etapa.

Para atribuir una campaña utiliza enlaces como `/contacto/?utm_source=facebook&utm_medium=social&utm_campaign=cocinas-cusco`. Se guardan etiquetas limitadas; no coloques datos personales en estos parámetros. Las visitas sin campaña pueden reconocer Google, Facebook, Instagram o TikTok por el dominio de referencia; de lo contrario se clasifican como web.

## Operación técnica

- Datos persistentes en PostgreSQL; tablas CRM separadas del catálogo e inventario. No hay suscripción adicional del CRM.
- Formulario público de escritura, JSON, origen restringido, validación, consentimiento, campo antispam y límites globales por ventana de 15 minutos: 120 intentos de consulta / 5 consultas nuevas por contacto; 300 eventos de clic. Los límites son protección, no una garantía de entrega frente a abuso.
- Claves de reintento aleatorias y huella inmutable del envío. No se expone la lectura de clientes ni se aceptan permisos, estados o importes enviados por visitantes.
- No se almacenan IP ni identificadores de visitantes en las métricas; las claves de control de frecuencia usan valores derivados. Los proveedores de alojamiento pueden conservar registros técnicos.
- CSV privado, filtrado, máximo 10 000 consultas y neutralización de fórmulas de hoja de cálculo.
- Render gratuito puede dormir. El formulario conserva la consulta si falla; ofrece reintento y WhatsApp. No se promete disponibilidad continua del plan gratuito.
- Antes de desplegar código CRM se aplica explícitamente `crm.0001_initial` en la base persistente. El arranque del servidor no ejecuta migraciones ni importa datos.

Las pruebas de dominio, captura y permisos viven en `backend/crm/tests_*.py`; se ejecutan con `npm run server:test`. La atribución pública se comprueba con `node --test src/lib/crm-attribution.test.ts`.
