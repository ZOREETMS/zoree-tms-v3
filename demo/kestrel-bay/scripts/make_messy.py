"""Two deliberately messy invoices for the Kestrel Bay demo (rows 'like' the data pack):
 09 — Pioneer invoice that arrived as a crooked, noisy phone scan (image-only PDF). Contents are clean.
 10 — Ridgeline invoice whose printed total does not match its lines (carrier typo)."""
import sys, random, importlib.util
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from pdf2image import convert_from_path
from PIL import Image, ImageFilter, ImageDraw, ImageEnhance

OUT = sys.argv[1]
spec = importlib.util.spec_from_file_location("mk", sys.argv[2]); mk = importlib.util.module_from_spec(spec)
sys.argv = [sys.argv[0], "/tmp"]; spec.loader.exec_module(mk)  # reuse layouts (writes originals to /tmp, ignored)

# 09: scanned Pioneer invoice
inv09 = ("09_PE-0944_scan.pdf", "PE-0944", "P", "KB-SH-40160", "2026-10-14", "PEX-55231",
         [("LTL freight charges", 236.00), ("Fuel surcharge", 56.64)], 292.64, "Dallas, TX", "Houston, TX", "2026-10-09")
c = canvas.Canvas("/tmp/clean09.pdf", pagesize=letter); mk.pioneer(c, inv09); c.showPage(); c.save()
img = convert_from_path("/tmp/clean09.pdf", dpi=110)[0].convert("L")
img = img.rotate(-2.2, expand=True, fillcolor=235)
random.seed(7)
px = img.load()
for _ in range(9000):
    x, y = random.randrange(img.width), random.randrange(img.height); px[x, y] = random.choice([170, 200, 120])
img = img.filter(ImageFilter.GaussianBlur(0.6))
img = ImageEnhance.Contrast(img).enhance(0.85)
rgb = Image.merge("RGB", (img, img, img))
d = ImageDraw.Draw(rgb, "RGBA")
d.ellipse((620, 820, 820, 1010), outline=(150, 105, 60, 90), width=14)   # coffee ring
d.polygon([(0, 0), (90, 0), (0, 70)], fill=(60, 60, 60, 255))           # folded corner shadow
rgb.save(f"{OUT}/09_PE-0944_scan.pdf", "PDF", resolution=110)

# 10: total does not match the lines
inv10 = ("10_RF-88241.pdf", "RF-88241", "R", "KB-SH-40163", "2026-10-15", "RLF-7731402",
         [("Linehaul LTL", 412.00), ("Fuel surcharge 24%", 98.88)], 519.88, "Reno, NV", "Phoenix, AZ", "2026-10-10")
c = canvas.Canvas(f"{OUT}/10_RF-88241.pdf", pagesize=letter); mk.ridgeline(c, inv10); c.showPage(); c.save()
print("ok")
