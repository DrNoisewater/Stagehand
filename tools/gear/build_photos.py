#!/usr/bin/env python3
"""Builds src/renderer/js/gear-photos.js: one entry per gear photo in art/gear/full.

  Hand-calibrated entries (tools/gear/gear-photos.base.js, the 4.5 table) win; their knob
  positions were measured on the untrimmed pictures, so they are moved by tools/gear/trims.json.
  Everything else comes from tools/gear/knobs.json (detect_knobs.py), already corrected by
  tools/gear/overrides.json, and is likewise moved by the trim.

  A knob listed here is placed on the photo and turns (the knob face is cut from the photo and
  rotated). Knobs not listed are still on the control strip beside the photo, never faked.

Usage: python3 tools/gear/build_photos.py
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(ROOT, 'src/renderer/art/gear')
GEAR = json.load(open(os.path.join(ROOT, 'src/renderer/data/gear2014.json')))
trims = json.load(open(os.path.join(ROOT, 'tools/gear/trims.json')))
knobs_path = os.path.join(ROOT, 'tools/gear/knobs.json')
det = json.load(open(knobs_path)) if os.path.exists(knobs_path) else {}
ovr_path = os.path.join(ROOT, 'tools/gear/overrides.json')
ovr = json.load(open(ovr_path)) if os.path.exists(ovr_path) else {}
# 4.10: the audit table (tools/gear/knob_audit.py) has the last word: every knob's centre, size and the
# angle its pointer shows in the photo, plus the sliders, all measured on the shipped (trimmed) picture
audit_path = os.path.join(ROOT, 'tools/gear/audit.json')
audit = json.load(open(audit_path)) if os.path.exists(audit_path) else {}
base_js = open(os.path.join(ROOT, 'tools/gear/gear-photos.base.js')).read()
old = json.loads(re.search(r'export const GEAR_PHOTOS = (\{.*?\});\n', base_js, re.S).group(1))

# a cab family's display name ("Marshall 1960 AX"), from any of its mic keys
cab_names = {}
for k, g in GEAR.items():
    m = re.match(r'(.*)_(57|Condenser|Ribbon|Tube)_(Cone|Edge|OffAxis)$', k)
    if m:
        cab_names.setdefault(m.group(1), re.sub(r'\s*\((Dynamic|Condenser|Ribbon|Tube).*$', '', g['n']).strip())


def remap(knobs, t):
    if not t:
        return knobs
    x0, y0, wf, hf = t[:4]
    out = {}
    for name, v in knobs.items():
        x, y, r, a = (list(v) + [0, 0, 0, 0])[:4]
        out[name] = [round((x / 100 - x0) / wf * 100, 3), round((y / 100 - y0) / hf * 100, 3), round(r / wf, 3), int(a)]
    return out


def ok(v):
    return 0 <= v[0] <= 100 and 0 <= v[1] <= 100 and 0.3 < v[2] < 30


photos = {}
stats = {'hand': 0, 'detected': 0, 'none': 0}
for f in sorted(os.listdir(os.path.join(ART, 'full'))):
    if not f.endswith(('.webp', '.avif')):
        continue
    key = f[:-5]
    t = trims.get(key)
    w, h = (t[4], t[5]) if t else (1000, 1000)
    info = GEAR.get(key) or {}
    name = info.get('n') or cab_names.get(key) or key
    params = {k[0].lower() for k in info.get('k', [])}
    e = {'file': f'full/{key}.avif', 'thumb': f'thumb/{key}.webp', 'name': name, 'width': w, 'height': h, 'knobs': {}}
    o = ovr.get(key, {})
    if key in old and not o.get('redo'):
        src = old[key]
        e['knobs'] = remap(src.get('knobs', {}), t if src['file'] != e['file'] else None)
        if src.get('steps'):
            e['steps'] = src['steps']
        e['how'] = 'hand'
        stats['hand'] += 1
    elif key in det:
        e['knobs'] = remap(det[key].get('knobs', {}), t)
        e['how'] = det[key].get('how', '')
        stats['detected'] += 1
    else:
        stats['none'] += 1
    if e.get('how') not in ('hand',) and info.get('t') == 'pedal' and h > w:
        # a stompbox's knobs are in its top two thirds: a "knob" lower down is the footswitch
        e['knobs'] = {k: v for k, v in e['knobs'].items() if v[1] < 68}
    if o.get('clear'):
        e['knobs'] = {}
        e['how'] = 'fixed'
    for name_, v in (o.get('knobs') or {}).items():  # overrides are on the trimmed picture
        if v is None:
            e['knobs'].pop(name_, None)
        else:
            e['knobs'][name_] = v
    for name_ in o.get('drop', []):
        e['knobs'].pop(name_, None)
    au = audit.get(key)
    if au is not None:
        e['knobs'] = dict(au.get('knobs') or {})
        e['how'] = 'audit'
        if au.get('sliders'):
            e['sliders'] = au['sliders']
    if e.get('how') not in ('hand', 'audit'):
        # most photos show their knobs at noon; a measured pointer angle is too often fooled by
        # print and glare, and a wrong one would show the wrong setting
        e['knobs'] = {k: v[:3] + [0] for k, v in e['knobs'].items()}
    # only real parameters of this piece, at sane places
    e['knobs'] = {k: v for k, v in e['knobs'].items() if k in params and ok(v)}
    if e.get('sliders'):
        e['sliders'] = {k: v for k, v in e['sliders'].items() if k in params}
    if e['knobs']:
        e['turn'] = True
    photos[key] = e

head = '''// Gear portraits and their knobs (built by tools/gear/build_photos.py; edit overrides.json and
// rebuild rather than this file). Each knob: [x %, y %, radius % of the width, angle the photo's
// own pointer shows (degrees, 0 = straight up)]. The knob face is cut from the photo and turned,
// so the real knob moves. Sliders: [x %, y % of the cap at the top of its travel, y % at the bottom,
// y % where the photo shows it, cap width %, cap height %, y % of a clear piece of slot used to
// paint over the photo's own cap]. Controls not listed for a piece are on the strip beside it.
'''
js = head + 'export const GEAR_PHOTOS = ' + json.dumps(photos, separators=(',', ':')) + ';\n'
js += re.search(r'(// The same physical family.*)', base_js, re.S).group(1)
open(os.path.join(ROOT, 'src/renderer/js/gear-photos.js'), 'w').write(js)
placed = sum(len(e['knobs']) + len(e.get('sliders', {})) for e in photos.values())
total = sum(len((GEAR.get(k) or {}).get('k', [])) for k in photos)
print(f"{len(photos)} photos ({stats['hand']} hand-calibrated, {stats['detected']} detected, {stats['none']} without knob data); {placed} of {total} knobs on the photos")
