/*
 * Pedals and rack effects (everything except amps, cabinets and reverbs).
 * Stompboxes run mono; rack units after the cabinet can run in stereo.
 */
#include "sh_dsp.h"

static float P(const sh_gear *g, const char *n, float def) { return kn_pos(g, n, def); }
static float RAW(const sh_gear *g, const char *n, float def) { return kn_raw(g, n, def); }

/* ============================================================ dynamics == */
typedef struct {
  float thr, ratio, makeup, knee;
  env_t env;
  /* 4.5.x: MB Comp: two bands split at the Transition Band; only the low band is compressed */
  int mb;
  bq_t xlo, xlo2;
  int gate;
  float gate_thr, gate_g, gate_rel, gate_att;
  int hold, holdn;
  int limiter;
  float *live; /* Stagehand's own gate: engine-owned floor / offset / off (see sh_dsp.h) */
  float rel_auto, rel_strong;
} dyn_t;

static void dyn_proc(sh_block *b, float *L, float *R, int n) {
  dyn_t *d = (dyn_t *)b->st;
  if (d->mb && !R) {
    for (int i = 0; i < n; i++) {
      float x = L[i];
      float lo = bq_run(&d->xlo2, bq_run(&d->xlo, x)); /* 4th-order low band */
      float hi = x - lo;
      float db = sh_lin2db_fast(env_run(&d->env, lo));
      float over = db - d->thr, red = 0;
      if (over > d->knee) red = over * (1.f - 1.f / d->ratio);
      else if (over > -d->knee) {
        float t = over + d->knee;
        red = (1.f - 1.f / d->ratio) * t * t / (4.f * d->knee);
      }
      L[i] = lo * sh_db2lin_fast(-red) * d->makeup + hi;
    }
    return;
  }
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float e = env_run(&d->env, x);
    float g;
    if (d->gate) {
      float db = sh_lin2db_fast(e);
      float thr = d->gate_thr;
      if (d->live) {
        if (d->live[2] > 0.5f) { /* switched off: pass everything */
          d->gate_g = 1, d->holdn = 0, d->live[3] = 1;
          continue;
        }
        /* above the player's own noise floor (measured as they play), never below the tone's own */
        if (d->live[0] > -150 && d->live[0] + 12 > thr) thr = d->live[0] + 12;
        thr += d->live[1];
        d->gate_rel = d->live[1] > 0.5f ? d->rel_strong : d->rel_auto;
      }
      int open = db > thr || (d->gate_g > 0.5f && db > thr - 6);
      if (open) d->holdn = d->hold;
      else if (d->holdn > 0) d->holdn--, open = 1;
      float target = open ? 1.f : 0.f;
      d->gate_g += (open ? d->gate_att : d->gate_rel) * (target - d->gate_g);
      g = d->gate_g;
      if (d->live) d->live[3] = g;
    } else {
      float db = sh_lin2db_fast(e);
      float over = db - d->thr;
      float red = 0;
      if (over > d->knee) red = over * (1.f - 1.f / d->ratio);
      else if (over > -d->knee) {
        float t = over + d->knee;
        red = (1.f - 1.f / d->ratio) * t * t / (4.f * d->knee);
      }
      g = sh_db2lin_fast(-red) * d->makeup;
    }
    L[i] *= g;
    if (R) R[i] *= g;
  }
}

static dyn_t *dyn_new(sh_arena *a) { return (dyn_t *)ar_alloc(a, sizeof(dyn_t)); }

int gate_build_default(sh_block *b, sh_arena *a, double sr, float thr_db, float *live) {
  dyn_t *d = dyn_new(a);
  if (!d) return 0;
  d->gate = 1;
  d->gate_thr = thr_db;
  d->live = live;
  env_set(&d->env, sr, 0.3, 40);
  d->gate_att = (float)(1 - sh_exp(-1000.0 / (sr * 0.8)));
  /* closing: 60 ms, so a high-gain amp's hiss is gone within a third of a second;
     Strong closes faster (35 ms) */
  d->rel_auto = (float)(1 - sh_exp(-1000.0 / (sr * 60)));
  d->rel_strong = (float)(1 - sh_exp(-1000.0 / (sr * 35)));
  d->gate_rel = d->rel_auto;
  d->hold = (int)(sr * 0.05);
  d->gate_g = 1;
  b->st = d, b->process = dyn_proc, b->name = "gate";
  return 1;
}

static int dyn_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  dyn_t *d = dyn_new(a);
  if (!d) return 0;
  const char *k = g->key;
  d->knee = 4;
  d->makeup = 1;
  if (sh_has(k, "NoiseGate")) {
    d->gate = 1;
    d->gate_thr = RAW(g, "threshold", -55);
    float rate = P(g, "rate", 0.8f);
    env_set(&d->env, sr, 0.3, 30);
    d->gate_att = (float)(1 - sh_exp(-1000.0 / (sr * 0.8)));
    d->gate_rel = (float)(1 - sh_exp(-1000.0 / (sr * (250 - 230 * rate))));
    d->hold = (int)(sr * 0.03);
    d->gate_g = 1;
  } else if (sh_has(k, "Limiter")) {
    float lim = P(g, "limit", 0.25f), sp = P(g, "speed", 0.6f);
    d->thr = -2 - 28 * lim, d->ratio = 20, d->knee = 2;
    env_set(&d->env, sr, 0.5 + 8 * (1 - sp), 40 + 300 * (1 - sp));
    d->makeup = (float)sh_db2lin(-d->thr * 0.5);
  } else if (sh_has(k, "Swole")) {
    float sm = P(g, "smash", 0.66f), rate = P(g, "rate", 0.8f);
    d->thr = -12 - 30 * sm, d->ratio = 8;
    env_set(&d->env, sr, 2, 60 + 400 * (1 - rate));
    d->makeup = (float)sh_db2lin(-d->thr * 0.55);
  } else if (sh_has(k, "StudioCompressor")) {
    static const float ratios[5] = {1.5f, 2, 4, 8, 20};
    int ri = (int)RAW(g, "ratio", 1);
    d->ratio = ratios[ri < 0 ? 0 : ri > 4 ? 4 : ri];
    d->thr = RAW(g, "threshold", -22.5f);
    env_set(&d->env, sr, RAW(g, "attack", 75) * 0.1 + 0.1, RAW(g, "release", 170));
    d->makeup = (float)sh_db2lin(-d->thr * (1 - 1 / d->ratio) * 0.5);
  } else { /* Compression, MB Comp, Bass compressors */
    float c = P(g, "compression", 0.6f);
    d->thr = -8 - 30 * c, d->ratio = 3 + 5 * c;
    float att = sh_has(k, "MBComp") ? 3 : 1 + 30 * P(g, "attack", 0.3f);
    float rel = sh_has(k, "MBComp") ? 60 + 400 * (1 - P(g, "recovery", 0.4f)) : RAW(g, "release", 200);
    env_set(&d->env, sr, att, rel);
    d->makeup = (float)sh_db2lin(-d->thr * (1 - 1 / d->ratio) * 0.55);
    if (sh_has(k, "MBComp")) {
      float xo = RAW(g, "transition band", 600);
      if (xo < 60) xo = 60;
      d->mb = 1;
      bq_set(&d->xlo, BQ_LP, sr, xo, 0.707, 0);
      bq_set(&d->xlo2, BQ_LP, sr, xo, 0.707, 0);
      d->makeup = (float)sh_db2lin(-d->thr * (1 - 1 / d->ratio) * 0.45);
    }
  }
  b->st = d, b->process = dyn_proc, b->name = "dynamics";
  return 1;
}

/* ================================================================== EQ == */
#define EQN 10
typedef struct {
  bq_t f[EQN][2];
  int n;
  float out;
} eq_t;
static void eq_proc(sh_block *b, float *L, float *R, int n) {
  eq_t *e = (eq_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = L[i], y = R ? R[i] : 0;
    for (int k = 0; k < e->n; k++) {
      x = bq_run(&e->f[k][0], x);
      if (R) y = bq_run(&e->f[k][1], y);
    }
    L[i] = x * e->out;
    if (R) R[i] = y * e->out;
  }
}
static void eq_add(eq_t *e, int type, double sr, double hz, double q, double db) {
  if (e->n >= EQN) return;
  bq_set(&e->f[e->n][0], type, sr, hz, q, db);
  e->f[e->n][1] = e->f[e->n][0];
  e->n++;
}
static double band_hz(const char *n) {
  double hz = 0, f = 0.1;
  const char *q = n;
  if (!(*q >= '0' && *q <= '9')) return 0;
  while (*q >= '0' && *q <= '9') hz = hz * 10 + (*q++ - '0');
  if (*q == '.') {
    q++;
    while (*q >= '0' && *q <= '9') hz += (*q++ - '0') * f, f *= 0.1;
  }
  if (*q == 'k') hz *= 1000, q++;
  return (q[0] == 'h' && q[1] == 'z') ? hz : 0;
}
static int eq_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  eq_t *e = (eq_t *)ar_alloc(a, sizeof(eq_t));
  if (!e) return 0;
  e->out = 1;
  const char *k = g->key;
  sh_knob kk;
  if (sh_has(k, "AmpEQ")) {
    float bs = RAW(g, "bass freq", 0), ms = RAW(g, "mid freq", 1), ts = RAW(g, "treble freq", 0);
    eq_add(e, BQ_LSHELF, sr, bs > 0.5f ? 200 : 100, 0.7, (P(g, "bass", 0.5f) - 0.5) * 24);
    eq_add(e, BQ_PEAK, sr, ms < 0.5f ? 400 : ms < 1.5f ? 800 : 1600, 0.8, (P(g, "midrange", 0.5f) - 0.5) * 24);
    eq_add(e, BQ_HSHELF, sr, ts > 0.5f ? 5000 : 2500, 0.7, (P(g, "treble", 0.5f) - 0.5) * 24);
  } else if (sh_has(k, "StudioEQ") || sh_has(k, "StudioGraphicEQ")) {
    eq_add(e, BQ_LSHELF, sr, RAW(g, "bass freq", 120), 0.7, RAW(g, "bass", 0));
    sh_knob q;
    int narrow = kn_find(g, "low-mid \"q\"", &q) && q.v > 0.5f;
    eq_add(e, BQ_PEAK, sr, RAW(g, "low-mid freq", 800), narrow ? 2.5 : 0.8, RAW(g, "low-mid", 0));
    if (kn_exact(g, "mid", &kk)) {
      sh_knob mf;
      static const char *const MF[] = {"mid freq.", "mid freq", "mid frequency", NULL};
      double hz = kn_any_exact(g, MF, &mf) ? (mf.hi <= 20 ? mf.v * 1000 : mf.v) : 800;
      eq_add(e, BQ_PEAK, sr, hz < 100 ? 100 : hz, 1.0, kk.v);
    }
    narrow = kn_find(g, "high-mid \"q\"", &q) && q.v > 0.5f;
    float hm = RAW(g, "high-mid freq", 5);
    eq_add(e, BQ_PEAK, sr, hm <= 10 ? (hm < 0.5f ? 0.5f : hm) * 1000 : hm, narrow ? 2.5 : 0.8, RAW(g, "high-mid", 0));
    eq_add(e, BQ_HSHELF, sr, RAW(g, "treble freq", 5.6f) * 1000, 0.7, RAW(g, "treble", 0));
  } else if (sh_has(k, "LoFiFilter")) {
    float hc = P(g, "hi cut", 0.3f), lcut = P(g, "lo cut", 0.88f);
    eq_add(e, BQ_LP, sr, 16000 * sh_pow(0.06, hc), 0.9, 0);
    eq_add(e, BQ_LP, sr, 16000 * sh_pow(0.06, hc), 0.6, 0);
    eq_add(e, BQ_HP, sr, 30 * sh_pow(30, lcut), 0.9, 0);
    eq_add(e, BQ_HP, sr, 30 * sh_pow(30, lcut), 0.6, 0);
    e->out = 1.6f;
  } else if (sh_has(k, "AcousticEmulator")) {
    eq_add(e, BQ_HP, sr, 90, 0.7, 0);
    eq_add(e, BQ_PEAK, sr, 210, 1.0, (P(g, "body", 0.68f) - 0.3) * 14);
    eq_add(e, BQ_PEAK, sr, RAW(g, "mid frequency", 775), 0.9, -(P(g, "mid-range", 0.22f)) * 14 - 2);
    eq_add(e, BQ_HSHELF, sr, 3000, 0.6, (P(g, "tone", 0.82f) - 0.3) * 12);
    eq_add(e, BQ_PEAK, sr, 9000, 0.8, 4);
  } else {
    for (int i = 0; i < g->nk; i++) {
      double hz = band_hz(g->k[i].name);
      if (hz > 0) eq_add(e, BQ_PEAK, sr, hz, sh_has(k, "EQ8") ? 1.4 : 1.0, g->k[i].v);
    }
  }
  b->st = e, b->process = eq_proc, b->name = "eq";
  return 1;
}

/* ===================================================== wah & filters == */
typedef struct {
  svf_t f[2];
  env_t env;
  int autom, type; /* type 0 LP 1 BP 2 HP, 3 = wah */
  float pos, sens, lo, hi, q, mix;
  int cnt;
  double sr;
  float floor_db; /* 4.5.x: auto mode: dB where the sweep starts */
} filt_t;
static void filt_proc(sh_block *b, float *L, float *R, int n) {
  filt_t *f = (filt_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float e = env_run(&f->env, x);
    if ((f->cnt++ & 15) == 0) {
      float p = f->autom ? sh_clampf((sh_lin2db_fast(e) - f->floor_db) / 30.f, 0, 1) : f->pos;
      double hz = f->lo * sh_pow(f->hi / f->lo, p);
      svf_set(&f->f[0], f->sr, hz, f->q);
      f->f[1].g = f->f[0].g, f->f[1].k = f->f[0].k;
    }
    for (int c = 0; c < (R ? 2 : 1); c++) {
      float *s = c ? R : L;
      float lp, bp, hp;
      svf_run(&f->f[c], s[i], &lp, &bp, &hp);
      float y = f->type == 0 ? lp : f->type == 2 ? hp : f->type == 3 ? (bp * 2.2f + lp * 0.3f) : bp * 1.5f;
      s[i] = s[i] * (1 - f->mix) + y * f->mix;
    }
  }
}
static int filt_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  filt_t *f = (filt_t *)ar_alloc(a, sizeof(filt_t));
  if (!f) return 0;
  f->sr = sr;
  const char *k = g->key;
  f->mix = 1;
  if (sh_has(k, "Wah")) {
    f->type = 3;
    f->autom = RAW(g, "auto", 0) > 0.5f;
    f->sens = P(g, "sensitivity", 0.7f);
    f->pos = P(g, "pedal", 0.5f);
    f->lo = sh_has(k, "Bass") ? 200 : 380, f->hi = sh_has(k, "Bass") ? 1500 : 2300, f->q = sh_has(k, "UK") ? 5 : 3.5f;
    float sp = P(g, "speed", 0.9f);
    env_set(&f->env, sr, 2 + 20 * (1 - sp), 40 + 300 * (1 - sp));
    if (sh_has(k, "StudioWah")) env_set(&f->env, sr, RAW(g, "attack", 75) * 0.1 + 0.5, RAW(g, "release", 170));
  } else {
    f->autom = 1;
    f->type = (int)RAW(g, "filter type", 1);
    f->sens = P(g, "sensitivity", 0.7f);
    f->mix = P(g, "mix", 0.9f);
    f->lo = 150, f->hi = 3500, f->q = sh_has(k, "Bob") ? 5 : 3;
    env_set(&f->env, sr, RAW(g, "attack speed", 16) * 0.2 + 0.5, RAW(g, "release speed", 120));
  }
  f->floor_db = -48 + 30 * (1 - f->sens); /* more sensitivity: opens on quieter playing */
  svf_set(&f->f[0], sr, 800, f->q);
  f->f[1] = f->f[0];
  b->st = f, b->process = filt_proc, b->name = "filter";
  return 1;
}

/* ===================================== chorus / flanger / vibrato == */
typedef struct {
  dl_t d[2];
  float ph, rate, base, depth, fb, mix, wet_hp_z[2];
  float last[2];
  int stereo;
  double sr;
  int vibe;
  op_t lp[2];
  op_t hp[2];   /* 4.5.x: LoFilter: the wet signal's low cut */
  int use_hp;
  float spread; /* 4.5.x: Stereo: right LFO phase offset (0..0.5) */
  float wave;   /* 4.5.x: Supervibe Wave: 0 = sine, 1 = the lopsided "throb" of a photocell vibe */
} mod_t;
static void mod_proc(sh_block *b, float *L, float *R, int n) {
  mod_t *m = (mod_t *)b->st;
  float mix = m->mix * (b->flags & BLK_FX ? b->fxscale : 1);
  if (mix > 1) mix = 1;
  for (int i = 0; i < n; i++) {
    m->ph += m->rate;
    if (m->ph >= 1) m->ph -= 1;
    for (int c = 0; c < (R ? 2 : 1); c++) {
      float *s = c ? R : L;
      float x = s[i];
      float lfo = sh_sin01(m->ph + (c ? m->spread : 0.f));
      if (m->wave > 0) { /* throb: a fast rise and a slow fall, like a lamp in a photocell vibe */
        float sk = sh_sin01(2.f * (m->ph + (c ? m->spread : 0.f)) + 0.25f);
        lfo = sh_clampf(lfo + m->wave * 0.45f * sk, -1, 1);
      }
      float dt = (m->base + m->depth * (0.5f + 0.5f * lfo)) * (float)m->sr;
      dl_push(&m->d[c], x + m->last[c] * m->fb);
      float w = dl_tapf(&m->d[c], dt);
      w = op_lp(&m->lp[c], w);
      if (m->use_hp) w = op_hp(&m->hp[c], w);
      m->last[c] = w;
      s[i] = m->vibe ? x * (1 - mix) + w * mix : x * (1 - mix * 0.5f) + w * mix;
    }
  }
}
static int mod_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int stereo) {
  mod_t *m = (mod_t *)ar_alloc(a, sizeof(mod_t));
  if (!m) return 0;
  m->sr = sr;
  const char *k = g->key;
  float rate01 = P(g, "rate", 0.25f), depth = P(g, "depth", 0.5f);
  sh_knob rk;
  float hz;
  if (kn_find(g, "rate", &rk) && rk.hi <= 10) hz = 0.05f + rk.v * 0.8f; /* 0..10 */
  else hz = (float)(0.05 * sh_pow(160, rate01));
  m->mix = P(g, "mix", 0.5f);
  if (sh_has(k, "Flange")) {
    m->base = 0.0008f, m->depth = 0.0035f * depth;
    m->fb = 0.3f + 0.6f * P(g, "regen", 0.4f);
    if (sh_has(k, "80s")) m->fb = 0.75f;
    hz = (float)(0.03 * sh_pow(80, rate01));
  } else if (sh_has(k, "Clones")) {
    m->base = 0.006f, m->depth = 0.004f * depth, hz = 0.2f + 3 * P(g, "clones", 0.5f);
  } else if (sh_has(k, "Enbig")) {
    m->base = 0.012f, m->depth = 0.006f * depth;
  } else if (sh_has(k, "Vibe") || sh_has(k, "Supervibe")) { /* pitch vibrato */
    m->vibe = 1, m->base = 0.002f, m->depth = 0.004f * depth + 0.001f;
    hz = (float)(0.3 * sh_pow(30, P(g, "speed", 0.5f)));
  } else { /* chorus */
    m->base = 0.007f, m->depth = 0.006f * depth;
  }
  m->rate = (float)(hz / sr);
  m->spread = 0.25f;
  sh_knob kx;
  if (kn_exact(g, "stereo", &kx)) m->spread = 0.5f * (kx.v - kx.lo) / (kx.hi - kx.lo);
  if (kn_exact(g, "delay", &kx)) m->base = 0.002f + 0.02f * (kx.v - kx.lo) / (kx.hi - kx.lo);
  if (kn_exact(g, "lofilter", &kx) || kn_exact(g, "lo filter", &kx) || kn_exact(g, "low filter", &kx)) {
    m->use_hp = 1;
    op_lp_set(&m->hp[0], sr, 30 * sh_pow(25, (kx.v - kx.lo) / (kx.hi - kx.lo)));
    m->hp[1] = m->hp[0];
  }
  if (sh_has(k, "Supervibe") && kn_exact(g, "wave", &kx)) m->wave = (kx.v - kx.lo) / (kx.hi - kx.lo);
  float tone = sh_has(k, "StudioFlanger") ? P(g, "tone", 0.6f) : P(g, "hifilter", P(g, "filter", 0.7f));
  op_lp_set(&m->lp[0], sr, 2000 * sh_pow(8, tone));
  m->lp[1] = m->lp[0];
  int len = (int)(sr * 0.06);
  if (!dl_init(&m->d[0], a, len) || !dl_init(&m->d[1], a, len)) return 0;
  b->st = m, b->process = mod_proc, b->flags = BLK_FX, b->name = "modulation";
  (void)stereo;
  return 1;
}

/* ================================================================ phaser == */
typedef struct {
  float z[2][8];
  op_t hp[2]; /* 4.5.x: Filter: only the sound above this goes through the phaser */
  int use_hp;
  int stages;
  float ph, rate, depth, fb, mix, last[2], minf, maxf;
  double sr;
  float spread[8];
} phase_t;
static void phase_proc(sh_block *b, float *L, float *R, int n) {
  phase_t *p = (phase_t *)b->st;
  for (int i = 0; i < n; i++) {
    p->ph += p->rate;
    if (p->ph >= 1) p->ph -= 1;
    for (int c = 0; c < (R ? 2 : 1); c++) {
      float *s = c ? R : L;
      float lfo = 0.5f + 0.5f * sh_sin01(p->ph + (c ? 0.25f : 0));
      float fhz = p->minf * sh_exp2f_fast(lfo * p->depth * 5.f);
      float in0 = s[i];
      float lowpart = 0;
      if (p->use_hp) { float hp = op_hp(&p->hp[c], in0); lowpart = in0 - hp; in0 = hp; }
      float y = in0 + p->last[c] * p->fb;
      for (int k = 0; k < p->stages; k++) {
        float w = (float)(SH_PI * fhz * p->spread[k] / p->sr);
        float a1 = (1 - w) / (1 + w);
        float out = -a1 * y + p->z[c][k];
        p->z[c][k] = y + a1 * out;
        y = out;
      }
      p->last[c] = y;
      s[i] = p->use_hp ? lowpart + in0 * (1 - p->mix * 0.5f) + y * p->mix * 0.7f : s[i] * (1 - p->mix * 0.5f) + y * p->mix * 0.7f;
    }
  }
}
static int phase_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  phase_t *p = (phase_t *)ar_alloc(a, sizeof(phase_t));
  if (!p) return 0;
  p->sr = sr;
  const char *k = g->key;
  sh_knob rk;
  float hz = kn_find(g, "rate", &rk) && rk.hi <= 10 ? 0.05f + rk.v * 0.5f : (float)(0.05 * sh_pow(120, P(g, "rate", 0.25f)));
  p->rate = (float)(hz / sr);
  p->depth = P(g, "depth", 0.6f);
  p->mix = P(g, "mix", 0.7f);
  p->stages = 4, p->fb = 0.3f, p->minf = 200;
  if (sh_has(k, "Phaser")) p->stages = 4, p->fb = sh_has(k, "Shaver") ? 0.55f : 0.4f;
  if (sh_has(k, "PlanePhase")) p->stages = 8, p->fb = 0.6f;
  if (sh_has(k, "OmniMod")) p->stages = 6;
  if (sh_has(k, "Pedal_Phaser")) p->depth = 0.8f, p->mix = 0.8f;
  for (int i = 0; i < 8; i++) p->spread[i] = 1.f + 0.35f * i * (sh_has(k, "Vibe") ? 1.5f : 0.3f);
  sh_knob fk;
  if (kn_exact(g, "filter", &fk)) {
    p->use_hp = 1;
    op_lp_set(&p->hp[0], sr, 40 * sh_pow(20, (fk.v - fk.lo) / (fk.hi - fk.lo)));
    p->hp[1] = p->hp[0];
  }
  b->st = p, b->process = phase_proc, b->flags = BLK_FX, b->name = "phaser";
  return 1;
}

/* ============================================================= tremolo == */
typedef struct {
  float ph, rate, mix, wave;
  int shape;
  env_t env;
  int envmode;
  float sens;
} trem_t;
static void trem_proc(sh_block *b, float *L, float *R, int n) {
  trem_t *t = (trem_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float lfo;
    float amt = 1.f;
    if (t->envmode) {
      /* 4.11: Trem-Ole and AutoVibe are tremolos you play with your hands: the harder you dig in,
         the deeper and faster the wobble; play softly and it calms down (Sensitivity: how easily it
         comes on; Attack/Release: how quickly it follows you). Before, the level only ducked with
         the note and never wobbled at all. */
      float e = env_run(&t->env, x);
      amt = sh_clampf(e * t->sens * 10.f, 0, 1);
      t->ph += t->rate * (0.6f + 0.9f * amt);
      if (t->ph >= 1) t->ph -= 1;
      lfo = 0.5f + 0.5f * sh_sin01(t->ph);
    } else {
      t->ph += t->rate;
      if (t->ph >= 1) t->ph -= 1;
      float p = t->ph;
      switch (t->shape) {
        case 1: lfo = p < 0.5f ? p * 2 : 2 - p * 2; break;
        case 2: lfo = p < 0.5f ? 1.f : 0.f; break;
        case 3: lfo = p < 0.3f ? 1.f : 0.f; break;
        case 4: lfo = p < 0.7f ? 1.f : 0.f; break;
        default: lfo = 0.5f + 0.5f * sh_sin01(p);
      }
    }
    float g = 1.f - t->mix * amt * (1.f - lfo);
    L[i] *= g;
    if (R) {
      float g2 = t->envmode ? g : 1.f - t->mix * lfo; /* stereo: opposite phase */
      R[i] *= (g + g2) * 0.5f + (g2 - g) * 0.5f;
    }
  }
}
static int trem_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  trem_t *t = (trem_t *)ar_alloc(a, sizeof(trem_t));
  if (!t) return 0;
  const char *k = g->key;
  t->rate = (float)(0.5 * sh_pow(24, P(g, "speed", 0.5f)) / sr);
  t->mix = P(g, "mix", 0.5f);
  t->shape = (int)RAW(g, "waveform", 0);
  if (sh_has(k, "TremOle") || sh_has(k, "AutoVibe")) {
    t->envmode = 1;
    t->rate = (float)((sh_has(k, "AutoVibe") ? 5.2 : 4.2) / sr); /* its own speed, pushed by how hard you play */
    t->sens = P(g, "sensitivity", 0.7f);
    env_set(&t->env, sr, RAW(g, "attack speed", 10) * 0.5 + 1, RAW(g, "release speed", 200));
  }
  b->st = t, b->process = trem_proc, b->name = "tremolo";
  return 1;
}

/* ======================================================== rotary == */
typedef struct {
  dl_t d[2];
  float ph, rate, depth, mix;
  op_t xo;
  double sr;
  float horn, drum; /* 4.5.x: Balance: horn (top) vs drum (bottom) */
} rot_t;
static void rot_proc(sh_block *b, float *L, float *R, int n) {
  rot_t *r = (rot_t *)b->st;
  for (int i = 0; i < n; i++) {
    r->ph += r->rate;
    if (r->ph >= 1) r->ph -= 1;
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float lo = op_lp(&r->xo, x), hi = x - lo;
    float s = sh_sin01(r->ph), c = sh_sin01(r->ph + 0.25f);
    dl_push(&r->d[0], hi);
    float dop = dl_tapf(&r->d[0], (float)(r->sr * (0.002f + 0.0012f * r->depth * (1 + s))));
    float horn_l = dop * (1.f + 0.6f * r->depth * s), horn_r = dop * (1.f - 0.6f * r->depth * s);
    float drum = lo * (1.f + 0.2f * r->depth * c);
    float wl = horn_l * r->horn + drum * r->drum, wr = horn_r * r->horn + drum * r->drum;
    L[i] = L[i] * (1 - r->mix) + wl * r->mix;
    if (R) R[i] = R[i] * (1 - r->mix) + wr * r->mix;
  }
}
static int rot_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  rot_t *r = (rot_t *)ar_alloc(a, sizeof(rot_t));
  if (!r) return 0;
  r->sr = sr;
  r->rate = (float)((0.7 + 6.0 * P(g, "rate", 0.8f)) / sr);
  r->depth = P(g, "depth", 0.6f), r->mix = P(g, "mix", 0.6f);
  {
    float bal = P(g, "balance", 0.5f);
    r->horn = 2.f * bal > 1.f ? 1.f : 2.f * bal + 0.0f;
    r->drum = 2.f * (1 - bal) > 1.f ? 1.f : 2.f * (1 - bal);
  }
  op_lp_set(&r->xo, sr, 800);
  if (!dl_init(&r->d[0], a, (int)(sr * 0.01)) || !dl_init(&r->d[1], a, 16)) return 0;
  b->st = r, b->process = rot_proc, b->flags = BLK_FX, b->name = "rotary";
  return 1;
}

/* ============================================================ ring mod == */
typedef struct {
  float ph, rate, mix;
  int saw;
} ring_t;
static void ring_proc(sh_block *b, float *L, float *R, int n) {
  ring_t *r = (ring_t *)b->st;
  for (int i = 0; i < n; i++) {
    r->ph += r->rate;
    if (r->ph >= 1) r->ph -= 1;
    float c = r->saw ? r->ph * 2 - 1 : sh_sin01(r->ph);
    L[i] = L[i] * (1 - r->mix) + L[i] * c * r->mix;
    if (R) R[i] = R[i] * (1 - r->mix) + R[i] * c * r->mix;
  }
}
static int ring_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  ring_t *r = (ring_t *)ar_alloc(a, sizeof(ring_t));
  if (!r) return 0;
  float rate = RAW(g, "rate", 25);
  float depth = P(g, "depth", 0.5f);
  r->rate = (float)(rate * (2 + depth * 18) / sr);
  r->mix = P(g, "mix", 0.5f);
  r->saw = RAW(g, "funk", 0) > 0.5f;
  b->st = r, b->process = ring_proc, b->name = "ring mod";
  return 1;
}

/* ================================================================ delay == */
typedef struct {
  dl_t d[2];
  float t[2], fb, mix;
  op_t lp[2], hp[2];
  float ph, mrate, mdepth;
  int sat, lofi, pingpong;
  double sr;
  float hold[2];
  int hc;
} delay_t;
static void delay_proc(sh_block *b, float *L, float *R, int n) {
  delay_t *d = (delay_t *)b->st;
  float mix = d->mix * b->fxscale;
  if (mix > 1.2f) mix = 1.2f;
  for (int i = 0; i < n; i++) {
    d->ph += d->mrate;
    if (d->ph >= 1) d->ph -= 1;
    float mod = 1.f + d->mdepth * sh_sin01(d->ph);
    float in[2] = {L[i], R ? R[i] : L[i]};
    float out[2];
    for (int c = 0; c < (R ? 2 : 1); c++) {
      float w = dl_tapf(&d->d[c], d->t[c] * mod);
      w = op_lp(&d->lp[c], w);
      w = op_hp(&d->hp[c], w);
      if (d->sat) w = sh_tanhf(w * 1.2f) * 0.85f;
      if (d->lofi) {
        if ((d->hc++ % 3) == 0) d->hold[c] = sh_floorf(w * 64.f) / 64.f;
        w = d->hold[c];
      }
      out[c] = w;
    }
    if (R && d->pingpong) {
      dl_push(&d->d[0], in[0] * 0.5f + in[1] * 0.5f + out[1] * d->fb);
      dl_push(&d->d[1], out[0] * d->fb);
    } else {
      for (int c = 0; c < (R ? 2 : 1); c++) dl_push(&d->d[c], in[c] + out[c] * d->fb);
    }
    L[i] = in[0] + out[0] * mix;
    if (R) R[i] = in[1] + out[1] * mix;
  }
}
static int delay_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int stereo) {
  delay_t *d = (delay_t *)ar_alloc(a, sizeof(delay_t));
  if (!d) return 0;
  d->sr = sr;
  const char *k = g->key;
  float tl = RAW(g, "time", 360);
  if (kn_find(g, "time left", 0)) tl = RAW(g, "time left", 360);
  float tr = kn_find(g, "time right", 0) ? RAW(g, "time right", 220) : tl;
  if (tl < 10) tl = 10;
  if (tl > 2000) tl = 2000;
  if (tr > 2000) tr = 2000;
  d->t[0] = (float)(tl * 0.001 * sr), d->t[1] = (float)(tr * 0.001 * sr);
  d->fb = P(g, "feedback", 0.4f) * 0.92f;
  d->mix = P(g, "mix", 0.4f) * 0.9f;
  float lp = 9000, hp = 60;
  if (sh_has(k, "AnalogueDelay") || sh_has(k, "NPN")) lp = 3000, d->sat = 1;
  if (sh_has(k, "Tape") || sh_has(k, "Valve") || sh_has(k, "OilCan") || sh_has(k, "Cosmic")) {
    lp = 4200, d->sat = 1, d->mrate = (float)(0.6 / sr), d->mdepth = 0.0025f;
    if (sh_has(k, "OilCan")) lp = 2500, d->mdepth = 0.006f, d->mrate = (float)(3.0 / sr);
  }
  if (sh_has(k, "ModDelay")) d->mdepth = 0.01f * P(g, "mod depth", 0.45f), d->mrate = (float)((0.1 + RAW(g, "mod rate", 2.5f) * 0.5) / sr);
  if (sh_has(k, "NoFi")) d->lofi = 1, lp = 3500;
  if (sh_has(k, "Filter")) lp = (float)(600 * sh_pow(8, 1 - P(g, "low filter", 0.2f))), hp = 120;
  if (kn_find(g, "hi filter", 0)) lp = (float)(1500 * sh_pow(8, P(g, "hi filter", 0.68f)));
  if (sh_has(k, "StudioDelay")) lp = (float)(2000 * sh_pow(6, 1 - P(g, "filter", 0.3f))), d->pingpong = 0;
  {
    sh_knob lf;
    if (kn_exact(g, "lo filter", &lf)) hp = lf.v < 0.5f ? 30 : lf.v < 1.5f ? 140 : 420;
  }
  op_lp_set(&d->lp[0], sr, lp), d->lp[1] = d->lp[0];
  op_lp_set(&d->hp[0], sr, hp), d->hp[1] = d->hp[0];
  int len = (int)(sr * 2.1);
  if (!dl_init(&d->d[0], a, len)) return 0;
  if (stereo && !dl_init(&d->d[1], a, len)) return 0;
  if (!stereo) d->d[1] = d->d[0];
  b->st = d, b->process = delay_proc, b->flags = BLK_FX, b->name = "delay";
  return 1;
}

/* ============================================================= bitcrush == */
typedef struct {
  float mix, steps, hold, rect;
  int down, cnt;
  op_t lp;
} crush_t;
static void crush_proc(sh_block *b, float *L, float *R, int n) {
  crush_t *c = (crush_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = L[i];
    if (c->cnt++ % c->down == 0) {
      float y = x * (1 - c->rect) + sh_fabsf(x) * c->rect;
      c->hold = sh_floorf(y * c->steps + 0.5f) / c->steps;
    }
    float w = op_lp(&c->lp, c->hold);
    L[i] = x * (1 - c->mix) + w * c->mix;
    if (R) R[i] = R[i] * (1 - c->mix) + w * c->mix;
  }
}
static int crush_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  crush_t *c = (crush_t *)ar_alloc(a, sizeof(crush_t));
  if (!c) return 0;
  c->mix = P(g, "mix", 0.8f);
  c->down = 1 + (int)RAW(g, "downsample", 15);
  c->steps = (float)(1 << (int)RAW(g, "bit depth", 4));
  c->rect = P(g, "rectify", 0.8f) * 0.5f;
  op_lp_set(&c->lp, sr, 1000 * sh_pow(16, P(g, "filter", 0.45f)));
  b->st = c, b->process = crush_proc, b->name = "bit crusher";
  return 1;
}

/* ============================================================ dispatch == */
int fx_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int stereo) {
  const char *k = g->key;
  if (sh_has(k, "Verb") || sh_has(k, "Chamber") || sh_has(k, "Plate") || sh_has(k, "Spring")) return rev_build(b, g, a, sr, stereo);
  /* 4.5.x: chorus first: "VintageChorus" contains "echo" and used to be built as a delay */
  if (sh_has(k, "Chorus")) return mod_build(b, g, a, sr, stereo);
  if (sh_has(k, "Delay") || sh_has(k, "Echo")) return delay_build(b, g, a, sr, stereo);
  if (sh_has(k, "NoiseGate") || sh_has(k, "Compress") || sh_has(k, "Limiter") || sh_has(k, "Swole") || sh_has(k, "MBComp")) return dyn_build(b, g, a, sr);
  if (sh_has(k, "RangeBooster")) return boost_build(b, g, a, sr);
  if (sh_has(k, "BitCruncher")) return crush_build(b, g, a, sr);
  if (sh_has(k, "OctaveUp") || sh_has(k, "Octavius") || sh_has(k, "Pitch") || sh_has(k, "SubOctave") || sh_has(k, "BassEmulator")) return pitch_build(b, g, a, sr);
  if (sh_has(k, "Wah") || sh_has(k, "AutoFilter") || sh_has(k, "BobFilter") || sh_has(k, "SynthFilter")) return filt_build(b, g, a, sr);
  if (sh_has(k, "EQ") || sh_has(k, "LoFi") || sh_has(k, "AcousticEmulator")) return eq_build(b, g, a, sr);
  if (sh_has(k, "Rotatoe") || sh_has(k, "RotaVibe")) return rot_build(b, g, a, sr);
  if (sh_has(k, "RingMod")) return ring_build(b, g, a, sr);
  if (sh_has(k, "Trem") || sh_has(k, "AmpVibe") || sh_has(k, "AutoVibe") || sh_has(k, "MultiVibe") || sh_has(k, "AnalogVibe")) return trem_build(b, g, a, sr);
  if (sh_has(k, "Phase") || sh_has(k, "OmniMod")) return phase_build(b, g, a, sr);
  if (sh_has(k, "Chorus") || sh_has(k, "Flange") || sh_has(k, "Enbig") || sh_has(k, "Clones") || sh_has(k, "Supervibe")) return mod_build(b, g, a, sr, stereo);
  if (sh_has(k, "Drive") || sh_has(k, "Distortion") || sh_has(k, "Fuzz") || sh_has(k, "Buzz") || sh_has(k, "Guvnor") || sh_has(k, "ShredZone"))
    return drive_build(b, g, a, sr);
  return 0;
}
