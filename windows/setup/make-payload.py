#!/usr/bin/env python3
"""Appends the install payload (one zip of app/: Stagehand's own files) to the setup stub.
make-payload.py stub.exe out.exe <repo root>
4.0.1: the app runtime, the decoder and uv are no longer packed in: Setup downloads them
when a PC doesn't have them (see components.sh).
4.27: the artwork (pictures, clips, fonts: most of the size) isn't packed in either. The
payload carries app/art-files.txt instead: where the art is on GitHub (this exact commit)
and each file's SHA-256, size and path. Setup keeps the art a PC already has and downloads
only what's new or changed, so an update is a few MB. Each art file must be exactly as it is
in that commit (the build stops otherwise), since Setup fetches it from there.
  ART_REF   the commit the art is fetched from (default: HEAD; it must be on GitHub)
  ART_REPO  owner/name on GitHub (default: GITHUB_REPOSITORY, else DrNoisewater/Stagehand)
  ART_BASE  the whole address instead (a test mirror); then nothing is checked against git"""
import sys, os, zipfile, struct, shutil, hashlib, subprocess
stub, out, root = sys.argv[1:4]
APP = ['package.json', 'src', 'engine', 'build', 'native/bin']
SKIP_DIRS = {'__pycache__', 'node_modules', '.git'}
ART_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.mp4', '.webm', '.ttf', '.otf', '.woff', '.woff2', '.wav', '.mp3', '.ogg', '.ico'}
ART_MIN = 8192  # tiny pictures stay in the payload (fewer downloads, almost no size)
tmp = out + '.zip'
LEVEL = 9


def git(*a):
    return subprocess.run(['git', '-C', root, *a], check=True, capture_output=True, text=True).stdout.strip()


base = os.environ.get('ART_BASE', '')
ref = ''
if not base:
    ref = git('rev-parse', os.environ.get('ART_REF', 'HEAD'))
    repo = os.environ.get('ART_REPO') or os.environ.get('GITHUB_REPOSITORY') or 'DrNoisewater/Stagehand'
    base = f'https://raw.githubusercontent.com/{repo}/{ref}/'
if not base.endswith('/'):
    base += '/'

files = []
for item in APP:
    p = os.path.join(root, item)
    if os.path.isfile(p):
        files.append(item)
        continue
    for d, dirs, names in os.walk(p):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for f in sorted(names):
            if not f.endswith('.pyc'):
                files.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, '/'))

art, packed = [], []
for rel in files:
    full = os.path.join(root, rel)
    if os.path.splitext(rel)[1].lower() in ART_EXT and os.path.getsize(full) >= ART_MIN:
        art.append(rel)
    else:
        packed.append(rel)

if ref:
    # every art file must be on GitHub exactly as it is here
    tree = {}
    for line in git('ls-tree', '-r', ref, '--', 'src', 'engine', 'build').splitlines():
        meta, path = line.split('\t', 1)
        tree[path] = meta.split()[2]
    local = dict(zip(art, git('hash-object', '--', *art).split())) if art else {}
    bad = [a for a in art if tree.get(a) != local[a]]
    if bad:
        sys.exit('art not committed as it is here (commit and push it first, or set ART_REF):\n  ' + '\n  '.join(bad[:20]))

lines = ['# Stagehand art: Setup keeps what a PC has and fetches the rest from here', 'base ' + base]
art_bytes = 0
for rel in art:
    data = open(os.path.join(root, rel), 'rb').read()
    art_bytes += len(data)
    if ' ' in rel or '\n' in rel:
        sys.exit('an art file name has a space in it: ' + rel)
    lines.append(f'{hashlib.sha256(data).hexdigest()} {len(data)} {rel}')

with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=LEVEL) as z:
    for rel in packed:
        z.write(os.path.join(root, rel), 'app/' + rel, compresslevel=LEVEL)
    z.writestr('app/art-files.txt', '\n'.join(lines) + '\n', compress_type=zipfile.ZIP_DEFLATED, compresslevel=LEVEL)
size = os.path.getsize(tmp)
shutil.copyfile(stub, out)
ofs = os.path.getsize(stub)
with open(out, 'ab') as o, open(tmp, 'rb') as zf:
    shutil.copyfileobj(zf, o)
    o.write(b'SHPAYLD1' + struct.pack('<QQ', ofs, size))
os.remove(tmp)
print(f'payload {size / 1048576:.1f} MB at {ofs}; art kept apart: {len(art)} files, {art_bytes / 1048576:.1f} MB from {base}')
