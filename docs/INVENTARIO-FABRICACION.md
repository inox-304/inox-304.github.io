# Inventario y fabricación

La hoja privada es la fuente para editar existencias, recetas y costos. El panel conserva una copia con fecha, analiza pedidos y comprueba los cambios automáticamente cada minuto mientras la pestaña de inventario está visible. El catálogo, sus fichas, modelos 3D y variaciones se editan en **Catálogo**, dentro del mismo panel. La autorización de Google del complemento no concede credenciales al proceso Django: el servidor necesita su propia autorización privada.

## Códigos y ubicaciones

**Tienda: San Sebas. Taller: Vallecito**, según el propietario el 22/10/2026. Se mantienen las claves Tienda/Taller en movimientos para conservar sus fórmulas.

Inventario está ordenado por código. Usa un código por especificación: una plancha AISI 304 de 1 mm y otra de 1,2 mm son artículos distintos. Q:T guardan calidad, espesor, formato y notas. Los cinco materiales iniciales son propuestas editables, sin costos ni conteos inventados.

Elige una unidad constante: fracción de plancha o m², metros de tubo, unidades de perillas. No mezcles unidades bajo un código. La simulación calcula disponibilidad por cantidad; no optimiza cortes, tamaños de retazos ni anidado de piezas.

Un saldo vacío significa pendiente. Escribir cero confirma que no hay existencias. Movimientos requiere fecha, ID único y cantidad positiva. Los traslados descuentan del origen y suman al destino. El mínimo inicial 3 procede del audio y debe ajustarse por artículo/unidad.

## Recetas y análisis

El código principal del catálogo identifica la receta base. Cada variación admite un **código de fabricación** propio, que debe existir como producto terminado en Inventario, Recetas y Costos. Ejemplos de nomenclatura, sin crear artículos reales: `EQ-001-GAS`, `EQ-001-ELEC-COOLER`.

Cada configuración usa una receta completa que reemplaza la principal. Un adicional tiene otro código y su receta se suma. No repitas en el adicional componentes ya incluidos. Las compatibilidades técnicas se revisan al cotizar; no se generan combinaciones mecánicas automáticamente.

En Recetas, una fila relaciona un equipo y componente con cantidad por unidad. Merma % es opcional, entre 0 y 100: consumo bruto = cantidad × (1 + merma / 100). El análisis agrupa componentes repetidos antes de comparar con stock. El costo utiliza ese mismo consumo bruto.

En Costos se introduce mano de obra distinta para cada código/configuración y precio de venta. Costo directo = materiales y accesorios + mano de obra. Ganancia = venta − costo directo. Margen = ganancia / venta. No incluye impuestos ni gastos generales. Un dato faltante queda pendiente; cero es un costo conocido. No se suman monedas diferentes.

En **Analizar equipo**, elige configuración, cantidad entera, almacén y hasta tres adicionales distintos. Muestra consumo, faltantes y capacidad máxima por el componente limitante. Si faltan receta o conteos necesarios, la capacidad queda pendiente. No reserva ni descuenta existencias: la salida real se registra en Movimientos. El panel utiliza la última copia, no promete stock en tiempo real al comprador.

Como siguiente ampliación de mano de obra conviene separar corte, plegado, soldadura, pulido y montaje, con horas y tarifa por operación. Primero deben confirmarse esas operaciones y tiempos. Actualmente se introduce el total de mano de obra por código.

## Conexión privada de Google

`/admin/inventario/` exige sesión administrativa y segundo factor. Costos y recetas no se proyectan a la API pública. Las gráficas cuentan referencias, saldos y operaciones, sin sumar metros con unidades o kilos.

`backend/data/inventory/snapshot.json` conserva la última copia válida. Una actualización rechazada no la reemplaza. `sync-status.json` guarda la fecha de comprobación y el último error legible; `sync.lock` coordina los procesos del servidor. Ninguno se sirve públicamente. La lectura admite 200 artículos, 500 movimientos, 200 filas de componentes y 200 códigos de costeo; una fila adicional detecta desbordamientos. Para crecer, ampliar conjuntamente tablas, fórmulas y límites. Doscientas filas de componentes no equivalen a doscientas recetas completas.

Configurar solo en el entorno privado del servidor:

```dotenv
INOX_INVENTORY_SHEET_ID=ID_DE_LA_HOJA_PRIVADA
GOOGLE_APPLICATION_CREDENTIALS=RUTA_PRIVADA_A_CREDENCIALES_GOOGLE
INOX_INVENTORY_REFRESH_ENABLED=1
```

Habilitar Sheets API y conceder lectura de esa hoja a la identidad del servidor. Se utiliza Application Default Credentials con alcance `spreadsheets.readonly`. No hay escritura de vuelta desde Django. Nunca guardar claves en `PUBLIC_*`, HTML, código, enlaces públicos o Git. Reiniciar el servidor y comprobar una lectura real. Hasta entonces el botón se oculta y el panel muestra la conexión pendiente. La etiqueta **Conectado** solo aparece después de una lectura validada por el servidor; habilitar la variable no basta. No está implementada la edición simultánea desde web y Sheets.

Si el navegador no entrega la descarga JSON, Google permite generar el par RSA localmente y [registrar únicamente un certificado público X.509](https://docs.cloud.google.com/iam/docs/keys-upload). La clave privada permanece en el servidor; el JSON debe usar el identificador del registro que devuelve Google. Restringir el directorio de credenciales al usuario que ejecuta el servidor y registrar la caducidad del certificado en la documentación privada de operación. Antes de su vencimiento, registrar y comprobar la clave de reemplazo y retirar la anterior. Nunca incluir información privada en el sujeto del certificado público.

La pestaña visible consulta por POST `/admin/inventario/actualizar/` con sesión verificada, permiso de lectura de catálogo y token CSRF. Un bloqueo entre procesos y un intervalo mínimo de 60 segundos evitan multiplicar lecturas al abrir varias pestañas. `/admin/inventario/estado/` permite consultar el estado privado sin contactar Google. Los fallos de conexión o validación muestran un aviso, conservan las cifras anteriores y vuelven a intentarse; el botón **Actualizar ahora** comparte el límite por minuto. Al regresar a una pestaña se comprueba de nuevo. Cerrar el panel detiene las consultas; no hay un trabajador permanente en segundo plano.

Si cambian datos, se renuevan gráficas, existencias, costos y el último análisis enviado sin recargar toda la página. Se conservan filtros, búsqueda y campos de un análisis que se esté preparando. Las consultas automáticas no renuevan el tiempo de inactividad de la sesión; cuando vence se pide volver a ingresar. El estado distingue última lectura válida, conexión pendiente y error, sin presentar una copia antigua como stock confirmado en tiempo real.

## Archivos y 3D

El editor conserva los pasos datos, archivos, variaciones, adicionales, precio y revisión. Permite guardar borradores con archivos pendientes. GLB 2.0 y PDF admiten hasta 8 MB; las fotos se optimizan al guardar.

Cada variación puede tener GLB y PDF propios. Si están vacíos usa los del equipo. El visor cambia modelo y ficha al elegir una variación. El acabado cambia materiales solo si existe en `KHR_materials_variants` del GLB. La animación debe identificar un clip real: el botón de puertas aparece cuando el visor lo reconoce. Al elegir un archivo se muestran sus animaciones y acabados para seleccionarlos. Que un clip exista no demuestra que corresponda a las puertas: revisarlo en la vista previa.

Los modelos definitivos no se entregaron todavía. Colocar adicionales dentro del 3D, reglas de compatibilidad, puntos de montaje y modificar medidas requieren esos archivos y sus convenciones. Actualmente los adicionales son opciones de cotización; no se insertan mallas ni se redimensiona mobiliario automáticamente.

## Revisión de fuentes y estado

El PDF describe 32 equipos, pero no contiene recetas completas ni conteos. El Excel de revisión del video conserva 32 lecturas propuestas, confianza, tiempos y 14 fotogramas, con columnas para correcciones y confirmación. `REV-*` identifica lecturas, no artículos de inventario. Sus cifras son tamaños/capacidades, no existencias. No se importaron automáticamente esas propuestas al catálogo.

La migración aditiva `catalog.0004` incorpora campos y archivos de variantes. Se aplicó localmente tras crear un respaldo SQLite consistente; se verificaron idénticas las columnas previas de las tablas comerciales y de autenticación, correo y claves. No se ejecutaron seed, reset ni configuradores de acceso.

GitHub Pages publica la web estática, incluido el acceso discreto, pero no ejecuta Django. Publicar este código no aloja el panel, su base ni la sincronización: necesitan un servidor independiente siempre encendido. Mientras no se configure `PUBLIC_ADMIN_URL`, el atajo abre el panel local de la computadora que visita la web. Al alojar Django, configurar esa variable con su dirección HTTPS `/admin/` y volver a desplegar la web. La conexión activa de cada instalación se comprueba en el estado del panel, con las credenciales privadas de ese servidor.
