"""Keep OCR core compression in the build stage, within small server budgets."""
from pathlib import PurePosixPath

from whitenoise.compress import Compressor
from whitenoise.storage import CompressedManifestStaticFilesStorage


class InoxStaticCompressor(Compressor):
    def should_compress(self, filename):
        path = str(filename).replace("\\", "/")
        name = PurePosixPath(path).name
        # Both original and manifest-hashed copies contain '.wasm.'. The OCR
        # worker uses the original filename; its reproducible gzip sibling is
        # supplied by prepare-receipt-ocr.mjs. Brotli-compressing these large
        # embedded-WASM bundles concurrently exceeds small hosting budgets.
        if (
            "inox/ocr-vendor/" in path
            and name.startswith("tesseract-core")
            and ".wasm." in name
            and name.endswith(".js")
        ):
            return False
        return super().should_compress(filename)


class InoxStaticFilesStorage(CompressedManifestStaticFilesStorage):
    def create_compressor(self, **kwargs):
        return InoxStaticCompressor(**kwargs)
