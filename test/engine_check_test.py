"""
Runs the engine's --check and CPU-load logic against a stand-in `torch` package
for each situation a user can be in. Run: python3 test/engine_check_test.py
"""
import json
import os
import subprocess
import sys
import tempfile
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "..", "engine", "stagehand_stems.py")

FAKE_TORCH = textwrap.dedent('''
    import os
    MODE = os.environ["FAKE_TORCH_MODE"]
    __version__ = "2.8.0+cpu" if MODE == "cpu" else "2.8.0+cu126"
    class version:
        cuda = None if MODE == "cpu" else "12.6"
    _threads = [8]
    def load(*a, **k): return None
    def get_num_threads(): return _threads[0]
    def set_num_threads(n): _threads[0] = n
    class _T:
        def __init__(self, v): self.v = v
        def __mul__(self, k): return _T(self.v * k)
        def sum(self): return _T(self.v * 256)
        def item(self): return self.v
    def ones(n, device=None):
        if device == "cuda" and MODE == "nokernel":
            raise RuntimeError("CUDA error: no kernel image is available for execution on the device\\nCUDA kernel errors might be asynchronously reported")
        return _T(1.0)
    class _Props: total_memory = 11 * 1024 ** 3
    class cuda:
        @staticmethod
        def is_available(): return MODE in ("gpu", "nokernel")
        @staticmethod
        def init():
            if MODE == "olddriver":
                raise RuntimeError("The NVIDIA driver on your system is too old (found version 11020). Please update your GPU driver.")
            raise RuntimeError("Found no NVIDIA driver on your system.")
        @staticmethod
        def synchronize(): pass
        @staticmethod
        def get_device_name(i): return "NVIDIA GeForce GTX 1080 Ti"
        @staticmethod
        def get_arch_list(): return ["sm_61", "sm_70", "sm_75", "sm_80", "sm_86", "sm_90"]
        @staticmethod
        def get_device_capability(i): return (6, 1)
        @staticmethod
        def get_device_properties(i): return _Props()
''')


def make_fakes(root):
    os.makedirs(os.path.join(root, "torch"))
    with open(os.path.join(root, "torch", "__init__.py"), "w") as f:
        f.write(FAKE_TORCH)
    os.makedirs(os.path.join(root, "demucs"))
    with open(os.path.join(root, "demucs", "__init__.py"), "w") as f:
        f.write('__version__ = "4.0.1"\n')
    with open(os.path.join(root, "demucs", "pretrained.py"), "w") as f:
        f.write("import os, time\ndef get_model(name):\n    time.sleep(float(os.environ.get('FAKE_MODEL_SLEEP', '0')))\n    return None\n")
    with open(os.path.join(root, "demucs", "apply.py"), "w") as f:
        f.write("class BagOfModels: pass\ndef apply_model(*a, **k): return None\n")
    os.makedirs(os.path.join(root, "julius"))
    with open(os.path.join(root, "julius", "__init__.py"), "w") as f:
        f.write("")


def run_check(root, mode):
    env = dict(os.environ, PYTHONPATH=root, FAKE_TORCH_MODE=mode)
    out = subprocess.run([sys.executable, ENGINE, "--check"], env=env, capture_output=True, text=True, timeout=60)
    events = [json.loads(l) for l in out.stdout.splitlines() if l.strip().startswith("{")]
    return out.returncode, [e for e in events if e["event"] == "check"][0]


def serve_checks(root):
    """The engine that stays open: quits when the app goes away, reports each job by
    its id, and stops a cancelled one (all without a real PyTorch)."""
    import queue
    import threading
    import time

    env = dict(os.environ, PYTHONPATH=root, FAKE_TORCH_MODE="cpu", FAKE_MODEL_SLEEP="1.5")
    results = []

    def start(*extra):
        p = subprocess.Popen([sys.executable, "-u", ENGINE, "--serve", *extra], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        p.lines = queue.Queue()
        threading.Thread(target=lambda: [p.lines.put(l) for l in p.stdout], daemon=True).start()
        return p

    def read_until(p, test, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = p.lines.get(timeout=max(0.05, end - time.time()))
            except queue.Empty:
                break
            if line.strip().startswith("{"):
                ev = json.loads(line)
                if test(ev):
                    return ev
        return None

    # 1. stdin closes (the app stopped or crashed): the engine quits by itself
    p = start()
    ok = read_until(p, lambda e: e["event"] == "ready") is not None
    t = time.time()
    p.stdin.close()
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.kill()
        ok = False
    results.append(("serve quits when the app closes its input (%.1f s)" % (time.time() - t), ok))

    # 2. a cancel while the model loads: the job ends as cancelled, with its id
    p = start()
    read_until(p, lambda e: e["event"] == "ready")
    p.stdin.write(json.dumps({"cmd": "split", "id": "j1", "input": "x.wav", "outdir": root, "model": "htdemucs"}) + "\n")
    p.stdin.flush()
    time.sleep(0.3)
    p.stdin.write(json.dumps({"cmd": "cancel", "id": "j1"}) + "\n")
    p.stdin.flush()
    ev = read_until(p, lambda e: e["event"] in ("error", "done") and e.get("job") == "j1")
    results.append(("serve stops a cancelled job", bool(ev and ev.get("cancelled"))))

    # 3. the next job still runs (and fails here, the fake model is empty), reported by its id
    p.stdin.write(json.dumps({"cmd": "split", "id": "j2", "input": "x.wav", "outdir": root, "model": "htdemucs"}) + "\n")
    p.stdin.flush()
    ev = read_until(p, lambda e: e["event"] in ("error", "done") and e.get("job") == "j2")
    results.append(("serve carries on with the next job", bool(ev and not ev.get("cancelled"))))
    p.stdin.close()
    p.wait(timeout=10)

    # 4. nothing to do for a while: it closes by itself
    p = start("--idle", "0.5")
    try:
        p.wait(timeout=10)
        ok = p.returncode == 0
    except subprocess.TimeoutExpired:
        p.kill()
        ok = False
    p.stdin.close()
    results.append(("serve closes when idle", ok))
    return results


def main():
    failures = 0
    with tempfile.TemporaryDirectory() as root:
        make_fakes(root)
        cases = {
            "cpu": dict(device="cpu", cuda=False, variant="cpu", cudaBuild=None, cudaError=None),
            "olddriver": dict(device="cpu", cuda=False, variant="cu126", cudaBuild="12.6"),
            "gpu": dict(device="cuda", cuda=True, deviceName="NVIDIA GeForce GTX 1080 Ti", capability="6.1", variant="cu126"),
            "nokernel": dict(device="cpu", cuda=False, variant="cu126"),
        }
        for mode, expect in cases.items():
            code, info = run_check(root, mode)
            bad = [k for k, v in expect.items() if info.get(k) != v]
            if mode == "olddriver" and "too old" not in (info.get("cudaError") or ""):
                bad.append("cudaError")
            if mode == "nokernel" and "no kernel image" not in (info.get("cudaError") or ""):
                bad.append("cudaError")
            status = "ok " if code == 0 and not bad else "FAIL"
            failures += status != "ok "
            print("  %s check (%s): device=%s variant=%s error=%s %s" % (status, mode, info.get("device"), info.get("variant"), info.get("cudaError"), bad or ""))

        # CPU load levels use fewer threads than PyTorch's default of 8 here.
        sys.path.insert(0, root)
        os.environ["FAKE_TORCH_MODE"] = "cpu"
        sys.path.insert(0, os.path.dirname(ENGINE))
        import stagehand_stems as eng  # noqa: E402

        eng.cpu_info = lambda: (16, None)  # (no psutil: full = PyTorch's default)

        got = []
        for level in ("full", "half", "low"):
            import torch  # the fake

            torch.set_num_threads(8)
            got.append(eng.apply_cpu_load(level))
        ok = got == [8, 4, 2]
        failures += not ok
        print("  %s cpu load full/half/low -> %s threads" % ("ok " if ok else "FAIL", got))

        for name, ok in serve_checks(root):
            failures += not ok
            print("  %s %s" % ("ok " if ok else "FAIL", name))
    print("\n%s" % ("all passed" if not failures else "%d failed" % failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
