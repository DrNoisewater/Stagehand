"""4.5.x: gear photos -> app assets. art/gear/full/<key>.webp (<=1100 px), art/gear/thumb/<key>.webp (<=320 px).
Cabinet photos keep one picture per family (mic variants share it).  python3 tools/gear/convert.py <gear dir>"""
import os, sys, glob, re
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'src/renderer/art/gear')
os.makedirs(os.path.join(OUT, 'full'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'thumb'), exist_ok=True)
seen = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], '**', '*.*'), recursive=True)):
    if not re.search(r'\.(png|webp)$', f, re.I):
        continue
    k = os.path.splitext(os.path.basename(f))[0]
    if k not in seen or 'Previously' in seen[k]:
        seen[k] = f
total = 0
import json
trims = {}
for k, f in sorted(seen.items()):
    im = Image.open(f).convert('RGBA')
    W0, H0 = im.size
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()  # trim empty margins
    if bbox:
        im = im.crop(bbox)
    else:
        bbox = (0, 0, W0, H0)
    # the trim as fractions of the original, so knob positions found on the original can be moved
    trims[k] = [bbox[0] / W0, bbox[1] / H0, (bbox[2] - bbox[0]) / W0, (bbox[3] - bbox[1]) / H0, im.size[0], im.size[1]]
    for sub, size, q in (('full', 1100, 78), ('thumb', 320, 78)):
        t = im.copy()
        t.thumbnail((size, size), Image.LANCZOS)
        p = os.path.join(OUT, sub, f'{k}.webp')
        t.save(p, 'WEBP', quality=q, method=5)
        total += os.path.getsize(p)
    print(k, im.size, flush=True)
json.dump(trims, open(os.path.join(ROOT, 'tools/gear/trims.json'), 'w'), indent=0)
print('total MB', round(total / 1e6, 1))
