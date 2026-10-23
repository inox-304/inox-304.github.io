import importlib.util
from contextlib import redirect_stderr
from io import StringIO
import os
from pathlib import Path
import subprocess
from unittest.mock import patch

from django.test import SimpleTestCase


class ContainerRuntimeTests(SimpleTestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[2] / "deploy" / "start-web.py"
        spec = importlib.util.spec_from_file_location("inox_start_web", source)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_platform_port_and_one_worker_are_passed_without_a_shell(self):
        with patch.dict(os.environ, {"PORT": "10000"}, clear=True), \
             patch.object(self.module.subprocess, "run") as run, \
             patch.object(self.module.os, "chdir"), \
             patch.object(self.module.os, "execv") as execute:
            self.module.main()
        self.assertEqual(run.call_count, 1)
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[-2:], ["collectstatic", "--noinput"])
        self.assertNotIn("shell", run.call_args.kwargs)
        command = execute.call_args.args[1]
        self.assertEqual(command[command.index("--bind") + 1], "0.0.0.0:10000")
        self.assertEqual(command[command.index("--workers") + 1], "1")
        self.assertEqual(command[command.index("--forwarded-allow-ips") + 1], "")

    def test_invalid_process_options_abort_before_any_command(self):
        for name, value in (("PORT", "0"), ("PORT", "65536"),
                            ("PORT", "8000; echo unsafe"),
                            ("WEB_CONCURRENCY", "-1"), ("WEB_CONCURRENCY", "33"),
                            ("GUNICORN_TIMEOUT", "301")):
            with self.subTest(name=name, value=value), \
                 patch.dict(os.environ, {name: value}, clear=True), \
                 patch.object(self.module.subprocess, "run") as run, \
                 patch.object(self.module.os, "execv") as execute, \
                 redirect_stderr(StringIO()):
                self.assertEqual(self.module.main(), 2)
                run.assert_not_called()
                execute.assert_not_called()

    def test_static_asset_failure_prevents_serving_a_broken_release(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(self.module.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "collectstatic")), \
             patch.object(self.module.os, "execv") as execute:
            with self.assertRaises(subprocess.CalledProcessError):
                self.module.main()
        execute.assert_not_called()
