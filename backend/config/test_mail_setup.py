import importlib.util
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase


class MailSetupTests(SimpleTestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[2] / 'scripts' / 'configure-mail.py'
        spec = importlib.util.spec_from_file_location('configure_mail', source)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.module.ENV_FILE = Path(self.directory.name) / '.env'
        self.original = 'DJANGO_ENV=development\nCUSTOM=preserve-me\nEMAIL_HOST=old\n'
        self.module.ENV_FILE.write_text(self.original, encoding='utf-8')

    def configure(self, smtp):
        captured = StringIO()
        with redirect_stdout(captured), patch('builtins.input', return_value='sender@gmail.com'), \
             patch('getpass.getpass', return_value='abcd efgh ijkl mnop'), \
             patch('smtplib.SMTP', smtp):
            result = self.module.main()
        self.assertNotIn('abcdefghijklmnop', captured.getvalue())
        self.assertNotIn('abcd efgh ijkl mnop', captured.getvalue())
        return result

    def test_failed_transport_keeps_previous_configuration_and_hides_error_details(self):
        smtp = MagicMock(side_effect=OSError('Synthetic transport failure'))
        self.assertEqual(self.configure(smtp), 1)
        self.assertEqual(self.module.ENV_FILE.read_text(encoding='utf-8'), self.original)

    def test_configures_only_after_verified_tls_login_without_sending_mail(self):
        smtp = MagicMock()
        self.assertEqual(self.configure(smtp), 0)
        client = smtp.return_value.__enter__.return_value
        client.starttls.assert_called_once()
        self.assertTrue(client.starttls.call_args.kwargs['context'].check_hostname)
        client.login.assert_called_once_with('sender@gmail.com', 'abcdefghijklmnop')
        client.sendmail.assert_not_called()
        client.send_message.assert_not_called()
        saved = self.module.ENV_FILE.read_text(encoding='utf-8')
        self.assertIn('CUSTOM=preserve-me', saved)
        self.assertIn('SECURITY_EMAIL_ENABLED=1', saved)
        self.assertIn('EMAIL_BACKEND=security.smtp_backend.EmailBackend', saved)
        self.assertEqual(saved.count('EMAIL_HOST='), 1)
        self.assertEqual(list(Path(self.directory.name).iterdir()), [self.module.ENV_FILE])

    def test_no_echo_fallback_when_terminal_cannot_hide_credentials(self):
        with redirect_stdout(StringIO()), patch('builtins.input', return_value='sender@gmail.com'), \
             patch('getpass.getpass', side_effect=self.module.getpass.GetPassWarning), \
             patch('smtplib.SMTP') as smtp:
            self.assertEqual(self.module.main(), 1)
        smtp.assert_not_called()
        self.assertEqual(self.module.ENV_FILE.read_text(encoding='utf-8'), self.original)
