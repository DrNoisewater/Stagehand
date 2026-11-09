"""
Stagehand stem engine.

Splits a WAV file into instrument stems with Demucs and writes one 16-bit WAV
per stem at the source sample rate and exact source length, so every stem
lines up sample-for-sample with the original mix.

Talks to the app with one JSON object per line on stdout:
  {"event": "status",   "message": "..."}
  {"event": "device",   "device": "cuda", "name": "..."}
  {"event": "progress", "value": 0.0-1.0}
  {"event": "done",     "stems": [...], "sampleRate": 48000, "frames": N}
  {"event": "error",    "message": "..."}

In --serve mode the engine stays open and takes one JSON job per line on stdin:
  {"cmd": "split", "id": "j1", "input": "...", "outdir": "...", "model": "htdemucs_6s",
   "shifts": 1, "device": "auto", "cpu_load": "full"}
  {"cmd": "cancel", "id": "j1"}
  {"cmd": "priority", "level": "normal|low"}   (the song you're waiting for runs at normal)
  {"cmd": "load", "level": "full|half|low"}     (CPU threads, applied between chunks)
Every event about a job carries "job": its id. A cancelled job ends with
{"event": "error", "cancelled": true}. The model stays loaded between songs, so
the next split starts at once. It quits when stdin closes (the app went away)
or after 10 minutes with nothing to do.

Usage:
  python stagehand_stems.py --input mix.wav --outdir DIR [--model htdemucs_6s]
                            [--device auto|cpu|cuda] [--shifts 1] [--overlap 0.25]
                            [--cpu-load full|half|low]
  python stagehand_stems.py --serve [--idle 600]
  python stagehand_stems.py --check
  python stagehand_stems.py --prefetch htdemucs_6s
"""
import argparse
import json
import os
import struct
import sys
import threading
import time
import traceback

os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")


_out_lock = threading.Lock()
_job = threading.local()  # the serve-mode job this thread is working on


def emit(event, **kw):
    kw["event"] = event
    jid = getattr(_job, "id", None)
    if jid is not None and "job" not in kw:
        kw["job"] = jid
    with _out_lock:
        sys.stdout.write(json.dumps(kw) + "\n")
        sys.stdout.flush()


class Cancelled(Exception):
    pass


def watch_stdin(on_line=None):
    """Quit at once when stdin closes: the app stopped or went away, so nobody
    wants this split any more (and a split left running would eat the GPU)."""

    def run():
        try:
            for line in sys.stdin:
                if on_line:
                    on_line(line)
        except Exception:  # noqa: BLE001
            pass
        os._exit(0)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


# --------------------------------------------------------------------- WAV --
def read_wav(path):
    import numpy as np

    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Not a WAV file")
    pos = 12
    fmt = None
    while pos + 8 <= len(data):
        cid = data[pos : pos + 4]
        size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = pos + 8
        if cid == b"fmt ":
            tag, ch, sr = struct.unpack("<HHI", data[body : body + 8])
            bits = struct.unpack("<H", data[body + 14 : body + 16])[0]
            if tag == 0xFFFE and size >= 40:
                tag = struct.unpack("<H", data[body + 24 : body + 26])[0]
            fmt = (tag, ch, sr, bits)
        elif cid == b"data":
            if fmt is None:
                raise ValueError("WAV data before format")
            tag, ch, sr, bits = fmt
            raw = data[body : min(body + size, len(data))]
            if tag == 1 and bits == 16:
                a = np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
            elif tag == 1 and bits == 24:
                b = np.frombuffer(raw[: len(raw) // 3 * 3], dtype=np.uint8).reshape(-1, 3)
                v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
                v = np.where(v >= 1 << 23, v - (1 << 24), v)
                a = v.astype(np.float32) / float(1 << 23)
            elif tag == 1 and bits == 32:
                a = np.frombuffer(raw[: len(raw) // 4 * 4], dtype="<i4").astype(np.float32) / float(1 << 31)
            elif tag == 3 and bits == 32:
                a = np.frombuffer(raw[: len(raw) // 4 * 4], dtype="<f4").astype(np.float32)
            else:
                raise ValueError("Unsupported WAV encoding (format %d, %d bits)" % (tag, bits))
            frames = len(a) // ch
            return a[: frames * ch].reshape(frames, ch).T.copy(), sr
        pos = body + size + (size & 1)
    raise ValueError("WAV has no data chunk")


def write_wav16(path, audio, sr):
    """audio: float32 array shaped (channels, frames)."""
    import numpy as np

    ch, frames = audio.shape
    pcm = np.clip(np.round(audio.T * 32767.0), -32768, 32767).astype("<i2").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, ch, sr, sr * ch * 2, ch * 2, 16)
    header += b"data" + struct.pack("<I", len(pcm))
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(header)
        f.write(pcm)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ------------------------------------------------------------------- torch --
def patch_torch_load():
    import torch

    original = torch.load

    def load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return original(*args, **kwargs)

    torch.load = load


def cuda_probe():
    """Returns (ok, device_name, error) after running a real op on the GPU."""
    import torch

    if not torch.version.cuda:
        return False, None, None
    try:
        if not torch.cuda.is_available():
            try:
                torch.cuda.init()  # raises with the real reason (driver missing/too old)
            except Exception as e:  # noqa: BLE001
                return False, None, first_line(e)
            return False, None, "CUDA is not available"
        x = torch.ones(256, device="cuda")
        y = (x * 2).sum().item()
        torch.cuda.synchronize()
        if y != 512:
            return False, None, "GPU returned a wrong result"
        return True, torch.cuda.get_device_name(0), None
    except Exception as e:  # noqa: BLE001
        return False, None, first_line(e)


def first_line(e):
    msg = str(e).strip().splitlines()
    return (msg[0] if msg else e.__class__.__name__)[:300]


def pick_device(pref):
    if pref == "cpu":
        return "cpu", "CPU"
    ok, name, err = cuda_probe()
    if ok:
        return "cuda", name
    if err:
        emit("status", message="GPU unavailable (%s), using the CPU" % err)
    return "cpu", "CPU"


_BASE_THREADS = None
_INTEROP_SET = [False]
_PENDING_LOAD = [None]  # serve mode: a new CPU load level, applied between chunks


def cpu_info():
    """(logical cores, physical cores or None)."""
    logical = os.cpu_count() or 1
    physical = None
    try:
        import psutil  # not always installed

        physical = psutil.cpu_count(logical=False)
    except Exception:  # noqa: BLE001
        pass
    return logical, physical


def set_priority(level):
    """normal for the song you're waiting for; low (below normal) for splits in the background."""
    low = level != "normal"
    try:
        import psutil

        p = psutil.Process()
        if os.name == "nt":
            p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS if low else psutil.NORMAL_PRIORITY_CLASS)
        else:
            p.nice(10 if low else 0)
        return True
    except Exception:  # noqa: BLE001
        pass
    try:
        if os.name == "nt":
            import ctypes

            k = ctypes.windll.kernel32
            return bool(k.SetPriorityClass(k.GetCurrentProcess(), 0x4000 if low else 0x20))
        os.setpriority(os.PRIO_PROCESS, 0, 10 if low else 0)  # (back to normal needs rights on Linux)
        return True
    except Exception:  # noqa: BLE001
        return False


def apply_cpu_load(level):
    """full: PyTorch default (one thread per physical core); half / low use fewer cores."""
    import torch

    global _BASE_THREADS
    if _BASE_THREADS is None:  # the default, read once: later jobs may have changed it
        # full = every physical core (PyTorch's default; extra hyperthreads don't help it)
        _, physical = cpu_info()
        _BASE_THREADS = max(1, physical or torch.get_num_threads())
        if not _INTEROP_SET[0]:
            _INTEROP_SET[0] = True
            try:
                # few threads between operations, all of them within: less fighting over cores
                torch.set_num_interop_threads(max(1, min(4, _BASE_THREADS // 2)))
            except Exception:  # noqa: BLE001  (only allowed before any parallel work)
                pass
    base = _BASE_THREADS
    n = {"half": max(1, base // 2), "low": max(1, base // 4)}.get(level, base)
    torch.set_num_threads(n)
    return n


class ProgressShim:
    """Replaces demucs' tqdm so progress becomes JSON events."""

    def __init__(self, total_passes, stop=None):
        self.total = max(1, total_passes)
        self.index = -1
        self.last = 0.0
        self.stop = stop

    def tqdm(self, iterable, **_kw):
        self.index += 1
        items = list(iterable)
        n = max(1, len(items))
        for i, item in enumerate(items):
            if self.stop and self.stop():
                raise Cancelled()
            level = _PENDING_LOAD[0]
            if level:
                _PENDING_LOAD[0] = None
                emit("threads", threads=apply_cpu_load(level), level=level)
            yield item
            value = min(0.999, (self.index + (i + 1) / n) / self.total)
            if value - self.last >= 0.005 or i == n - 1:
                self.last = value
                emit("progress", value=round(value, 4))


def check():
    info = {"python": sys.version.split()[0]}
    try:
        import torch

        info["torch"] = torch.__version__
        info["variant"] = torch.__version__.split("+", 1)[1] if "+" in torch.__version__ else ("cpu" if not torch.version.cuda else "cuda")
        info["cudaBuild"] = torch.version.cuda
        info["threads"] = torch.get_num_threads()
        if torch.version.cuda:
            try:
                info["arches"] = torch.cuda.get_arch_list()
            except Exception:  # noqa: BLE001
                info["arches"] = []
        ok, name, err = cuda_probe()
        info["cuda"] = ok
        info["cudaError"] = err
        if ok:
            cap = torch.cuda.get_device_capability(0)
            info["capability"] = "%d.%d" % cap
            info["vram"] = torch.cuda.get_device_properties(0).total_memory
        info["device"] = "cuda" if ok else "cpu"
        info["deviceName"] = name if ok else "CPU"
    except Exception as e:  # noqa: BLE001
        emit("check", ok=False, error="PyTorch is not installed: %s" % e, **info)
        return 1
    try:
        import demucs

        info["demucs"] = getattr(demucs, "__version__", "?")
        from demucs.pretrained import get_model  # noqa: F401
        from demucs.apply import apply_model  # noqa: F401
    except Exception as e:  # noqa: BLE001
        emit("check", ok=False, error="Demucs is not installed: %s" % e, **info)
        return 1
    emit("check", ok=True, **info)
    return 0


def prefetch(name):
    patch_torch_load()
    from demucs.pretrained import get_model

    emit("status", message="Downloading model %s" % name)
    get_model(name)
    emit("status", message="Model ready")
    return 0


_MODELS = {}  # serve mode: models already loaded, by name
_DEVICES = {}  # serve mode: the device picked for each setting (the GPU test runs once)
_torch_patched = [False]


def separate(args, stop=None, keep=False):
    """Splits args.input into args.outdir. stop() -> True cancels (serve mode);
    keep=True keeps the model and the device choice for the next song."""

    def check_stop():
        if stop and stop():
            raise Cancelled()

    import torch

    if not _torch_patched[0]:
        patch_torch_load()
        _torch_patched[0] = True
    import demucs.apply as dapply
    from demucs.apply import BagOfModels, apply_model
    from demucs.pretrained import get_model
    import julius

    t0 = time.time()
    check_stop()
    model = _MODELS.get(args.model) if keep else None
    if model is None:
        emit("status", message="Loading model")
        model = get_model(args.model)
        check_stop()
        model.eval()
        if keep:
            _MODELS.clear()  # one model at a time: they're big
            _MODELS[args.model] = model
    check_stop()
    if keep and args.device in _DEVICES:
        device, device_name = _DEVICES[args.device]
    else:
        device, device_name = pick_device(args.device)
        if keep:
            _DEVICES[args.device] = (device, device_name)
    _PENDING_LOAD[0] = None
    threads = apply_cpu_load(args.cpu_load)
    logical, physical = cpu_info()
    emit("device", device=device, name=device_name, threads=threads, cores=logical, physical=physical or _BASE_THREADS)

    import numpy as np

    emit("status", message="Reading audio")
    audio, sr = read_wav(args.input)
    frames = audio.shape[1]
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    elif audio.shape[0] > 2:
        audio = audio[:2]

    wav = torch.from_numpy(audio)
    msr = model.samplerate
    if sr != msr:
        wav = julius.resample_frac(wav, sr, msr)

    ref = wav.mean(0)
    mean = ref.mean()
    std = ref.std() + 1e-8
    wav = (wav - mean) / std

    n_models = len(model.models) if isinstance(model, BagOfModels) else 1
    shim = ProgressShim(n_models * max(1, args.shifts), stop)
    dapply.tqdm = shim  # apply_model calls tqdm.tqdm(...)
    check_stop()

    emit("status", message="Separating")
    emit("progress", value=0.0)

    def run_on(dev):
        with torch.no_grad():
            return apply_model(
                model, wav[None], device=dev, shifts=args.shifts, split=True,
                overlap=args.overlap, progress=True, num_workers=0,
            )[0]

    try:
        sources = run_on(device)
    except Cancelled:
        raise
    except Exception as e:  # noqa: BLE001
        if device != "cuda":
            raise
        # Out of memory, missing kernels for this card, driver hiccups: finish on the CPU.
        reason = "ran out of memory" if "out of memory" in str(e).lower() else "failed (%s)" % first_line(e)
        emit("status", message="GPU %s, finishing on the CPU" % reason)
        try:
            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass
        device = "cpu"
        emit("device", device="cpu", name="CPU", threads=threads, fallback=reason)
        shim.index = -1
        shim.last = 0.0
        sources = run_on("cpu")

    sources = sources * std + mean
    check_stop()
    emit("status", message="Writing stems")
    os.makedirs(args.outdir, exist_ok=True)
    names = list(model.sources)
    for i, name in enumerate(names):
        s = sources[i].float().cpu()
        if sr != msr:
            s = julius.resample_frac(s, msr, sr)
        s = s.numpy()
        if s.shape[1] >= frames:
            s = s[:, :frames]
        else:
            s = np.pad(s, ((0, 0), (0, frames - s.shape[1])))
        write_wav16(os.path.join(args.outdir, name + ".wav"), s, sr)

    emit("progress", value=1.0)
    emit("done", stems=names, sampleRate=sr, frames=int(frames), seconds=round(time.time() - t0, 1), device=device)
    return 0


def free_gpu():
    try:
        import torch

        if torch.version.cuda and torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def serve(idle_seconds=600):
    """Stays open and splits one song after another (see the top of this file)."""
    import queue
    from types import SimpleNamespace

    jobs = queue.Queue()
    cancelled = set()
    lock = threading.Lock()

    def on_line(line):
        line = line.strip()
        if not line:
            return
        try:
            msg = json.loads(line)
        except ValueError:
            return
        cmd = msg.get("cmd")
        if cmd == "split":
            jobs.put(msg)
        elif cmd == "cancel":
            with lock:
                cancelled.add(str(msg.get("id")))
        elif cmd == "priority":
            set_priority(msg.get("level"))
        elif cmd == "load" and msg.get("level") in ("full", "half", "low"):
            _PENDING_LOAD[0] = msg.get("level")
        elif cmd == "quit":
            jobs.put(None)

    watch_stdin(on_line)  # quits the whole engine when stdin closes
    emit("ready", serve=True)
    while True:
        try:
            msg = jobs.get(timeout=idle_seconds)
        except queue.Empty:
            emit("status", message="Idle, closing")
            return 0
        if msg is None:
            return 0
        jid = str(msg.get("id"))
        _job.id = jid
        try:
            with lock:
                if jid in cancelled:
                    raise Cancelled()
            args = SimpleNamespace(
                input=msg["input"], outdir=msg["outdir"], model=msg.get("model") or "htdemucs_6s",
                shifts=int(msg.get("shifts") or 1), overlap=float(msg.get("overlap") or 0.25),
                device=msg.get("device") or "auto", cpu_load=msg.get("cpu_load") or "full",
            )

            if msg.get("priority"):
                set_priority(msg.get("priority"))

            def stop(jid=jid):
                with lock:
                    return jid in cancelled

            separate(args, stop=stop, keep=True)
        except Cancelled:
            emit("error", message="Cancelled", cancelled=True)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(traceback.format_exc())
            sys.stderr.flush()
            emit("error", message=str(e) or e.__class__.__name__)
        finally:
            _job.id = None
            with lock:
                cancelled.discard(jid)
            free_gpu()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--outdir")
    ap.add_argument("--model", default="htdemucs_6s")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--shifts", type=int, default=1)
    ap.add_argument("--overlap", type=float, default=0.25)
    ap.add_argument("--cpu-load", dest="cpu_load", default="full", choices=["full", "half", "low"])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--prefetch")
    ap.add_argument("--priority", choices=["normal", "low"])
    ap.add_argument("--serve", action="store_true")
    ap.add_argument("--idle", type=float, default=600)
    ap.add_argument("--watch-stdin", dest="watch_stdin", action="store_true")
    args = ap.parse_args()
    try:
        if args.serve:
            return serve(args.idle)
        if args.watch_stdin:
            watch_stdin()
        if args.check:
            return check()
        if args.prefetch:
            return prefetch(args.prefetch)
        if not args.input or not args.outdir:
            ap.error("--input and --outdir are required")
        if args.priority:
            set_priority(args.priority)
        return separate(args)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(traceback.format_exc())
        emit("error", message=str(e) or e.__class__.__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
