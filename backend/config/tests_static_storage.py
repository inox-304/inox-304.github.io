from django.test import SimpleTestCase
from whitenoise.compress import Compressor

from .static_storage import InoxStaticCompressor


class StaticCompressionTests(SimpleTestCase):
    def test_large_ocr_cores_use_build_time_gzip_for_plain_and_hashed_names(self):
        compressor = InoxStaticCompressor(quiet=True)
        for path in (
            'inox/ocr-vendor/v7/core/tesseract-core.wasm.js',
            'inox/ocr-vendor/v7/core/tesseract-core-lstm.wasm.a3c227d2e04b.js',
            r'C:\static\inox\ocr-vendor\v7\core\tesseract-core-simd-lstm.wasm.js',
        ):
            with self.subTest(path=path):
                self.assertFalse(compressor.should_compress(path))

    def test_other_static_assets_retain_standard_compression_rules(self):
        compressor = InoxStaticCompressor(quiet=True)
        standard = Compressor(quiet=True)
        for path in (
            'inox/finance.js', 'inox/finance.0123456789ab.js', 'inox/finance.css',
            'inox/logo.png', 'inox/video.mp4', 'inox/ocr-vendor/v7/worker.min.js',
            'inox/ocr-vendor/v7/lang/spa.traineddata.gz',
            'other/tesseract-core.wasm.js',
        ):
            with self.subTest(path=path):
                self.assertEqual(compressor.should_compress(path), standard.should_compress(path))
