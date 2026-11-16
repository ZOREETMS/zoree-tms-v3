# Regenerates frontend/public/demo/pod-sample.png (the AI Agents demo POD photo) with today's dates.
# Usage: python3 scripts/demo/make_pod_image.py frontend/public/demo/pod-sample.png   (needs Pillow)
import sys, datetime, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
F = '/usr/share/fonts/truetype/dejavu/'
def font(name, size):
    for n in [name, 'DejaVuSans.ttf']:
        try: return ImageFont.truetype(F + n, size)
        except OSError: pass
    return ImageFont.load_default()
W, H = 1240, 1600
paper = Image.new('RGB', (W, H), (252, 251, 246))
d = ImageDraw.Draw(paper)
ink = (25, 25, 30); blue = (28, 52, 140); gray = (110, 110, 110)
bold = font('DejaVuSans-Bold.ttf', 34); reg = font('DejaVuSans.ttf', 22); small = font('DejaVuSans.ttf', 18)
hand = font('DejaVuSerif-Italic.ttf', 30); handb = font('DejaVuSerif-BoldItalic.ttf', 34)
d.rectangle([40, 40, W-40, H-40], outline=ink, width=3)
d.text((70, 70), 'SWIFT TRANSPORTATION', font=bold, fill=ink)
d.text((70, 118), 'DELIVERY RECEIPT / PROOF OF DELIVERY', font=reg, fill=ink)
d.text((W-420, 70), 'PRO: PRO-DEMO-77120', font=font('DejaVuSansMono-Bold.ttf', 28), fill=ink)
d.text((W-420, 112), 'BOL: BOL-SHP-DEMO-POD1', font=font('DejaVuSansMono.ttf', 24), fill=ink)
d.line([60, 170, W-60, 170], fill=ink, width=2)
def box(x, y, w, h, label, value=None, vfont=None, vcolor=ink):
    d.rectangle([x, y, x+w, y+h], outline=ink, width=2)
    d.text((x+10, y+6), label, font=small, fill=gray)
    if value: d.text((x+14, y+34), value, font=vfont or reg, fill=vcolor)
box(60, 190, 540, 150, 'SHIPPER', 'Gulf Coast Appliance DC\n8100 Clinton Dr, Houston TX 77029')
box(640, 190, 540, 150, 'CONSIGNEE', 'Austin Home Supply\n4400 Industrial Blvd, Austin TX 78744')
box(60, 360, 360, 90, 'SHIP DATE', (datetime.date.today()-datetime.timedelta(days=1)).strftime('%m/%d/%Y'))
box(440, 360, 360, 90, 'TRAILER #', '53-DV 88412')
box(820, 360, 360, 90, 'SEAL #', 'SL-4471902')
# commodity table
y = 480
d.rectangle([60, y, W-60, y+320], outline=ink, width=2)
cols = [60, 220, 760, 960, W-60]
for c in cols[1:-1]: d.line([c, y, c, y+320], fill=ink, width=1)
d.line([60, y+44, W-60, y+44], fill=ink, width=1)
for txt, x in zip(['PIECES', 'DESCRIPTION', 'WEIGHT (LBS)', 'CLASS'], cols):
    d.text((x+12, y+10), txt, font=small, fill=gray)
rows = [('24 PLT', 'Household appliances (washers, dryers)', '24,000', '85'), ('', 'Shrink-wrapped, do not double stack', '', '')]
for i, r in enumerate(rows):
    for txt, x in zip(r, cols): d.text((x+12, y+60+i*44), txt, font=reg, fill=ink)
d.text((80, y+210), 'TOTAL PIECES SHIPPED: 24', font=reg, fill=ink)
# exception area (handwritten)
y = 830
d.rectangle([60, y, W-60, y+250], outline=ink, width=2)
d.text((72, y+8), 'EXCEPTIONS / OS&D NOTES (consignee must note any shortage or damage)', font=small, fill=gray)
d.text((90, y+56), 'Rec\'d 22 plt.  SHORT 2', font=handb, fill=blue)
d.text((90, y+112), '2 cartons crushed on plt #14 - refused', font=hand, fill=blue)
d.text((90, y+164), 'driver notified', font=hand, fill=blue)
# signature block
y = 1110
box(60, y, 560, 150, 'RECEIVED BY (PRINT)', 'J. Ramirez', handb, blue)
box(640, y, 540, 150, 'SIGNATURE')
pts = [(700, y+110), (740, y+60), (770, y+115), (800, y+70), (840, y+100), (880, y+55), (930, y+105), (990, y+80), (1060, y+95)]
d.line(pts, fill=blue, width=4, joint='curve')
box(60, y+170, 360, 100, 'DATE', datetime.date.today().strftime('%m/%d/%Y'), hand, blue)
box(440, y+170, 360, 100, 'TIME', '2:20 PM', hand, blue)
box(820, y+170, 360, 100, 'PIECES RECEIVED', '22', handb, blue)
d.text((70, H-90), 'Carrier copy  ·  Freight received in apparent good order except as noted', font=small, fill=gray)
# photo feel: rotate on a desk background, slight blur and vignette
paper = paper.filter(ImageFilter.GaussianBlur(0.6)).rotate(-2.2, expand=True, fillcolor=(0,0,0,0))
bg = Image.new('RGB', (paper.width + 120, paper.height + 120), (92, 74, 58))
for _ in range(4000):
    x, y0 = random.randrange(bg.width), random.randrange(bg.height)
    c = random.randint(70, 110); ImageDraw.Draw(bg).point((x, y0), fill=(c+10, c-5, c-20))
mask = Image.new('L', paper.size, 0); ImageDraw.Draw(mask).rectangle([0,0,paper.width,paper.height], fill=255)
mask = paper.convert('L').point(lambda v: 255 if v > 3 else 0)
bg.paste(paper, (60, 60), mask)
bg = bg.resize((bg.width*3//5, bg.height*3//5))
bg.save(sys.argv[1], optimize=True)
print(bg.size)
