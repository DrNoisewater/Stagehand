"""
The two-pass "singer_6s" split in engine/stagehand_stems.py, without the real
models: the singer model's download (resume, a cut-off connection, a damaged
file, a second address, offline, cancel, a lock left behind) against a local web
server, the progress bar shared by the two passes, and, when PyTorch is
installed, the chunked singer pass and the whole split with stand-in models (the
six stems add up to the song). Run: python test/singer_stems_test.py
"""
import hashlib
import os
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import ModuleType, SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"

import stagehand_stems as eng  # noqa: E402  (plain Python at import: no PyTorch needed)

EVENTS = []
eng.emit = lambda event, **kw: EVENTS.append(dict(kw, event=event))

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print("  %s %s%s" % ("ok  " if ok else "FAIL", name, (" (%s)" % detail) if detail and not ok else ""))


# ------------------------------------------------------------- web server --
PAYLOAD = bytes((i * 7 + (i >> 9)) & 0xFF for i in range(3 * 1024 * 1024 + 123))
SPEC = {
    "label": "the test model",
    "file": "test-model.bin",
    "size": len(PAYLOAD),
    "sha256": hashlib.sha256(PAYLOAD).hexdigest(),
    "urls": [],
}
SEEN = []  # (path, Range header)
CUT = {"left": 0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        SEEN.append((self.path, self.headers.get("Range")))
        if self.path == "/missing":
            self.send_error(404)
            return
        body = PAYLOAD if self.path != "/bad" else PAYLOAD[:-1] + b"\x00"
        start = 0
        rng = self.headers.get("Range")
        if rng and self.path != "/norange":
            start = int(rng.split("=")[1].split("-")[0])
            if start >= len(body):
                self.send_response(416)
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, len(body) - 1, len(body)))
        else:
            self.send_response(200)
        self.send_header("Content-Length", str(len(body) - start))
        self.end_headers()
        data = body[start:]
        if self.path == "/cut" and CUT["left"] > 0:  # the connection drops part way
            CUT["left"] -= 1
            self.wfile.write(data[: 1024 * 1024])
            self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        self.wfile.write(data)


def download_checks(root):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    final = os.path.join(root, SPEC["file"])
    part = final + ".part"
    lock = final + ".lock"

    def spec(*paths):
        return dict(SPEC, urls=[base + p for p in paths])

    def fresh():
        for p in (final, part, lock):
            if os.path.exists(p):
                os.remove(p)
        del SEEN[:]
        del EVENTS[:]

    def good_file():
        with open(final, "rb") as f:
            return f.read() == PAYLOAD

    def fetch(sp, **kw):
        kw.setdefault("wait", 0)
        return eng.fetch_model(sp, root, **kw)

    try:
        # 1. a first download
        fresh()
        path = fetch(spec("/good"))
        msgs = [e.get("message") for e in EVENTS if e["event"] == "status"]
        check("downloads the model, checked, into the folder", path == final and good_file() and not os.path.exists(part) and not os.path.exists(lock))
        check("says so in plain words, with a percentage", "Downloading the test model (3 MB), one time" in msgs and "Downloading the test model: 100%" in msgs, msgs)
        check("download events carry a 0-1 value", any(e.get("download") == 1.0 for e in EVENTS))

        # 2. already there: nothing fetched
        del SEEN[:]
        check("a model already there is used as it is", fetch(spec("/good")) == final and not SEEN)

        # 3. a .part left by an engine that was closed: goes on from there
        fresh()
        with open(part, "wb") as f:
            f.write(PAYLOAD[:1500000])
        fetch(spec("/good"))
        check("resumes a cut-off download from where it stopped", good_file() and SEEN == [("/good", "bytes=1500000-")], SEEN)

        # 4. the connection drops part way: picks up again by itself
        fresh()
        CUT["left"] = 2
        fetch(spec("/cut"))
        ranges = [r for _, r in SEEN]
        check("a dropped connection is picked up again", good_file() and len(SEEN) == 3 and ranges[0] is None and ranges[1] == "bytes=1048576-", SEEN)

        # 5. a server that ignores Range: starts the file over
        fresh()
        with open(part, "wb") as f:
            f.write(b"x" * 1000)
        fetch(spec("/norange"))
        check("a server that sends the whole file again: starts over", good_file())

        # 6. a damaged file is refused and thrown away
        fresh()
        err = None
        try:
            fetch(spec("/bad"))
        except RuntimeError as e:
            err = str(e)
        check("a damaged download is refused", err is not None and "damaged" in err and not os.path.exists(final) and not os.path.exists(part), err)
        check("the lock is let go after a failure", not os.path.exists(lock))

        # 7. a dead first address: the next one is tried
        fresh()
        fetch(spec("/missing", "/good"))
        check("tries the next address when the first fails", good_file() and [p for p, _ in SEEN] == ["/missing", "/good"], SEEN)

        # 8. damaged at the first address, fine at the second
        fresh()
        fetch(spec("/bad", "/good"))
        check("a damaged file from one address, a good one from the next", good_file())

        # 9. offline (nothing listens there)
        fresh()
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        dead = "http://127.0.0.1:%d/m" % s.getsockname()[1]
        s.close()
        err = None
        t = time.time()
        try:
            eng.fetch_model(dict(SPEC, urls=[dead]), root, wait=0)
        except RuntimeError as e:
            err = str(e)
        check("offline: a clear message", err is not None and err.startswith("Couldn't download the test model. Check the internet connection") and time.time() - t < 20, err)

        # 10. cancelled part way: stops, keeps what it has for next time
        fresh()
        calls = {"n": 0}

        def stop():
            calls["n"] += 1
            return calls["n"] > 3

        cancelled = False
        try:
            fetch(spec("/good"), stop=stop)
        except eng.Cancelled:
            cancelled = True
        kept = os.path.getsize(part) if os.path.exists(part) else 0
        check("a cancel stops the download and keeps the part", cancelled and 0 < kept < len(PAYLOAD) and not os.path.exists(final) and not os.path.exists(lock), kept)
        fetch(spec("/good"))
        check("and the next try finishes it", good_file() and SEEN[-1][1] == "bytes=%d-" % kept)

        # 11. a lock left behind by an engine that was closed long ago
        fresh()
        open(lock, "w").close()
        old = time.time() - 600
        os.utime(lock, (old, old))
        fetch(spec("/good"))
        check("a stale lock is taken over", good_file() and not os.path.exists(lock))

        # 12. another engine is downloading: waits for it, then uses its file
        fresh()
        open(lock, "w").close()

        def other():
            time.sleep(1.5)
            with open(final, "wb") as f:
                f.write(PAYLOAD)
            os.remove(lock)

        th = threading.Thread(target=other)
        th.start()
        path = fetch(spec("/good"))
        th.join()
        msgs = [e.get("message") for e in EVENTS if e["event"] == "status"]
        check("waits for another engine's download", path == final and not SEEN and "Waiting for the test model to download" in msgs, (SEEN, msgs))
    finally:
        srv.shutdown()
        srv.server_close()


# ----------------------------------------------------------------- progress --
def progress_checks():
    r = eng.SINGER_SHARE
    check("the singer pass takes its share of the bar", abs(eng.singer_share("cpu", 1) - r["cpu"]) < 1e-9 and abs(eng.singer_share("cuda", 1) - r["cuda"]) < 1e-9)
    check("more Demucs shifts give Demucs more of the bar", eng.singer_share("cpu", 2) < eng.singer_share("cpu", 1) and eng.singer_share("cpu", 0) == eng.singer_share("cpu", 1))
    del EVENTS[:]
    shim = eng.ProgressShim(2, base=0.75, span=0.25)
    for _ in range(2):
        for _ in shim.tqdm(range(10)):
            pass
    vals = [e["value"] for e in EVENTS if e["event"] == "progress"]
    check("Demucs' part of the bar runs from the singer's share to the end",
          vals and vals[0] > 0.75 and vals == sorted(vals) and abs(vals[-1] - 0.999) < 1e-9 and abs(vals[9] - 0.875) < 1e-9, vals)
    del EVENTS[:]
    shim = eng.ProgressShim(1)
    for _ in shim.tqdm(range(4)):
        pass
    vals = [e["value"] for e in EVENTS if e["event"] == "progress"]
    check("a one-pass split's bar is as before", vals == [0.25, 0.5, 0.75, 0.999], vals)


# ----------------------------------------------------- with PyTorch only --
def torch_checks(root):
    import numpy as np
    import torch

    class Gain(torch.nn.Module):
        """Stands in for the singer model: a share of the input, shaped like its output."""

        def __init__(self, g=1.0, fail_gpu=False):
            super().__init__()
            self.g = g
            self.fail_gpu = fail_gpu
            self.on = "cpu"
            self.calls = 0

        def to(self, dev):
            self.on = str(dev)
            return self

        def forward(self, x):
            self.calls += 1
            if self.fail_gpu and self.on != "cpu":
                raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
            return (x * self.g)[:, None]

    # the chunks put back together give back the song, whatever its length
    torch.manual_seed(0)
    worst = 0.0
    for n in (1, 100, 999, 1000, 1001, 2500, 4321, 10007):
        x = torch.randn(2, n)
        for overlap in (1, 2, 4):
            for batch in (1, 3):
                y, dev = eng.roformer_separate(Gain(), x, "cpu", 1000, overlap, batch=batch)
                worst = max(worst, float((y - x).abs().max()))
                if y.shape != x.shape or dev != "cpu":
                    worst = 1.0
    check("overlapping chunks blend back into the whole song (any length)", worst < 1e-5, worst)

    prog = []
    x = torch.randn(2, 9000)
    y, _ = eng.roformer_separate(Gain(0.5), x, "cpu", 1000, 2, progress=prog.append)
    check("the singer pass reports its progress up to 1", prog == sorted(prog) and prog[-1] == 1.0 and len(prog) > 5, prog)
    check("the singer's share comes out shaped like the song", y.shape == x.shape and float((y - 0.5 * x).abs().max()) < 1e-5)

    told = []
    m = Gain(fail_gpu=True)
    y, dev = eng.roformer_separate(m, x, "cuda", 1000, 2, batch=2, on_gpu_error=told.append)
    check("a GPU that runs out of memory hands over to the CPU", dev == "cpu" and len(told) == 1 and m.on == "cpu" and float((y - x).abs().max()) < 1e-5, (dev, told))

    stops = {"n": 0}

    def stop():
        stops["n"] += 1
        return stops["n"] > 2

    try:
        eng.roformer_separate(Gain(), x, "cpu", 1000, 2, stop=stop)
        ok = False
    except eng.Cancelled:
        ok = True
    check("a cancel stops the singer pass between chunks", ok)

    # the vendored model itself, tiny, untrained
    try:
        import einops  # noqa: F401
    except ImportError:
        print("  --   tiny BS-RoFormer skipped (einops not installed here)")
    else:
        sys.path.insert(0, os.path.join(HERE, "..", "engine"))
        from roformer import BSRoformer

        cfg = dict(dim=16, depth=1, stereo=True, num_stems=1, time_transformer_depth=1, freq_transformer_depth=1,
                   freqs_per_bands=(32, 32, 65), dim_head=8, heads=2, stft_n_fft=256, stft_hop_length=64,
                   stft_win_length=256, mask_estimator_depth=2, multi_stft_hop_size=147)
        a = BSRoformer(**cfg).eval()
        b = BSRoformer(**cfg).eval()
        b.load_state_dict(a.state_dict(), strict=True)
        with torch.inference_mode():
            x = torch.randn(2, 2, 3000)
            ya, yb = a(x), b(x)
        check("the vendored BS-RoFormer runs: (batch, stems, channels, time), finite",
              tuple(ya.shape) == (2, 1, 2, 3000) and bool(torch.isfinite(ya).all()) and torch.equal(ya, yb), tuple(ya.shape))

    # the whole two-pass split with stand-in models
    weights = {"drums": 0.3, "bass": 0.2, "other": 0.2, "vocals": 0.1, "guitar": 0.15, "piano": 0.05}

    class FakeDemucs:
        samplerate = 44100
        sources = list(weights)

        def eval(self):
            return self

    apply_mod = ModuleType("demucs.apply")
    apply_mod.BagOfModels = type("BagOfModels", (), {})
    apply_mod.tqdm = None
    seen = {}

    def apply_model(model, mix, device=None, shifts=1, **_kw):
        seen["mix"] = mix.clone()
        for _ in apply_mod.tqdm.tqdm(range(6)):
            pass
        w = torch.tensor([weights[s] for s in model.sources])[None, :, None, None]
        return mix[:, None] * w

    apply_mod.apply_model = apply_model
    pre = ModuleType("demucs.pretrained")
    pre.get_model = lambda name: (seen.__setitem__("demucs", name), FakeDemucs())[1]
    dem = ModuleType("demucs")
    dem.apply, dem.pretrained = apply_mod, pre
    jul = ModuleType("julius")
    jul.resample_frac = lambda *a, **k: (_ for _ in ()).throw(AssertionError("no resample at 44.1 kHz"))
    saved = {k: sys.modules.get(k) for k in ("demucs", "demucs.apply", "demucs.pretrained", "julius")}
    sys.modules.update({"demucs": dem, "demucs.apply": apply_mod, "demucs.pretrained": pre, "julius": jul})
    real = (eng.fetch_model, eng.load_roformer, eng.model_dir, eng.ROFORMER)
    singer = Gain(0.4)
    fetched = []
    eng.fetch_model = lambda spec, folder, stop=None: (fetched.append(spec["file"]), "singer.ckpt")[1]
    eng.load_roformer = lambda path, spec=None: singer
    eng.model_dir = lambda: root
    eng.ROFORMER = dict(eng.ROFORMER, chunk=44100)  # 1 s chunks: several of them in 3 s
    try:
        sr = 44100
        t = np.arange(3 * sr) / sr
        mix = np.stack([0.5 * np.sin(2 * np.pi * 220 * t), 0.4 * np.sin(2 * np.pi * 330 * t + 1)]).astype(np.float32)
        wav = os.path.join(root, "mix.wav")
        eng.write_wav16(wav, mix, sr)
        mix, _ = eng.read_wav(wav)
        out = os.path.join(root, "stems")
        del EVENTS[:]
        args = SimpleNamespace(input=wav, outdir=out, model="singer_6s", shifts=1, overlap=0.25, device="cpu", cpu_load="full")
        eng.separate(args)
        done = [e for e in EVENTS if e["event"] == "done"]
        stems = {n: eng.read_wav(os.path.join(out, n + ".wav"))[0] for n in weights}
        total = sum(stems.values())
        check("singer_6s writes the same six stems", bool(done) and sorted(done[0]["stems"]) == sorted(weights) and done[0]["frames"] == mix.shape[1] and done[0]["sampleRate"] == sr)
        check("the six stems add up to the song", float(np.abs(total - mix).max()) < 2e-3, float(np.abs(total - mix).max()))
        # vocals: the singer model's 40%, plus Demucs' 10% of what was left
        check("vocals = the singer model's + Demucs' leftover", float(np.abs(stems["vocals"] - 0.46 * mix).max()) < 2e-3)
        check("Demucs splits only what the singer model left", float(np.abs(stems["guitar"] - 0.15 * 0.6 * mix).max()) < 2e-3)
        check("the singer model downloads first, then htdemucs_6s loads", fetched == [eng.ROFORMER["file"]] and seen.get("demucs") == "htdemucs_6s")
        vals = [e["value"] for e in EVENTS if e["event"] == "progress"]
        share = eng.singer_share("cpu", 1)
        statuses = [e["message"] for e in EVENTS if e["event"] == "status"]
        check("one progress bar across both passes, 0 to 1",
              vals[0] == 0.0 and vals[-1] == 1.0 and vals == sorted(vals) and any(abs(v - round(share, 4)) < 1e-9 for v in vals)
              and sum(1 for v in vals if 0 < v < share) >= 2 and sum(1 for v in vals if share < v < 1) >= 3, vals)
        check("the same status words as a Demucs split", statuses == ["Loading model", "Reading audio", "Separating", "Writing stems"], statuses)

        # a cancel during the singer pass
        del EVENTS[:]
        n = {"k": 0}

        def stop():
            n["k"] += 1
            return n["k"] > 4

        try:
            eng.separate(SimpleNamespace(**dict(vars(args), outdir=os.path.join(root, "stems2"))), stop=stop)
            ok = False
        except eng.Cancelled:
            ok = True
        check("a cancel stops a two-pass split", ok and not any(e["event"] == "done" for e in EVENTS))

        # --prefetch singer_6s fetches both models
        del fetched[:]
        seen.pop("demucs", None)
        eng.prefetch("singer_6s")
        check("--prefetch singer_6s fetches both models", fetched == [eng.ROFORMER["file"]] and seen.get("demucs") == "htdemucs_6s")
    finally:
        eng.fetch_model, eng.load_roformer, eng.model_dir, eng.ROFORMER = real
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v


def main():
    with tempfile.TemporaryDirectory() as root:
        print("singer model download:")
        download_checks(root)
        print("progress:")
        progress_checks()
        try:
            import torch  # noqa: F401
            import numpy  # noqa: F401
        except ImportError:
            print("the singer pass and the two-pass split: skipped (PyTorch is not installed here)")
        else:
            print("the singer pass and the two-pass split (stand-in models):")
            torch_checks(root)
    failed = results.count(False)
    print("\n%s" % ("all passed" if not failed else "%d failed" % failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
