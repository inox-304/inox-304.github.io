INOX 304 — REFERENCIAS ILUMI
Consulta: 22/10/2026, America/Bogota.

Alcance: 29 páginas/modelos comerciales identificados en siete familias:
2 amasadoras, 8 batidoras (incluye inmersión), 4 envasadoras al vacío,
1 extractor de naranja, 3 cremoladeras, 8 máquinas de helado y
3 dispensadores de jugos. La colección Pro Line no corresponde a estas
siete familias. El catálogo del proveedor puede cambiar.

catalog.json contiene hechos y enlaces oficiales para revisar y preparar
borradores. No contiene precios, existencias, credenciales, recetas de
fabricación ni modelos 3D. Las fichas encontradas son imágenes JPG;
no deben asignarse al campo PDF ni presentarse como modelos GLB.

Cada SKU se importa por separado con código interno ILUMI-<SKU>, origen
Producto distribuido, marca ILUMI, familia y capacidad. Las líneas
fría/neutra se conservan. Los 32 productos anteriores no se reclasifican.
El SKU de la versión blanca B7 todavía no está confirmado: no crear uno
por deducción a partir de un nombre de imagen.

El importador añade borradores, conserva registros existentes y no descarga
archivos. Un segundo pase no sobrescribe correcciones hechas en el panel.
No crea códigos en Google Sheets ni descuenta o reserva materiales.
La atribución --actor es auditoría de una operación del servidor; no crea
una sesión del panel ni omite su verificación en dos pasos.

Revisar primero:
  python backend/manage.py import_supplier_catalog catalogs/ilumi/catalog.json
Aplicar después de un respaldo y con el entorno de la instalación correcta:
  python backend/manage.py import_supplier_catalog catalogs/ilumi/catalog.json --apply --actor CORREO_ADMIN

La migración catalog.0006 añade campos opcionales; aplicar únicamente como
parte de esta actualización, nunca como un reseteo o rutina de arranque.

Biblioteca local por familia y SKU:
  python scripts/prepare-ilumi-references.py
Salida privada por defecto: outputs/ilumi/revision-catalogo.html y carpetas
por familia con referencias.json y brief-modelado.txt. No descarga imágenes:
la revisión visual carga enlaces del proveedor cuando hay conexión.

Para preparar cada 3D:
- Verificar dimensiones exteriores, fotos de todos los lados y mecanismos.
- Mantener la geometría oficial del modelo; no escalar un SKU para simular otro.
- Separar piezas móviles solo cuando su recorrido esté documentado.
- Exportar GLB en metros, con texturas incluidas y portada del modelo.
- Objetivo 2–5 MB y hasta 150000 triángulos; panel máximo 8 MB/300000.
- Subirlo al producto correcto y revisar su vista previa privada antes de publicar.

Las advertencias del manifiesto conservan discrepancias de las fuentes.
No resolver por conjetura diferencias de capacidad, medidas o garantía.
La integración está preparada; todavía no hay archivos 3D confirmados.
