#!/usr/bin/env python3
"""Hand fixes for knob positions the detector got wrong (tools/gear/fixes.json → overrides.json).

Each fix names rows of knobs: [y % of the picture's height, [names left to right]] (null skips a
knob that isn't a parameter), optionally limited to an x range in %. The knobs themselves are still
found in the picture (circle search in a band around each row), so the numbers only have to be
roughly right. "clear": no knobs on the photo (sliders, knobs out of sight); "drop": remove names.

Usage: python3 tools/gear/fixrows.py [keys…]   then python3 tools/gear/build_photos.py
"""
import json, os, sys
import numpy as np, cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FULL = os.path.join(ROOT, 'src/renderer/art/gear/full')
fixes = json.load(open(os.path.join(ROOT, 'tools/gear/fixes.json')))
ovr_path = os.path.join(ROOT, 'tools/gear/overrides.json')
ovr = json.load(open(ovr_path)) if os.path.exists(ovr_path) else {}
only = set(sys.argv[1:])


def rim(gray, x, y, r):
    """How much this circle looks like a knob's rim: brightness change across it, all round."""
    h, w = gray.shape
    s = 0; n = 0
    for a in np.linspace(0, 2 * np.pi, 36, endpoint=False):
        xi, yi = int(x + np.cos(a) * r * 0.75), int(y + np.sin(a) * r * 0.75)
        xo, yo = int(x + np.cos(a) * r * 1.25), int(y + np.sin(a) * r * 1.25)
        if 0 <= xo < w and 0 <= yo < h and 0 <= xi < w and 0 <= yi < h:
            s += abs(float(gray[yi, xi]) - float(gray[yo, xo])); n += 1
    return s / max(1, n)


def contrast(gray, x, y, r, n=40):
    """A knob's rim: the inside (just within) differs from the outside (just beyond) the same way
    all round. Signed mean difference, less how much it varies round the circle."""
    h, w = gray.shape
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ca, sa = np.cos(a), np.sin(a)
    xi = np.clip((x + ca * r * 0.82).astype(int), 0, w - 1); yi = np.clip((y + sa * r * 0.82).astype(int), 0, h - 1)
    xo = np.clip((x + ca * r * 1.18).astype(int), 0, w - 1); yo = np.clip((y + sa * r * 1.18).astype(int), 0, h - 1)
    d = gray[yi, xi].astype(float) - gray[yo, xo].astype(float)
    return abs(d.mean()) - 0.35 * d.std()


def refine(gray, x, y, r, lo=0.5, hi=1.25):
    """Best circle near (x, y, r): the centre within half a radius, the size from lo·r to hi·r."""
    best = (contrast(gray, x, y, r), x, y, r)
    for rr in np.linspace(r * lo, r * hi, 12):
        step = max(1.0, rr / 8)
        for dy in np.arange(-r * 0.5, r * 0.5 + 0.1, step):
            for dx in np.arange(-r * 0.5, r * 0.5 + 0.1, step):
                sc = contrast(gray, x + dx, y + dy, rr)
                if sc > best[0]:
                    best = (sc, x + dx, y + dy, rr)
    # second pass, finer
    _, bx, by, br = best
    for rr in np.linspace(br * 0.9, br * 1.1, 7):
        for dy in np.arange(-3, 3.1, 1):
            for dx in np.arange(-3, 3.1, 1):
                sc = contrast(gray, bx + dx, by + dy, rr)
                if sc > best[0]:
                    best = (sc, bx + dx, by + dy, rr)
    return best[1], best[2], best[3]


def place(gray, row, W, H):
    """A row given as [y %, [x %…] or [first x %, last x %], names, r %]: start there, then refine."""
    yc, xs, names, rp = row[:4]
    exact = len(row) > 4 and row[4] == 'exact'  # trust the numbers (perspective knobs fool the rim search)
    if len(xs) == 2 and len(names) > 2:
        xs = [xs[0] + (xs[1] - xs[0]) * i / (len(names) - 1) for i in range(len(names))]
    out = {}
    for x, nm in zip(xs, names):
        if not nm:
            continue
        X, Y, R = (x / 100 * W, yc / 100 * H, rp / 100 * W) if exact else refine(gray, x / 100 * W, yc / 100 * H, rp / 100 * W, 0.8, 1.2)
        out[nm] = [round(X / W * 100, 3), round(Y / H * 100, 3), round(R / W * 100, 3), 0]
    return out


def find_row(gray, yc, names, xr, W, H):
    n = len(names)
    x0, x1 = int(xr[0] / 100 * W), int(xr[1] / 100 * W)
    span = x1 - x0
    # expected knob size: by spacing for rows, by picture size for single knobs
    rmax = int(min(span / max(1, n) * 0.55, H * 0.16))
    rmin = max(6, int(rmax * 0.3))
    band = int(max(rmax * 2.2, H * 0.08))
    y0, y1 = max(0, int(yc / 100 * H) - band), min(H, int(yc / 100 * H) + band)
    sub = cv2.medianBlur(gray[y0:y1, x0:x1], 5)
    c = cv2.HoughCircles(sub, cv2.HOUGH_GRADIENT, dp=1.2, minDist=rmin * 1.7, param1=110, param2=16, minRadius=rmin, maxRadius=rmax)
    if c is None:
        return None
    cands = [(float(x) + x0, float(y) + y0, float(r)) for x, y, r in c[0]]
    cands = [(x, y, r, rim(gray, x, y, r) - 0.15 * abs(y - yc / 100 * H)) for x, y, r in cands]
    cands.sort(key=lambda t: -t[3])
    picked = []
    for cnd in cands:
        if all(abs(cnd[0] - p[0]) > (cnd[2] + p[2]) * 0.9 for p in picked):
            picked.append(cnd)
        if len(picked) == n:
            break
    if len(picked) < n:
        return None
    # one size and one height for a row of knobs: snap to the row's median
    if n > 1:
        ys = np.median([p[1] for p in picked]); rs = np.median([p[2] for p in picked])
        picked = [(x, y if abs(y - ys) < rs * 0.6 else ys, r if 0.7 < r / rs < 1.3 else rs, s) for x, y, r, s in picked]
    picked.sort(key=lambda t: t[0])
    return {nm: [round(x / W * 100, 3), round(y / H * 100, 3), round(r / W * 100, 3), 0] for nm, (x, y, r, s) in zip(names, picked) if nm}


bad = []
for key, fx in fixes.items():
    if only and key not in only:
        continue
    o = {'redo': True}
    if fx.get('clear'):
        o['clear'] = True
    elif fx.get('drop'):
        o = {'drop': fx['drop']}
    else:
        im = Image.open(os.path.join(FULL, key + '.avif')).convert('RGBA')
        a = np.array(im); rgb = a[:, :, :3].copy(); rgb[a[:, :, 3] < 128] = 128
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        H, W = gray.shape
        knobs = {}
        for row in fx['rows']:
            if len(row) >= 4:  # placed by hand, refined on the picture
                knobs.update(place(gray, row, W, H))
                continue
            yc, names = row
            got = find_row(gray, yc, names, fx.get('xr', [2, 98]), W, H)
            if got:
                got = {nm: v for nm, v in got.items()}
                for nm, v in got.items():  # tighten what the circle search found
                    X, Y, R = refine(gray, v[0] / 100 * W, v[1] / 100 * H, v[2] / 100 * W, 0.45, 1.15)
                    got[nm] = [round(X / W * 100, 3), round(Y / H * 100, 3), round(R / W * 100, 3), 0]
            if got is None:
                bad.append(f'{key} row at {yc}%'); continue
            knobs.update(got)
        o['clear'] = True
        o['knobs'] = knobs
    ovr[key] = o
json.dump(ovr, open(ovr_path, 'w'), indent=1)
print(f'{len(fixes)} fixes; could not find: {", ".join(bad) or "none"}')
