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

Models: any Demucs model name (htdemucs_6s, htdemucs_ft, htdemucs), or singer_6s:
two passes, a dedicated singer model (BS-RoFormer) takes the vocals out first,
then htdemucs_6s splits what is left into the other five; Demucs' own vocals
leftover goes back into the vocals, so the six stems still add up to the song.
The singer model (639 MB) downloads once on first use, beside Demucs' models
(torch hub's checkpoints folder), resuming a cut-off download; while it
downloads, status events carry "download": 0.0-1.0.

Usage:
  python stagehand_stems.py --input mix.wav --outdir DIR [--model htdemucs_6s]
                            [--device auto|cpu|cuda] [--shifts 1] [--overlap 0.25]
                            [--cpu-load full|half|low]
  python stagehand_stems.py --serve [--idle 600]
  python stagehand_stems.py --check
  python stagehand_stems.py --prefetch htdemucs_6s   (or singer_6s: both of its models)
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import threading
import time
import traceback

os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

_HERE = os.path.dirname(os.path.abspath(__file__))

# The singer model: BS-RoFormer by viperx (vocals SDR 12.97 on MUSDB18-HQ), as UVR
# publishes it. Its code is in roformer/ (MIT). The file is checked against this
# hash before it is used; more addresses can go in "urls" (tried in order).
ROFORMER = {
    "label": "the singer model",
    "file": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    "size": 639331213,
    "sha256": "5b84f37e8d444c8cb30c79d77f613a41c05868ff9c9ac6c7049c00aefae115aa",
    "urls": [
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    ],
    "samplerate": 44100,
    # model_bs_roformer_ep_317_sdr_12.9755.yaml (UVR's mdx_c_configs), the parts used to separate
    "config": dict(
        dim=512, depth=12, stereo=True, num_stems=1,
        time_transformer_depth=1, freq_transformer_depth=1,
        freqs_per_bands=(2,) * 24 + (4,) * 12 + (12,) * 8 + (24,) * 8 + (48,) * 8 + (128, 129),
        dim_head=64, heads=8, attn_dropout=0.1, ff_dropout=0.1, flash_attn=True,
        dim_freqs_in=1025, stft_n_fft=2048, stft_hop_length=441, stft_win_length=2048,
        stft_normalized=False, mask_estimator_depth=2,
    ),
    "chunk": 352800,  # 8 s at 44.1 kHz (audio.chunk_size)
    # each moment is worked on twice (the config says 4: a hair better, twice the time;
    # too slow for a GTX 10-series card or the CPU)
    "overlap": 2,
}

# Two-pass models: the singer model first, then this Demucs model on what is left.
TWO_PASS = {"singer_6s": {"demucs": "htdemucs_6s"}}

# The singer pass's share of the progress bar (with one Demucs shift), from timing
# both passes; more Demucs shifts make the second pass longer.
SINGER_SHARE = {"cpu": 0.8, "cuda": 0.75}


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


def apply_pending_load():
    """serve mode: a new CPU load level from the app, taken between chunks."""
    level = _PENDING_LOAD[0]
    if level:
        _PENDING_LOAD[0] = None
        emit("threads", threads=apply_cpu_load(level), level=level)


class ProgressShim:
    """Replaces demucs' tqdm so progress becomes JSON events. A two-pass split
    gives Demucs the part of the bar from base to base + span."""

    def __init__(self, total_passes, stop=None, base=0.0, span=1.0):
        self.total = max(1, total_passes)
        self.index = -1
        self.base = base
        self.span = span
        self.last = base
        self.stop = stop

    def tqdm(self, iterable, **_kw):
        self.index += 1
        items = list(iterable)
        n = max(1, len(items))
        for i, item in enumerate(items):
            if self.stop and self.stop():
                raise Cancelled()
            apply_pending_load()
            yield item
            value = min(0.999, self.base + self.span * (self.index + (i + 1) / n) / self.total)
            if value - self.last >= 0.005 or i == n - 1:
                self.last = value
                emit("progress", value=round(value, 4))


def singer_share(device, shifts):
    """The singer pass's share of a two-pass split's progress bar."""
    r = SINGER_SHARE.get(device, SINGER_SHARE["cpu"])
    return r / (r + (1.0 - r) * max(1, shifts))


# ---------------------------------------------------------- model download --
def model_dir():
    """Beside Demucs' own downloads (torch hub's checkpoints folder)."""
    import torch.hub

    return os.path.join(torch.hub.get_dir(), "checkpoints")


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _take_lock(lock, stop, label):
    """One download at a time (another engine may be fetching the same file). A
    lock nobody has touched for a minute was left by an engine that was closed."""
    told = False
    while True:
        try:
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            return
        except FileExistsError:
            pass
        try:
            if time.time() - os.path.getmtime(lock) > 60:
                os.remove(lock)
                continue
        except OSError:
            continue
        if stop and stop():
            raise Cancelled()
        if not told:
            told = True
            emit("status", message="Waiting for %s to download" % label)
        time.sleep(1)


def fetch_model(spec, folder, stop=None, urlopen=None, retries=3, wait=2.0):
    """The path of spec's file in folder, downloaded first when missing: resumes
    a cut-off download (.part file, HTTP Range), checks the SHA-256 and tries
    each address in turn. Raises with a plain message when it can't."""
    import urllib.error
    import urllib.request

    urlopen = urlopen or urllib.request.urlopen
    final = os.path.join(folder, spec["file"])
    size = spec["size"]
    if os.path.isfile(final) and os.path.getsize(final) == size:
        return final  # (only a checked download gets this name)
    os.makedirs(folder, exist_ok=True)
    part = final + ".part"
    lock = final + ".lock"
    label = spec["label"]
    _take_lock(lock, stop, label)
    try:
        if os.path.isfile(final) and os.path.getsize(final) == size:
            return final  # another engine just finished it
        if os.path.isfile(final):
            os.remove(final)
        emit("status", message="Downloading %s (%d MB), one time" % (label, round(size / 1e6)), download=0.0)
        state = {"pct": -1, "at": 0.0, "touch": time.time()}

        def report(have, force=False):
            now = time.time()
            if now - state["touch"] > 5:
                state["touch"] = now
                try:
                    os.utime(lock, None)
                except OSError:
                    pass
            pct = int(100 * have / size) if size else 100
            if pct != state["pct"] and (force or now - state["at"] >= 2):
                state["pct"], state["at"] = pct, now
                emit("status", message="Downloading %s: %d%%" % (label, pct), download=round(have / size, 3))

        reason = None
        damaged = False
        for url in spec["urls"]:
            failures = 0
            while failures < retries:
                if stop and stop():
                    raise Cancelled()
                have = os.path.getsize(part) if os.path.isfile(part) else 0
                if have > size:
                    os.remove(part)
                    have = 0
                if have < size:
                    headers = {"User-Agent": "Stagehand"}
                    if have:
                        headers["Range"] = "bytes=%d-" % have
                    try:
                        resp = urlopen(urllib.request.Request(url, headers=headers), timeout=30)
                    except urllib.error.HTTPError as e:
                        if e.code == 416 and have:  # asked past the end: start over
                            os.remove(part)
                            failures += 1
                            continue
                        reason = "the server said %d %s" % (e.code, e.reason)
                        failures += 1 if e.code >= 500 or e.code == 429 else retries  # (a missing file stays missing)
                        continue
                    except Exception as e:  # noqa: BLE001  (offline, name lookup, timeout, refused)
                        reason = first_line(getattr(e, "reason", None) or e)
                        failures += 1
                        if failures < retries:
                            time.sleep(wait)
                        continue
                    grew = False
                    try:
                        status = getattr(resp, "status", None) or resp.getcode()
                        mode = "ab"
                        if have and status != 206:  # the server sent the whole file again
                            have, mode = 0, "wb"
                        report(have, force=True)
                        with open(part, mode) as f:
                            while True:
                                if stop and stop():
                                    raise Cancelled()
                                b = resp.read(1 << 20)
                                if not b:
                                    break
                                f.write(b)
                                have += len(b)
                                grew = True
                                report(have)
                    except Cancelled:
                        raise
                    except Exception as e:  # noqa: BLE001  (cut off: go on from where it stopped)
                        reason = first_line(e)
                        failures = 0 if grew else failures + 1
                        if failures < retries:
                            time.sleep(wait)
                        continue
                    finally:
                        try:
                            resp.close()
                        except Exception:  # noqa: BLE001
                            pass
                    if have < size:
                        reason = "the download stopped early"
                        failures = 0 if grew else failures + 1
                        continue
                report(size, force=True)
                emit("status", message="Checking %s" % label)
                if os.path.getsize(part) == size and _sha256(part) == spec["sha256"]:
                    os.replace(part, final)
                    return final
                os.remove(part)  # damaged or not the right file: from the start, from the next address
                damaged = True
                break
        if damaged and reason is None:
            raise RuntimeError("The download of %s came out damaged. Try again later." % label)
        raise RuntimeError(
            "Couldn't download %s. Check the internet connection and try again (%s)."
            % (label, reason or ("the download came out damaged" if damaged else "no address worked"))
        )
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass


# ---------------------------------------------------------- the singer pass --
def load_roformer(path, spec=None):
    import torch

    spec = spec or ROFORMER
    if _HERE not in sys.path:
        sys.path.insert(0, _HERE)
    from roformer import BSRoformer

    model = BSRoformer(**spec["config"])
    state = torch.load(path, map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    return model.eval()


def roformer_separate(model, mix, device, chunk, overlap, batch=1, progress=None, stop=None, on_gpu_error=None):
    """The singer model over the whole song in overlapping chunks, blended with
    short fades. mix: float32 tensor (channels, frames) on the CPU at the model's
    rate. Returns (vocals shaped like mix on the CPU, the device it finished on).
    A GPU that fails part way (out of memory...) hands over to the CPU: the
    chunks already done are kept and on_gpu_error(exception) is told once."""
    import torch
    import torch.nn.functional as F

    n = mix.shape[-1]
    if n == 0:
        return torch.zeros_like(mix), device
    step = max(1, chunk // max(1, overlap))
    border = chunk - step
    pad = border if (border > 0 and n > 2 * border) else 0
    x = F.pad(mix[None], (pad, pad), mode="reflect")[0] if pad else mix
    total = x.shape[-1]
    fade = min(chunk // 10, border // 2)  # (fades never meet: every moment has a chunk at full weight)
    win = torch.ones(chunk)
    if fade > 0:
        win[:fade] = torch.linspace(0, 1, fade)
        win[-fade:] = torch.linspace(1, 0, fade)
    starts = []
    s = 0
    while True:
        starts.append(s)
        if s + chunk >= total:
            break
        s += step
    out = torch.zeros_like(x)
    weight = torch.zeros(total)
    if device != "cpu":
        model.to(device)
    for b0 in range(0, len(starts), max(1, batch)):
        if stop and stop():
            raise Cancelled()
        apply_pending_load()
        group = starts[b0 : b0 + max(1, batch)]
        parts = []
        for s in group:
            p = x[:, s : s + chunk]
            short = chunk - p.shape[-1]
            if short:  # the last chunk: filled out (mirrored when it can be)
                p = F.pad(p[None], (0, short), mode="reflect" if short < p.shape[-1] else "constant")[0]
            parts.append(p)
        xb = torch.stack(parts)

        def run(dev):
            with torch.inference_mode():
                y = model(xb.to(dev))
                if y.ndim == 4:
                    y = y[:, 0]
                return y.float().cpu()

        try:
            y = run(device)
        except Cancelled:
            raise
        except Exception as e:  # noqa: BLE001
            if device == "cpu":
                raise
            if on_gpu_error:
                on_gpu_error(e)
            model.to("cpu")
            try:
                torch.cuda.empty_cache()
            except Exception:  # noqa: BLE001
                pass
            device = "cpu"
            y = run(device)
        for k, s in enumerate(group):
            ln = min(chunk, total - s)
            w = win.clone()
            if fade and s == 0:
                w[:fade] = 1
            if fade and s + chunk >= total:
                w[-fade:] = 1
            out[:, s : s + ln] += y[k, :, :ln] * w[:ln]
            weight[s : s + ln] += w[:ln]
        if progress:
            progress(min(1.0, (b0 + len(group)) / len(starts)))
    out = out / weight.clamp_min(1e-8)
    return out[:, pad : pad + n].contiguous(), device


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

    if name in TWO_PASS:
        fetch_model(ROFORMER, model_dir())
        name = TWO_PASS[name]["demucs"]
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

    two_pass = args.model in TWO_PASS
    t0 = time.time()
    check_stop()
    loaded = _MODELS.get(args.model) if keep else None
    if loaded is None:
        # singer_6s: the singer model downloads once (it says so) before "Loading model"
        singer_path = fetch_model(ROFORMER, model_dir(), stop=stop) if two_pass else None
        check_stop()
        emit("status", message="Loading model")
        model = get_model(TWO_PASS[args.model]["demucs"] if two_pass else args.model)
        check_stop()
        model.eval()
        singer = load_roformer(singer_path) if two_pass else None
        loaded = (model, singer)
        if keep:
            _MODELS.clear()  # one model at a time: they're big
            _MODELS[args.model] = loaded
    model, singer = loaded
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

    vocals = None
    share = 0.0
    if two_pass:
        if msr != ROFORMER["samplerate"]:
            raise ValueError("The singer model and %s work at different sample rates" % TWO_PASS[args.model]["demucs"])
        check_stop()
        emit("status", message="Separating")
        emit("progress", value=0.0)
        share = singer_share(device, args.shifts)
        last = [0.0]

        def singer_progress(frac):
            value = min(0.999, share * frac)
            if value - last[0] >= 0.005 or frac >= 1.0:
                last[0] = value
                emit("progress", value=round(value, 4))

        def gpu_failed(e):
            reason = "ran out of memory" if "out of memory" in str(e).lower() else "failed (%s)" % first_line(e)
            emit("status", message="GPU %s, finishing on the CPU" % reason)
            emit("device", device="cpu", name="CPU", threads=threads, fallback=reason)

        batch = 1
        if device == "cuda":
            try:
                batch = 2 if torch.cuda.get_device_properties(0).total_memory >= 8 * 1024 ** 3 else 1
            except Exception:  # noqa: BLE001
                pass
        try:
            vocals, device = roformer_separate(
                singer, wav, device, ROFORMER["chunk"], ROFORMER["overlap"], batch=batch,
                progress=singer_progress, stop=stop, on_gpu_error=gpu_failed,
            )
        finally:
            if device != "cpu":  # the card is Demucs' now
                singer.to("cpu")
                free_gpu()
        wav = wav - vocals  # what is left for Demucs: everything but the singer

    ref = wav.mean(0)
    mean = ref.mean()
    std = ref.std() + 1e-8
    wav = (wav - mean) / std

    n_models = len(model.models) if isinstance(model, BagOfModels) else 1
    shim = ProgressShim(n_models * max(1, args.shifts), stop, base=share, span=1.0 - share)
    dapply.tqdm = shim  # apply_model calls tqdm.tqdm(...)
    check_stop()

    if not two_pass:
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
        shim.last = shim.base
        sources = run_on("cpu")

    sources = sources * std + mean
    names = list(model.sources)
    if vocals is not None:  # the singer, plus any voice Demucs still found in the rest
        vi = names.index("vocals")
        sources[vi] = sources[vi] + vocals.to(sources.device, sources.dtype)
    check_stop()
    emit("status", message="Writing stems")
    os.makedirs(args.outdir, exist_ok=True)
    # 4.12: the last step goes easy on the computer (it used every core, and the app
    # stuttered as a split wrapped up): back to the song's rate on the graphics card
    # when it did the splitting, and on half the cores at most
    torch.set_num_threads(max(1, min(threads, (_BASE_THREADS or threads) // 2)))
    try:
        for i, name in enumerate(names):
            s = sources[i]
            if sr != msr:
                try:
                    s = julius.resample_frac(s, msr, sr)
                except Exception:  # noqa: BLE001  (the card is out of memory: on the CPU)
                    s = julius.resample_frac(s.float().cpu(), msr, sr)
            s = s.float().cpu().numpy()
            if s.shape[1] >= frames:
                s = s[:, :frames]
            else:
                s = np.pad(s, ((0, 0), (0, frames - s.shape[1])))
            write_wav16(os.path.join(args.outdir, name + ".wav"), s, sr)
            check_stop()
    finally:
        torch.set_num_threads(threads)

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
