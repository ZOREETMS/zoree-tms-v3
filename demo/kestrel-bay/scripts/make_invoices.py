"""Generate carrier invoice PDFs from the Kestrel Bay data pack.
Three carriers, three different layouts — like real AP inboxes."""
import sys
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib import colors

OUT = sys.argv[1]
BILL_TO = ["Kestrel Bay Logistics", "Accounts Payable", "1200 Terminal Way", "Reno, NV 89502"]

INV = [
  # file, invoice#, carrier, shipment, inv date, pro, lines[(desc, amt)], total, origin, dest
  ("01_RF-88213.pdf", "RF-88213", "R", "KB-SH-40117", "2026-10-06", "RLF-7731042", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-02"),
  ("02_RF-88214.pdf", "RF-88214", "R", "KB-SH-40122", "2026-10-07", "RLF-7731088", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88), ("Liftgate - delivery", 85.00)], 595.88, "Reno, NV", "Phoenix, AZ", "2026-10-03"),
  ("03_RF-88219.pdf", "RF-88219", "R", "KB-SH-40126", "2026-10-09", "RLF-7731150", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-05"),
  ("04_BW-5521.pdf",  "BW-5521",  "B", "KB-SH-40130", "2026-10-08", "BWC-220415", [("Truckload linehaul", 1280.00), ("Fuel (22%)", 281.60)], 1561.60, "Ontario, CA", "Las Vegas, NV", "2026-10-03"),
  ("05_PE-0931.pdf",  "PE-0931",  "P", "KB-SH-40141", "2026-10-10", "PEX-55190", [("LTL freight charges", 236.00), ("Fuel surcharge", 56.64), ("Detention 2.0 hrs @ $75.00", 150.00)], 442.64, "Dallas, TX", "Houston, TX", "2026-10-06"),
  ("06_RF-88213_resent.pdf", "RF-88213", "R", "KB-SH-40117", "2026-10-20", "RLF-7731042", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-02"),
  ("07_BW-5527.pdf",  "BW-5527",  "B", "KB-SH-40999", "2026-10-12", "BWC-220511", [("Truckload linehaul", 1180.00), ("Fuel (22%)", 259.60)], 1439.60, "Ontario, CA", "Las Vegas, NV", "2026-10-08"),
  ("08_RF-88230.pdf", "RF-88230", "R", "KB-SH-40155", "2026-10-13", "RLF-7731299", [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 510.88, "Reno, NV", "Phoenix, AZ", "2026-10-07"),
]

def m(x): return f"${x:,.2f}"

def ridgeline(c, inv):
    _, num, _, shp, dt, pro, lines, total, o, d, sd = inv
    W, H = letter
    c.setFillColor(colors.HexColor("#0b3d2e")); c.rect(0, H-90, W, 90, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 22); c.drawString(40, H-50, "RIDGELINE FREIGHT")
    c.setFont("Helvetica", 9); c.drawString(40, H-68, "LTL Carrier  |  MC 448210  |  4100 Freeport Blvd, Sparks, NV 89431  |  billing@ridgelinefreight.example")
    c.setFillColor(colors.black); c.setFont("Helvetica-Bold", 16); c.drawRightString(W-40, H-125, "FREIGHT INVOICE")
    c.setFont("Helvetica", 10)
    y = H-150
    for k, v in [("Invoice No.", num), ("Invoice Date", dt), ("PRO No.", pro), ("Customer Ref (Shipment)", shp), ("Terms", "Net 30")]:
        c.drawRightString(W-150, y, k + ":"); c.drawString(W-145, y, v); y -= 15
    c.setFont("Helvetica-Bold", 10); c.drawString(40, H-150, "BILL TO")
    c.setFont("Helvetica", 10)
    for i, l in enumerate(BILL_TO): c.drawString(40, H-165-i*13, l)
    c.setFont("Helvetica-Bold", 10); c.drawString(40, H-240, "SHIPMENT")
    c.setFont("Helvetica", 10); c.drawString(40, H-255, f"Pickup {sd}   Origin: {o}   Destination: {d}   Service: LTL Standard")
    y = H-300
    c.setFillColor(colors.HexColor("#e8efe9")); c.rect(40, y-4, W-80, 18, fill=1, stroke=0); c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 10); c.drawString(48, y, "Description"); c.drawRightString(W-48, y, "Amount")
    c.setFont("Helvetica", 10); y -= 22
    for desc, amt in lines: c.drawString(48, y, desc); c.drawRightString(W-48, y, m(amt)); y -= 18
    c.line(W-200, y+6, W-40, y+6); y -= 10
    c.setFont("Helvetica-Bold", 12); c.drawString(W-200, y, "TOTAL DUE"); c.drawRightString(W-48, y, m(total))
    c.setFont("Helvetica", 8); c.drawString(40, 60, "Remit to: Ridgeline Freight, PO Box 2290, Sparks NV 89432. Late payments subject to 1.5% monthly fee.")

def bluewater(c, inv):
    _, num, _, shp, dt, pro, lines, total, o, d, sd = inv
    W, H = letter
    c.setFont("Helvetica-Bold", 18); c.setFillColor(colors.HexColor("#0a4c8b")); c.drawString(40, H-55, "Bluewater Carriers, Inc.")
    c.setFillColor(colors.black); c.setFont("Helvetica", 9)
    c.drawString(40, H-70, "Full Truckload Services • DOT 3021884 • 900 E. Francis St, Ontario, CA 91761")
    c.setStrokeColor(colors.HexColor("#0a4c8b")); c.setLineWidth(2); c.line(40, H-80, W-40, H-80); c.setLineWidth(1)
    c.setFont("Helvetica-Bold", 11); c.drawString(40, H-110, f"INVOICE # {num}")
    c.setFont("Helvetica", 10)
    c.drawString(40, H-128, f"Date issued: {dt}")
    c.drawString(40, H-142, f"Load / BOL: {pro}")
    c.drawString(40, H-156, f"Your reference: {shp}")
    c.drawString(330, H-110, "Customer:"); 
    for i, l in enumerate(BILL_TO): c.drawString(330, H-124-i*13, l)
    c.setStrokeColor(colors.grey); c.rect(40, H-235, W-80, 50, stroke=1, fill=0)
    c.drawString(50, H-205, f"Pick up: {o}  ({sd})"); c.drawString(50, H-222, f"Deliver: {d}")
    c.drawString(330, H-205, "Equipment: 53' dry van"); c.drawString(330, H-222, "Mode: FTL")
    y = H-275
    c.setFont("Helvetica-Bold", 10); c.drawString(50, y, "Charge"); c.drawString(300, y, "Basis"); c.drawRightString(W-50, y, "Total"); y -= 6
    c.line(40, y, W-40, y); y -= 16; c.setFont("Helvetica", 10)
    for desc, amt in lines:
        basis = "Flat" if "linehaul" in desc.lower() else "% of linehaul"
        c.drawString(50, y, desc); c.drawString(300, y, basis); c.drawRightString(W-50, y, m(amt)); y -= 18
    c.line(40, y+8, W-40, y+8)
    c.setFont("Helvetica-Bold", 11); c.drawString(300, y-10, "Amount due (USD)"); c.drawRightString(W-50, y-10, m(total))
    c.setFont("Helvetica-Oblique", 8); c.drawString(40, 60, "Please reference the invoice number on remittance. ACH details on file. Questions: ar@bluewatercarriers.example")

def pioneer(c, inv):
    _, num, _, shp, dt, pro, lines, total, o, d, sd = inv
    W, H = letter
    c.setFont("Courier-Bold", 14); c.drawString(40, H-50, "PIONEER EXPRESS LTL")
    c.setFont("Courier", 9); c.drawString(40, H-63, "2211 Irving Blvd Dallas TX 75207   AR: (214) 555-0190")
    c.setFont("Courier-Bold", 11); c.drawString(380, H-50, "STATEMENT OF CHARGES")
    c.setFont("Courier", 10)
    rows = [("INV#", num), ("DATE", dt), ("PRO", pro), ("SHIPPER REF", shp), ("BILL TO", BILL_TO[0])]
    y = H-95
    for k, v in rows: c.drawString(40, y, f"{k:<14}{v}"); y -= 14
    c.drawString(40, y-6, f"{'FROM':<14}{o}"); c.drawString(40, y-20, f"{'TO':<14}{d}"); c.drawString(40, y-34, f"{'SHIP DATE':<14}{sd}")
    y -= 70
    c.drawString(40, y, "-"*78); y -= 14
    c.drawString(40, y, f"{'CODE':<8}{'DESCRIPTION':<42}{'CHARGE':>14}"); y -= 12
    c.drawString(40, y, "-"*78); y -= 14
    codes = ["400", "FSC", "DET"]
    for (desc, amt), code in zip(lines, codes):
        c.drawString(40, y, f"{code:<8}{desc:<42}{m(amt):>14}"); y -= 14
    c.drawString(40, y, "-"*78); y -= 16
    c.setFont("Courier-Bold", 11); c.drawString(40, y, f"{'':<8}{'TOTAL':<42}{m(total):>14}")
    c.setFont("Courier", 8); c.drawString(40, 60, "DETENTION BILLED PER TARIFF PEX-100 ITEM 340. QUESTIONS: AR@PIONEEREXPRESS.EXAMPLE")

for inv in INV:
    c = canvas.Canvas(f"{OUT}/{inv[0]}", pagesize=letter)
    c.setTitle(f"Invoice {inv[1]}")
    {"R": ridgeline, "B": bluewater, "P": pioneer}[inv[2]](c, inv)
    c.showPage(); c.save()
print("ok")
