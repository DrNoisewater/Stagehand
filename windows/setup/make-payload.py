#!/usr/bin/env python3
"""Appends the install payload (one zip of app/: Stagehand's own files) to the setup stub.
make-payload.py stub.exe out.exe <repo root>
4.0.1: the app runtime, the decoder and uv are no longer packed in: Setup downloads them
when a PC doesn't have them (see components.sh)."""
import sys, os, zipfile, struct, shutil, io
stub, out, root = sys.argv[1:4]
APP = ['package.json', 'src', 'engine', 'build', 'native/bin']
SKIP_DIRS = {'__pycache__', 'node_modules', '.git'}
tmp = out + '.zip'
LEVEL = 9
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=LEVEL) as z:
    for item in APP:
        p = os.path.join(root, item)
        if os.path.isfile(p):
            z.write(p, 'app/' + item, compresslevel=LEVEL)
            continue
        for d, dirs, files in os.walk(p):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in files:
                if f.endswith('.pyc'):
                    continue
                full = os.path.join(d, f)
                z.write(full, 'app/' + os.path.relpath(full, root).replace(os.sep, '/'), compresslevel=LEVEL)
size = os.path.getsize(tmp)
shutil.copyfile(stub, out)
ofs = os.path.getsize(stub)
with open(out, 'ab') as o, open(tmp, 'rb') as zf:
    shutil.copyfileobj(zf, o)
    o.write(b'SHPAYLD1' + struct.pack('<QQ', ofs, size))
os.remove(tmp)
print('payload', size // 1048576, 'MB at', ofs)
