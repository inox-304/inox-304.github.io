from pathlib import Path
import tempfile
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from catalog.validators import validate_glb
from .runner import child_environment, convert_process, JobFailure


class ConversionProcessTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source, self.output = self.root / "source.skp", self.root / "model.glb"
        from openskp.create import SkpBuilder
        builder = SkpBuilder()
        builder.add_face([(0, 0, 0), (40, 0, 0), (0, 20, 0)])
        builder.save(str(self.source))

    def test_isolated_child_converts_real_skp_to_valid_glb(self):
        with patch.dict("os.environ", {"DATABASE_URL": "must-not-be-inherited", "AWS_SECRET_ACCESS_KEY": "synthetic"}):
            self.assertNotIn("DATABASE_URL", child_environment(self.root))
            self.assertNotIn("AWS_SECRET_ACCESS_KEY", child_environment(self.root))
            stats = convert_process(self.source, self.output, alive=lambda: True)
        self.assertEqual(stats["engine_version"], "1.4.0")
        self.assertGreater(stats["triangles_unique"], 0)
        validate_glb(self.output.read_bytes())

    def test_cancellation_stops_child_without_output(self):
        with patch("model_imports.runner.BOOTSTRAP", "import time; time.sleep(15)"):
            with self.assertRaises(JobFailure) as error:
                convert_process(self.source, self.output, alive=lambda: False)
        self.assertEqual(error.exception.code, "cancelled")
        self.assertFalse(self.output.exists())

    @override_settings(MODEL_IMPORT_TIMEOUT_SECONDS=.1)
    def test_wall_timeout_stops_slow_child(self):
        with patch("model_imports.runner.BOOTSTRAP", "import time; time.sleep(15)"):
            with self.assertRaises(JobFailure) as error:
                convert_process(self.source, self.output, alive=lambda: True)
        self.assertEqual(error.exception.code, "timeout")
