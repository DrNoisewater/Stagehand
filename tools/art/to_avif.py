"""4.9.1: shrink the app's pictures without changing what you see: every .webp under src/renderer/art
(except the small gear thumbnails, which the gear wall decodes 200 at a time) becomes AVIF at the same
pixel size, quality 60 (about 45% of the WebP size; side by side at their shown size they look the same).
Then every reference to a converted file in src/ is rewritten to .avif.

  python3 -I tools/art/to_avif.py            (run from anywhere; does nothing for files already converted)
"""
import os, re, sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

root = Path(__file__).resolve().parents[2]
art = root / 'src/renderer/art'
SKIP = ('gear/thumb/',)

def convert(p):
    rel = p.relative_to(art).as_posix()
    im = Image.open(p)
    im.load()
    out = p.with_suffix('.avif')
    im.save(out, 'AVIF', quality=60, speed=4)
    before, after = p.stat().st_size, out.stat().st_size
    p.unlink()
    return rel, before, after

if __name__ == '__main__':
    files = [p for p in art.rglob('*.webp') if not p.relative_to(art).as_posix().startswith(SKIP)]
    total_b = total_a = 0
    done = set()
    with ProcessPoolExecutor() as ex:
        for rel, b, a in ex.map(convert, files):
            done.add(rel); total_b += b; total_a += a
    print(f'{len(done)} pictures: {total_b / 1e6:.1f} MB -> {total_a / 1e6:.1f} MB')
    # every converted picture, by its path below art/ (any suffix of it may be what the code names)
    converted = {p.relative_to(art).as_posix()[:-5] for p in art.rglob('*.avif')}
    tok = re.compile(r'[A-Za-z0-9_./-]+\.webp')
    def fix(m):
        t = m.group(0)
        stem = t[:-5].lstrip('./')
        while stem.startswith('../'):
            stem = stem[3:]
        stem = stem.removeprefix('art/')
        hits = [c for c in converted if c == stem or c.endswith('/' + stem)]
        return t[:-5] + '.avif' if len(hits) == 1 else t
    changed = []
    for f in (root / 'src').rglob('*'):
        if f.suffix not in ('.js', '.mjs', '.css', '.html', '.json') or not f.is_file():
            continue
        s = f.read_text(encoding='utf-8')
        n = tok.sub(fix, s)
        if n != s:
            f.write_text(n, encoding='utf-8'); changed.append(f.relative_to(root).as_posix())
    print('references updated in', len(changed), 'files:', ', '.join(changed))
    left = [m for f in (root / 'src').rglob('*.*') if f.suffix in ('.js', '.css', '.html', '.json')
            for m in tok.findall(f.read_text(encoding='utf-8')) if 'thumb/' not in m]
    if left:
        print('still .webp (check these by hand):', sorted(set(left))[:40])
