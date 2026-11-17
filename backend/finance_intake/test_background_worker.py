"""Queue orchestration tests: no storage, real jobs, database, or network."""
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .management.commands import process_background_jobs as worker


class BackgroundWorkerTests(SimpleTestCase):
    def run_worker(self, *, photos, imports, once=True, photo=None, claim=None, model=None, sleep=None):
        with override_settings(FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED=photos), \
                patch.dict(worker.os.environ, {"MODEL_IMPORT_WORKER": imports}), \
                patch("finance_intake.processing.process_next", side_effect=photo, return_value=False) as read_photo, \
                patch("model_imports.services.claim_job", side_effect=claim, return_value=None) as claim_model, \
                patch("model_imports.runner.process_job", side_effect=model) as convert_model, \
                patch.object(worker, "close_old_connections") as close_connections, \
                patch.object(worker.signal, "signal", return_value="previous-handler") as signals, \
                patch.object(worker.time, "sleep", side_effect=sleep) as sleeps, \
                patch("socket.socket.connect", side_effect=AssertionError("Orchestration must not contact external services")):
            worker.Command().handle(once=once)
        return read_photo, claim_model, convert_model, close_connections, signals, sleeps

    def test_disabled_queues_do_not_claim_or_run_jobs(self):
        photo, claim, model, close, signals, sleep = self.run_worker(photos=False, imports="0")
        photo.assert_not_called()
        claim.assert_not_called()
        model.assert_not_called()
        self.assertEqual(close.call_count, 2)
        sleep.assert_not_called()
        self.assertEqual(signals.call_args.args, (worker.signal.SIGTERM, "previous-handler"))

    def test_photo_only_flag_does_not_start_a_model_job(self):
        photo, claim, model, *_ = self.run_worker(photos=True, imports="0", photo=lambda: True)
        photo.assert_called_once_with()
        claim.assert_not_called()
        model.assert_not_called()

    def test_model_only_flag_does_not_read_photos(self):
        job = object()
        photo, claim, model, *_ = self.run_worker(photos=False, imports="1", claim=lambda: job)
        photo.assert_not_called()
        claim.assert_called_once_with()
        model.assert_called_once_with(job)

    def test_each_cycle_services_both_busy_queues_in_series(self):
        events = []
        job = object()

        def photo():
            events.extend(("photo-start", "photo-finish"))
            return True

        def claim():
            events.append("model-claim")
            return job

        def model(current):
            self.assertIs(current, job)
            events.extend(("model-start", "model-finish"))
            if events.count("model-finish") == 2:
                raise KeyboardInterrupt

        calls = self.run_worker(photos=True, imports="1", once=False, photo=photo, claim=claim, model=model)
        cycle = ["photo-start", "photo-finish", "model-claim", "model-start", "model-finish"]
        self.assertEqual(events, cycle * 2)
        calls[-1].assert_not_called()

    def test_idle_backoff_is_bounded_and_shutdown_restores_signal_handler(self):
        waits = []

        def pause(seconds):
            waits.append(seconds)
            if len(waits) == 8:
                raise KeyboardInterrupt

        _, _, _, close, signals, _ = self.run_worker(photos=True, imports="1", once=False, sleep=pause)
        self.assertEqual(waits, [5, 10, 15, 20, 25, 30, 30, 30])
        self.assertEqual(signals.call_args.args, (worker.signal.SIGTERM, "previous-handler"))
        self.assertEqual(close.call_count, 9)

    def test_unexpected_worker_failure_restores_handlers_for_supervisor_restart(self):
        with override_settings(FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED=True), \
                patch.dict(worker.os.environ, {"MODEL_IMPORT_WORKER": "0"}), \
                patch("finance_intake.processing.process_next", side_effect=RuntimeError("synthetic failure")), \
                patch.object(worker, "close_old_connections") as close, \
                patch.object(worker.signal, "signal", return_value="previous-handler") as signals:
            with self.assertRaisesMessage(RuntimeError, "synthetic failure"):
                worker.Command().handle(once=True)
        self.assertEqual(close.call_count, 2)
        self.assertEqual(signals.call_args.args, (worker.signal.SIGTERM, "previous-handler"))
