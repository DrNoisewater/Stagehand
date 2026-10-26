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
        f.write("def get_model(name): return None\n")
    with open(os.path.join(root, "demucs", "apply.py"), "w") as f:
        f.write("def apply_model(*a, **k): return None\n")


def run_check(root, mode):
    env = dict(os.environ, PYTHONPATH=root, FAKE_TORCH_MODE=mode)
    out = subprocess.run([sys.executable, ENGINE, "--check"], env=env, capture_output=True, text=True, timeout=60)
    events = [json.loads(l) for l in out.stdout.splitlines() if l.strip().startswith("{")]
    return out.returncode, [e for e in events if e["event"] == "check"][0]


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

        got = []
        for level in ("full", "half", "low"):
            import torch  # the fake

            torch.set_num_threads(8)
            got.append(eng.apply_cpu_load(level))
        ok = got == [8, 4, 2]
        failures += not ok
        print("  %s cpu load full/half/low -> %s threads" % ("ok " if ok else "FAIL", got))
    print("\n%s" % ("all passed" if not failures else "%d failed" % failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
