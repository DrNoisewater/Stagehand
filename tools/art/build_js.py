"""Merge tools/art/placements.json into art/manifest.json and rebuild js/identity-art.js.

  python3 -I tools/art/build_js.py
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
man_path = root / 'src/renderer/art/manifest.json'
man = json.loads(man_path.read_text())
ids = {a['id'] for a in man['assets']}
add = json.loads((root / 'tools/art/placements.json').read_text())
pl = man.setdefault('placements', {})
ev = man.setdefault('events', {})
missing = []
for pool, items in add.items():
    if pool.startswith('_'):
        continue
    # event-* pools (the animated moments, js/cameo.js) are kept apart from the menu pools
    cur = (ev if pool.startswith('event-') else pl).setdefault(pool, [])
    for i in items:
        if i not in ids:
            missing.append(f'{pool}:{i}')
        elif i not in cur:
            cur.append(i)
if missing:
    raise SystemExit('unknown art ids: ' + ', '.join(missing))
man_path.write_text(json.dumps(man, indent=2, ensure_ascii=False) + '\n')
art = [{k: v for k, v in a.items() if k != 'original'} for a in man['assets']]
js = ('// Generated from art/manifest.json by tools/art/build_js.py.\n'
      f'export const ART = {json.dumps(art, ensure_ascii=False)};\n'
      f'export const PLACEMENTS = {json.dumps(pl, ensure_ascii=False)};\n'
      f'export const EVENTS = {json.dumps(ev, ensure_ascii=False)};\n')
(root / 'src/renderer/js/identity-art.js').write_text(js)
print(len(art), 'pictures,', len(pl), 'menu pools,', len(ev), 'event pools')
