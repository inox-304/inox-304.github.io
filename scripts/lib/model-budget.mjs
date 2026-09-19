export function inspectGlb(buffer) {
  const errors = [], warnings = [];
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) return { errors: ['El archivo no es un GLB versión 2 válido.'], warnings, bytes: buffer.length, triangles: 0 };
  if (buffer.readUInt32LE(8) !== buffer.length) errors.push('El tamaño declarado del GLB no coincide con el archivo.');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || jsonLength + 20 > buffer.length || jsonLength % 4 !== 0) return { errors: [...errors, 'El bloque JSON del GLB no es válido.'], warnings, bytes: buffer.length, triangles: 0 };
  let gltf;
  try { gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')); }
  catch { return { errors: [...errors, 'El JSON del GLB no se puede leer.'], warnings, bytes: buffer.length, triangles: 0 }; }
  if (!gltf || typeof gltf !== 'object' || Array.isArray(gltf) || ['buffers', 'images', 'meshes', 'accessors', 'extensionsRequired'].some(key => gltf[key] !== undefined && !Array.isArray(gltf[key]))) return { errors: [...errors, 'La estructura glTF del GLB no es válida.'], warnings, bytes: buffer.length, triangles: 0 };
  if (gltf.asset?.version !== '2.0') errors.push('El contenido debe usar glTF 2.0.');
  if ([...(gltf.buffers || []), ...(gltf.images || [])].some(asset => typeof asset?.uri === 'string' && !asset.uri.startsWith('data:'))) errors.push('Incluye las texturas y buffers dentro del GLB; no uses archivos ni URLs externas.');
  if ((gltf.extensionsRequired || []).includes('EXT_meshopt_compression')) errors.push('Exporta sin Meshopt o usa Draco; este visor distribuye el decodificador Draco local.');
  let triangles = 0;
  for (const mesh of gltf.meshes || []) for (const primitive of Array.isArray(mesh?.primitives) ? mesh.primitives : []) {
    if (!primitive || typeof primitive !== 'object') continue;
    const count = gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count || 0;
    const mode = primitive.mode ?? 4;
    if (mode === 4) triangles += Math.floor(count / 3);
    else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
  }
  if (buffer.length > 12 * 1024 * 1024) errors.push('Supera el máximo de 12 MB por modelo.');
  else if (buffer.length > 5 * 1024 * 1024) warnings.push('Supera el objetivo de 5 MB; revisa carga en celular.');
  if (triangles > 300000) errors.push('Supera el máximo de 300 000 triángulos.');
  else if (triangles > 150000) warnings.push('Supera el objetivo de 150 000 triángulos; simplifica las piezas internas.');
  return { errors, warnings, bytes: buffer.length, triangles };
}
