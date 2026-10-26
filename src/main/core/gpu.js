'use strict';
/**
 * GPU inventory parsing and "why isn't my GPU used?" diagnosis.
 * Pure functions so they can be tested without the hardware.
 */

// PyTorch 2.8.0 Windows CUDA builds (from .ci/pytorch/windows/cuda12x.bat at v2.8.0).
const TORCH_ARCHES = {
  cu126: [6.1, 7.0, 7.5, 8.0, 8.6, 9.0],
  cu128: [6.1, 7.0, 7.5, 8.0, 8.6, 9.0, 10.0, 12.0],
};
// CUDA 12.x minor-version compatibility needs at least this Windows driver.
const MIN_DRIVER = 528.33;

function vendorOf(name, compat = '') {
  const s = `${name} ${compat}`.toLowerCase();
  if (/nvidia|geforce|quadro|tesla|rtx|gtx/.test(s)) return 'nvidia';
  if (/amd|radeon|advanced micro/.test(s)) return 'amd';
  if (/intel|arc\b|iris|uhd/.test(s)) return 'intel';
  if (/microsoft basic|remote display|virtual|parsec|meta virtual/.test(s)) return 'virtual';
  return 'other';
}

/** "31.0.15.2849" (Windows driver version) -> "528.49" (NVIDIA version). */
function nvidiaDriverFromWindows(v) {
  const parts = String(v || '').split('.');
  if (parts.length < 4) return null;
  const digits = (parts[2] + parts[3].padStart(4, '0')).slice(-5);
  if (!/^\d{5}$/.test(digits)) return null;
  return `${Number(digits.slice(0, 3))}.${digits.slice(3)}`;
}

/** Output of: Get-CimInstance Win32_VideoController | Select ... | ConvertTo-Json */
function parseCim(text) {
  let data;
  try {
    data = JSON.parse(String(text || '').trim() || '[]');
  } catch (_) {
    return [];
  }
  const list = Array.isArray(data) ? data : [data];
  return list
    .filter((g) => g && g.Name)
    .map((g) => {
      const vendor = vendorOf(g.Name, g.AdapterCompatibility);
      return {
        name: String(g.Name).trim(),
        vendor,
        driver: vendor === 'nvidia' ? nvidiaDriverFromWindows(g.DriverVersion) : g.DriverVersion || null,
        source: 'windows',
      };
    })
    .filter((g) => g.vendor !== 'virtual');
}

/** Output of: nvidia-smi --query-gpu=name,compute_cap,driver_version --format=csv,noheader */
function parseSmi(text, fields = ['name', 'compute_cap', 'driver_version']) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < fields.length) continue;
    const rec = {};
    fields.forEach((f, i) => (rec[f] = cols[i]));
    if (!rec.name || /not a valid field|error/i.test(line)) continue;
    const cap = Number(rec.compute_cap);
    out.push({ name: rec.name, vendor: 'nvidia', computeCap: Number.isFinite(cap) && cap > 0 ? cap : null, driver: rec.driver_version || null, source: 'nvidia-smi' });
  }
  return out;
}

/** Best-known compute capability from the card name when nvidia-smi cannot say. */
function guessComputeCap(name) {
  const n = String(name).toLowerCase();
  if (/rtx\s*50\d0/.test(n)) return 12.0;
  if (/rtx\s*40\d0|rtx\s*a?[456]000 ada|l40|l4\b/.test(n)) return 8.9;
  if (/rtx\s*30\d0|rtx\s*a\d000/.test(n)) return 8.6;
  if (/rtx\s*20\d0|gtx\s*16\d0|titan rtx|quadro rtx/.test(n)) return 7.5;
  if (/titan v|v100/.test(n)) return 7.0;
  if (/gtx\s*10\d0|titan x[p ]|p\d{3,4}|quadro p/.test(n)) return 6.1;
  if (/gtx\s*9\d0|gtx\s*7[45]0|titan x\b|quadro m/.test(n)) return 5.2;
  return null;
}

/** Merges the Windows adapter list with nvidia-smi details. */
function mergeGpus(cim, smi) {
  const out = cim.map((g) => ({ ...g }));
  for (const s of smi) {
    const match = out.find((g) => g.vendor === 'nvidia' && g.name.toLowerCase().replace(/^nvidia\s+/, '') === s.name.toLowerCase().replace(/^nvidia\s+/, ''));
    if (match) Object.assign(match, { computeCap: s.computeCap, driver: s.driver || match.driver, source: 'nvidia-smi' });
    else out.push({ ...s });
  }
  for (const g of out) if (g.vendor === 'nvidia' && !g.computeCap) g.computeCap = guessComputeCap(g.name);
  return out;
}

function supportsCap(variant, cap) {
  if (!cap) return true; // unknown: let the engine's own test decide
  const list = TORCH_ARCHES[variant];
  if (!list) return false;
  // SASS for major.minor runs on the same major with a higher minor (e.g. 8.6 runs 8.9).
  return list.some((a) => Math.floor(a) === Math.floor(cap) && a <= cap + 1e-6);
}

/** Which PyTorch build an NVIDIA card needs. */
function variantFor(gpu) {
  if (!gpu) return 'cpu';
  const cap = gpu.computeCap;
  if (cap && cap >= 10) return 'cu128';
  if (cap && !supportsCap('cu126', cap)) return 'unsupported';
  return 'cu126';
}

function bestNvidia(gpus) {
  const n = (gpus || []).filter((g) => g.vendor === 'nvidia');
  return n.sort((a, b) => (b.computeCap || 0) - (a.computeCap || 0))[0] || null;
}

/**
 * Explains where separation runs and what to do about it.
 * @param engine result of the engine's --check (or {installed:false})
 * @param gpus merged GPU list
 * @param pref settings.stems.device ('auto' | 'cpu')
 */
function advise(engine, gpus, pref = 'auto') {
  const nv = bestNvidia(gpus);
  const others = (gpus || []).filter((g) => g.vendor === 'amd' || g.vendor === 'intel');
  const driverOld = nv && nv.driver && Number(nv.driver) < MIN_DRIVER;
  const base = { gpu: nv ? nv.name : others[0] ? others[0].name : null, driver: nv ? nv.driver : null, variant: variantFor(nv) };

  if (!engine || !engine.installed) {
    return { ...base, kind: 'not-installed', onGpu: false };
  }
  if (engine.device === 'cuda') {
    return { ...base, kind: 'gpu', onGpu: true, title: `Running on ${engine.deviceName || 'your GPU'}`, detail: 'Stems are separated on the graphics card.' };
  }
  if (pref === 'cpu') {
    return { ...base, kind: 'cpu-chosen', onGpu: false, title: 'Running on the CPU', detail: 'You chose to always use the CPU below.' };
  }
  if (!nv) {
    const name = others[0] ? others[0].name : null;
    return {
      ...base,
      kind: 'no-nvidia',
      onGpu: false,
      title: 'Running on the CPU',
      detail: name
        ? `${name} can't be used for stem separation. Demucs needs an NVIDIA graphics card, so separation runs on the CPU.`
        : 'No NVIDIA graphics card was found, so separation runs on the CPU.',
    };
  }
  if (base.variant === 'unsupported') {
    return {
      ...base,
      kind: 'gpu-too-old',
      onGpu: false,
      title: 'Running on the CPU',
      detail: `${nv.name} is too old for current PyTorch GPU builds (compute capability ${nv.computeCap}), so separation runs on the CPU.`,
    };
  }
  const cpuBuild = !engine.cudaBuild;
  if (cpuBuild) {
    return {
      ...base,
      kind: 'switch',
      onGpu: false,
      action: 'switch',
      title: 'Running on the CPU',
      detail:
        `Your ${nv.name} isn't being used because the CPU-only version of PyTorch is installed. Switching downloads the GPU version (about 2.5 GB) and makes separation many times faster.` +
        (driverOld ? ` Your NVIDIA driver (${nv.driver}) is also too old for it, so install the latest driver first.` : ''),
    };
  }
  // GPU build installed but CUDA does not work.
  if (driverOld || /driver/i.test(engine.cudaError || '')) {
    return {
      ...base,
      kind: 'driver',
      onGpu: false,
      action: 'driver',
      title: 'Running on the CPU',
      detail: `The GPU version of PyTorch is installed, but your NVIDIA driver${nv.driver ? ` (${nv.driver})` : ''} is too old for it. Install the latest driver for your ${nv.name}, restart, then press Check again.`,
      error: engine.cudaError || null,
    };
  }
  if (base.variant !== engine.variant && engine.variant && base.variant !== 'cpu') {
    return {
      ...base,
      kind: 'switch',
      onGpu: false,
      action: 'switch',
      title: 'Running on the CPU',
      detail: `The installed GPU build (${engine.variant}) doesn't match your ${nv.name}. Reinstalling the right build fixes this.`,
    };
  }
  return {
    ...base,
    kind: 'gpu-error',
    onGpu: false,
    action: 'switch',
    title: 'Running on the CPU',
    detail: `PyTorch could not use your ${nv.name}${engine.cudaError ? `: ${engine.cudaError}` : '.'} Updating the NVIDIA driver usually fixes this. Reinstalling the GPU build is the next thing to try.`,
    error: engine.cudaError || null,
  };
}

module.exports = { parseCim, parseSmi, mergeGpus, nvidiaDriverFromWindows, guessComputeCap, variantFor, supportsCap, advise, bestNvidia, vendorOf, TORCH_ARCHES, MIN_DRIVER };
