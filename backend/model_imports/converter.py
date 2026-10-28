"""Bounded SKP -> GLB conversion. Run in the isolated worker, never in a request.

The pinned OpenSKP parser supplies geometry; our writer keeps metres, component
instances and names without exporting SketchUp attribute dictionaries or paths.
This module deliberately has no Django, storage, network or credential access.
"""
from __future__ import annotations

import argparse
from array import array
from importlib.metadata import version
from io import BytesIO
import json
import logging
import math
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import sys
import zipfile

ENGINE_VERSION = "1.4.0"
MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_EXPANDED_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_TRIANGLES = 300_000
MAX_NODES = 5_000
MAX_DEPTH = 40
MAX_TEXTURE_PIXELS = 16_000_000
MAX_TEXTURE_EDGE = 2048
IDENTITY = (1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.)
KNOWN_LIMITATIONS = [
    "Revisa la vista previa: la lectura SKP es independiente de SketchUp y puede diferir del original.",
    "No se importan animaciones, reglas de componentes dinámicos, cotas, escenas ni estilos de SketchUp.",
    "Las texturas proyectadas o aplicadas a un componente pueden diferir; los materiales no incluyen el acabado físico de acero.",
    "Se conservan componentes y posiciones; las puertas y módulos necesitan configurar sus interacciones por separado.",
]


class ConversionError(Exception):
    """A safe error for the administration UI; never include parser exceptions."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def preflight(source_path: str | Path) -> Path:
    source = Path(source_path)
    if source.suffix.lower() != ".skp" or not source.is_file():
        raise ConversionError("invalid_source", "Selecciona un archivo SketchUp .skp válido.")
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise ConversionError("source_too_large", "El modelo SketchUp supera 20 MB; purga componentes y materiales sin usar.")
    with source.open("rb") as stream:
        header = stream.read(4096)
    if not header.startswith(b"\xff\xfe\xff\x0e"):
        raise ConversionError("invalid_source", "El contenido no corresponde a un archivo SketchUp.")
    # Check the directory independently of the header scan. Even a prepended
    # or ambiguous container must pass expansion checks before the parser runs.
    if zipfile.is_zipfile(source) or b"PK\x03\x04" in header:
        try:
            with zipfile.ZipFile(source) as archive:
                entries = archive.infolist()
                if len(entries) > 2048 or sum(i.file_size for i in entries) > MAX_EXPANDED_BYTES:
                    raise ConversionError("expanded_too_large", "El modelo contiene demasiados datos descomprimidos para la conversión.")
                seen = set()
                for entry in entries:
                    name = entry.filename.replace("\\", "/")
                    path = PurePosixPath(name)
                    if (path.is_absolute() or ".." in path.parts or ":" in name or name in seen
                            or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1
                            or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                        raise ConversionError("invalid_source", "El contenedor SketchUp no es compatible o no es seguro.")
                    seen.add(name)
                if "model.dat" not in seen:
                    raise ConversionError("invalid_source", "El archivo SketchUp no contiene su modelo principal.")
        except (zipfile.BadZipFile, OSError, ValueError) as exc:
            raise ConversionError("invalid_source", "El archivo SketchUp está incompleto o dañado.") from exc
    return source


def _prepare(parsed: dict) -> int:
    """Bound the definition graph before triangulation and omit hidden geometry.

    OpenSKP 1.4.0 exposes visibility but does not filter it in its scene builder.
    No source data is changed on disk. The source remains available privately.
    """
    definitions = parsed.get("defs_dict", {})
    if len(definitions) > MAX_NODES:
        raise ConversionError("too_complex", "El modelo contiene demasiados componentes.")
    layer_names = parsed.get("layer_id_to_name", {})
    hidden = parsed.get("layer_hidden", {})
    omitted = 0
    total_faces = total_vertices = 0
    for definition in definitions.values():
        builder = definition["builder"]
        total_faces += len(builder.faces)
        total_vertices += len(builder.vertices)
        faces = {key: face for key, face in builder.faces.items()
                 if not face.get("hidden") and not hidden.get(layer_names.get(face.get("layer"), ""), False)}
        omitted += len(builder.faces) - len(faces)
        builder.faces = faces
        instances = [i for i in builder.instances
                     if not i.get("hidden") and not hidden.get(layer_names.get(i.get("layer_id"), ""), False)]
        omitted += len(builder.instances) - len(instances)
        builder.instances = instances
    if total_faces > MAX_TRIANGLES or total_vertices > 600_000:
        raise ConversionError("too_complex", "El modelo contiene demasiada geometría; simplifícalo antes de subirlo.")
    count = 0

    def walk(key, ancestors):
        nonlocal count
        if key in ancestors or len(ancestors) >= MAX_DEPTH:
            raise ConversionError("invalid_graph", "La estructura de componentes es circular o demasiado profunda.")
        if key not in definitions:
            raise ConversionError("invalid_graph", "El modelo contiene referencias a componentes ausentes.")
        count += 1
        if count > MAX_NODES:
            raise ConversionError("too_complex", "El modelo contiene demasiadas instancias de componentes.")
        for instance in definitions[key]["builder"].instances:
            walk(instance["ref_idx"], ancestors | {key})

    walk("ROOT", set())
    return omitted


def _name(value, fallback):
    clean = "".join(c for c in str(value or "") if c.isprintable()).strip()
    return clean[:160] or fallback


def _finite(values, expected=None):
    result = [float(v) for v in values]
    if (expected is not None and len(result) != expected) or not all(math.isfinite(v) and abs(v) <= 1e9 for v in result):
        raise ConversionError("invalid_geometry", "El modelo contiene coordenadas no válidas.")
    return result


def _multiply(a, b):
    return [sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
            for col in range(4) for row in range(4)]


def _texture(data):
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        with Image.open(BytesIO(data), formats=("PNG", "JPEG")) as original:
            if original.width * original.height > MAX_TEXTURE_PIXELS:
                raise ConversionError("texture_too_large", "Una textura supera 16 megapíxeles; reduce su resolución.")
            original.load()
            picture = ImageOps.exif_transpose(original).convert("RGBA")
            resized = max(picture.size) > MAX_TEXTURE_EDGE
            picture.thumbnail((MAX_TEXTURE_EDGE, MAX_TEXTURE_EDGE), Image.Resampling.LANCZOS)
            # Re-encoding also removes EXIF, comments and author/source metadata.
            output = BytesIO()
            if picture.getextrema()[3] == (255, 255):
                picture.convert("RGB").save(output, format="JPEG", quality=94, subsampling=0)
                mime = "image/jpeg"
            else:
                picture.save(output, format="PNG", optimize=True)
                mime = "image/png"
            return output.getvalue(), mime, resized
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ConversionError("invalid_texture", "El modelo contiene una textura no compatible o dañada.") from exc


def encode_scene(scene) -> tuple[bytes, dict]:
    """Write a self-contained GLB without opaque extras or external resources."""
    if len(scene.gltf_materials) > 512 or len(scene.textures) > 128:
        raise ConversionError("too_complex", "El modelo contiene demasiados materiales o texturas.")
    document = {"asset": {"version": "2.0", "generator": "INOX SKP importer / OpenSKP 1.4.0"},
                "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [], "meshes": [],
                "materials": [], "accessors": [], "bufferViews": [], "buffers": []}
    binary = bytearray()

    def buffer(data, target=None):
        binary.extend(b"\0" * (-len(binary) % 4))
        if len(binary) + len(data) > MAX_OUTPUT_BYTES:
            raise ConversionError("output_too_large", "El modelo convertido supera 8 MB; simplifica geometría o texturas.")
        entry = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
        if target:
            entry["target"] = target
        document["bufferViews"].append(entry)
        binary.extend(data)
        return len(document["bufferViews"]) - 1

    def accessor(values, width, *, indices=False, bounds=False):
        if len(values) % width or not len(values):
            raise ConversionError("invalid_geometry", "El modelo contiene una malla incompleta.")
        if indices:
            converted = array("I", values)
            component_type = 5125
        else:
            converted = array("f", values)
            if not all(math.isfinite(v) and abs(v) <= 1e9 for v in converted):
                raise ConversionError("invalid_geometry", "El modelo contiene coordenadas no válidas.")
            component_type = 5126
        if sys.byteorder != "little":
            converted.byteswap()
        entry = {"bufferView": buffer(converted.tobytes(), 34963 if indices else 34962),
                 "componentType": component_type, "count": len(values) // width,
                 "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3"}[width]}
        if bounds:
            entry["min"] = [min(values[i::width]) for i in range(width)]
            entry["max"] = [max(values[i::width]) for i in range(width)]
        document["accessors"].append(entry)
        return len(document["accessors"]) - 1

    texture_map = {}
    resized_textures = 0
    for material in scene.gltf_materials:
        pbr = material.get("pbrMetallicRoughness", {})
        color = _finite(pbr.get("baseColorFactor", [1, 1, 1, 1]), 4)
        if any(v < 0 or v > 1 for v in color):
            raise ConversionError("invalid_material", "El modelo contiene un material no válido.")
        output_pbr = {"baseColorFactor": color, "metallicFactor": 0.0, "roughnessFactor": 0.8}
        output = {"pbrMetallicRoughness": output_pbr, "doubleSided": bool(material.get("doubleSided", False))}
        if material.get("alphaMode") in {"MASK", "BLEND"}:
            output["alphaMode"] = material["alphaMode"]
        texture_info = pbr.get("baseColorTexture")
        if texture_info is not None:
            index = texture_info.get("index")
            if not isinstance(index, int) or index < 0 or index >= len(scene.textures):
                raise ConversionError("invalid_texture", "Falta una textura utilizada por el modelo.")
            if index not in texture_map:
                data, mime, resized = _texture(scene.textures[index].data)
                resized_textures += int(resized)
                images = document.setdefault("images", [])
                images.append({"bufferView": buffer(data), "mimeType": mime})
                textures = document.setdefault("textures", [])
                textures.append({"source": len(images) - 1})
                texture_map[index] = len(textures) - 1
            output_pbr["baseColorTexture"] = {"index": texture_map[index]}
        document["materials"].append(output)

    resources = {}
    triangles_unique = 0
    for resource in scene.mesh_resources:
        if resource.id in resources:
            raise ConversionError("invalid_graph", "El modelo contiene componentes duplicados inválidos.")
        primitives = []
        local_min, local_max = [math.inf] * 3, [-math.inf] * 3
        triangles = 0
        for primitive in resource.primitives:
            vertex_count = len(primitive.positions) // 3
            if (len(primitive.positions) % 3 or not vertex_count or len(primitive.indices) % 3
                    or len(primitive.normals) != len(primitive.positions)
                    or min(primitive.indices, default=-1) < 0 or max(primitive.indices, default=vertex_count) >= vertex_count):
                raise ConversionError("invalid_geometry", "El modelo contiene una malla incompleta.")
            triangles += len(primitive.indices) // 3
            if triangles_unique + triangles > MAX_TRIANGLES:
                raise ConversionError("too_many_triangles", "El modelo supera 300 000 triángulos; simplifica la geometría.")
            position = accessor(primitive.positions, 3, bounds=True)
            attributes = {"POSITION": position, "NORMAL": accessor(primitive.normals, 3)}
            if len(primitive.uvs):
                if len(primitive.uvs) != vertex_count * 2:
                    raise ConversionError("invalid_geometry", "Las coordenadas de textura están incompletas.")
                # SketchUp/OpenSKP use bottom-left UV origin; glTF images use
                # top-left. Keep the pixels upright and flip the V coordinate.
                uvs = array("f", primitive.uvs)
                for offset in range(1, len(uvs), 2):
                    uvs[offset] = 1.0 - uvs[offset]
                attributes["TEXCOORD_0"] = accessor(uvs, 2)
            if not 0 <= primitive.material_index < len(document["materials"]):
                raise ConversionError("invalid_material", "Falta un material utilizado por el modelo.")
            primitives.append({"attributes": attributes, "indices": accessor(primitive.indices, 1, indices=True),
                               "material": primitive.material_index, "mode": 4})
            for axis in range(3):
                local_min[axis] = min(local_min[axis], document["accessors"][position]["min"][axis])
                local_max[axis] = max(local_max[axis], document["accessors"][position]["max"][axis])
        if primitives:
            resources[resource.id] = (len(document["meshes"]), triangles, local_min, local_max)
            document["meshes"].append({"name": _name(resource.definition_name, "Componente"), "primitives": primitives})
            triangles_unique += triangles

    placed_triangles = 0
    minimum, maximum = [math.inf] * 3, [-math.inf] * 3
    active = set()

    def node(source, parent_matrix, depth):
        nonlocal placed_triangles
        if depth > MAX_DEPTH or id(source) in active or len(document["nodes"]) >= MAX_NODES:
            raise ConversionError("invalid_graph", "La estructura de componentes es demasiado compleja.")
        active.add(id(source))
        matrix = _finite(source.matrix, 16)
        if any(abs(matrix[i]) > 1e-8 for i in (3, 7, 11)) or abs(matrix[15] - 1) > 1e-8:
            raise ConversionError("invalid_geometry", "El modelo contiene una transformación no compatible.")
        absolute = _multiply(parent_matrix, matrix)
        target = {"name": _name(source.name, "Componente"), "matrix": matrix}
        index = len(document["nodes"])
        document["nodes"].append(target)
        if source.mesh_resource_id:
            if source.mesh_resource_id not in resources:
                raise ConversionError("invalid_geometry", "Un componente no contiene una malla válida.")
            mesh, triangles, local_min, local_max = resources[source.mesh_resource_id]
            target["mesh"] = mesh
            placed_triangles += triangles
            if placed_triangles > MAX_TRIANGLES:
                raise ConversionError("too_many_triangles", "El modelo colocado supera 300 000 triángulos; reduce las repeticiones.")
            for corner in range(8):
                point = [local_max[a] if corner & (1 << a) else local_min[a] for a in range(3)]
                for axis in range(3):
                    value = sum(absolute[k * 4 + axis] * point[k] for k in range(3)) + absolute[12 + axis]
                    minimum[axis] = min(minimum[axis], value)
                    maximum[axis] = max(maximum[axis], value)
        if source.children:
            target["children"] = [node(child, absolute, depth + 1) for child in source.children]
        active.remove(id(source))
        return index

    node(scene.scene_hierarchy, IDENTITY, 0)
    if not placed_triangles:
        raise ConversionError("empty_geometry", "El modelo no contiene superficies visibles; las líneas solas no forman un equipo 3D.")
    document["buffers"] = [{"byteLength": len(binary)}]
    payload = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    payload += b" " * (-len(payload) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    length = 12 + 8 + len(payload) + 8 + len(binary)
    if length > MAX_OUTPUT_BYTES:
        raise ConversionError("output_too_large", "El modelo convertido supera 8 MB; simplifica geometría o texturas.")
    output = struct.pack("<4sII", b"glTF", 2, length) + struct.pack("<I4s", len(payload), b"JSON") + payload
    output += struct.pack("<I4s", len(binary), b"BIN\0") + binary
    warnings = list(KNOWN_LIMITATIONS)
    if scene.textures:
        warnings.append("Las texturas se han optimizado y se han retirado sus metadatos privados.")
    if resized_textures:
        warnings.append("Las texturas grandes se redujeron a un máximo de 2048 píxeles por lado.")
    if getattr(scene, "curve_resources", []):
        warnings.append("Las líneas auxiliares sin superficies no se incluyen en la visualización.")
    return output, {"bytes": length, "triangles_unique": triangles_unique, "triangles_instanced": placed_triangles,
                    "nodes": len(document["nodes"]), "meshes": len(document["meshes"]),
                    "materials": len(document["materials"]), "textures": len(texture_map),
                    "bounds_m": {"min": minimum, "max": maximum}, "warnings": warnings}


def convert(source_path: str | Path, output_path: str | Path) -> dict:
    source = preflight(source_path)
    output = Path(output_path)
    if source.resolve() == output.resolve() or output.suffix.lower() != ".glb":
        raise ConversionError("invalid_output", "La salida debe ser un archivo GLB distinto del original.")
    if version("openskp") != ENGINE_VERSION:
        raise ConversionError("engine_version", "La versión del conversor no corresponde a la verificada.")
    # Full parsing once avoids retaining the typed model and then parsing again.
    from openskp import _core
    from openskp.instanced_scene import build_instanced_scene
    try:
        parsed = _core.full_parse(str(source))
        omitted = _prepare(parsed)
        raw_version = str(parsed.get("version", "unknown"))
        source_version = raw_version if re.fullmatch(r"\{?\d+(?:\.\d+){0,3}\}?", raw_version) else "unknown"
        scene = build_instanced_scene(parsed, name_override_keys=())
        del parsed
        data, stats = encode_scene(scene)
        if omitted:
            stats["warnings"].append("Se omitieron elementos ocultos del archivo SketchUp.")
        stats.update(engine="openskp", engine_version=ENGINE_VERSION, source_version=source_version,
                     units="m", up_axis="Y", animations=0)
        output.write_bytes(data)
        return stats
    except ConversionError:
        raise
    except MemoryError as exc:
        raise ConversionError("memory_limit", "El modelo necesita más memoria; reduce su complejidad antes de convertirlo.") from exc
    except Exception as exc:
        raise ConversionError("conversion_failed", "No se pudo interpretar este SketchUp. Revisa el archivo y prueba una copia simplificada.") from exc


def main(argv=None):
    parser = argparse.ArgumentParser(description="Convertir SketchUp a GLB dentro del trabajador aislado.")
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        stats = convert(args.source, args.output)
    except ConversionError as exc:
        print(json.dumps({"ok": False, "code": exc.code, "message": str(exc)}, ensure_ascii=True))
        return 1
    except Exception:
        print(json.dumps({"ok": False, "code": "conversion_failed", "message": "El conversor no pudo completar el archivo."}))
        return 1
    print(json.dumps({"ok": True, **stats}, ensure_ascii=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
