"""Conversion checks use generated geometry, never customer SKP files.

The OpenSKP builder creates a legacy-v17 fixture, not proof of SKP 2023
fidelity. Modern-container preflight is tested separately; real 2023 files
still need visual approval from their author.
"""
from array import array
from io import BytesIO
import json
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
import zipfile

from . import converter


def unpack(data):
    size = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + size]), data[28 + size:]


def scene_fixture(*, texture=False, copies=2):
    material = {"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, .5], "metallicFactor": 0, "roughnessFactor": .8},
                "alphaMode": "BLEND", "doubleSided": True, "extras": {"password": "private-property"}}
    textures = []
    if texture:
        from PIL import Image, PngImagePlugin
        image = Image.new("RGBA", (2, 2), (255, 0, 0, 128))
        info = PngImagePlugin.PngInfo()
        info.add_text("Author", "private-texture-author")
        data = BytesIO()
        image.save(data, format="PNG", pnginfo=info)
        textures.append(NS(data=data.getvalue(), filename="C:/private/author/photo.png"))
        material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
    primitive = NS(positions=array("f", [0, 0, 0, 1, 0, 0, 0, 1, 0]), normals=array("f", [0, 0, 1] * 3),
                   uvs=array("f", [0, 0, 1, 0, 0, 1]), indices=array("I", [0, 1, 2]), material_index=0)
    resource = NS(id="door", definition_name="Puerta", primitives=[primitive])
    children = []
    for i in range(copies):
        matrix = list(converter.IDENTITY)
        matrix[12] = i * 2
        children.append(NS(name=f"Puerta {i + 1}", matrix=matrix, mesh_resource_id="door", children=[],
                           properties={"password": "private-property"}))
    root = NS(name="Equipo", matrix=converter.IDENTITY, mesh_resource_id=None, children=children)
    return NS(mesh_resources=[resource], scene_hierarchy=root, gltf_materials=[material], textures=textures, curve_resources=[])


class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_instancing_metres_names_and_no_private_extras(self):
        data, stats = converter.encode_scene(scene_fixture())
        doc, binary = unpack(data)
        self.assertEqual(struct.unpack_from("<4sII", data), (b"glTF", 2, len(data)))
        self.assertEqual(len(doc["meshes"]), 1)
        self.assertEqual([n.get("mesh") for n in doc["nodes"]], [None, 0, 0])
        self.assertEqual(doc["nodes"][2]["matrix"][12], 2)
        self.assertEqual(doc["nodes"][1]["name"], "Puerta 1")
        self.assertEqual(doc["accessors"][0]["max"], [1, 1, 0])
        self.assertEqual(stats["bounds_m"], {"min": [0, 0, 0], "max": [3, 1, 0]})
        self.assertEqual(stats["triangles_unique"], 1)
        self.assertEqual(stats["triangles_instanced"], 2)
        self.assertNotIn(b"private-property", data)
        self.assertNotIn("animations", doc)
        self.assertNotIn("extras", json.dumps(doc))
        self.assertGreater(len(binary), 0)

    def test_textures_embedded_alpha_uv_orientation_and_metadata_removed(self):
        from PIL import Image
        data, stats = converter.encode_scene(scene_fixture(texture=True))
        doc, binary = unpack(data)
        image = doc["images"][0]
        self.assertEqual(image["mimeType"], "image/png")
        view = doc["bufferViews"][image["bufferView"]]
        content = binary[view["byteOffset"]:view["byteOffset"] + view["byteLength"]]
        with Image.open(BytesIO(content)) as picture:
            self.assertEqual(picture.getpixel((0, 0)), (255, 0, 0, 128))
            self.assertNotIn("Author", picture.info)
        self.assertEqual(doc["materials"][0]["alphaMode"], "BLEND")
        primitive = doc["meshes"][0]["primitives"][0]
        uv = doc["accessors"][primitive["attributes"]["TEXCOORD_0"]]
        view = doc["bufferViews"][uv["bufferView"]]
        self.assertEqual(struct.unpack_from("<6f", binary, view["byteOffset"]), (0, 1, 1, 1, 0, 0))
        self.assertEqual(stats["textures"], 1)
        self.assertNotIn(b"private-texture-author", data)
        self.assertNotIn(b"C:/private", data)
        self.assertNotIn('"uri"', json.dumps(doc))

    def test_rejects_instanced_geometry_over_budget(self):
        with patch.object(converter, "MAX_TRIANGLES", 1):
            with self.assertRaises(converter.ConversionError) as error:
                converter.encode_scene(scene_fixture(copies=2))
        self.assertEqual(error.exception.code, "too_many_triangles")

    def test_rejects_malformed_geometry_and_cycles(self):
        scene = scene_fixture()
        scene.mesh_resources[0].primitives[0].indices[2] = 999
        with self.assertRaises(converter.ConversionError):
            converter.encode_scene(scene)
        scene = scene_fixture()
        scene.scene_hierarchy.children.append(scene.scene_hierarchy)
        with self.assertRaises(converter.ConversionError):
            converter.encode_scene(scene)
        scene = scene_fixture()
        scene.scene_hierarchy.matrix = [float("nan")] * 16
        with self.assertRaises(converter.ConversionError):
            converter.encode_scene(scene)

    def test_output_limit_rejects_without_partial_file(self):
        with patch.object(converter, "MAX_OUTPUT_BYTES", 100):
            with self.assertRaises(converter.ConversionError) as error:
                converter.encode_scene(scene_fixture())
        self.assertEqual(error.exception.code, "output_too_large")

    def zip_source(self, entries):
        source = self.directory / "modern.skp"
        header = b"\xff\xfe\xff\x0e" + "SketchUp Model".encode("utf-16le")
        source.write_bytes(header)
        with zipfile.ZipFile(source, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, value in entries.items():
                archive.writestr(name, value)
        return source

    def test_modern_container_preflight_checks_expansion_and_paths(self):
        source = self.zip_source({"model.dat": b"synthetic-container-not-real-2023"})
        self.assertEqual(converter.preflight(source), source)
        with patch.object(converter, "MAX_EXPANDED_BYTES", 1):
            with self.assertRaises(converter.ConversionError) as error:
                converter.preflight(source)
        self.assertEqual(error.exception.code, "expanded_too_large")
        source = self.zip_source({"model.dat": b"data", "../untrusted.xml": b"bad"})
        with self.assertRaises(converter.ConversionError):
            converter.preflight(source)

    def test_zip_after_long_prefix_and_symlinks_are_checked(self):
        source = self.directory / "long-prefix.skp"
        source.write_bytes(b"\xff\xfe\xff\x0e" + b"x" * 5000)
        with zipfile.ZipFile(source, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("model.dat", b"x" * 1000)
        with patch.object(converter, "MAX_EXPANDED_BYTES", 500):
            with self.assertRaises(converter.ConversionError) as error:
                converter.preflight(source)
        self.assertEqual(error.exception.code, "expanded_too_large")
        source = self.zip_source({"model.dat": b"data"})
        with zipfile.ZipFile(source, "a") as archive:
            entry = zipfile.ZipInfo("materials/redirect.png")
            entry.create_system = 3
            entry.external_attr = 0o120777 << 16
            archive.writestr(entry, "/etc/passwd")
        with self.assertRaises(converter.ConversionError) as error:
            converter.preflight(source)
        self.assertEqual(error.exception.code, "invalid_source")

    def test_synthetic_vff_triangle_runs_modern_parser_and_catalog_validation(self):
        # A deliberately tiny TLV+ZIP fixture, not a SketchUp-authored file.
        # OpenSKP's writer only writes legacy v17. Constructing the documented
        # record shapes here exercises its separate modern ZIP parser path.
        def tlv(tag, body):
            return bytes.fromhex(tag) + struct.pack("<I", len(body)) + body

        def entity(number):
            return tlv("DE05", bytes([number]))

        vertices = b"".join(tlv("C409", entity(i + 1) + tlv("C509", struct.pack("<3d", *point)))
                            for i, point in enumerate(((0, 0, 0), (40, 0, 0), (0, 20, 0))))
        edges = b"".join(tlv("B80B", entity(i + 4) + tlv("B90B", bytes([a])) + tlv("BA0B", bytes([b])))
                         for i, (a, b) in enumerate(((1, 2), (2, 3), (3, 1))))
        coedges = b"".join(tlv("A00F", tlv("A10F", bytes([edge])) + tlv("A20F", b"\0")) for edge in (4, 5, 6))
        face = tlv("AC0D", entity(7) + tlv("AD0D", struct.pack("<3d", 0, 0, 1))
                   + tlv("AE0D", tlv("9411", coedges)))
        source = self.directory / "synthetic-modern.skp"
        declared_version = "{23.0.0}"
        source.write_bytes(b"\xff\xfe\xff\x0e" + "SketchUp Model".encode("utf-16le")
                           + b"\xff\xfe\xff" + bytes([len(declared_version)]) + declared_version.encode("utf-16le"))
        with zipfile.ZipFile(source, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("model.dat", tlv("F601", vertices + edges + face))
        output = self.directory / "modern.glb"
        stats = converter.convert(source, output)
        self.assertEqual(stats["source_version"], "{23.0.0}")
        self.assertGreaterEqual(stats["triangles_unique"], 1)
        self.assertAlmostEqual(stats["bounds_m"]["max"][0], 1.016, places=5)
        self.assertAlmostEqual(stats["bounds_m"]["min"][2], -.508, places=5)
        from catalog.validators import validate_glb
        validate_glb(output.read_bytes())

    def test_real_parser_generated_skp_preserves_dimensions_components_and_hidden(self):
        from openskp.create import SkpBuilder
        builder = SkpBuilder()
        with builder.add_component_definition("Puerta") as door:
            door.add_face([(0, 0, 0), (40, 0, 0), (40, 0, 20), (0, 0, 20)])
        builder.add_instance(door, name="Puerta izquierda", translation=(0, 0, 0), attributes={"private": "PRIVATE-DO-NOT-EXPORT"})
        builder.add_instance(door, name="Puerta derecha", translation=(40, 0, 0))
        builder.add_instance(door, name="Oculto", translation=(4000, 0, 0), hidden=True)
        source = self.directory / "fixture.skp"
        builder.save(str(source))
        output = self.directory / "fixture.glb"
        stats = converter.convert(source, output)
        data = output.read_bytes()
        doc, _ = unpack(data)
        self.assertEqual(stats["engine_version"], "1.4.0")
        self.assertEqual(stats["units"], "m")
        self.assertAlmostEqual(stats["bounds_m"]["max"][0], 2.032, places=5)
        self.assertAlmostEqual(stats["bounds_m"]["max"][1], .508, places=5)
        self.assertEqual(stats["meshes"], 1)
        self.assertEqual(stats["nodes"], 3)
        self.assertEqual(stats["triangles_instanced"], stats["triangles_unique"] * 2)
        self.assertIn("Puerta izquierda", [n["name"] for n in doc["nodes"]])
        self.assertNotIn(b"PRIVATE-DO-NOT-EXPORT", data)
        self.assertNotIn(b"Oculto", data)
        self.assertFalse(output.with_name("fixture_metadata.json").exists())

    def test_bad_skp_is_rejected_without_exposing_paths(self):
        source = self.directory / "personal-information.skp"
        source.write_bytes(b"not a sketchup")
        with self.assertRaises(converter.ConversionError) as error:
            converter.convert(source, self.directory / "result.glb")
        self.assertNotIn("personal-information", str(error.exception))
        self.assertFalse((self.directory / "result.glb").exists())

    def test_real_parser_texture_and_nested_transforms(self):
        from openskp.create import SkpBuilder
        from PIL import Image
        texture_path = self.directory / "private-author-texture.png"
        Image.new("RGBA", (4, 4), (20, 90, 190, 128)).save(texture_path)
        builder = SkpBuilder()
        material = builder.add_texture_material("Vidrio", str(texture_path), applied_width=20, applied_height=20)
        hidden_layer = builder.add_layer("No publicar", hidden=True)
        with builder.add_component_definition("Ventana") as part:
            part.add_face([(0, 0, 0), (20, 0, 0), (20, 0, 20), (0, 0, 20)], material=material, back_material=material)
        with builder.add_component_definition("Mueble") as assembly:
            assembly.add_instance(part, name="Ventana izquierda", translation=(20, 0, 20))
        builder.add_instance(assembly, name="Mueble principal", translation=(40, 0, 0))
        builder.add_instance(part, name="No visible", translation=(4000, 0, 0), layer=hidden_layer)
        source, output = self.directory / "textured.skp", self.directory / "textured.glb"
        builder.save(str(source))
        stats = converter.convert(source, output)
        doc, _ = unpack(output.read_bytes())
        self.assertEqual(stats["textures"], 1)
        self.assertEqual(stats["nodes"], 3)
        self.assertAlmostEqual(stats["bounds_m"]["min"][0], 60 * .0254, places=5)
        self.assertAlmostEqual(stats["bounds_m"]["max"][0], 80 * .0254, places=5)
        self.assertAlmostEqual(stats["bounds_m"]["max"][1], 40 * .0254, places=5)
        self.assertEqual(doc["nodes"][1]["children"], [2])
        self.assertEqual(doc["images"][0]["mimeType"], "image/png")
        self.assertNotIn(b"private-author-texture", output.read_bytes())

    def test_rejects_unknown_parser_version(self):
        source = self.zip_source({"model.dat": b"synthetic"})
        with patch.object(converter, "version", return_value="9.9.9"):
            with self.assertRaises(converter.ConversionError) as error:
                converter.convert(source, self.directory / "result.glb")
        self.assertEqual(error.exception.code, "engine_version")


if __name__ == "__main__":
    unittest.main()
