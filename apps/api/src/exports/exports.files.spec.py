import io
from pathlib import Path
import sys
import unittest
import warnings
import zipfile

from openpyxl import load_workbook
from pypdf import PdfReader

if len(sys.argv) < 2:
    raise SystemExit("Usage: python exports.files.spec.py <fixture-dir>")
FIXTURES = Path(sys.argv[1]).resolve()


def body_lines(filename):
    reader = PdfReader(FIXTURES / filename, strict=True)
    lines = []
    for page_index, page in enumerate(reader.pages):
        def visit(text, cm, tm, font, size):
            if size == 7.5 and text.strip():
                lines.append((text.strip(), tm[4], tm[5], page_index))
        page.extract_text(visitor_text=visit)
    return reader, lines


class IndependentFileCompatibility(unittest.TestCase):
    def test_xlsx_external_workbook_reader(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error", UserWarning)
            workbook = load_workbook(FIXTURES / "warehouse.xlsx", data_only=False)
        self.assertEqual(workbook.sheetnames, ["Data", "Metadata"])
        self.assertEqual(list(workbook["Data"].values), [
            ("Họ và tên", "Giá trị", "Ghi chú"),
            ("Nguyễn Văn Đạt", "9007199254740993", "'=1+1"),
            ("Trần Thị Mỹ Duyên", 42, 'A & B <C> "D"'),
        ])
        self.assertEqual(workbook["Data"]["C2"].data_type, "s")
        metadata = dict(list(workbook["Metadata"].values)[1:])
        self.assertEqual(metadata["Format"], "xlsx")
        self.assertEqual(metadata["Total Records"], "2")
        self.assertEqual(len(metadata["Data Payload Checksum (SHA-256)"]), 64)
        self.assertEqual(metadata["Export ID"], "11111111-1111-4111-8111-111111111111")

    def test_xlsx_external_reader_rejects_legacy_xml(self):
        with self.assertRaises(zipfile.BadZipFile):
            load_workbook(io.BytesIO(b'<?xml version="1.0"?><Workbook></Workbook>'))

    def test_xlsx_external_reader_rejects_missing_workbook(self):
        incomplete = io.BytesIO()
        with zipfile.ZipFile(FIXTURES / "warehouse.xlsx") as source:
            with zipfile.ZipFile(incomplete, "w") as target:
                for name in source.namelist():
                    if name != "xl/workbook.xml":
                        target.writestr(name, source.read(name))
        with self.assertRaises(KeyError):
            load_workbook(io.BytesIO(incomplete.getvalue()))

    def test_pdf_vietnamese_text_and_embedded_fonts(self):
        reader = PdfReader(FIXTURES / "vietnamese.pdf", strict=True)
        text = "\n".join(page.extract_text() for page in reader.pages)
        for expected in [
            "SHIP DỄ — BÁO CÁO XUẤT DỮ LIỆU", "Họ và tên", "Tỉnh/Thành phố",
            "Nguyễn Văn Đạt", "Trần Thị Mỹ Duyên", "TP. Hồ Chí Minh",
            "Đơn hàng vận chuyển nhanh", "Kiểm tra đối soát thành công",
        ]:
            self.assertIn(expected, text)
        self.assertNotIn("\ufffd", text)
        for font_name in ["/F1", "/F2"]:
            font = reader.pages[0]["/Resources"]["/Font"][font_name]
            cid_font = font["/DescendantFonts"][0].get_object()
            program = cid_font["/FontDescriptor"]["/FontFile2"].get_data()
            self.assertGreater(len(program), 1000)
            self.assertEqual(program[:4], b"\x00\x01\x00\x00")
            self.assertIn("/ToUnicode", font)

    def test_pdf_preserves_all_80_unique_lines_inside_the_page(self):
        reader, lines = body_lines("long-row.pdf")
        self.assertGreater(len(reader.pages), 1)
        expected = [f"Dòng {i:03d} Nguyễn Văn Đạt" for i in range(80)]
        self.assertEqual([line[0] for line in lines], expected)
        for text, x, y, page in lines:
            self.assertGreaterEqual(y, 45, (text, page))
            self.assertLess(y, float(reader.pages[page].mediabox.top))
            self.assertGreaterEqual(x, 30)

    def test_pdf_preserves_wide_unbroken_cell_without_clipping(self):
        reader, lines = body_lines("wide-row.pdf")
        self.assertGreater(len(reader.pages), 1)
        self.assertEqual("".join(line[0] for line in lines), "M" * 12000)
        for text, x, y, page in lines:
            self.assertGreaterEqual(y, 45, (len(text), page))

    def test_reviewed_pdf_exhibits_the_off_page_regression(self):
        _, lines = body_lines("legacy-wide-row.pdf")
        self.assertTrue(any(y < 45 for _, _, y, _ in lines),
                        "The reviewed generator must fail the new page-boundary assertion")


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
