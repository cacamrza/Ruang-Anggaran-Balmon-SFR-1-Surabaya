import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from docx import Document

import streamlit_app


class StreamlitAppTests(unittest.TestCase):
    def test_to_number_handles_indonesian_and_plain_amounts(self):
        self.assertEqual(streamlit_app.to_number("Rp 1.234.567"), 1234567)
        self.assertEqual(streamlit_app.to_number("1,234,567"), 1234567)
        self.assertEqual(streamlit_app.to_number("1234,5"), 1234.5)
        self.assertIsNone(streamlit_app.to_number("—"))

    def test_compact_rupiah_uses_short_indonesian_units(self):
        self.assertEqual(streamlit_app.format_compact_rupiah(17_100_000_000), "17,1 M")
        self.assertEqual(streamlit_app.format_compact_rupiah(1_260_000), "1,3 jt")

    def test_account_can_log_in_after_a_new_database_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / ".data" / "accounts.sqlite3"
            with patch.object(streamlit_app, "ACCOUNT_DB_PATH", database_path):
                salt, digest = streamlit_app.hash_password("password123")
                self.assertTrue(streamlit_app.create_account("staff@example.com", salt, digest))

                account = streamlit_app.get_account("staff@example.com")
                self.assertIsNotNone(account)
                self.assertTrue(streamlit_app.password_matches("password123", account["salt"], account["digest"]))
                self.assertFalse(streamlit_app.password_matches("wrong-password", account["salt"], account["digest"]))
                self.assertFalse(streamlit_app.create_account("staff@example.com", salt, digest))

    def test_signup_is_limited_to_configured_office_network_ranges(self):
        allowed, _ = streamlit_app.signup_network_status(
            "10.20.30.45",
            "10.20.30.0/24,198.51.100.7/32",
        )
        self.assertTrue(allowed)

        guest_allowed, message = streamlit_app.signup_network_status(
            "10.20.31.45",
            "10.20.30.0/24",
        )
        self.assertFalse(guest_allowed)
        self.assertIn("Wi-Fi tamu", message)

        unconfigured, message = streamlit_app.signup_network_status("10.20.30.45", "")
        self.assertFalse(unconfigured)
        self.assertIn("SIGNUP_ALLOWED_CIDRS", message)

    def test_signup_uses_streamlit_secret_when_environment_is_unset(self):
        fake_streamlit = SimpleNamespace(
            context=SimpleNamespace(ip_address="198.51.100.7"),
            secrets={"SIGNUP_ALLOWED_CIDRS": "198.51.100.0/24"},
        )
        with patch.dict(os.environ):
            os.environ.pop("SIGNUP_ALLOWED_CIDRS", None)
            with patch.object(streamlit_app, "st", fake_streamlit):
                self.assertEqual(streamlit_app.get_signup_network_status(), (True, ""))

    def test_signup_environment_setting_overrides_streamlit_secret(self):
        fake_streamlit = SimpleNamespace(
            context=SimpleNamespace(ip_address="198.51.100.7"),
            secrets={"SIGNUP_ALLOWED_CIDRS": "10.20.30.0/24"},
        )
        with patch.dict(os.environ, {"SIGNUP_ALLOWED_CIDRS": "198.51.100.0/24"}):
            with patch.object(streamlit_app, "st", fake_streamlit):
                self.assertEqual(streamlit_app.get_signup_network_status(), (True, ""))

    def test_signup_denies_access_when_visitor_ip_is_unavailable(self):
        fake_streamlit = SimpleNamespace(context=SimpleNamespace(ip_address=None))
        with patch.dict(os.environ, {"SIGNUP_ALLOWED_CIDRS": "192.168.100.0/24"}):
            with patch.object(streamlit_app, "st", fake_streamlit):
                allowed, message = streamlit_app.get_signup_network_status()

        self.assertFalse(allowed)
        self.assertIn("Alamat IP pengunjung", message)

    def test_revision_compares_remaining_to_increase(self):
        rows = [
            ["", "Semula", None, None, "Menjadi", None, None, None, None],
            [None, "Kode Anggaran", "Uraian", "Jumlah", "Kode Anggaran", "Uraian", "Jumlah", "Selisih", "Sisa Anggaran"],
            [None, None, "Perjalanan", 100, None, "Perjalanan", 120, 20, 15],
            [None, None, "Peralatan", 100, None, "Peralatan", 110, 10, 25],
        ]
        revision = streamlit_app.find_revision(rows)
        self.assertEqual(revision["increase_total"], 30)
        self.assertEqual(revision["insufficient_count"], 1)
        self.assertEqual(revision["sufficient_count"], 1)
        self.assertEqual(revision["shortfall"], 5)

    def test_dashboard_analysis_prepares_rows_and_categories(self):
        rows = [
            ["Kode Anggaran", "Uraian", "Pagu", "Sisa Anggaran"],
            ["051", "Monitoring", 100000, 20000],
            ["052", "Pengawasan", 80000, 10000],
            ["", "Baris tidak bernilai", None, None],
        ]
        analysis = streamlit_app.analyze_rows(rows, "RAB")
        self.assertTrue(analysis["header_found"])
        self.assertEqual(len(analysis["rows"]), 2)
        self.assertEqual(len(analysis["categories"]), 2)
        self.assertEqual(analysis["category_total"], 180000)

    def test_sp2d_pdf_text_parser_reads_category_and_wrapped_detail_rows(self):
        pages = ["""
LAPORAN REALISASI SP2D TA 2026
                       Uraian                    Pagu Revisi Lock Pagu
     100 Kegiatan pertama                     1,000,000 0 500,000 0 500,000 50.00 % 500,000
       101 Kegiatan kedua                      2,000,000 0 1,000,000 0 1,000,000 50.00 % 1,000,000
              000001. Rincian kegiatan yang
                                          100,000 0 50,000 0 50,000 50.00 % 50,000
                 keterangannya terbungkus
"""]

        rows = streamlit_app.parse_sp2d_text(pages)

        self.assertEqual(rows[0], ["Kode Anggaran", "Uraian", "Pagu", "Sisa Anggaran"])
        self.assertEqual(rows[1], ["100", "Kegiatan pertama", 1000000, 500000])
        self.assertEqual(rows[2], ["101", "Kegiatan kedua", 2000000, 1000000])
        self.assertEqual(rows[3], ["000001", "Rincian kegiatan yang keterangannya terbungkus", 100000, 50000])
        self.assertIsNone(streamlit_app.parse_sp2d_text(["PDF laporan lain"]))

    def test_budget_pdf_parsers_combine_ro_budget_and_financial_values(self):
        workplan = streamlit_app.parse_rincian_kertas_text(["""
RINCIAN KERTAS KERJA SATKER T.A. 2026
ALOKASI Rp. 1,500,000
7437.BAH.078 Layanan Dukungan RO 1.0 layanan 1,500,000
- Rincian terblokir 100,000 100,000 *
"""])
        financial = streamlit_app.parse_fa_text(["""
LAPORAN REALISASI SP2D TA 2026
JUMLAH SELURUHNYA 1,000,000 0 400,000 0 400,000 40.00 % 600,000
BAH.078 Layanan Dukungan RO 1,000,000 0 400,000 0 400,000 40.00 % 600,000
"""])

        rows = streamlit_app.combine_budget_documents([
            ("Rincian Kertas Kerja", workplan),
            ("Laporan FA Detail", financial),
        ])
        analysis = streamlit_app.analyze_rows(rows, "Perbandingan Anggaran RO")

        self.assertEqual(analysis["budget_comparison"]["pagu_penuh"], 1500000)
        self.assertEqual(analysis["budget_comparison"]["pagu_efektif"], 1000000)
        self.assertEqual(analysis["budget_comparison"]["realisasi"], 400000)
        self.assertEqual(analysis["budget_comparison"]["sisa"], 600000)
        self.assertEqual(analysis["budget_comparison"]["pagu_terblokir"], 100000)
        ro = analysis["rows"][0]
        self.assertEqual(ro["Kode"], "7437.BAH.078")
        self.assertEqual(ro["Status Pasangan"], "Cocok berdasarkan kode RO")
        sections = streamlit_app.build_tor_sections(
            ro["Uraian"], "Surabaya", "2026", "", analysis, selected_row=ro,
        )
        financing = next(body for title, body in sections if title == "VII. Pembiayaan")
        self.assertIn("Kode RO: 7437.BAH.078", financing)
        self.assertIn("Pagu penuh: Rp 1.500.000", financing)
        self.assertIn("Pagu terblokir: Rp 100.000", financing)

    def test_tor_download_is_a_valid_word_document(self):
        analysis = {
            "sheet": "RAB Rev 9",
            "rows": [{
                "Uraian": "Monitoring",
                "Pagu": 100000,
                "Sisa anggaran": 20000,
                "Baris": 2,
                "Kode": "051",
            }],
        }
        sections = streamlit_app.build_tor_sections(
            "Monitoring", "Surabaya", "2026", "", analysis,
        )
        content = streamlit_app.make_tor_docx(
            "Monitoring",
            "Surabaya",
            "2026",
            analysis["sheet"],
            sections,
            ro_code="7437.BAH.078",
            budget_data={
                "Pagu Penuh": 150000,
                "Pagu Efektif": 140000,
                "Pagu Terblokir": 10000,
                "Realisasi": 80000,
                "Sisa anggaran": 60000,
            },
        )
        document = Document(io.BytesIO(content))
        self.assertEqual(document.paragraphs[0].text, "TOR (TERM OF REFERENCE)")
        self.assertIn("VII. Pembiayaan", [paragraph.text for paragraph in document.paragraphs])
        table_text = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
        self.assertIn("Sumber Data", table_text)
        self.assertIn("RAB Rev 9", table_text)
        self.assertTrue(any(
            "7437.BAH.078" in cell
            for cell in table_text
        ))
        self.assertTrue(any(
            "Pagu Efektif" in cell
            for cell in table_text
        ))
        self.assertTrue(any(
            "Rp 140.000" in cell
            for cell in table_text
        ))
        self.assertIn("TOR ini menjadi acuan pelaksanaan Monitoring pada tahun 2026, berdasarkan data pada sheet RAB Rev 9.", sections[0][1])
        self.assertLess(max(len(body) for _, body in sections), 180)
        body = next(paragraph for paragraph in document.paragraphs if paragraph.text.startswith("TOR ini menjadi"))
        self.assertEqual(body.alignment, 3)
        self.assertEqual(body.paragraph_format.line_spacing, 1.5)
        self.assertEqual(body.runs[0].font.name, "Times New Roman")


if __name__ == "__main__":
    unittest.main()
