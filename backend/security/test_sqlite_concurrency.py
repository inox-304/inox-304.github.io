"""Exercise the real throttle against two connections to a disposable SQLite file.

The usual in-memory test database doesn't reproduce SQLite's file locking. Each
worker temporarily routes its own thread-local default connection to this file;
no settings, existing connection, installation database, or environment is edited.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.db import OperationalError, connections
from django.db.backends.sqlite3.base import DatabaseWrapper
from django.test import SimpleTestCase

from security.models import LoginThrottle
from security.services import reserve_attempt


@skipUnless(settings.DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3",
            "This regression covers the local SQLite installation.")
class SQLiteThrottleConcurrencyTests(SimpleTestCase):
    scope = "sqlite-regression"
    identity = "synthetic-account@example.invalid"

    def setUp(self):
        self.scratch = TemporaryDirectory(prefix="inox-sqlite-throttle-")
        self.addCleanup(self.scratch.cleanup)
        self.database_path = Path(self.scratch.name) / "throttle-only.sqlite3"
        self.key = hashlib.sha256(f"{self.scope}:{self.identity}".encode()).hexdigest()
        with self.scratch_connection("DEFERRED") as connection:
            with connection.schema_editor() as schema:
                schema.create_model(LoginThrottle)
            LoginThrottle.objects.create(key=self.key)

    @contextmanager
    def scratch_connection(self, mode):
        config = deepcopy(settings.DATABASES["default"])
        config.update(NAME=str(self.database_path), CONN_MAX_AGE=0, AUTOCOMMIT=True)
        config["OPTIONS"] = {"timeout": 3, "transaction_mode": mode}
        # The unique alias is intentionally absent from settings.DATABASES. The
        # wrapper and file exist only in this test; the ORM still uses "default".
        connection = DatabaseWrapper(config, alias=f"sqlite-regression-{uuid4().hex}")
        previous = connections["default"]
        connections["default"] = connection
        connections[connection.alias] = connection
        try:
            yield connection
        finally:
            try:
                connection.close()
            finally:
                connections["default"] = previous
                del connections[connection.alias]

    def wait_for(self, event):
        self.assertTrue(event.wait(timeout=5), "The competing SQLite transaction did not reach its expected stage.")

    def result_row(self):
        with self.scratch_connection("IMMEDIATE"):
            row = LoginThrottle.objects.get(key=self.key)
            return row.attempts, row.locked_until

    def test_deferred_read_upgrade_reproduces_database_locked_in_real_throttle(self):
        reader_started = Event()
        writer_updated = Event()
        reader_finished = Event()

        def reader_hook(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.startswith("SELECT") and "security_loginthrottle" in sql and not reader_started.is_set():
                reader_started.set()
                self.wait_for(writer_updated)
            return result

        def writer_hook(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.startswith("UPDATE") and "security_loginthrottle" in sql:
                writer_updated.set()
                # Keep the writer's RESERVED lock until the reader has tried to
                # upgrade its SHARED lock. DEFERRED fails rather than waiting.
                self.wait_for(reader_finished)
            return result

        def reader():
            try:
                with self.scratch_connection("DEFERRED") as connection:
                    with connection.execute_wrapper(reader_hook):
                        return reserve_attempt(self.scope, self.identity, limit=1)
            except OperationalError as error:
                return str(error)
            finally:
                reader_finished.set()

        def writer():
            self.wait_for(reader_started)
            with self.scratch_connection("DEFERRED") as connection:
                with connection.execute_wrapper(writer_hook):
                    return reserve_attempt(self.scope, self.identity, limit=1)

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(reader)
            second = executor.submit(writer)
            self.assertEqual(first.result(timeout=10), "database is locked")
            self.assertTrue(second.result(timeout=10))
        self.assertEqual(self.result_row(), (1, None))

    def test_configured_immediate_serializes_real_throttle_and_preserves_rate_limit(self):
        mode = settings.DATABASES["default"].get("OPTIONS", {}).get("transaction_mode")
        self.assertEqual(mode, "IMMEDIATE", "Local SQLite must reserve the writer before reading inside atomic().")
        reader_started = Event()
        contender_entering = Event()

        def first_hook(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.startswith("SELECT") and "security_loginthrottle" in sql and not reader_started.is_set():
                reader_started.set()
                self.wait_for(contender_entering)
            return result

        def contender_hook(execute, sql, params, many, context):
            if sql == "BEGIN IMMEDIATE":
                contender_entering.set()
            return execute(sql, params, many, context)

        def first():
            with self.scratch_connection(mode) as connection:
                with connection.execute_wrapper(first_hook):
                    return reserve_attempt(self.scope, self.identity, limit=1)

        def contender():
            self.wait_for(reader_started)
            with self.scratch_connection(mode) as connection:
                with connection.execute_wrapper(contender_hook):
                    return reserve_attempt(self.scope, self.identity, limit=1)

        with ThreadPoolExecutor(max_workers=2) as executor:
            admitted = executor.submit(first)
            denied = executor.submit(contender)
            self.assertTrue(admitted.result(timeout=10))
            self.assertFalse(denied.result(timeout=10))
        attempts, locked_until = self.result_row()
        self.assertEqual(attempts, 2)
        self.assertIsNotNone(locked_until)
