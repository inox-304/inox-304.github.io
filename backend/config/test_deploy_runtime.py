import importlib.util
from contextlib import redirect_stderr
from io import StringIO
import os
from pathlib import Path
import signal
import subprocess
from unittest.mock import Mock, patch

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
                            ("GUNICORN_TIMEOUT", "301"),
                            ("MODEL_IMPORT_WORKER", "true"), ("MODEL_IMPORT_WORKER", "2"),
                            ("MODEL_IMPORT_WORKER", " 1")):
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

    def test_worker_default_is_production_only_and_can_be_disabled(self):
        for environment, explicit, expected in (("production", None, True), ("development", None, False),
                                                ("test", None, False), ("production", "0", False), ("test", "1", True)):
            values = {"DJANGO_ENV": environment}
            if explicit is not None:
                values["MODEL_IMPORT_WORKER"] = explicit
            with self.subTest(environment=environment, explicit=explicit), patch.dict(os.environ, values, clear=True):
                self.assertEqual(self.module.worker_enabled(), expected)

    def test_production_supervises_only_web_and_queue_consumer(self):
        with patch.dict(os.environ, {"DJANGO_ENV": "production"}, clear=True), \
             patch.object(self.module.subprocess, "run") as run, \
             patch.object(self.module.os, "chdir"), \
             patch.object(self.module.os, "execv") as execute, \
             patch.object(self.module, "supervise", return_value=0) as supervise:
            self.assertEqual(self.module.main(), 0)
        execute.assert_not_called()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][-2:], ["collectstatic", "--noinput"])
        web, worker, cwd = supervise.call_args.args
        self.assertIn("config.wsgi:application", web)
        self.assertEqual(worker[-1], "process_model_imports")
        self.assertEqual(Path(worker[1]).name, "manage.py")
        self.assertEqual(cwd.name, "backend")
        self.assertNotIn("migrate", web + worker + run.call_args.args[0])

    def test_worker_crash_restarts_with_backoff_and_web_exit_stops_everything(self):
        clock = {"now": 0.0}
        starts = []
        web = Mock(pid=100)
        web.poll.side_effect = lambda: 7 if clock["now"] >= 4 else None
        workers = [Mock(pid=n) for n in (101, 102, 103)]
        for worker in workers:
            worker.poll.return_value = 1

        def start(arguments, _cwd):
            if arguments == ["web"]:
                return web
            starts.append(clock["now"])
            return workers[len(starts) - 1]

        def sleep(seconds):
            clock["now"] += seconds

        with patch.object(self.module, "start_process", side_effect=start), \
             patch.object(self.module.time, "monotonic", side_effect=lambda: clock["now"]), \
             patch.object(self.module.time, "sleep", side_effect=sleep), \
             patch.object(self.module.signal, "signal"), \
             patch.object(self.module, "signal_process") as send, \
             patch.object(self.module, "stop_processes") as stop, \
             redirect_stderr(StringIO()):
            self.assertEqual(self.module.supervise(["web"], ["worker"], Path("unused")), 7)
        self.assertEqual(starts, [0, 1.25, 3.5])
        self.assertEqual(send.call_count, 3)
        stop.assert_called_once_with((None, web))

    def test_sigterm_stops_both_services_and_restores_handlers(self):
        handlers = {}
        web, worker = Mock(pid=100), Mock(pid=101)
        web.poll.return_value = None
        worker.poll.return_value = None

        def install(sig, handler):
            previous = handlers.get(sig, "original")
            handlers[sig] = handler
            return previous

        def sleep(_seconds):
            handlers[signal.SIGTERM](signal.SIGTERM, None)

        with patch.object(self.module, "start_process", side_effect=[web, worker]), \
             patch.object(self.module.time, "monotonic", return_value=0), \
             patch.object(self.module.time, "sleep", side_effect=sleep), \
             patch.object(self.module.signal, "signal", side_effect=install), \
             patch.object(self.module, "stop_processes") as stop:
            self.assertEqual(self.module.supervise(["web"], ["worker"], Path("unused")), 128 + signal.SIGTERM)
        stop.assert_called_once_with((worker, web))
        self.assertEqual(handlers[signal.SIGTERM], "original")
        self.assertEqual(handlers[signal.SIGINT], "original")

    def test_worker_spawn_failure_backs_off_without_terminating_web(self):
        clock = {"now": 0.0}
        starts = []
        web = Mock(pid=100)
        web.poll.side_effect = lambda: -9 if clock["now"] >= 4 else None
        worker = Mock(pid=101)
        worker.poll.return_value = None

        def start(arguments, _cwd):
            if arguments == ["web"]:
                return web
            starts.append(clock["now"])
            if len(starts) < 3:
                raise OSError("Synthetic failure")
            return worker

        def sleep(seconds):
            clock["now"] += seconds

        with patch.object(self.module, "start_process", side_effect=start), \
             patch.object(self.module.time, "monotonic", side_effect=lambda: clock["now"]), \
             patch.object(self.module.time, "sleep", side_effect=sleep), \
             patch.object(self.module.signal, "signal"), \
             patch.object(self.module, "stop_processes") as stop, \
             redirect_stderr(StringIO()):
            self.assertEqual(self.module.supervise(["web"], ["worker"], Path("unused")), 137)
        self.assertEqual(starts, [0, 1, 3])
        stop.assert_called_once_with((worker, web))

    def test_failed_web_start_restores_handlers_and_does_not_start_worker(self):
        with patch.object(self.module, "start_process", side_effect=OSError("Synthetic failure")) as start, \
             patch.object(self.module.signal, "signal", return_value="previous") as handlers, \
             patch.object(self.module, "stop_processes") as stop:
            with self.assertRaises(OSError):
                self.module.supervise(["web"], ["worker"], Path("unused"))
        self.assertEqual(start.call_count, 1)
        self.assertEqual(handlers.call_count, 4)
        self.assertEqual(handlers.call_args_list[-1].args[1], "previous")
        stop.assert_called_once_with((None, None))

    def test_linux_service_groups_are_isolated_and_children_are_signalled(self):
        process = Mock(pid=43210)
        process.poll.return_value = 0
        with patch.object(self.module.os, "name", "posix"), \
             patch.object(self.module.subprocess, "Popen", return_value=process) as popen, \
             patch.object(self.module.os, "killpg", create=True) as killpg:
            self.module.start_process(["python", "manage.py", "process_model_imports"], "backend")
            self.module.signal_process(process, signal.SIGTERM)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertNotIn("shell", popen.call_args.kwargs)
        killpg.assert_called_once_with(43210, signal.SIGTERM)

    def test_shutdown_uses_one_deadline_then_forces_both_groups(self):
        worker, web = Mock(pid=10), Mock(pid=20)
        worker.wait.side_effect = [subprocess.TimeoutExpired("worker", 10), 0]
        web.wait.return_value = 0
        with patch.object(self.module, "signal_process") as send, \
             patch.object(self.module.time, "monotonic", side_effect=[0, 0, 10]):
            self.module.stop_processes((worker, web))
        self.assertEqual(worker.wait.call_args_list[0].kwargs["timeout"], 10)
        self.assertEqual(web.wait.call_args_list[0].kwargs["timeout"], 0)
        self.assertEqual([call.args for call in send.call_args_list], [
            (worker, signal.SIGTERM), (web, signal.SIGTERM),
            (worker, self.module.KILL_SIGNAL), (web, self.module.KILL_SIGNAL)])
