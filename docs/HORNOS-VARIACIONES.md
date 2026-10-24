# Hornos y távolas: opciones confirmadas

El catálogo presenta una sola tarjeta de horno pollero. P07 y P08 se conservan
como diseños dentro de esa ficha, con sus rutas y archivos originales.

| Equipo | Opciones autorizadas por el propietario |
| --- | --- |
| Pollero P07 / P08 | 12, 18, 24 o 30 pollos; leña o carbón (ecológico) |
| Multiuso P06 | 4, 6, 8 o 10 bandejas; convencional o con convección |
| Pizza | 2 niveles; gas o eléctrico |
| Távola caliente | 4, 6, 8 o 10 bandejas; gas o eléctrico; con o sin cubierta de vidrio |

El horno importado y el significado de «5 / 10» quedan pendientes de una ficha
técnica. No se crean capacidades, precios ni recetas para ese equipo.

## Editar desde el panel

En **Catálogo → producto → Variaciones**, el propietario define los **Tipos de
opción** (por ejemplo, Capacidad y Energía) y sus valores. Cada fila representa
una combinación completa, con foto, GLB, ficha, disponibilidad y orden propios.
La primera combinación activa ordenada es la predeterminada en la web.

Los borradores pueden conservarse sin combinación, pero deben estar inactivos.
No se crean combinaciones ni se comparten opciones entre productos de forma
automática. Cambiar o quitar un valor exige corregir también las filas afectadas.
Se admiten hasta tres tipos de opción, diez valores por tipo y cien variaciones
por equipo. Estos límites protegen la edición y se pueden revisar en el código.

El servidor valida tanto los formularios como la proyección pública. La web
ofrece combinaciones existentes y nunca inventa una combinación al cambiar un
selector. Si otra elección debe ajustarse, lo comunica junto a los controles.
La cotización incluye el diseño y la combinación elegida.

El catálogo alojado en Django consume estos datos directamente. GitHub Pages
usa la instantánea del repositorio y necesita una nueva publicación para reflejar
cambios de datos del panel; el despliegue actual actualiza ambas versiones.

## Modelos y referencias

Los GLB son ilustrativos y no constituyen planos de fabricación. Se muestra el
número seleccionado de pollos o bandejas; las dimensiones finales, distribución,
formatos y mecanismos reales deben confirmarse al cotizar. Los originales v1/v2
se conservan. Los generadores de nuevas variantes están en `scripts/3d/`.

La fotografía del horno pizzero procede de la publicación de INOX del
[21 de mayo de 2020](https://www.facebook.com/photo.php?fbid=799997833864409).
La descripción identifica un horno a gas en acero 304 con dos rejillas. Es
referencia visual del gabinete vertical con vidrio, no evidencia de precio o
stock actuales. La variante eléctrica fue autorizada por el propietario; su
representación es ilustrativa.

`public/images/products/horno-pizza-referencia-facebook.webp` es una edición de
esa fotografía realizada con la herramienta integrada de imágenes. Se retiraron
el anuncio, la persona y el fondo; se conservó el equipo centrado sobre blanco.
Instrucción de edición: conservar estructura, proporciones, vidrio, dos rejillas,
dos mandos inferiores, patas y distintivo del horno; retirar elementos externos,
sin añadir accesorios ni pedestal. El original privado permanece en el respaldo
de trabajo y no se publica con los datos históricos del anuncio.

Otra referencia revisada es el [baño maría de tres bandejas](https://www.facebook.com/photo/?fbid=673753999822127), publicado el 6 de diciembre de 2019: el anuncio lo identifica como eléctrico, con vidrio curvo. Se conserva como referencia histórica adicional; no cambia las capacidades 4/6/8/10 confirmadas para la távola ni demuestra sus medidas actuales.

Su foto se limpió con la herramienta integrada de imágenes: quitar anuncio y fondo, vaciar exactamente tres bandejas, conservar gabinete, vidrio curvo, apoyos, corredera frontal y ruedas; fondo blanco sin pedestal. La edición y el original quedan en el respaldo de trabajo. Las búsquedas del perfil por «tavola», «convección» e «importado» no aportaron una ficha que confirme las opciones 5/10; esa parte sigue pendiente.
