#!/usr/bin/env python3
"""Makes the small fonts Setup draws with (4.14): the app's own Archivo, pinned to fixed
widths and weights, and its typewriter face, cut down to the letters Setup uses.
   python3 windows/setup/make-fonts.py      (needs fontTools; the results are committed)"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', '..', 'src', 'renderer', 'fonts')
OUT = os.path.join(HERE, 'fonts')
# Latin, punctuation Setup's words use (’ “ ” – — … → ·), digits
TEXT = ''.join(chr(c) for c in range(0x20, 0x7F)) + ' ·é‘’“”–—…→•'

def rename(f, family, weight):
    n = f['name']
    for rec in list(n.names):
        if rec.nameID in (16, 17, 21, 22, 25):
            n.removeNames(nameID=rec.nameID)
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        n.setName(family, 1, pid, eid, lid)
        n.setName('Regular', 2, pid, eid, lid)
        n.setName(family, 4, pid, eid, lid)
        n.setName(family.replace(' ', ''), 6, pid, eid, lid)
    f['OS/2'].usWeightClass = weight
    f['OS/2'].fsSelection = (f['OS/2'].fsSelection & ~0b1100001) | 0b1000000  # REGULAR
    f['head'].macStyle = 0
    for t in ('STAT', 'fvar', 'gvar', 'avar', 'HVAR', 'MVAR'):
        if t in f:
            del f[t]

def cut(f, path):
    opts = subset.Options()
    opts.layout_features = ['kern', 'liga']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(text=TEXT)
    s.subset(f)
    f.save(path)
    print(path, os.path.getsize(path))

for family, wdth, wght in (('SH Display', 62, 900), ('SH Text', 100, 600), ('SH Text Bold', 92, 800)):
    v = TTFont(os.path.join(FONTS, 'Archivo-Variable.ttf'))
    f = instancer.instantiateVariableFont(v, {'wdth': wdth, 'wght': wght})
    rename(f, family, wght)
    cut(f, os.path.join(OUT, family.replace(' ', '') + '.ttf'))

m = TTFont(os.path.join(FONTS, 'LiberationMono-Bold.ttf'))
rename(m, 'SH Mono', 700)
cut(m, os.path.join(OUT, 'SHMono.ttf'))
