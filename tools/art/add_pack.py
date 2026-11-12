"""Add an art pack (transparent PNGs) to Stagehand: trimmed, web-sized WebP copies in
src/renderer/art/<folder>/, registered in art/manifest.json, then js/identity-art.js rebuilt.

  python3 -I tools/art/add_pack.py <png folder> <art subfolder> <max side px> "<source note>" [id prefix]

Run again with the same folder to refresh. Placements (which page uses what) live in
tools/art/placements.json and are merged into the manifest by build_js.py.
"""
import json, sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
src, folder, side, note = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
prefix = sys.argv[5] if len(sys.argv) > 5 else ''
out = root / 'src/renderer/art' / folder
out.mkdir(parents=True, exist_ok=True)
man_path = root / 'src/renderer/art/manifest.json'
man = json.loads(man_path.read_text())
by_id = {a['id']: a for a in man['assets']}
for png in sorted(src.glob('*.png')):
    stem = png.stem.split('-', 1)[1] if png.stem[:2].isdigit() else png.stem
    aid = prefix + stem
    im = Image.open(png).convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if box:
        pad = round(max(im.size) * 0.012)
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
        im = im.crop(box)
    im.thumbnail((side, side), Image.Resampling.LANCZOS)
    file = f'{folder}/{stem}.webp'
    im.save(out / f'{stem}.webp', 'WEBP', quality=86, method=6)
    by_id[aid] = {'id': aid, 'file': file, 'source': note, 'original': png.name,
                  'width': im.width, 'height': im.height, 'alpha': True, 'role': 'decoration only'}
    print(aid, im.size)
man['assets'] = list({**{a['id']: a for a in man['assets']}, **by_id}.values())
man_path.write_text(json.dumps(man, indent=2, ensure_ascii=False) + '\n')
