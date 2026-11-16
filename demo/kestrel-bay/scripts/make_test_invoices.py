"""Sridhar's own policy test invoices — NOT part of the Kestrel Bay data pack.
Same three carrier layouts as make_invoices.py; every file name starts with TEST_.
Usage: python3 make_test_invoices.py <out_dir>"""
import sys, pathlib
src = (pathlib.Path(__file__).parent / "make_invoices.py").read_text()
ns = {"__name__": "gen"}
sys_argv = sys.argv
exec(src.split("for inv in INV:")[0], ns)  # layouts only
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = sys_argv[1]
TESTS = [
  # T1 clean, but over the $2,500 auto-approve limit
  ("TEST_T1_BW-T9001_over_limit.pdf", "BW-T9001", "B", "KB-SH-T9001", "2026-10-21", "BWC-T9001", [("Truckload linehaul", 2049.19), ("Fuel (22%)", 450.82)], 2500.01, "Ontario, CA", "Las Vegas, NV", "2026-10-17"),
  # T2 carrier's corrected copy of BW-5521 after AP disputed it (now matches contract)
  ("TEST_T2_BW-5521_corrected_after_dispute.pdf", "BW-5521", "B", "KB-SH-40130", "2026-10-22", "BWC-220415", [("Truckload linehaul", 1180.00), ("Fuel (22%)", 259.60)], 1439.60, "Ontario, CA", "Las Vegas, NV", "2026-10-03"),
  # T3 shipment reference smudged / unreadable
  ("TEST_T3_RF-T9003_unreadable_ref.pdf", "RF-T9003", "R", "KB-SH-4?1#?", "2026-10-21", "RLF-T9003", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-16"),
  # T4 RF-88213 sent again in a later batch, after it was released and exported
  ("TEST_T4_RF-88213_resent_after_export.pdf", "RF-88213", "R", "KB-SH-40117", "2026-11-02", "RLF-7731042", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-02"),
  # T5 clean when read; its shipment is cancelled before release
  ("TEST_T5_RF-T9005_cancel_before_release.pdf", "RF-T9005", "R", "KB-SH-T9005", "2026-10-21", "RLF-T9005", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-16"),
  # T6 shipment has no contract rate in the TMS
  ("TEST_T6_PE-T9006_no_contract_rate.pdf", "PE-T9006", "P", "KB-SH-T9006", "2026-10-21", "PEX-T9006", [("LTL freight charges", 236.00), ("Fuel surcharge", 56.64)], 292.64, "Dallas, TX", "Houston, TX", "2026-10-16"),
]
for inv in TESTS:
    c = canvas.Canvas(f"{OUT}/{inv[0]}", pagesize=letter)
    c.setTitle(f"Invoice {inv[1]}")
    {"R": ns["ridgeline"], "B": ns["bluewater"], "P": ns["pioneer"]}[inv[2]](c, inv)
    c.showPage(); c.save()
print("ok", len(TESTS))
