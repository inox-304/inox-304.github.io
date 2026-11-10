# Finanzas dentro del administrador de INOX 304

El módulo está integrado en `/admin/finanzas/` y utiliza el inicio de sesión y segundo factor existentes del panel. Organiza movimientos de dinero por empresa y conserva importes, comprobantes y un historial de cambios. La disponibilidad pública de una versión depende de su despliegue en el servidor; añadir código al repositorio no activa por sí solo las conexiones externas.

## Alcance de esta versión

- Empresas, cuentas o cajas, categorías y códigos de ítems editables desde el panel.
- Registro manual de ingresos, egresos y traslados internos, con borradores antes de confirmar.
- Revisión de comprobantes, detalles de cantidades y precios históricos, anulación con motivo y cierre mensual.
- Filtros por una o varias empresas, fechas, estado, medio y búsqueda; totales separados por moneda.
- Permisos financieros por empresa, independientes de Catálogo, Inventario y CRM.
- Exportación CSV y respaldo privado descargable por el propietario.
- Recepción técnica de WhatsApp preparada y desactivada hasta completar su configuración y verificar entregas reales.

No hay saldos iniciales inventados, movimientos de ejemplo ni datos financieros cargados automáticamente. El lector de fotos usa PaddleOCR en el navegador, con Tesseract como alternativa, y permite corregir los datos antes de guardar un borrador. No están implementados el procesamiento con OpenAI, el envío de preguntas por WhatsApp, el OCR automático de mensajes entrantes, la conexión bancaria, la validación SUNAT ni la importación masiva del histórico desde 2018. Guardar un comprobante no confirma un movimiento. El alcance del lector está en [FINANZAS-OCR.md](FINANZAS-OCR.md).

## Preparación por el propietario

1. Entrar en **Panel → Finanzas → Configuración** con la cuenta propietaria configurada en el servidor.
2. Usar **Preparar empresas** para crear, si todavía no existen, **INOX 304**, **Armosac**, **Victor** y **Shamo**. Esta acción explícita no crea cuentas bancarias, saldos ni movimientos. Se propone PEN; confirmar la moneda de cada empresa antes de registrar dinero.
3. Editar los nombres visibles o añadir nuevas empresas cuando sea necesario. No existe una limitación funcional de cuatro empresas. El código identifica establemente a cada empresa.
4. Crear las cuentas reales de cada empresa: por ejemplo, caja de tienda, Yape del negocio y cuenta bancaria. Cada una tiene un medio y una moneda. Se admiten PEN y USD; no hay conversión automática entre monedas.
5. Crear categorías de ingreso o egreso e ítems con código propio, nombre, unidad y precios o costos sugeridos. El costo vacío significa **desconocido**, no cero.
6. Asignar acceso únicamente a las cuentas activas del panel que deban trabajar en las finanzas de esa empresa.

Las cuentas, categorías y empresas pueden desactivarse para impedir nuevos registros, conservando el histórico. Una cuenta utilizada mantiene su empresa, moneda y medio; una categoría utilizada mantiene su empresa y tipo. Para otra combinación se crea un registro nuevo.

## Dar y retirar acceso

En **Configuración → Accesos**, elegir la empresa, la cuenta del panel y uno de estos permisos:

| Permiso | Qué permite |
| --- | --- |
| Consultar | Ver y filtrar movimientos de la empresa, descargar sus comprobantes y exportar su listado. |
| Registrar borradores | Lo anterior, más crear y editar borradores y adjuntar comprobantes antes de confirmar. |
| Revisar y confirmar | Lo anterior, más confirmar movimientos y anularlos con motivo. |

**Retirar acceso** elimina el permiso financiero de esa empresa. No borra los movimientos ni modifica el acceso a Catálogo, Inventario o CRM. La persona debe existir previamente como cuenta activa del panel; esta pantalla no crea contraseñas ni reinicia su segundo factor.

Solo la identidad propietaria configurada en `SECURITY_OWNER_USERNAME` administra empresas, configuración y permisos financieros. Ser administrador técnico o tener permisos generales de Django no otorga por sí solo este control. Las otras cuentas necesitan una asignación financiera explícita. La recepción compartida de WhatsApp y el respaldo completo también se reservan al propietario.

## Leer el resumen financiero

La portada de Finanzas permite marcar una, dos, tres o más empresas y pulsar **Aplicar selección**. **Ver todas**, o aplicar sin marcas, muestra todas las empresas a las que el usuario tiene acceso. Se puede consultar el mes actual, el anterior o todo el historial y buscar un detalle, referencia o código FIN. En **Más filtros** se eligen medio, moneda y estado de la lista.

La selección combinada se conserva al cambiar de periodo o medio, buscar, abrir pendientes, paginar y exportar CSV. **Restablecer filtros** conserva las empresas y vuelve al periodo inicial. La comparación muestra el aporte de cada empresa dentro de la consulta. Elegir varias empresas no amplía los permisos: todos sus identificadores deben estar autorizados. Para registrar un comprobante se elige siempre una empresa concreta en el formulario.

- Los indicadores, la comparación por empresa y los medios muestran únicamente movimientos **confirmados**. El filtro de estado cambia la lista inferior, no esos resultados. Fechas, empresa, búsqueda, medio y moneda sí se aplican a ambos.
- **Por revisar** cuenta los borradores de la consulta, aunque la lista esté mostrando confirmados o anulados. La pestaña superior de revisión conserva el contador general de las empresas autorizadas.
- El gráfico compara ingresos y egresos mensuales, separados por moneda. Muestra como máximo doce meses consecutivos hasta el último movimiento del periodo; avisa cuando omite meses anteriores. Los totales siguen incluyendo todo el periodo. **Ver importes por mes** expone los valores exactos sin depender del gráfico.
- Efectivo, Yapes y Transacciones permiten abrir los movimientos de ese medio. Son categorías del registro; su presencia no significa que WhatsApp esté conectado. Los traslados se muestran aparte y no incrementan el flujo neto.
- Las empresas sin actividad no reciben importes ficticios: se pueden seleccionar, pero no aparecen en una comparación de movimientos confirmados sin tener registros.
- Soles y dólares no se suman ni convierten automáticamente. El resumen describe flujo de dinero registrado, no rentabilidad ni saldo conciliado.

El dashboard funciona sin JavaScript adicional, conserva los permisos por empresa y no cambia datos, precios ni snapshots al consultar. Sus agregaciones se realizan en la base de datos, sin descargar todo el historial al navegador.

## Registrar y revisar una operación

1. Abrir **Nuevo movimiento** y seleccionar la empresa correcta.
2. Elegir **Ingreso**, **Egreso** o **Traslado entre cuentas**. Indicar fecha real, cuenta, importe, moneda, detalle y, cuando exista, referencia de pago.
3. Añadir opcionalmente los ítems, cantidades, precios y costos reales de esa operación. Si hay detalles, su suma debe coincidir exactamente con el importe total antes de confirmar.
4. Guardar como **Por revisar**. Todavía no suma a los resultados.
5. Abrir la ficha y adjuntar el comprobante original, si corresponde: PDF, JPG o PNG de hasta 10 MB, máximo diez archivos por movimiento. Se verifica el formato y se conserva su huella SHA-256. Los documentos se descargan mediante una ruta privada con comprobación de permisos; no tienen enlaces públicos de catálogo.
6. Revisar empresa, cuenta, fecha, moneda, importe, referencia y documento. Pulsar **Confirmar** únicamente cuando los datos sean correctos.

Las fechas de operaciones deben estar entre 1900 y la fecha actual de `America/Lima`. Los pagos previstos y presupuestos futuros no son movimientos de caja realizados.

Un **traslado** mueve dinero entre dos cuentas distintas de la misma empresa y moneda. No es una venta ni un gasto, no contiene detalles de ítems y se muestra aparte del resultado de ingresos menos egresos. Los movimientos entre empresas y las conversiones de moneda requieren un diseño contable adicional; no deben disfrazarse de traslados internos.

La misma referencia de pago ya confirmada en una cuenta bloquea una segunda confirmación, sin distinguir mayúsculas. Esto ayuda a detectar duplicados, pero no sustituye la revisión: un comprobante sin referencia o con datos distintos puede representar el mismo pago. **Una factura y su pago no deben registrarse como dos ingresos o dos egresos por el mero hecho de recibir ambos documentos.**

## Precios históricos y correcciones

Los detalles guardan una copia del código, nombre, unidad, cantidad, precio unitario y costo unitario conocido. Estos valores son el **snapshot de la operación**. Cambiar el precio o costo sugerido de un ítem no reescribe movimientos anteriores.

- En operaciones manuales de hoy, un ítem puede proponer sus valores actuales; deben revisarse antes de confirmar.
- En operaciones anteriores o de origen histórico, el precio real debe indicarse expresamente. No se completa con el precio actual.
- Un costo histórico desconocido permanece vacío. No se sustituye por cero ni por el costo de hoy.
- Los movimientos confirmados no se editan ni se eliminan desde el flujo normal. Se anulan con un motivo y, si procede, se registra el movimiento correcto. La anulación conserva el original y su historial.
- Dos formularios abiertos simultáneamente no sobrescriben silenciosamente sus cambios: la versión obsoleta se rechaza y debe revisarse.

Los totales del panel son **flujo de dinero registrado**, separado por moneda. Ingresos menos egresos no equivale necesariamente a utilidad, rentabilidad ni saldo bancario: no incluye automáticamente saldos iniciales, cuentas por cobrar/pagar, impuestos, depreciación, costo de fabricación, inventario o conciliación. Los costos de ítems guardados sirven como evidencia para análisis posterior; la valorización contable no se infiere de ellos.

## Cierre mensual

El propietario utiliza **Configuración → Periodos** para cerrar una empresa y mes. Antes deben confirmarse o anularse los borradores de ese periodo. El cierre bloquea altas, ediciones y anulaciones en ese mes, incluso al intentar cambiar la fecha de un registro hacia otro mes abierto.

Para corregir un periodo cerrado, el propietario debe reabrirlo con un motivo. El cierre y la reapertura quedan registrados. No existe un borrado de histórico para cuadrar resultados.

## Los tres grupos de WhatsApp

El esquema acordado es **una persona operadora, dos números y tres grupos**:

| Grupo usado como carpeta | Medio propuesto |
| --- | --- |
| Yapes | Yape |
| Efectivo | Efectivo |
| Transacciones | Transferencias o transacciones bancarias |

La persona escribe desde su número. El número técnico del bot recibe mediante la API oficial. Los mismos tres grupos contienen operaciones de las cuatro empresas; **no se crea un grupo por empresa**. La empresa y cuenta concreta se eligen en cada registro. El grupo solo propone el medio.

La pestaña **Recepción** muestra el estado real de la conexión. Con la configuración completa, la ruta `/api/finanzas/whatsapp/` verifica la firma del cuerpo, el número técnico, el único remitente autorizado y los tres identificadores de grupo. Guarda primero el mensaje y reconoce la recepción después; el identificador de Meta evita duplicados por reintentos. Los avisos de entrega o lectura no se convierten en operaciones financieras.

Los mensajes recibidos se pueden vincular manualmente a un borrador o descartar con motivo, por el propietario. Vincular un mensaje no confirma dinero ni crea una segunda operación. Los archivos de WhatsApp quedan identificados como pendientes: esta versión no descarga sus contenidos ni los procesa con IA.

La conexión oficial de grupos, la elegibilidad OBA, el número técnico y la entrega real siguen requiriendo configuración y verificación con Meta. No se accede automáticamente al historial de grupos ordinarios. No se ha habilitado un envío automático de respuestas.

## Exportar y respaldar

- **Exportar CSV** respeta los permisos y filtros actuales. Incluye los detalles históricos, admite hasta 5.000 movimientos por exportación y protege celdas contra ejecución accidental de fórmulas al abrirlas en una hoja de cálculo.
- **Descargar respaldo**, exclusivo del propietario, genera un ZIP con datos financieros, permisos por empresa, auditoría, mensajes recibidos y comprobantes originales. Incluye manifiesto con conteos y SHA-256.
- El respaldo del panel admite hasta 100.000 registros y 256 MB de contenido. Si supera el límite o falta un comprobante, se requiere una copia operativa de base de datos y almacenamiento; no se entrega como completo un respaldo fallido.
- El ZIP **no está cifrado**: guardarlo en un lugar privado y con acceso restringido. No contiene contraseñas, sesiones, llaves de acceso ni secretos de API. Las referencias a usuarios son identificadores, no una exportación de autenticación.
- No hay restauración automática desde el panel. Una recuperación debe verificarse primero en una base aislada, comprobar hashes y resolver las referencias de usuarios. El exportador no sustituye un sistema periódico de respaldos y pruebas de restauración.
- La carga masiva de CSV/Excel y la importación del histórico desde 2018 todavía no están implementadas. Preparar esa migración por lotes con originales preservados y totales conciliados.

## Operación técnica

Las aplicaciones Django son `finance` y `finance_intake`. Reutilizan PostgreSQL, el almacenamiento privado existente y la protección MFA del administrador. Los datos financieros no se publican en los endpoints del catálogo.

Las operaciones financieras toman un bloqueo por empresa antes del movimiento. Se revalida el permiso al adquirirlo, se verifican los periodos y se usan importes `Decimal`. Las escrituras y transiciones dejan auditoría. Estas protecciones pertenecen a la aplicación; un acceso directo y privilegiado a la base de datos puede eludirlas y debe mantenerse restringido.

Las variables de recepción se configuran solo en los secretos del servidor:

```text
FINANCE_WHATSAPP_ENABLED=0
FINANCE_WHATSAPP_APP_SECRET
FINANCE_WHATSAPP_VERIFY_TOKEN
FINANCE_WHATSAPP_PHONE_NUMBER_ID
FINANCE_WHATSAPP_OPERATOR_ID
FINANCE_WHATSAPP_OPERATOR_ID_KIND
FINANCE_WHATSAPP_GROUP_YAPE
FINANCE_WHATSAPP_GROUP_CASH
FINANCE_WHATSAPP_GROUP_TRANSFER
```

`OPERATOR_ID_KIND` identifica si el remitente se compara mediante `bsuid` o `phone`. Los tres grupos deben ser distintos. Una configuración incompleta permanece cerrada. No poner claves en el código, formularios públicos, archivos versionados ni variables `PUBLIC_*`.

Para desarrollo, ejecutar sobre una base y configuración de **prueba aisladas**; `config/settings.py` también puede cargar `backend/.env`, por lo que debe verificarse el destino antes de lanzar comandos:

```bash
uv sync --project backend --locked
uv run --project backend python backend/manage.py test finance finance_intake
uv run --project backend python backend/manage.py makemigrations --check --dry-run
```

La instalación requiere aplicar expresamente las migraciones de las dos aplicaciones sobre el destino confirmado, con respaldo previo del servidor:

```bash
uv run --project backend python backend/manage.py migrate finance
uv run --project backend python backend/manage.py migrate finance_intake
```

Estas migraciones crean el esquema; no crean usuarios, contraseñas, saldos ni movimientos. No ejecutar un `seed`, `reset` o restauración por el mero hecho de desplegar el módulo.

## Riesgos y siguientes verificaciones

El OCR local y los filtros no generan cargos por lectura ni requieren una suscripción de IA. Esto no implica infraestructura ilimitada ni WhatsApp gratuito: la [FAQ oficial de Meta](https://whatsappbusiness.com/resources/faq/) consultada el 10/11/2026 distingue acceso directo sin cuota adicional y tarifas por mensajes entregados. La elegibilidad y tarifas concretas para los grupos deben verificarse antes de activar el número técnico. El bot continúa sin conectar.

El alojamiento tiene límites de capacidad y disponibilidad ([Render Free](https://render.com/docs/free), [Neon](https://neon.com/pricing)). Como referencia calculada, 100 fotos diarias de 2 MB sumarían aproximadamente 6 GB cada 30 días; no es consumo medido del negocio. Antes de conservar indefinidamente ese volumen, definir tamaño de fotos, retención y respaldos, sin borrar ni degradar originales automáticamente.

Los riesgos principales son registrar una empresa o importe incorrecto, duplicar factura y pago, exponer documentos a usuarios equivocados, perder disponibilidad del alojamiento o depender de una conexión externa sin verificar. Los borradores, permisos por empresa, referencias de pago, auditoría y exportaciones reducen estos riesgos; no los eliminan.

Antes de activar automatización: verificar OBA y recepción con mensajes de prueba, evaluar disponibilidad del servidor para webhooks, acordar presupuesto de API, revisar la extracción con documentos sintéticos y mantener una revisión humana de importes y faltantes. Las respuestas automáticas, el OCR y la conciliación deben activarse como funciones independientes, con pruebas y límites definidos.

La cuenta de GPT/Codex usada para desarrollo puede ser compartida. No cargar allí finanzas reales ni credenciales personales. La futura API deberá usar un proyecto empresarial privado, con secretos del servidor y acceso limitado. La restricción personal del propietario a usar Google solo en su PC no equivale a un bloqueo técnico de una cuenta GPT compartida.

## Evaluar la lectura con el método del contador

Depositar archivos históricos en una carpeta no entrena el OCR. Antes de adaptar patrones de lectura y clasificación, preparar una muestra de 50–100 comprobantes anonimizados de los tres medios, con el resultado correcto de importe, moneda, fecha, referencia y empresa. Reservar parte de la muestra para comprobar los cambios sin utilizarla para ajustarlos. Incluir fotografías difíciles y documentos con más de un importe, no solo ejemplos fáciles.

Medir aciertos por campo, documentos completos correctos, duplicados detectados y correcciones necesarias. La confianza que devuelve OCR no equivale a la probabilidad de que un movimiento financiero sea correcto. No hay una garantía comprobada de 99,99 % para este flujo; tampoco se ha medido todavía su precisión con documentos reales del negocio. Los benchmarks de otros modelos no sustituyen esa evaluación.

El lector gratuito PaddleOCR instalado mantiene revisión humana y confirmación separada. Un modelo abierto más grande, como PaddleOCR-VL, requeriría un entorno de ejecución distinto y una comparación real antes de decidir si mejora el resultado. XML o CSV estructurado pueden evitar errores de transcripción cuando estén disponibles, pero aún requieren validar su origen, tipo de operación y posibles duplicados.

`FINANZAS_PRIVADAS/` está excluida de Git para evitar publicar accidentalmente originales colocados allí. Esto **no** cifra la carpeta, restringe Windows ni evita que un archivo leído por un asistente entre en el contexto de una cuenta compartida. Usar únicamente ejemplos anonimizados en esta cuenta; analizar el historial real en un entorno con acceso exclusivo y autorización específica. No existe importación automática de esa carpeta.
