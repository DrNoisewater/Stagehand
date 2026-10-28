'use strict';
/**
 * External helpers Stagehand installs into its own app-data folder:
 *  - vgmstream-cli: decodes Rocksmith's Wwise .wem audio
 *  - the stem engine: uv + a private Python 3.12 + PyTorch + Demucs
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter, once } = require('events');
const { unzip } = require('../core/files');
const gpu = require('../core/gpu');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';

const URLS = {
  vgmstream: IS_WIN
    ? 'https://github.com/vgmstream/vgmstream/releases/latest/download/vgmstream-win64.zip'
    : 'https://github.com/vgmstream/vgmstream/releases/latest/download/vgmstream-linux.zip',
  uv: IS_WIN
    ? 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
    : 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz',
  torchIndex: (variant) => `https://download.pytorch.org/whl/${variant}`,
};

const ENGINE_PINS = {
  python: '3.12',
  torch: 'torch==2.8.0',
  torchaudio: 'torchaudio==2.8.0',
  demucs: 'demucs==4.0.1',
};

function which(cmd) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, cmd + e);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch (_) {}
    }
  }
  return null;
}

function run(cmd, args, { env, cwd, onLine, signal, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    let tail = '';
    const feed = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      if (onLine) text.split(/\r?\n|\r/).forEach((l) => l.trim() && onLine(l));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    if (signal) signal.onabort = () => child.kill();
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
    child.on('close', () => timer && clearTimeout(timer));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(tail);
      else {
        const e = new Error(signal && signal.aborted ? 'Cancelled' : `${path.basename(cmd)} exited with code ${code}`);
        e.output = tail;
        e.cancelled = !!(signal && signal.aborted);
        reject(e);
      }
    });
  });
}

class Tools extends EventEmitter {
  constructor({ toolsDir, engineDir, settings, fetchImpl, engineScript }) {
    super();
    this.toolsDir = toolsDir;
    this.engineDir = engineDir;
    this.settings = settings;
    this.fetch = fetchImpl;
    this.engineScript = engineScript;
    this._engineStatus = null;
    this._setupAbort = null;
  }

  // ------------------------------------------------------------ download --
  async download(url, dest, onProgress) {
    const res = await this.fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let got = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await once(out, 'drain');
        if (onProgress) onProgress(got, total);
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
      await fsp.rename(tmp, dest);
    } catch (err) {
      out.destroy();
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  // ----------------------------------------------------------- vgmstream --
  vgmstreamPath() {
    const custom = this.settings.get().tools.vgmstream;
    if (custom && fs.existsSync(custom)) return custom;
    const bundled = path.join(this.toolsDir, 'vgmstream', 'vgmstream-cli' + EXE);
    if (fs.existsSync(bundled)) return bundled;
    return which('vgmstream-cli');
  }

  async installVgmstream(onProgress = () => {}) {
    const dir = path.join(this.toolsDir, 'vgmstream');
    const zip = path.join(this.toolsDir, 'vgmstream.zip');
    onProgress({ step: 'Downloading vgmstream', value: 0 });
    await this.download(URLS.vgmstream, zip, (got, total) => onProgress({ step: 'Downloading vgmstream', value: total ? got / total : 0 }));
    onProgress({ step: 'Unpacking', value: 1 });
    await fsp.rm(dir, { recursive: true, force: true });
    await unzip(zip, dir);
    await fsp.unlink(zip).catch(() => {});
    const exe = path.join(dir, 'vgmstream-cli' + EXE);
    if (!fs.existsSync(exe)) throw new Error('vgmstream-cli was not found in the download');
    if (!IS_WIN) await fsp.chmod(exe, 0o755);
    await run(exe, ['-V']).catch(() => {});
    return exe;
  }

  // -------------------------------------------------------------- engine --
  enginePython() {
    const p = this.settings.get().engine.python;
    if (p && fs.existsSync(p)) return p;
    const managed = path.join(this.engineDir, 'venv', IS_WIN ? 'Scripts' : 'bin', 'python' + EXE);
    return fs.existsSync(managed) ? managed : null;
  }

  /**
   * A Python already on this PC that has PyTorch and Demucs (installed by
   * hand, by another app, or by Stagehand Setup). Using it saves a 3 GB
   * download. Checked once per run.
   */
  async findExistingEngine() {
    if (this._probed !== undefined) return this._probed;
    this._probed = null;
    const cands = [];
    const add = (p) => p && !cands.includes(p) && !/WindowsApps/i.test(p) && fs.existsSync(p) && cands.push(p);
    if (IS_WIN) {
      const py = which('py');
      if (py) {
        try {
          const out = await run(py, ['-0p'], { timeoutMs: 8000 });
          for (const line of out.split(/\r?\n/)) {
            const m = line.match(/([A-Za-z]:\\.*python(?:w)?\.exe)\s*$/i);
            if (m) add(m[1].trim());
          }
        } catch (_) {}
      }
    }
    add(which(IS_WIN ? 'python' : 'python3'));
    for (const p of cands) {
      try {
        let ok = false;
        await run(p, ['-c', 'import torch, demucs; print("ok", torch.__version__)'], { timeoutMs: 30000, onLine: (l) => (ok = ok || l.startsWith('ok ')) });
        if (ok) {
          this._probed = p;
          this._log && this._log(`Stem engine: using the Python already on this PC (${p})`);
          break;
        }
      } catch (_) {}
    }
    return this._probed;
  }

  engineEnv() {
    return {
      TORCH_HOME: path.join(this.engineDir, 'torch'),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
    };
  }

  async engineStatus({ refresh = false } = {}) {
    if (this._engineStatus && !refresh) return this._withAdvice(this._engineStatus);
    let python = this.enginePython();
    if (!python) {
      const found = await this.findExistingEngine().catch(() => null);
      if (found) {
        this.settings.set({ engine: { python: found, variant: 'existing', installedAt: Date.now() } });
        python = found;
      }
    }
    if (!python) {
      this._engineStatus = { installed: false };
      return this._withAdvice(this._engineStatus);
    }
    try {
      let info = null;
      await run(python, ['-u', this.engineScript, '--check'], {
        env: this.engineEnv(),
        onLine: (l) => {
          try {
            const j = JSON.parse(l);
            if (j.event === 'check') info = j;
          } catch (_) {}
        },
      });
      this._engineStatus = info ? { installed: true, python, ...info } : { installed: false, python, error: 'Engine check returned nothing' };
    } catch (err) {
      this._engineStatus = { installed: false, python, error: (err.output || err.message).split('\n').slice(-3).join(' ') };
    }
    return this._withAdvice(this._engineStatus);
  }

  async _withAdvice(status) {
    const gpus = await this.detectGpus().catch(() => []);
    const pref = this.settings.get().stems.device || 'auto';
    status.gpus = gpus;
    status.advice = gpu.advise(status, gpus, pref);
    return status;
  }

  /** Every display adapter, with NVIDIA details from nvidia-smi where available. Cached. */
  async detectGpus({ refresh = false } = {}) {
    if (this._gpus && !refresh) return this._gpus;
    if (process.env.STAGEHAND_FAKE_GPUS) {
      this._gpus = JSON.parse(process.env.STAGEHAND_FAKE_GPUS);
      return this._gpus;
    }
    let cim = [];
    if (IS_WIN) {
      try {
        const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const out = await run(fs.existsSync(ps) ? ps : 'powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,DriverVersion | ConvertTo-Json -Compress',
        ]);
        cim = gpu.parseCim(out);
      } catch (err) {
        this._log && this._log(`GPU inventory failed: ${err.message}`);
      }
    }
    let smi = [];
    for (const exe of this._smiCandidates()) {
      try {
        smi = gpu.parseSmi(await run(exe, ['--query-gpu=name,compute_cap,driver_version', '--format=csv,noheader']));
      } catch (_) {
        try {
          smi = gpu.parseSmi(await run(exe, ['--query-gpu=name,driver_version', '--format=csv,noheader']), ['name', 'driver_version']);
        } catch (__) {}
      }
      if (smi.length) break;
    }
    this._gpus = gpu.mergeGpus(cim, smi);
    return this._gpus;
  }

  _smiCandidates() {
    const list = [];
    const add = (p) => p && !list.includes(p) && fs.existsSync(p) && list.push(p);
    add(which('nvidia-smi'));
    if (IS_WIN) {
      const root = process.env.SystemRoot || 'C:\\Windows';
      add(path.join(root, 'System32', 'nvidia-smi.exe'));
      add(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'));
      // DCH drivers keep a copy inside the driver store.
      const repo = path.join(root, 'System32', 'DriverStore', 'FileRepository');
      try {
        for (const d of fs.readdirSync(repo)) if (/^nv/i.test(d)) add(path.join(repo, d, 'nvidia-smi.exe'));
      } catch (_) {}
    }
    return list;
  }

  async chooseVariant(pref = 'auto') {
    const gpus = await this.detectGpus();
    const nv = gpu.bestNvidia(gpus);
    if (pref && pref !== 'auto') return { variant: pref, gpu: nv, gpus };
    const v = gpu.variantFor(nv);
    return { variant: v === 'unsupported' ? 'cpu' : v, gpu: nv, gpus };
  }

  cancelSetup() {
    if (this._setupAbort) this._setupAbort.abort();
  }

  /**
   * One-click engine install. Emits progress through `report({step, index, total, value, log})`.
   */
  async setupEngine({ variant: pref = 'auto' } = {}, report = () => {}) {
    if (this._setupAbort) throw new Error('Setup is already running');
    const abort = new AbortController();
    this._setupAbort = abort;
    const steps = ['Download uv', 'Install Python', 'Install PyTorch', 'Install Demucs', 'Download separation model', 'Test the engine'];
    const total = steps.length;
    const step = (index, extra = {}) => report({ step: steps[index], index, total, ...extra });
    // Big downloads print little for minutes: show how much has arrived and
    // for how long, every second, so it never looks stuck.
    let beat = null;
    const dirBytes = (dir) => {
      let n = 0;
      const walk = (d) => {
        let list = [];
        try {
          list = fs.readdirSync(d, { withFileTypes: true });
        } catch (_) {
          return;
        }
        for (const e of list) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else {
            try {
              n += fs.statSync(p).size;
            } catch (_) {}
          }
        }
      };
      walk(dir);
      return n;
    };
    const heartbeat = (index, dir) => {
      if (beat) clearInterval(beat);
      const t0 = Date.now();
      const base = dir ? dirBytes(dir) : 0;
      let k = 0;
      beat = setInterval(() => {
        const secs = Math.round((Date.now() - t0) / 1000);
        const got = dir && ++k % 2 === 0 ? dirBytes(dir) - base : null;
        const mb = got === null ? null : got / 1048576;
        const size = mb === null ? '' : mb > 1024 ? `${(mb / 1024).toFixed(1)} GB · ` : mb >= 1 ? `${Math.round(mb)} MB · ` : '';
        if (got !== null || secs % 2 === 1) step(index, { detail: `${size}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` });
      }, 1000);
    };
    const stopBeat = () => beat && clearInterval(beat);
    const log = (line) => report({ log: line });
    const env = {
      UV_PYTHON_INSTALL_DIR: path.join(this.engineDir, 'python'),
      UV_CACHE_DIR: path.join(this.engineDir, 'uv-cache'),
      UV_LINK_MODE: 'copy',
      UV_NO_CONFIG: '1',
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_HTTP_TIMEOUT: '300',
    };
    try {
      await fsp.mkdir(this.engineDir, { recursive: true });
      const { variant, gpu: card, gpus } = await this.chooseVariant(pref);
      log(`Graphics: ${gpus.length ? gpus.map((g) => `${g.name}${g.driver ? ` (driver ${g.driver})` : ''}${g.computeCap ? `, compute ${g.computeCap}` : ''}`).join('; ') : 'none found'}`);
      log(variant === 'cpu' ? 'Installing the CPU version of PyTorch.' : `Installing the GPU version of PyTorch (${variant}) for ${card ? card.name : 'your NVIDIA card'}.`);

      step(0);
      const uvDir = path.join(this.engineDir, 'uv');
      const uv = path.join(uvDir, 'uv' + EXE);
      if (!fs.existsSync(uv)) {
        if (!IS_WIN) {
          const found = which('uv');
          if (!found) throw new Error('Install uv first (https://docs.astral.sh/uv/)');
          await fsp.mkdir(uvDir, { recursive: true });
          await fsp.copyFile(found, uv);
          await fsp.chmod(uv, 0o755);
        } else {
          const zip = path.join(this.engineDir, 'uv.zip');
          await this.download(URLS.uv, zip, (g, t) => step(0, { value: t ? g / t : 0 }));
          await unzip(zip, uvDir);
          await fsp.unlink(zip).catch(() => {});
        }
      }
      if (abort.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });

      step(1);
      heartbeat(1, env.UV_PYTHON_INSTALL_DIR);
      const venv = path.join(this.engineDir, 'venv');
      const py = path.join(venv, IS_WIN ? 'Scripts' : 'bin', 'python' + EXE);
      const existing = fs.existsSync(py);
      if (!existing) {
        await run(uv, ['venv', venv, '--python', ENGINE_PINS.python], { env, onLine: log, signal: abort.signal });
      }

      step(2);
      heartbeat(2, env.UV_CACHE_DIR);
      // "torch==2.8.0" is already satisfied by 2.8.0+cpu, so force the swap
      // whenever an engine exists; uv's cache makes this cheap when unchanged.
      const reinstall = existing ? ['--reinstall-package', 'torch', '--reinstall-package', 'torchaudio'] : [];
      await run(uv, ['pip', 'install', '--python', py, ENGINE_PINS.torch, ENGINE_PINS.torchaudio, ...reinstall, '--index-url', URLS.torchIndex(variant)], {
        env,
        onLine: log,
        signal: abort.signal,
      });

      step(3);
      heartbeat(3, env.UV_CACHE_DIR);
      await run(uv, ['pip', 'install', '--python', py, ENGINE_PINS.demucs, 'numpy'], { env, onLine: log, signal: abort.signal });

      step(4);
      heartbeat(4, this.engineEnv().TORCH_HOME);
      const model = this.settings.get().stems.model || 'htdemucs_6s';
      await run(py, ['-u', this.engineScript, '--prefetch', model], { env: this.engineEnv(), onLine: log, signal: abort.signal });

      stopBeat();
      step(5);
      this.settings.set({ engine: { python: py, variant, installedAt: Date.now() } });
      const status = await this.engineStatus({ refresh: true });
      if (!status.installed) throw new Error(status.error || 'The engine did not start');
      this.settings.set({ engine: { device: status.device } });
      log(status.device === 'cuda' ? `Engine ready on ${status.deviceName}.` : `Engine ready on the CPU.${status.cudaError ? ` GPU problem: ${status.cudaError}` : ''}`);
      report({ done: true, status });
      return status;
    } finally {
      stopBeat();
      this._setupAbort = null;
    }
  }

  async removeEngine() {
    this.settings.set({ engine: { python: null, variant: null, installedAt: null, device: null } });
    this._engineStatus = null;
    await fsp.rm(this.engineDir, { recursive: true, force: true });
  }
}

module.exports = { Tools, run, which, URLS, ENGINE_PINS };
