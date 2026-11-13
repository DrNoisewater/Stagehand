#!/usr/bin/env python3
"""4.16.3: packs Setup's header pictures (made by make-art.js from the app's own banner) for the build:
'SHI1', width, height (little-endian u32), then the pixels as premultiplied BGRA, zlib-compressed.
Setup unpacks them with miniz and draws them with AlphaBlend. Dev time only (needs Pillow); the .bin files
are committed, so the build needs nothing extra.
    python3 windows/setup/make-art.py"""
import os, struct, zlib
from PIL import Image

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'art')
for name in ('header-setup', 'header-remove'):
    im = Image.open(os.path.join(HERE, name + '.png')).convert('RGBA')
    w, h = im.size
    # the bottom edge fades out, so the picture's wall runs on into the wall Setup draws below it
    FADE = 40
    px = bytearray()
    for i, (r, g, b, a) in enumerate(im.getdata()):
        y = i // w
        if y >= h - FADE:
            a = a * (h - 1 - y) // FADE
        px += bytes((b * a // 255, g * a // 255, r * a // 255, a))
    data = b'SHI1' + struct.pack('<II', w, h) + zlib.compress(bytes(px), 9)
    with open(os.path.join(HERE, name + '.bin'), 'wb') as f:
        f.write(data)
    print(f'{name}.bin: {w}x{h}, {len(data) // 1024} KB')
