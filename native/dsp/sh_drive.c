/*
 * Drive pedals: overdrives, distortions, fuzzes and boosters.
 */
#include "sh_dsp.h"

static float P(const sh_gear *g, const char *n, float def) { return kn_pos(g, n, def); }
static float RAW(const sh_gear *g, const char *n, float def) { return kn_raw(g, n, def); }

/* ================================================================ drive == */
enum { CLIP_SOFT, CLIP_ASYM, CLIP_HARD, CLIP_FUZZ, CLIP_GERM };
typedef struct {
  os4_t os;
  float pre;
  bq_t hp, mid, tone, tone2, post_lp, eq[4];
  int neq;
  int clip;
  float level, blend;
  op_t dc;
  /* tube-screamer style: the clipped part (high-passed, softened on top) is added back to the dry signal */
  int ts;
  op_t ts_hp, ts_lp;
  /* the dry signal, held back to line up with the oversampled clipper (15 samples) */
  float dbuf[16];
  int dpos;
} drive_t;

static inline float clipf(int t, float x) {
  switch (t) {
    case CLIP_SOFT: return sh_tanhf(x);
    case CLIP_ASYM: return x > 0 ? sh_tanhf(x) : sh_tanhf(x * 0.7f) * 1.25f;
    case CLIP_HARD: { float y = x / sh_sqrtf(sh_sqrtf(1.f + x * x * x * x)); return y; }
    case CLIP_FUZZ: { float y = x > 0 ? 1.f - sh_expf_fast(-x) : -(1.f - sh_expf_fast(x * 1.6f)) / 1.6f; return y * 1.1f; }
    case CLIP_GERM: { float y = x > 0 ? x / (1.f + x) : x / (1.f - 0.6f * x); return y * 1.3f; }
  }
  return x;
}

static void drive_proc(sh_block *b, float *L, float *R, int n) {
  (void)R;
  drive_t *d = (drive_t *)b->st;
  for (int i = 0; i < n; i++) {
    float dry = L[i];
    float x = bq_run(&d->hp, dry);
    x = bq_run(&d->mid, x);
    if (d->ts) x = op_hp(&d->ts_hp, x);
    float u[4];
    os4_up(&d->os, x * d->pre, u);
    for (int k = 0; k < 4; k++) u[k] = clipf(d->clip, u[k]);
    float y = os4_down(&d->os, u);
    d->dbuf[d->dpos] = dry;
    d->dpos = (d->dpos + 1) & 15;
    dry = d->dbuf[d->dpos]; /* the sample from 15 steps back */
    if (d->ts) y = 0.8f * op_lp(&d->ts_lp, y) + dry;
    y = op_hp(&d->dc, y);
    y = bq_run(&d->tone, y);
    y = bq_run(&d->tone2, y);
    y = bq_run(&d->post_lp, y);
    for (int e = 0; e < d->neq; e++) y = bq_run(&d->eq[e], y);
    y *= d->level;
    L[i] = d->blend < 1 ? dry * (1 - d->blend) + y * d->blend : y;
  }
}

int drive_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  drive_t *d = (drive_t *)ar_alloc(a, sizeof(drive_t));
  if (!d) return 0;
  os4_init(&d->os);
  const char *k = g->key;
  float gain = P(g, "gain", 0.7f), tone = P(g, "tone", 0.5f);
  if (sh_has(k, "CaptFuzzle")) gain = sh_clampf((RAW(g, "gain", 100) - 1) / 149.f, 0, 1);
  float lo_db = 6, hi_db = 36, hp = 40, mid_hz = 0, mid_db = 0, lp = 9000;
  d->clip = CLIP_SOFT;
  d->blend = 1;
  if (sh_has(k, "BassOverdrive")) {
    lo_db = 4, hi_db = 30, hp = 30, d->clip = CLIP_SOFT, lp = 5000, d->blend = P(g, "blend", 0.55f);
  } else if (sh_has(k, "SuperDrive") || sh_has(k, "Overdrive")) {
    /* tube-screamer style: the lows pass clean, the mids are pushed and clipped softly, the top rolled off */
    lo_db = 8, hi_db = 38, hp = 20, mid_hz = 0, d->clip = CLIP_SOFT, lp = 6000;
    d->ts = 1;
    op_lp_set(&d->ts_hp, sr, 720);
    op_lp_set(&d->ts_lp, sr, 2000);
  } else if (sh_has(k, "LineDrive")) { /* clean-ish boost */
    lo_db = 0, hi_db = 22, hp = 60, d->clip = CLIP_SOFT, lp = 12000;
  } else if (sh_has(k, "MetalDistortion")) { /* DS/HM style, tight and scooped */
    lo_db = 18, hi_db = 46, hp = 200, mid_hz = 700, mid_db = -6, d->clip = CLIP_HARD, lp = 7000;
  } else if (sh_has(k, "VintageDistortion")) { /* RAT-ish */
    lo_db = 12, hi_db = 42, hp = 100, d->clip = CLIP_HARD, lp = 6000;
  } else if (sh_has(k, "Pedal_Distortion")) {
    lo_db = 14, hi_db = 42, hp = 90, d->clip = CLIP_HARD, lp = 6500, mid_hz = 900, mid_db = 2;
  } else if (sh_has(k, "FuzzWasHe")) { /* fuzz face */
    lo_db = 16, hi_db = 40, hp = 60, d->clip = CLIP_GERM, lp = 5000;
  } else if (sh_has(k, "Buzz") || sh_has(k, "CaptFuzzle")) { /* big-muff style: scooped wall */
    lo_db = 20, hi_db = 50, hp = 80, d->clip = CLIP_FUZZ, mid_hz = 1000, mid_db = -8, lp = 4500;
  } else if (sh_has(k, "GermaniumDrive")) {
    lo_db = 8, hi_db = 34, hp = 90, d->clip = CLIP_GERM, lp = 6000;
  } else if (sh_has(k, "Guvnor")) {
    lo_db = 6, hi_db = 38, hp = 70, d->clip = CLIP_ASYM, lp = 7000;
    gain = P(g, "gain", 0.3f);
    sh_knob kk;
    d->neq = 0;
    if (kn_exact(g, "bass", &kk)) bq_set(&d->eq[d->neq++], BQ_LSHELF, sr, 150, 0.7, ((kk.v - kk.lo) / (kk.hi - kk.lo) - 0.5) * 18);
    if (kn_exact(g, "mid", &kk)) bq_set(&d->eq[d->neq++], BQ_PEAK, sr, 800, 0.8, ((kk.v - kk.lo) / (kk.hi - kk.lo) - 0.5) * 18);
    if (kn_exact(g, "treble", &kk)) bq_set(&d->eq[d->neq++], BQ_HSHELF, sr, 2500, 0.7, ((kk.v - kk.lo) / (kk.hi - kk.lo) - 0.5) * 18);
    /* 4.5.x: Deep: a resonant low boost after the clipping, as on the real pedal (0..+12 dB) */
    if (kn_exact(g, "deep", &kk)) bq_set(&d->eq[d->neq++], BQ_PEAK, sr, 85, 1.1, (kk.v - kk.lo) / (kk.hi - kk.lo) * 12);
    tone = 0.5f;
  } else if (sh_has(k, "ShredZone")) { /* metal zone: huge gain, active EQ */
    lo_db = 20, hi_db = 50, hp = 150, d->clip = CLIP_HARD, lp = 7500;
    d->neq = 3;
    bq_set(&d->eq[0], BQ_LSHELF, sr, 120, 0.7, RAW(g, "bass", 0) * 1.6);
    bq_set(&d->eq[1], BQ_PEAK, sr, 900, 0.9, RAW(g, "mid", 0) * 1.6);
    bq_set(&d->eq[2], BQ_HSHELF, sr, 3500, 0.7, RAW(g, "treble", 0) * 1.6);
    tone = 0.5f;
  } else if (sh_has(k, "CustomDrive")) {
    int ca = RAW(g, "voicing", 0) > 0.5f;
    lo_db = 10, hi_db = 40, hp = ca ? 160 : 90, d->clip = ca ? CLIP_HARD : CLIP_ASYM, lp = ca ? 7000 : 6000, mid_hz = ca ? 0 : 1000, mid_db = 3;
  } else if (sh_has(k, "BassDistortion")) {
    lo_db = 10, hi_db = 38, hp = 30, d->clip = CLIP_HARD, lp = 4500, d->blend = 0.8f;
  } else if (sh_has(k, "BassFuzz")) {
    lo_db = 16, hi_db = 44, hp = 30, d->clip = CLIP_FUZZ, lp = 4000, d->blend = 0.8f;
  }
  float filt = P(g, "filter", -1);
  if (filt >= 0) lp = (float)(800 * sh_pow(12, filt));
  d->pre = (float)sh_db2lin(lo_db + (hi_db - lo_db) * gain);
  bq_set(&d->hp, BQ_HP, sr, hp, 0.6, 0);
  bq_set(&d->mid, BQ_PEAK, sr, mid_hz ? mid_hz : 1000, 0.8, mid_hz ? mid_db : 0);
  /* tone: tilt from dark to bright */
  bq_set(&d->tone, BQ_HSHELF, sr, 1600, 0.6, (tone - 0.5) * 16);
  bq_set(&d->tone2, BQ_LP, sr, lp * (0.6 + tone * 0.8), 0.7, 0);
  bq_set(&d->post_lp, BQ_LP, sr, 11000, 0.6, 0);
  op_lp_set(&d->dc, sr, 15);
  /* level: keep roughly unity loudness */
  d->level = (float)(d->clip == CLIP_SOFT ? 0.9 : 0.7) * (float)sh_db2lin(-(lo_db + (hi_db - lo_db) * gain) * 0.08);
  if (d->ts) d->level = 0.75f;
  if (sh_has(k, "LineDrive")) d->level = (float)sh_db2lin((lo_db + (hi_db - lo_db) * gain) * 0.35);
  b->st = d;
  b->process = drive_proc;
  b->name = "drive";
  return 1;
}

/* treble booster */
typedef struct {
  bq_t hp, lp;
  float g;
} boost_t;
static void boost_proc(sh_block *b, float *L, float *R, int n) {
  (void)R;
  boost_t *d = (boost_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = bq_run(&d->hp, L[i]) * d->g;
    L[i] = bq_run(&d->lp, sh_tanhf(x));
  }
}
int boost_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  boost_t *d = (boost_t *)ar_alloc(a, sizeof(boost_t));
  if (!d) return 0;
  float v = P(g, "boost", 0.85f);
  bq_set(&d->hp, BQ_HSHELF, sr, 1200, 0.6, 6 + 10 * v);
  bq_set(&d->lp, BQ_LP, sr, 9000, 0.7, 0);
  d->g = (float)sh_db2lin(2 + 10 * v);
  b->st = d, b->process = boost_proc, b->name = "booster";
  return 1;
}

