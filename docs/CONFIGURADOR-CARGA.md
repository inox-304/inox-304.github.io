# Personalización disponible durante una caída del servidor

GitHub Pages incluye las reglas públicas aprobadas de P01, P02, P03, P04, P05
y la cocina empotrada INOX-COC-EMP. La primera visita puede mostrar sus opciones
sin esperar a Render. Esta copia no incluye usuarios, credenciales ni datos privados.

La fuente está en `src/data/cooktop-published.json`, con la fecha de consulta y el
servidor de origen. Cada entrada corresponde a un código y un modelo 3D exactos.
El validador rechaza identidades ajenas, modelos distintos, equipos de distribución
y reglas mal formadas. No se aplican opciones de cocina a otros productos.

Para actualizar la copia después de cambiar las opciones autorizadas en el panel:

```powershell
node scripts/refresh-cooktop-snapshot.mjs
node --test scripts/test-cooktop-snapshot.mjs
```

El comando solo lee seis direcciones públicas del panel, sin cookies ni claves.
Reemplaza el archivo completo únicamente cuando todas las consultas y validaciones
terminan correctamente. Si alguna falla, conserva la copia anterior. Un valor
`null` o una configuración deshabilitada confirmados por el servidor también se
guardan para retirar esas opciones en la siguiente publicación.

Hay que revisar el cambio y publicar la web para distribuir la copia nueva. Las
consultas en vivo siguen siendo la fuente más reciente cuando el servidor está
disponible; la copia permite continuar con las últimas opciones publicadas durante
una interrupción. Una revocación realizada mientras el servidor está inaccesible
no puede conocerse hasta recuperar la conexión. La configuración sigue siendo
una solicitud de cotización, no una aprobación de fabricación o un precio cerrado.

Si se reemplaza el modelo base por uno de SketchUp, hay que revisar su compatibilidad
modular y la asociación de la copia antes de publicar; no heredará automáticamente
las piezas de un modelo anterior. Los productos obtenidos desde la API del panel
no se sobrescriben con esta copia estática.

La comprobación en segundo plano muestra un aviso si tarda más de cinco segundos.
Al fallar o superar 65 segundos, ofrece «Reintentar conexión» y mantiene el
configurador, el 3D, la distribución y el historial de cambios. El reintento no
recarga la página ni ejecuta solicitudes duplicadas. Una respuesta vieja de otro
producto o de un intento vencido no puede sobrescribir la selección actual.

Una respuesta válida que deshabilita las reglas, o un producto retirado (404/410),
sí retira la personalización y lo explica. Los errores de red, respuestas incompletas
y fallos del servidor no se interpretan como desactivaciones. Si el taller modifica
reglas y la selección sigue siendo compatible, se conserva; si ya no es compatible,
se restablece con un aviso.
