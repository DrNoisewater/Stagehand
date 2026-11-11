"""
4.5.x: finds the knobs on the gear photos and matches each to the engine parameter it controls.

For every amp, pedal and rack photo:
  1. knob candidates: circles (Hough) inside the gear, scored for looking like a knob
     (round, a solid cap, a pointer);
  2. labels: words printed on the gear (Tesseract), matched to the Rocksmith knob names;
  3. each parameter gets the knob right above (or below) its printed label; when no label
     reads, and the count of knobs equals the count of parameters, reading order decides;
  4. the knob's own pointer angle is measured, so the cut-out face turns from where it is.

Writes tools/gear/knobs.json { key: { w, h, knobs: { name: [x%, y%, r%, angle] }, how } }
and QA sheets (numbered overlays) to the folder given. Manual fixes: tools/gear/overrides.json.

  python3 tools/gear/detect_knobs.py <gear dir> <out dir>
"""
import json, os, re, sys, glob, math
from difflib import SequenceMatcher
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
import pytesseract

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEAR = json.load(open(os.path.join(ROOT, 'src/renderer/data/gear2014.json')))
SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
OVR = json.load(open(os.path.join(ROOT, 'tools/gear/overrides.json'))) if os.path.exists(os.path.join(ROOT, 'tools/gear/overrides.json')) else {}

# label words that mean the same knob
ALIAS = {
    'gain': ['gain', 'drive', 'distortion', 'dist', 'fuzz', 'boost', 'preamp', 'overdrive', 'sustain', 'level 1', 'loudness'],
    'level': ['level', 'volume', 'vol', 'output', 'master'],
    'mix': ['mix', 'blend', 'level', 'effect', 'wet'],
    'rate': ['rate', 'speed'], 'speed': ['speed', 'rate'],
    'time': ['time', 'delay'], 'feedback': ['feedback', 'repeat', 'repeats', 'regen'],
    'compression': ['compression', 'comp', 'sustain', 'squeeze'],
    'presence': ['presence', 'pres'], 'treble': ['treble', 'high', 'highs', 'hi', 'tone'],
    'bass': ['bass', 'low', 'lows'], 'mid': ['mid', 'middle', 'mids'],
}


def words_of(name):
    return [w for w in re.split(r'[^a-z0-9]+', name.lower()) if w]


def ocr(img_rgb):
    """Words with their boxes, from the image and its inverse (light and dark print)."""
    out = []
    g = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    big = cv2.resize(g, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    for im in (big, 255 - big):
        try:  # some faceplates make tesseract churn for minutes; skip that pass
            d = pytesseract.image_to_data(im, config='--psm 11', output_type=pytesseract.Output.DICT, timeout=40)
        except RuntimeError:
            continue
        for i, t in enumerate(d['text']):
            t = re.sub(r'[^A-Za-z0-9.]', '', t or '')
            if len(t) < 2 or float(d['conf'][i]) < 30:
                continue
            out.append({'t': t.lower(), 'x': (d['left'][i] + d['width'][i] / 2) / 2, 'y': (d['top'][i] + d['height'][i] / 2) / 2, 'h': d['height'][i] / 2, 'w': d['width'][i] / 2})
    return out


def circles(img_rgb, alpha, kind):
    h, w = alpha.shape
    g = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    g = cv2.medianBlur(g, 5)
    if kind == 'pedal':
        rmin, rmax = int(w * 0.035), int(w * 0.17)
    elif kind == 'rack':
        rmin, rmax = int(w * 0.006), int(w * 0.03)
    else:
        rmin, rmax = int(w * 0.008), int(w * 0.055)
    found = []
    for p2 in (30, 22):
        c = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1.2, minDist=max(6, rmin * 1.6), param1=110, param2=p2, minRadius=max(3, rmin), maxRadius=rmax)
        if c is not None:
            found += [tuple(map(float, x)) for x in c[0]]
        if len(found) > 3:
            break
    # keep circles fully on the gear, score how knob-like they are
    res = []
    for (x, y, r) in found:
        if x - r < 0 or y - r < 0 or x + r >= w or y + r >= h:
            continue
        if alpha[int(y), int(x)] < 200:
            continue
        mask = np.zeros_like(g)
        cv2.circle(mask, (int(x), int(y)), int(r * 0.8), 255, -1)
        ring = np.zeros_like(g)
        cv2.circle(ring, (int(x), int(y)), int(r * 1.35), 255, -1)
        cv2.circle(ring, (int(x), int(y)), int(r * 1.05), 0, -1)
        inside = g[mask > 0].astype(float)
        around = g[ring > 0].astype(float)
        if not len(inside) or not len(around):
            continue
        contrast = abs(inside.mean() - around.mean())
        res.append({'x': x, 'y': y, 'r': r, 'score': contrast, 'dark': inside.mean()})
    # drop overlapping duplicates (keep the stronger)
    res.sort(key=lambda c: -c['score'])
    keep = []
    for c in res:
        if all(math.hypot(c['x'] - k['x'], c['y'] - k['y']) > max(c['r'], k['r']) * 0.9 for k in keep):
            keep.append(c)
    return keep


def pointer_angle(img_rgb, c):
    """The angle (deg, 0 = up, clockwise) of the knob's own pointer line or dot."""
    g = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY).astype(float)
    best, prof = 0, []
    for a in range(0, 360, 3):
        rad = math.radians(a)
        vals = []
        for f in (0.45, 0.6, 0.75):
            px = int(c['x'] + math.sin(rad) * c['r'] * f)
            py = int(c['y'] - math.cos(rad) * c['r'] * f)
            if 0 <= px < g.shape[1] and 0 <= py < g.shape[0]:
                vals.append(g[py, px])
        prof.append(np.mean(vals) if vals else 0)
    prof = np.array(prof)
    med = np.median(prof)
    dev = prof - med
    i = int(np.argmax(np.abs(dev)))
    strength = abs(dev[i]) / (prof.std() + 1e-6)
    a = i * 3
    return (a if a <= 180 else a - 360), strength


def label_score(name, text):
    best = 0
    cands = ALIAS.get(name.lower(), []) + [name.lower()] + words_of(name)
    for c in cands:
        best = max(best, SequenceMatcher(None, c, text).ratio())
    return best


def edge_score(gx, gy, mag, x, y, r):
    """How much of a circle's rim is a strong edge pointing across the rim (knobs: lots)."""
    n = 72
    hits, tot = 0.0, 0.0
    H, W = mag.shape
    for i in range(n):
        a = 2 * math.pi * i / n
        px, py = x + math.cos(a) * r, y + math.sin(a) * r
        ix, iy = int(round(px)), int(round(py))
        if not (0 <= ix < W and 0 <= iy < H):
            return 0
        g = mag[iy, ix]
        radial = abs(gx[iy, ix] * math.cos(a) + gy[iy, ix] * math.sin(a))
        tot += g
        hits += 1 if radial > 0.6 * g and g > 25 else 0
    return hits / n


def local_knob(gray, grad, x0, y0, x1, y1, rmin, rmax, want_x, want_y=None):
    """The best knob in a box: Hough candidates rescored by rim edge strength."""
    H, W = gray.shape
    x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(W, int(x1)), min(H, int(y1))
    if x1 - x0 < rmin * 2 or y1 - y0 < rmin * 2:
        return None
    sub = cv2.medianBlur(gray[y0:y1, x0:x1], 3)
    c = cv2.HoughCircles(sub, cv2.HOUGH_GRADIENT, dp=1, minDist=rmin, param1=100, param2=max(8, int(rmin * 0.6)), minRadius=int(rmin), maxRadius=int(rmax))
    if c is None:
        return None
    gx, gy, mag = grad
    best = None
    for (cx, cy, r) in c[0][:40]:
        X, Y = cx + x0, cy + y0
        es = edge_score(gx, gy, mag, X, Y, r)
        dx = abs(X - want_x) / max(r, 1)
        # nearest the label: the gap between label and knob edge, in knob radii
        dy = 0 if want_y is None else max(0.0, abs(Y - want_y) - r) / max(r, 1)
        sc = es - 0.12 * dx - 0.07 * dy
        if best is None or sc > best['sc']:
            best = {'x': float(X), 'y': float(Y), 'r': float(r), 'sc': sc, 'es': es}
    return best


def row_fallback(params, gray, grad, kind, w, h):
    """No labels read: a clean row of exactly as many knob-like circles as there are knobs."""
    if kind == 'pedal':
        rmin, rmax = w * 0.035, w * 0.16
    elif kind == 'rack':
        rmin, rmax = w * 0.006, w * 0.03
    else:
        rmin, rmax = w * 0.008, w * 0.05
    gx, gy, mag = grad
    c = cv2.HoughCircles(cv2.medianBlur(gray, 3), cv2.HOUGH_GRADIENT, dp=1, minDist=rmin * 1.5, param1=100, param2=max(10, int(rmin * 0.7)), minRadius=int(rmin), maxRadius=int(rmax))
    if c is None:
        return {}
    ks = []
    for (x, y, r) in c[0][:400]:
        es = edge_score(gx, gy, mag, float(x), float(y), float(r))
        if es >= 0.45:
            ks.append({'x': float(x), 'y': float(y), 'r': float(r), 'sc': es, 'es': es})
    ks.sort(key=lambda k: -k['es'])
    keep = []
    for k in ks:
        if all(math.hypot(k['x'] - o['x'], k['y'] - o['y']) > max(k['r'], o['r']) * 1.4 for o in keep):
            keep.append(k)
    n = len(params)
    best = None
    for k in keep:  # rows around each strong knob
        row = [o for o in keep if abs(o['y'] - k['y']) < k['r'] * 0.5 and abs(o['r'] - k['r']) < k['r'] * 0.25]
        if len(row) == n:
            sc = sum(o['es'] for o in row)
            if best is None or sc > best[0]:
                best = (sc, sorted(row, key=lambda o: o['x']))
    if not best:
        return {}
    return dict(zip(params, best[1]))


def match(params, words, gray, grad, kind, w, h):
    """param name -> knob, found near its printed label (above or below)."""
    if kind == 'pedal':
        rmin, rmax = w * 0.035, w * 0.16
    elif kind == 'rack':
        rmin, rmax = w * 0.006, w * 0.03
    else:
        rmin, rmax = w * 0.008, w * 0.05
    out = {}
    pairs = []
    for name in params:
        for wd in words:
            sc = label_score(name, wd['t'])
            if sc >= 0.8:
                pairs.append((sc, name, wd))
    pairs.sort(key=lambda p: -p[0])
    # labels sit on one side of their knobs on a given device: decide above/below once
    side_total = {'above': 0.0, 'below': 0.0}
    probe = {}
    seen_names = set()
    for sc, name, wd in pairs:
        if name in seen_names:
            continue
        seen_names.add(name)
        span = rmax * 2.6
        for side in ('above', 'below'):
            if side == 'above':
                box = (wd['x'] - span, wd['y'] - wd['h'] / 2 - span * 1.6, wd['x'] + span, wd['y'] - wd['h'] / 2 + 2)
            else:
                box = (wd['x'] - span, wd['y'] + wd['h'] / 2 - 2, wd['x'] + span, wd['y'] + wd['h'] / 2 + span * 1.6)
            k = local_knob(gray, grad, *box, rmin, rmax, wd['x'], wd['y'] - wd['h'] / 2 if side == 'above' else wd['y'] + wd['h'] / 2)
            probe[(id(wd), side)] = k
            if k:
                side_total[side] += max(0.0, k['es'])
    pick_side = 'above' if side_total['above'] > side_total['below'] * 1.15 else 'below' if side_total['below'] > side_total['above'] * 1.15 else None
    used_words = set()
    for sc, name, wd in pairs:
        if name in out or id(wd) in used_words:
            continue
        if pick_side:
            k = probe.get((id(wd), pick_side))
            if not k or k['es'] < 0.28:
                continue
            if any(math.hypot(k['x'] - o['x'], k['y'] - o['y']) < k['r'] * 0.8 for o in out.values()):
                continue
            out[name] = dict(k, side=pick_side)
            used_words.add(id(wd))
            continue
        cands = []
        for side in ('above', 'below'):
            span = rmax * 2.6
            if side == 'above':
                box = (wd['x'] - span, wd['y'] - wd['h'] / 2 - span * 1.6, wd['x'] + span, wd['y'] - wd['h'] / 2 + 2)
            else:
                box = (wd['x'] - span, wd['y'] + wd['h'] / 2 - 2, wd['x'] + span, wd['y'] + wd['h'] / 2 + span * 1.6)
            k = local_knob(gray, grad, *box, rmin, rmax, wd['x'], wd['y'] - wd['h'] / 2 if side == 'above' else wd['y'] + wd['h'] / 2)
            if k:
                k['side'] = side
                cands.append(k)
        if not cands:
            continue
        k = max(cands, key=lambda c: c['sc'])
        if k['es'] < 0.28:
            continue
        # not the same knob as another label's
        if any(math.hypot(k['x'] - o['x'], k['y'] - o['y']) < k['r'] * 0.8 for o in out.values()):
            continue
        out[name] = k
        used_words.add(id(wd))
    # one size per row: refit knobs far from the row's median radius
    if len(out) >= 3:
        med = float(np.median([k['r'] for k in out.values()]))
        for name, k in list(out.items()):
            if abs(k['r'] - med) > med * 0.35:
                r2 = local_knob(gray, grad, k['x'] - med * 2.2, k['y'] - med * 2.2, k['x'] + med * 2.2, k['y'] + med * 2.2, med * 0.8, med * 1.2, k['x'])
                if r2 and r2['es'] >= 0.25:
                    out[name] = r2
                else:
                    del out[name]
    how = 'labels' if len(out) == len(params) else ('partial' if out else 'none')
    if len(out) < 2:
        fb = row_fallback(params, gray, grad, kind, w, h)
        if fb and (not out or all(any(math.hypot(o['x'] - f['x'], o['y'] - f['y']) < f['r'] for f in fb.values()) for o in out.values())):
            return fb, 'row'
        return out, how
    med = float(np.median([k['r'] for k in out.values()]))
    gx, gy, mag = grad
    if kind != 'pedal':
        # one row of knobs on an amp or rack: drop picks off the row (grille, logos)
        rowy = float(np.median([k['y'] for k in out.values()]))
        for name, k in list(out.items()):
            if abs(k['y'] - rowy) > med * 1.2:
                del out[name]
        if len(out) < 2:
            return out, ('partial' if out else 'none')
        if len(out) == len(params):
            return out, how
        rows = [rowy]
    else:
        if len(out) == len(params):
            return out, how
        ys = sorted(k['y'] for k in out.values())
        rows = []
        for y in ys:
            if not rows or abs(y - rows[-1]) > med * 1.2:
                rows.append(y)
    # scan each row for the knobs whose labels didn't read
    extra = []
    for rowy in rows:
        y0, y1 = int(max(0, rowy - med * 1.8)), int(min(h, rowy + med * 1.8))
        sub = cv2.medianBlur(gray[y0:y1, :], 3)
        c = cv2.HoughCircles(sub, cv2.HOUGH_GRADIENT, dp=1, minDist=med * 1.5, param1=100, param2=max(8, int(med * 0.6)), minRadius=int(med * 0.8), maxRadius=int(med * 1.2))
        if c is None:
            continue
        for (cx, cy, r) in c[0]:
            X, Y = float(cx), float(cy + y0)
            if abs(Y - rowy) > med * 0.5:
                continue
            es = edge_score(gx, gy, mag, X, Y, r)
            if es < 0.33:
                continue
            if any(math.hypot(X - o['x'], Y - o['y']) < med * 1.3 for o in list(out.values()) + extra):
                continue
            extra.append({'x': X, 'y': Y, 'r': float(r), 'sc': es, 'es': es})
    rest = [p for p in params if p not in out]
    if extra and len(extra) == len(rest):
        # name them in panel order: reading order of the knobs, the gear's order of the names
        allk = sorted(list(out.values()) + extra, key=lambda k: (round(k['y'] / (med * 2)), k['x']))
        order_ok = True
        named = [n for n in params if n in out]
        # the labelled knobs must already sit in the same order as their names
        pos = [allk.index(out[n]) for n in named]
        if pos != sorted(pos):
            order_ok = False
        if order_ok:
            it = iter(rest)
            for k in allk:
                if k in extra:
                    out[next(it)] = k
            how = 'labels+row'
    return out, how


def main():
    files = sorted(glob.glob(os.path.join(SRC, '**', '*.*'), recursive=True))
    files = [f for f in files if re.search(r'\.(png|webp)$', f, re.I)]
    seen = {}
    for f in files:  # newer sets win over "Previously included" when both have the piece
        k = os.path.splitext(os.path.basename(f))[0]
        if k not in seen or 'Previously' in seen[k]:
            seen[k] = f
    result = {}
    sheet = []
    font = ImageFont.load_default()
    only = set(sys.argv[3:])
    path = os.path.join(ROOT, 'tools/gear/knobs.json')
    done = json.load(open(path)) if os.path.exists(path) else {}
    resume = os.environ.get('RESUME') == '1'
    for key, f in sorted(seen.items()):
        if only and key not in only:
            continue
        if resume and key in done:
            continue
        info = GEAR.get(key)
        if not info or info['t'] not in ('amp', 'pedal', 'rack'):
            continue
        kind = info['t']
        params = [k[0] for k in info.get('k', [])]
        im = Image.open(f).convert('RGBA')
        scale = 1400 / max(im.size) if max(im.size) > 1400 else 1
        if scale != 1:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        a = np.array(im)
        rgb, alpha = a[:, :, :3].copy(), a[:, :, 3]
        rgb[alpha < 128] = 128
        w, h = im.size
        words = ocr(rgb)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gx = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
        mag = np.hypot(gx, gy)
        cands = []
        ov = OVR.get(key, {})
        m, how = match(params, words, gray, (gx, gy, mag), kind, w, h)
        knobs = {}
        for name, c in m.items():
            ang, strength = pointer_angle(rgb, c)
            knobs[name.lower()] = [round(c['x'] / w * 100, 3), round(c['y'] / h * 100, 3), round(c['r'] / w * 100, 3), int(ang) if strength > 1.6 else 0]
        for name, v in ov.get('knobs', {}).items():
            if v is None:
                knobs.pop(name, None)
            else:
                knobs[name] = v
        result[key] = {'w': w, 'h': h, 'knobs': knobs, 'params': len(params), 'how': ov.get('how', how), 'cands': len(cands), 'words': [x['t'] for x in words][:30]}
        # QA image
        q = im.copy()
        bg = Image.new('RGBA', q.size, (70, 70, 70, 255))
        bg.alpha_composite(q)
        d = ImageDraw.Draw(bg)
        for wd in words:
            d.rectangle([wd['x'] - wd['w'] / 2, wd['y'] - wd['h'] / 2, wd['x'] + wd['w'] / 2, wd['y'] + wd['h'] / 2], outline=(90, 90, 255, 255), width=1)
        for name, (x, y, r, ang) in knobs.items():
            X, Y, R = x / 100 * w, y / 100 * h, r / 100 * w
            d.ellipse([X - R, Y - R, X + R, Y + R], outline=(0, 255, 90, 255), width=4)
            rad = math.radians(ang)
            d.line([X, Y, X + math.sin(rad) * R, Y - math.cos(rad) * R], fill=(255, 40, 40, 255), width=4)
            d.rectangle([X - R, Y + R + 2, X - R + 9 * len(name) + 6, Y + R + 20], fill=(0, 0, 0, 255))
            d.text((X - R + 3, Y + R + 4), name, fill=(255, 255, 0, 255), font=font)
        miss = [p for p in params if p.lower() not in knobs]
        d.rectangle([0, 0, w, 26], fill=(0, 0, 0, 255))
        d.text((6, 6), f'{key}  {how}  {len(knobs)}/{len(params)}  missing: {", ".join(miss)}', fill=(255, 255, 255, 255), font=font)
        bg.convert('RGB').save(os.path.join(OUT, f'{key}.jpg'), quality=80)
        print(f'{key:40s} {how:13s} {len(knobs)}/{len(params)} cands {len(cands)}', flush=True)
        done[key] = result[key]
        json.dump(done, open(path, 'w'), indent=1)  # saved as it goes, so a stop can resume (RESUME=1)


main()
