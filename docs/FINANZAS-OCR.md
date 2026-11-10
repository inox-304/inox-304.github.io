# Lectura gratuita de comprobantes

Esta versión integra PaddleOCR en el lector de comprobantes. Para activarlo en
el panel alojado es necesario desplegar esta versión y verificar sus recursos;
una versión anterior puede seguir utilizando únicamente Tesseract.

## Uso desde el panel

1. Abre **Finanzas → Leer comprobante** y elige la empresa.
2. Selecciona una foto JPG/PNG de hasta 10 MB y 24 megapíxeles. Se lee en el
   navegador; puedes girar la vista, ampliar el original, cancelar o repetir.
3. Compara las sugerencias con la imagen. Elige ingreso, egreso o traslado y
   su cuenta. La fecha de emisión y el total de una factura no siempre son la
   fecha ni el importe del pago: corrígelos cuando corresponda.
4. Marca la revisión y pulsa **Guardar para revisión**. Se conserva el original
   en almacenamiento privado y se crea un borrador; aún no suma a resultados.
5. Revisa la ficha y pulsa **Confirmar movimiento** cuando todo esté correcto.
   Este último paso exige permiso de revisión de la empresa.

Se procesa un comprobante por registro. Puedes corregir cualquier sugerencia antes
de guardar; los datos que escribiste no se reemplazan automáticamente al repetir
la lectura. Los campos ambiguos quedan pendientes de completar. Tras cambiar la
foto o los datos, vuelve a compararlos con el original y a marcar la revisión.
El texto OCR solo permanece temporalmente en la pantalla; al servidor se envían
los campos revisados y la foto original al guardar.

El borrador también se puede corregir desde su ficha antes de confirmarlo. Leer
una foto, aceptar una sugerencia o guardar el borrador no confirma un movimiento.
Los reintentos de un mismo envío no crean otro borrador ni otro adjunto; cambiar
la foto o los campos de un envío ya registrado requiere abrir un formulario nuevo.

Una foto idéntica ya registrada en la misma empresa se detecta por su huella de
archivo; otra toma del mismo papel puede tener una huella diferente. La referencia
de pago también se comprueba al confirmar. Para distintos abonos respaldados por
una misma factura, utiliza registros manuales con sus referencias de pago propias.
Los precios históricos de los ítems mantienen el funcionamiento existente; este
lector no desglosa automáticamente sus líneas ni cambia sus precios.

Esta función no activa WhatsApp, no importa el histórico desde 2018 y no requiere
una API de GPT. La primera lectura necesita descargar los recursos del propio
panel. Si falla, el formulario manual sigue disponible.

## Motores y archivos

La integración utiliza `@paddleocr/paddleocr-js` 0.4.2 con los modelos
`PP-OCRv6_small_det` y `PP-OCRv6_small_rec`, que incluyen caracteres del español.
El worker oficial incorpora OpenCV 4.10.0 y ONNX Runtime Web 1.24.3; la inferencia
se configura en CPU/WebAssembly con un solo hilo, sin WebGPU.

PaddleOCR hace la primera lectura. Si falla su carga o no logra completar el
reconocimiento, se intenta Tesseract. También puedes pulsar **Probar lector
alternativo** tras una lectura para intentarlo con el otro motor. Una lectura
con datos dudosos sigue requiriendo revisión; no se fusionan resultados de los
dos motores para elegir un importe.

Ambos procesan la imagen en el dispositivo: no se añade un servicio de OCR remoto
ni se envía el comprobante a Paddle, OpenAI o un CDN. Cancelar detiene la lectura
sin iniciar automáticamente la alternativa. Completar los campos manualmente
sigue disponible si ambos motores fallan.

La alternativa usa Tesseract.js 7.0.0, con los modelos de español e inglés
`4.0.0_best_int` de los paquetes de idiomas 1.0.0. No requiere una API de IA,
clave, suscripción ni créditos de reconocimiento. La infraestructura y el
almacenamiento privado existentes siguen teniendo sus propias cuotas.

Cambiar de motor no demuestra una mejora de precisión en los comprobantes del
usuario. La aceptación necesita pruebas con muestras representativas; una lectura
puede seguir confundiendo cifras, fechas o referencias. Las sugerencias conservan
la revisión humana y nunca eligen empresa, cuenta ni tipo de movimiento.

Los paquetes están fijados en `package.json` y `package-lock.json`. Para preparar
el entorno local:

```sh
npm ci
npm run finance:assets
npm run finance:assets:check
```

El generador prepara `backend/static/inox/ocr-vendor/paddle-v0.4.2/` y
`backend/static/inox/ocr-vendor/v7/`, con manifiestos SHA-256. Esas carpetas se
generan y no se versionan. Los scripts y runtimes proceden de los paquetes
fijados por `npm ci`. Los modelos Paddle y algunos textos de licencia se descargan
durante la preparación desde las URLs de `scripts/paddle-assets.json`, con
tamaño y SHA-256 obligatorios; se reutiliza la caché local verificada de la
compilación. No se descargan del proveedor durante la lectura de una foto.

`--check` trabaja sin red: compara los recursos generados con los paquetes,
fuentes, huellas fijadas y manifiestos. Los modelos detector/reconocedor ocupan
9.891.840 y 21.319.680 bytes sin compresión; los runtimes y scripts añaden su
propio peso. El manifiesto enumera tamaños originales y gzip, que no equivalen
al consumo de memoria del navegador.

Docker ejecuta la preparación en la etapa Node y copia los recursos al backend.
El contenedor de Python no necesita Node ni ejecutar OCR. `collectstatic` sirve
estos archivos desde el mismo origen del panel, usando WhiteNoise. Los bundles
grandes de WebAssembly llegan con gzip determinista generado en la etapa Node.
`config.static_storage.InoxStaticFilesStorage` evita recomprimir esos bundles
(incluidas sus copias con hash), para no exceder memoria en servidores pequeños.
El resto de los archivos conserva la compresión normal de WhiteNoise.

## Contrato del navegador

Los resultados de los dos motores conservan el mismo contrato: texto reconocido
no confiable que el parser convierte en sugerencias. Las cajas de PaddleOCR se
agrupan por filas y se ordenan de izquierda a derecha; su texto se conserva,
incluidos fragmentos dudosos que puedan contener otro total. Se rechazan resultados
con más de 512 cajas, más de 60.000 caracteres o geometría inválida, sin truncarlos
para obtener una sugerencia parcial.

Cada fila conserva la confianza mínima de sus cajas, en escala de 0 a 100. Un
campo de Paddle solo se sugiere si todas las filas de su evidencia alcanzan 85;
sin evidencia coincidente o con puntuación inválida queda para escritura manual.
Una línea decorativa débil no invalida otros campos claros. Tesseract conserva
el umbral global de 60 porque no entrega la misma evidencia por fila en este
flujo. Estos valores no representan una probabilidad comparable de que un importe
sea correcto. Ninguna puntuación autoriza a confirmar un movimiento.

No se mezclan dos lecturas para inventar un total. Se muestran las sugerencias
del resultado elegido junto con la foto; las correcciones manuales se conservan.
Resultados que llegan después de cancelar, cambiar la foto o abandonar la página
se descartan. La inicialización y cada motor tienen un límite de tiempo; tras un
error se permite reintentar o completar los datos a mano.

Rutas de Paddle, bajo `inox/ocr-vendor/paddle-v0.4.2/`:

- Adaptador: `receipt-paddle.js`; normalizador: `paddle-normalize.mjs`.
- Worker oficial fijado y conservado sin modificaciones: `paddle-worker.js`.
- Modelos: `models/PP-OCRv6_small_det.tar` y `models/PP-OCRv6_small_rec.tar`.
- Runtime: `runtime/ort-wasm-simd-threaded.jsep.mjs` y su archivo `.wasm`.

El adaptador usa el protocolo del worker de la versión 0.4.2. Actualizar el SDK
requiere volver a comprobar ese contrato, los modelos y el runtime. El navegador
debe admitir Web Workers, ImageBitmap y el WebAssembly/SIMD del runtime elegido;
si no los admite, se conserva la alternativa Tesseract o el formulario manual.

Rutas de la alternativa Tesseract:

- Script: `inox/ocr-vendor/v7/tesseract.min.js`.
- Worker: `inox/ocr-vendor/v7/worker.min.js`.
- `corePath`: directorio `inox/ocr-vendor/v7/core/`.
- `langPath`: directorio `inox/ocr-vendor/v7/lang/`.
- Idiomas: `spa+eng`, motor LSTM (OEM 1).
- `workerBlobURL: false`; pasar siempre las rutas explícitas del mismo origen.
- No usar rutas CDN, `localStorage`, IndexedDB de documentos ni servicios de IA.

Con almacenamiento estático de manifiesto, resolver el adaptador Paddle y el
script y worker Tesseract con `{% static %}`. Para los directorios, derivar el
directorio de un archivo existente resuelto con `{% static %}`; no pedir al
manifiesto una entrada para un directorio. WhiteNoise debe conservar también las
versiones sin hash de los recursos internos: workers, normalizador, modelos,
runtimes, bundles de core e idiomas se resuelven por sus nombres en ejecución.

Los bundles Tesseract `*.wasm.js` ya incluyen WebAssembly. Se incluyen las seis variantes
de core, incluidas las que no usan SIMD, para compatibilidad entre dispositivos.
El lector solo carga la variante que necesita y los modelos de idiomas: no
descarga todos los bundles. Los archivos del motor alternativo solo se solicitan
cuando se necesita ese motor.

Las pruebas de parser, geometría y confianza se ejecutan con:

```sh
node --test scripts/test-receipt-parser.mjs scripts/test-receipt-paddle.mjs
```

Además de esas pruebas, comprobar en navegador la carga sin peticiones externas,
la cancelación durante inicio e inferencia, una segunda foto con resultados
atrasados, las correcciones manuales, los reintentos y el guardado como borrador.
Las imágenes sintéticas prueban el funcionamiento; no son un benchmark de
precisión en documentos reales.

## Límites y revisión

El reconocimiento aporta sugerencias, no prueba que una factura esté pagada ni
reemplaza la revisión humana. Una foto borrosa, girada, cortada o con varios
comprobantes puede producir errores. El usuario debe comprobar empresa, cuenta,
tipo de movimiento, fecha, moneda e importe antes de guardar y confirmar.

El OCR de esta versión trabaja con fotos JPG/PNG. No transforma un PDF en imagen.
Los comprobantes se conservan como adjuntos privados, con los permisos del
movimiento, y no se incluyen en los archivos estáticos del lector.

## Contención de red del lector

El formulario de comprobantes tiene una política CSP que limita conexiones,
scripts, workers y envíos de formulario al origen del panel. Bloquea scripts
inline, documentos incrustados y cambios de URL base. Las imágenes locales
`blob:`/`data:` permiten previsualizar y girar la foto sin subirla.
WhiteNoise aplica la política también a las respuestas de los workers OCR:
estos no heredan la política de la página. Sus URL incluyen `receipt-policy=1`
para renovar respuestas antiguas que pudieran seguir en caché sin esos headers.

El documento y Tesseract permiten compilar WebAssembly sin habilitar
`unsafe-eval`. Solo el worker de Paddle 0.4.2 necesita `unsafe-eval` porque su
OpenCV construye funciones durante el arranque; esa excepción no permite
conexiones, importaciones ni workers de otros orígenes. Es una limitación
concreta del paquete fijado, no una garantía de aislamiento absoluto.

No se añadieron analítica, anuncios, píxeles, API de IA ni reportes CSP externos.
El guardado autorizado sigue enviando original y campos revisados al servidor
privado. El alojamiento y almacenamiento pueden registrar metadatos operativos;
esta política no protege contra un equipo comprometido, extensiones del
navegador, acceso indebido a cuentas o un servidor comprometido. Tampoco vuelve
privada una cuenta compartida de GPT/Codex.

## Evaluación de alternativas gratuitas — 10/11/2026

La elección actual conserva procesamiento en el navegador y evita cobrar por
comprobante. Un modelo mayor no ofrece por sí mismo mejor resultado contable,
ni sustituye revisar el movimiento. Las siguientes cifras públicas corresponden
a pruebas diferentes y **no son la precisión del panel ni son comparables entre sí**.

| Opción | Licencia y ejecución | Evidencia y decisión |
| --- | --- | --- |
| PP-OCRv6 small, actual | PaddleOCR.js/ONNX en el navegador; Apache 2.0 para Paddle. Modelos servidos por el panel. | Mantener como motor principal ligero. Falta medir extracción exacta en comprobantes representativos de las empresas. |
| PP-OCRv6 medium | Alternativa Paddle de mayor tamaño; ejecución local, con integración/runtime que debe validarse. | Su informe publica 83,2 % de reconocimiento en su benchmark interno. Evaluar contra small antes de reemplazarlo: ese valor no mide facturas completas ni exactitud financiera. |
| PaddleOCR-VL-1.6 | Apache 2.0; pipeline Python con CPU o GPU según backend. Modelo de 0,9B parámetros. | Publica 96,3 % en OmniDocBench 1.6. Buen candidato para documentos complejos, pero no está instalado; recursos, latencia, tablas e importes deben probarse. No asumir que cabe en Render gratuito. |
| Tesseract.js, alternativa actual | Apache 2.0; WebAssembly en navegador. | Ya disponible si falla Paddle o para comparar una foto. La documentación recomienda corregir resolución, inclinación y ruido; reentrenar no suele resolver una mala imagen. |
| Surya | Código Apache 2.0; pesos con licencia AI Pubs Open Rail-M modificada y condiciones comerciales. CPU/llama.cpp o GPU/vLLM. | No tratarlo como gratuito comercial sin condiciones a futuro. Necesita otro runtime y evaluación de sus pesos/licencia antes de incorporarlo. |
| docTR | Apache 2.0, Python/PyTorch; ejecución propia posible. | Candidato para comparar detección/reconocimiento local. No hay medición de nuestros comprobantes que justifique migrar ahora. |

Fuentes primarias: [SDK PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md),
[PP-OCRv6](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.en.md),
[PaddleOCR-VL](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PaddleOCR-VL.en.md),
[Tesseract.js](https://github.com/naptha/tesseract.js),
[calidad de entrada en Tesseract](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html),
[Surya y sus condiciones](https://github.com/datalab-to/surya),
[docTR](https://github.com/mindee/doctr).

Para elegir por evidencia, preparar 50–100 comprobantes anonimizados,
representativos de efectivo, Yape y transferencias, con datos esperados revisados
por una persona. Separar una parte para ajustar reglas y otra que nunca se use
para esos ajustes. Comparar los motores sobre las mismas imágenes y medir:

- Exactitud por campo: importe, moneda, fecha y referencia, conservando ceros.
- Documentos completos correctos y cobertura: dejar un campo vacío no cuenta
  como lectura correcta, aunque sea una abstención más segura.
- Sugerencias incorrectas, intervenciones humanas y duplicados no detectados.
- Tiempo y memoria en los dispositivos reales, incluidas fotos difíciles.

El umbral de confianza OCR de 85 es una regla para abstenerse; **no significa
85 % de exactitud**. Obtener todos los ejemplos correctos en una prueba tampoco
demuestra 100 % de aciertos futuros. Mantener revisión, conciliación y auditoría
incluso si una evaluación mejora. Si existen XML o exportaciones estructuradas
de origen verificable, evaluar su importación para evitar transcribir por OCR;
siguen requiriendo controles de duplicados, empresa, moneda y pago efectivo.

## Licencias

PaddleOCR y sus modelos, así como OpenCV 4.10.0, usan Apache 2.0. ONNX Runtime y
js-yaml usan MIT; Clipper usa Boost. Los recursos generados conservan licencias,
avisos y metadatos; el worker oficial conserva sus comentarios de terceros.
Referencias: [PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js),
[ONNX Runtime](https://github.com/microsoft/onnxruntime) y
[OpenCV](https://github.com/opencv/opencv).

Tesseract.js, Tesseract.js-core y el repositorio de datos de entrenamiento usan
Apache 2.0. Los paquetes npm de idiomas declaran MIT para sus envoltorios. La
preparación conserva licencias, metadatos y avisos de los paquetes en la carpeta
del lector. Fuentes originales:

- [Tesseract.js](https://github.com/naptha/tesseract.js)
- [Tesseract.js-core](https://github.com/naptha/tesseract.js-core)
- [Datos de entrenamiento](https://github.com/naptha/tessdata)
