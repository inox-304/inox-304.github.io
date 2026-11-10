# Lectura gratuita de comprobantes

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

Se procesa un comprobante por registro. Los datos escritos por la persona no se
reemplazan automáticamente en otra lectura. Los campos ambiguos quedan pendientes
de completar. El texto OCR solo permanece temporalmente en la pantalla; al servidor
se envían los campos revisados y la foto original al guardar.

Una foto idéntica ya registrada en la misma empresa se detecta por su huella de
archivo; otra toma del mismo papel puede tener una huella diferente. La referencia
de pago también se comprueba al confirmar. Para distintos abonos respaldados por
una misma factura, utiliza registros manuales con sus referencias de pago propias.
Los precios históricos de los ítems mantienen el funcionamiento existente; este
lector no desglosa automáticamente sus líneas ni cambia sus precios.

Esta función no activa WhatsApp, no importa el histórico desde 2018 y no requiere
una API de GPT. La primera lectura necesita descargar los recursos del propio
panel. Si falla, el formulario manual sigue disponible.

## Motor y archivos

El lector usa Tesseract.js 7.0.0 en un Web Worker del navegador, con los modelos
de español e inglés `4.0.0_best_int` de los paquetes de idiomas 1.0.0. No requiere
una API de IA, clave, suscripción ni créditos de reconocimiento. La infraestructura
y el almacenamiento privado existentes siguen teniendo sus propias cuotas.

Los paquetes están fijados en `package.json` y `package-lock.json`. Para preparar
el entorno local:

```sh
npm ci
npm run finance:assets
npm run finance:assets:check
```

El generador copia los recursos a `backend/static/inox/ocr-vendor/v7/` y escribe
un manifiesto SHA-256. Esa carpeta es generada y no se versiona. `--check` compara
cada archivo con el paquete instalado y comprueba también el manifiesto. No
descarga nada durante la preparación: las descargas ocurren únicamente en `npm ci`.

Docker ejecuta la preparación en la etapa Node y copia los recursos al backend.
El contenedor de Python no necesita Node ni ejecutar OCR. `collectstatic` sirve
estos archivos desde el mismo origen del panel, usando WhiteNoise. Los bundles
grandes de WebAssembly llegan con gzip determinista generado en la etapa Node.
`config.static_storage.InoxStaticFilesStorage` evita recomprimir esos bundles
(incluidas sus copias con hash), para no exceder memoria en servidores pequeños.
El resto de los archivos conserva la compresión normal de WhiteNoise.

## Contrato del navegador

- Script: `inox/ocr-vendor/v7/tesseract.min.js`.
- Worker: `inox/ocr-vendor/v7/worker.min.js`.
- `corePath`: directorio `inox/ocr-vendor/v7/core/`.
- `langPath`: directorio `inox/ocr-vendor/v7/lang/`.
- Idiomas: `spa+eng`, motor LSTM (OEM 1).
- `workerBlobURL: false`; pasar siempre las rutas explícitas del mismo origen.
- No usar rutas CDN, `localStorage`, IndexedDB de documentos ni servicios de IA.

Con almacenamiento estático de manifiesto, resolver el script y el worker con
`{% static %}`. Para los directorios, derivar el directorio de un archivo existente
resuelto con `{% static %}`; no pedir al manifiesto una entrada para un directorio.
WhiteNoise debe conservar las versiones sin hash de los bundles de core y de los
idiomas, pues el motor selecciona esos nombres de archivo en tiempo de ejecución.

Los bundles `*.wasm.js` ya incluyen WebAssembly. Se incluyen las seis variantes
de core, incluidas las que no usan SIMD, para compatibilidad entre dispositivos.
El lector solo carga la variante que necesita y los modelos de idiomas: no
descarga todos los bundles. Los archivos originales ocupan aproximadamente 30 MiB;
esto no es el peso que se descarga en cada lectura.

## Límites y revisión

El reconocimiento aporta sugerencias, no prueba que una factura esté pagada ni
reemplaza la revisión humana. Una foto borrosa, girada, cortada o con varios
comprobantes puede producir errores. El usuario debe comprobar empresa, cuenta,
tipo de movimiento, fecha, moneda e importe antes de guardar y confirmar.

El OCR de esta versión trabaja con fotos JPG/PNG. No transforma un PDF en imagen.
Los comprobantes se conservan como adjuntos privados, con los permisos del
movimiento, y no se incluyen en los archivos estáticos del lector.

## Licencias

Tesseract.js, Tesseract.js-core y el repositorio de datos de entrenamiento usan
Apache 2.0. Los paquetes npm de idiomas declaran MIT para sus envoltorios. La
preparación conserva licencias, metadatos y avisos de los paquetes en la carpeta
del lector. Fuentes originales:

- https://github.com/naptha/tesseract.js
- https://github.com/naptha/tesseract.js-core
- https://github.com/naptha/tessdata
