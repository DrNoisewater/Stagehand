"""Rebuild shipping artwork from the retained PNG masters; requires Pillow."""
import json
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'src/renderer/art/manifest.json').read_text())
for item in manifest['assets']:
    im = Image.open(root / item['master']).convert('RGBA')
    im.thumbnail((720, 540), Image.Resampling.LANCZOS)
    im.save(root / 'src/renderer/art' / item['file'], 'WEBP', quality=88, method=6)
for item in manifest.get('venues', []):
    im = Image.open(root / item['master']).convert('RGB')
    im.save(root / 'src/renderer/art' / item['file'], 'JPEG', quality=88, optimize=True)
    im.thumbnail((320, 180), Image.Resampling.LANCZOS)
    im.save(root / 'src/renderer/art' / item['thumbnail'], 'JPEG', quality=85)
