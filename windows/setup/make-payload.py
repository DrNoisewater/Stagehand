#!/usr/bin/env python3
"""Appends the install payload (one zip: runtime/, app/, vgmstream/, uv/) to the setup stub.
make-payload.py stub.exe out.exe <repo root> <electron zip> <vgmstream zip> <uv zip>"""
import sys, os, zipfile, struct, shutil, io
stub, out, root, ezip, vzip, uzip = sys.argv[1:7]
APP = ['package.json', 'src', 'engine', 'build', 'native/bin']
SKIP_DIRS = {'__pycache__', 'node_modules', '.git'}
tmp = out + '.zip'
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    def copy_zip(src, prefix, strip_top=False):
        with zipfile.ZipFile(src) as s:
            names = [n for n in s.namelist() if not n.endswith('/')]
            top = os.path.commonprefix(names) if strip_top else ''
            top = top[:top.rfind('/') + 1] if '/' in top else ''
            for n in names:
                rel = n[len(top):]
                info = zipfile.ZipInfo(prefix + rel, date_time=s.getinfo(n).date_time)
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, s.read(n), compresslevel=9)
    copy_zip(ezip, 'runtime/')
    for item in APP:
        p = os.path.join(root, item)
        if os.path.isfile(p):
            z.write(p, 'app/' + item)
            continue
        for d, dirs, files in os.walk(p):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in files:
                if f.endswith('.pyc'):
                    continue
                full = os.path.join(d, f)
                z.write(full, 'app/' + os.path.relpath(full, root).replace(os.sep, '/'))
    copy_zip(vzip, 'vgmstream/', strip_top=True)
    copy_zip(uzip, 'uv/', strip_top=True)
size = os.path.getsize(tmp)
shutil.copyfile(stub, out)
ofs = os.path.getsize(stub)
with open(out, 'ab') as o, open(tmp, 'rb') as zf:
    shutil.copyfileobj(zf, o)
    o.write(b'SHPAYLD1' + struct.pack('<QQ', ofs, size))
os.remove(tmp)
print('payload', size // 1048576, 'MB at', ofs)
