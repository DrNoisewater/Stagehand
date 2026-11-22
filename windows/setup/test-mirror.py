#!/usr/bin/env python3
"""Test stand-in for GitHub's downloads (Setup's STAGEHAND_SETUP_MIRROR):
  python test-mirror.py <folder> <port>
Serves the files in <folder> by name, with Range requests (resuming). With DROP=<bytes>
the first answer for each file is cut off after that many bytes, like a dropped
connection, so Setup has to carry on from where it stopped. Logs to <folder>/../mirror.log.
4.27: with ART_ROOT=<a Stagehand checkout>, /art/<path> serves that file from it (Setup's
STAGEHAND_ART_MIRROR=http://127.0.0.1:<port>/art); ART_DROP=<bytes> cuts off the first answer
for each picture bigger than that, so Setup has to fetch it again."""
import http.server, os, sys, re
ROOT, PORT = sys.argv[1], int(sys.argv[2])
DROP = int(os.environ.get('DROP', '0'))
ART_ROOT = os.environ.get('ART_ROOT', '')
ART_DROP = int(os.environ.get('ART_DROP', '0'))
dropped = set()
log = open(os.path.join(os.path.dirname(ROOT), 'mirror.log'), 'a')
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        art = ART_ROOT and self.path.startswith('/art/')
        if art:
            rel = self.path[5:]
            p = os.path.join(ART_ROOT, *rel.split('/'))
            if '..' in rel or not os.path.realpath(p).startswith(os.path.realpath(ART_ROOT)):
                self.send_response(403); self.end_headers(); return
        else:
            p = os.path.join(ROOT, os.path.basename(self.path))
        if not os.path.exists(p):
            self.send_response(404); self.end_headers(); return
        size = os.path.getsize(p)
        start = 0
        m = re.match(r'bytes=(\d+)-', self.headers.get('Range', ''))
        if m:
            start = int(m.group(1))
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{size-1}/{size}')
        else:
            self.send_response(200)
        self.send_header('Content-Length', str(size - start))
        self.end_headers()
        log.write(f'{self.path} range={start}\n'); log.flush()
        cut = (ART_DROP if art else DROP) if self.path not in dropped else 0
        if cut and cut >= size - start: cut = 0
        if cut: dropped.add(self.path)
        with open(p, 'rb') as f:
            f.seek(start)
            sent = 0
            while True:
                b = f.read(1 << 16)
                if not b: break
                if cut and sent + len(b) > cut:
                    self.wfile.write(b[:cut - sent]); self.wfile.flush(); self.connection.close(); return
                self.wfile.write(b); sent += len(b)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
