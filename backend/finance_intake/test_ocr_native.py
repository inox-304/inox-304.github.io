"""Exercise the installed engine with a generated receipt, never real records."""
from datetime import date
from io import BytesIO
import os
from pathlib import Path
import shutil
from unittest import skipUnless
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from PIL import Image, ImageDraw, ImageFont

from .extraction import extract_fields
from .ocr import read_image


FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
NATIVE_AVAILABLE = bool(shutil.which("tesseract", path=os.defpath)) and FONT.is_file()


@skipUnless(NATIVE_AVAILABLE, "Requires local Tesseract spa+eng and the CI DejaVuSans font")
@override_settings(FINANCE_WHATSAPP_TESSERACT_COMMAND="tesseract")
class NativeTesseractTests(SimpleTestCase):
    def test_generated_receipt_runs_through_local_engine_and_conservative_parser(self):
        image = Image.new("RGB", (1100, 600), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(str(FONT), 54)
        for index, line in enumerate(("COMPROBANTE DE PRUEBA", "TOTAL S/ 118.00", "Fecha: 2026-11-17", "Operacion: 12345678")):
            draw.text((45, 45 + 110 * index), line, font=font, fill="black")
        encoded = BytesIO()
        image.save(encoded, format="PNG")
        with patch("socket.socket.connect", side_effect=AssertionError("OCR must not use a network API")):
            result = read_image(encoded.getvalue(), "image/png")
        fields = extract_fields(result["text"], "Empresa: INOX304; Tipo: egreso", today=date(2026, 11, 17))
        self.assertEqual(result["engine"], "tesseract")
        self.assertGreater(result["confidence"], 0.5)
        self.assertLessEqual(result["confidence"], 1)
        self.assertEqual(fields["amount"], "118.00")
        self.assertEqual(fields["currency"], "PEN")
        self.assertEqual(fields["date"], "2026-11-17")
        self.assertEqual(fields["reference"], "12345678")
        self.assertEqual(fields["conflicts"], [])
