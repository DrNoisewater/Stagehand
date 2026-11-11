/*
 * Tube and solid-state amp models, 4x oversampled.
 *
 * input → coupling HP → [bright] → N triode stages (asymmetric, bias shift,
 * inter-stage HP/LP, voicing peak) → tone stack (Fender/Marshall/Vox TMB, or
 * an active EQ for bass/solid-state amps) → power amp (push-pull with sag,
 * presence and resonance) → output transformer.
 */
#include "sh_dsp.h"

enum { FAM_CLEAN_US, FAM_TWEED, FAM_CHIME, FAM_PLEXI, FAM_BRIT_HOT, FAM_US_HI, FAM_ORANGE, FAM_SOLID, FAM_BASS_TUBE, FAM_BASS_SS, FAM_DI };
enum { STK_FENDER, STK_MARSHALL, STK_VOX, STK_ACTIVE };

typedef struct {
  const char *match;
  int fam;
  const char *label;
} amp_map;

/* Rocksmith 2014 amp keys → circuit family. Order matters (first match wins). */
static const amp_map MAP[] = {
    {"Bass_Amp_OrangeAD200B", FAM_BASS_TUBE, "Orange AD200B"},
    {"Bass_Amp_HT", FAM_BASS_TUBE, "British tube bass"},
    {"Bass_Amp_BT600B", FAM_BASS_TUBE, "Classic tube bass"},
    {"Bass_Amp_BT975B", FAM_BASS_TUBE, "Classic tube bass"},
    {"Bass_Amp_LT85B", FAM_BASS_TUBE, "Vintage tube bass"},
    {"Bass_Amp", FAM_BASS_SS, "Solid-state bass"},
    {"DI_Amp_BassDriver", FAM_BASS_SS, "Bass DI"},
    {"EdenWTDI", FAM_BASS_SS, "Eden D.I."},
    {"DI_Amp", FAM_DI, "DI"},
    {"Amp_MarshallJCM800", FAM_BRIT_HOT, "Marshall JCM800"},
    {"Amp_MarshallDSL", FAM_BRIT_HOT, "Marshall DSL"},
    {"Amp_MarshallJVM", FAM_BRIT_HOT, "Marshall JVM"},
    {"Amp_Marshall", FAM_PLEXI, "Marshall plexi"},
    {"Amp_Orange", FAM_ORANGE, "Orange"},
    {"Amp_CA100", FAM_US_HI, "Cali-100"},
    {"Amp_CA38", FAM_BRIT_HOT, "Cali-38"},
    {"Amp_CA85", FAM_CLEAN_US, "Cali-85"},
    {"Amp_CS", FAM_SOLID, "Solid-state clean"},
    {"Amp_EN50", FAM_US_HI, "EN-50"},
    {"Amp_EN30", FAM_BRIT_HOT, "EN-30"},
    {"Amp_GB100", FAM_US_HI, "GBC-1H"},
    {"Amp_GB38", FAM_BRIT_HOT, "GBC-38"},
    {"Amp_GB50", FAM_PLEXI, "GBC-50"},
    {"Amp_HG", FAM_US_HI, "HG high gain"},
    {"Amp_BT15", FAM_US_HI, "BTQ-15"},
    {"Amp_BT30", FAM_BRIT_HOT, "BTQ-30"},
    {"Amp_BT45", FAM_PLEXI, "BTQ-45"},
    {"Amp_AT", FAM_CHIME, "AT chime"},
    {"Amp_TW40", FAM_BRIT_HOT, "AMTW-40"},
    {"Amp_TW", FAM_CLEAN_US, "AMTW"},
    {"Amp_Gibson", FAM_TWEED, "Gibson"},
    {"Amp_Epiphone", FAM_TWEED, "Epiphone"},
    {0, FAM_PLEXI, "Amp"},
};

typedef struct {
  int stages;
  float lo_db, hi_db;       /* input drive range at gain 0..1 */
  float stage_gain[4];      /* small-signal gain of later stages */
  float hp_hz[4], lp_hz[4]; /* per stage coupling HP and Miller LP */
  float voice_hz, voice_db, voice_q; /* pre-stage-2 voicing peak */
  int stack;
  float bright_db;
  float pa_drive, sag;      /* power amp */
  float out_hp, out_lp;
  float pres_hz;
  int solid;
  float stack_pos; /* 0 = stack after preamp, 1 = between stage 1 and 2 (high gain) */
} amp_prof;

static amp_prof prof_for(int fam) {
  amp_prof p;
  sh_memset(&p, 0, sizeof p);
  p.voice_q = 0.8f;
  p.out_hp = 70, p.out_lp = 13000, p.pres_hz = 3500;
  for (int i = 0; i < 4; i++) p.lp_hz[i] = 14000, p.hp_hz[i] = 25, p.stage_gain[i] = 3;
  switch (fam) {
    case FAM_CLEAN_US:
      p.stages = 2, p.lo_db = -10, p.hi_db = 21, p.stack = STK_FENDER, p.bright_db = 5, p.pa_drive = 0.7f, p.sag = 0.25f;
      p.stage_gain[1] = 2, p.lp_hz[1] = 12000;
      break;
    case FAM_TWEED:
      p.stages = 2, p.lo_db = -4, p.hi_db = 22, p.stack = STK_FENDER, p.pa_drive = 1.6f, p.sag = 0.6f, p.lp_hz[0] = 8000, p.lp_hz[1] = 6000;
      p.stage_gain[1] = 2.5f, p.voice_hz = 900, p.voice_db = 3, p.out_lp = 9000;
      break;
    case FAM_CHIME:
      p.stages = 2, p.lo_db = -4, p.hi_db = 30, p.stack = STK_VOX, p.bright_db = 3, p.pa_drive = 1.5f, p.sag = 0.35f;
      p.stage_gain[1] = 3, p.voice_hz = 2200, p.voice_db = 3, p.voice_q = 0.9f, p.lp_hz[1] = 11000;
      break;
    case FAM_PLEXI:
      p.stages = 3, p.lo_db = -2, p.hi_db = 26, p.stack = STK_MARSHALL, p.bright_db = 4, p.pa_drive = 1.4f, p.sag = 0.35f;
      p.stage_gain[1] = 3.2f, p.stage_gain[2] = 1.6f, p.hp_hz[1] = 60, p.lp_hz[1] = 10000, p.lp_hz[2] = 9000, p.voice_hz = 1100, p.voice_db = 2;
      break;
    case FAM_BRIT_HOT:
      p.stages = 4, p.lo_db = -10, p.hi_db = 28, p.stack = STK_MARSHALL, p.bright_db = 3, p.pa_drive = 1.1f, p.sag = 0.25f;
      p.stage_gain[1] = 4, p.stage_gain[2] = 3, p.stage_gain[3] = 1.4f;
      p.hp_hz[1] = 120, p.hp_hz[2] = 90, p.lp_hz[1] = 9000, p.lp_hz[2] = 7500, p.lp_hz[3] = 7000;
      p.voice_hz = 900, p.voice_db = 4, p.voice_q = 0.7f;
      break;
    case FAM_US_HI:
      p.stages = 4, p.lo_db = -12, p.hi_db = 34, p.stack = STK_FENDER, p.bright_db = 2, p.pa_drive = 0.9f, p.sag = 0.2f;
      p.stage_gain[1] = 5, p.stage_gain[2] = 4, p.stage_gain[3] = 2;
      p.hp_hz[0] = 40, p.hp_hz[1] = 180, p.hp_hz[2] = 140, p.hp_hz[3] = 60, p.lp_hz[1] = 8000, p.lp_hz[2] = 6500, p.lp_hz[3] = 6500;
      p.voice_hz = 750, p.voice_db = 5, p.voice_q = 0.8f, p.stack_pos = 0;
      break;
    case FAM_ORANGE:
      p.stages = 4, p.lo_db = -10, p.hi_db = 30, p.stack = STK_MARSHALL, p.pa_drive = 1.5f, p.sag = 0.45f;
      p.stage_gain[1] = 4, p.stage_gain[2] = 2.5f, p.stage_gain[3] = 1.3f;
      p.hp_hz[1] = 80, p.lp_hz[1] = 7500, p.lp_hz[2] = 6500, p.lp_hz[3] = 6000, p.voice_hz = 500, p.voice_db = 4, p.voice_q = 0.6f;
      break;
    case FAM_SOLID:
      p.stages = 0, p.lo_db = -12, p.hi_db = 12, p.stack = STK_ACTIVE, p.bright_db = 4, p.pa_drive = 0.35f, p.sag = 0, p.solid = 1, p.out_lp = 16000;
      break;
    case FAM_BASS_TUBE:
      p.stages = 2, p.lo_db = -8, p.hi_db = 20, p.stack = STK_ACTIVE, p.pa_drive = 1.1f, p.sag = 0.4f, p.out_hp = 28, p.out_lp = 9000;
      p.stage_gain[1] = 2.5f, p.hp_hz[0] = 18, p.hp_hz[1] = 30, p.lp_hz[0] = 9000, p.lp_hz[1] = 7000;
      break;
    case FAM_BASS_SS:
      p.stages = 1, p.lo_db = -12, p.hi_db = 10, p.stack = STK_ACTIVE, p.pa_drive = 0.4f, p.sag = 0.1f, p.out_hp = 28, p.out_lp = 15000, p.solid = 1;
      p.hp_hz[0] = 18;
      break;
    case FAM_DI:
      p.stages = 1, p.lo_db = -10, p.hi_db = 14, p.stack = STK_ACTIVE, p.pa_drive = 0.3f, p.solid = 1, p.out_hp = 25, p.out_lp = 18000;
      break;
  }
  /* Tighten the low end before the first gain stage, more for higher-gain
     amps (as real high-gain circuits do): bass that reaches the clipping
     stages turns to mush and buries pick attack and pinch harmonics. */
  switch (fam) {
    case FAM_CLEAN_US: p.hp_hz[0] = 60; break;
    case FAM_TWEED: p.hp_hz[0] = 70; break;
    case FAM_CHIME: p.hp_hz[0] = 80; break;
    case FAM_PLEXI: p.hp_hz[0] = 100; break;
    case FAM_BRIT_HOT: p.hp_hz[0] = 150; break;
    case FAM_US_HI: p.hp_hz[0] = 170; break;
    case FAM_ORANGE: p.hp_hz[0] = 120; break;
    default: break;
  }
  if (fam != FAM_BASS_TUBE && fam != FAM_BASS_SS && fam != FAM_DI) p.out_hp = 85;
  return p;
}

/* ----------------------------------------------------------- tone stack -- */
/* Yeh & Smith closed-form TMB tone stack, discretised by bilinear transform. */
typedef struct {
  double b[4], a[4];
  double z[3];
} ts_t;

static void ts_design(ts_t *ts, int kind, double sr, double tre, double mid, double bas) {
  double R1, R2, R3, R4, C1, C2, C3;
  if (kind == STK_FENDER) R1 = 250e3, R2 = 1e6, R3 = 25e3, R4 = 56e3, C1 = 250e-12, C2 = 20e-9, C3 = 20e-9;
  else if (kind == STK_VOX) R1 = 1e6, R2 = 1e6, R3 = 10e3, R4 = 100e3, C1 = 50e-12, C2 = 22e-9, C3 = 22e-9;
  else R1 = 220e3, R2 = 1e6, R3 = 22e3, R4 = 33e3, C1 = 470e-12, C2 = 22e-9, C3 = 22e-9;
  double t = sh_clamp(tre, 0.001, 0.999);
  double m = sh_clamp(mid, 0.001, 0.999);
  double l = sh_clamp((sh_exp(bas * 3.4) - 1) / (sh_exp(3.4) - 1), 0.001, 0.999); /* log taper */
  double b1 = t * C1 * R1 + m * C3 * R3 + l * (C1 * R2 + C2 * R2) + (C1 * R3 + C2 * R3);
  double b2 = t * (C1 * C2 * R1 * R4 + C1 * C3 * R1 * R4) - m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
              m * (C1 * C3 * R1 * R3 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) + l * (C1 * C2 * R1 * R2 + C1 * C2 * R2 * R4 + C1 * C3 * R2 * R4) +
              l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) + (C1 * C2 * R1 * R3 + C1 * C2 * R3 * R4 + C1 * C3 * R3 * R4);
  double b3 = l * m * (C1 * C2 * C3 * R1 * R2 * R3 + C1 * C2 * C3 * R2 * R3 * R4) - m * m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) +
              m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) + t * C1 * C2 * C3 * R1 * R3 * R4 - t * m * C1 * C2 * C3 * R1 * R3 * R4 +
              t * l * C1 * C2 * C3 * R1 * R2 * R4;
  double a0 = 1;
  double a1 = (C1 * R1 + C1 * R3 + C2 * R3 + C2 * R4 + C3 * R4) + m * C3 * R3 + l * (C1 * R2 + C2 * R2);
  double a2 = m * (C1 * C3 * R1 * R3 - C2 * C3 * R3 * R4 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) + l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) -
              m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) + l * (C1 * C2 * R2 * R4 + C1 * C2 * R1 * R2 + C1 * C3 * R2 * R4 + C2 * C3 * R2 * R4) +
              (C1 * C2 * R1 * R4 + C1 * C3 * R1 * R4 + C1 * C2 * R3 * R4 + C1 * C2 * R1 * R3 + C1 * C3 * R3 * R4 + C2 * C3 * R3 * R4);
  double a3 = l * m * (C1 * C2 * C3 * R1 * R2 * R3 + C1 * C2 * C3 * R2 * R3 * R4) - m * m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) +
              m * (C1 * C2 * C3 * R3 * R3 * R4 + C1 * C2 * C3 * R1 * R3 * R3 - C1 * C2 * C3 * R1 * R3 * R4) + l * C1 * C2 * C3 * R1 * R2 * R4 +
              C1 * C2 * C3 * R1 * R3 * R4;
  double c = 2 * sr, c2 = c * c, c3 = c2 * c;
  double B0 = -b1 * c - b2 * c2 - b3 * c3, B1 = -b1 * c + b2 * c2 + 3 * b3 * c3, B2 = b1 * c + b2 * c2 - 3 * b3 * c3, B3 = b1 * c - b2 * c2 + b3 * c3;
  double A0 = -a0 - a1 * c - a2 * c2 - a3 * c3, A1 = -3 * a0 - a1 * c + a2 * c2 + 3 * a3 * c3, A2 = -3 * a0 + a1 * c + a2 * c2 - 3 * a3 * c3,
         A3 = -a0 + a1 * c - a2 * c2 + a3 * c3;
  ts->b[0] = B0 / A0, ts->b[1] = B1 / A0, ts->b[2] = B2 / A0, ts->b[3] = B3 / A0;
  ts->a[0] = 1, ts->a[1] = A1 / A0, ts->a[2] = A2 / A0, ts->a[3] = A3 / A0;
}
static inline float ts_run(ts_t *t, float xf) {
  double x = xf;
  double y = t->b[0] * x + t->z[0];
  t->z[0] = t->b[1] * x - t->a[1] * y + t->z[1];
  t->z[1] = t->b[2] * x - t->a[2] * y + t->z[2];
  t->z[2] = t->b[3] * x - t->a[3] * y;
  return (float)y;
}

/* ---------------------------------------------------------------- state -- */
#define MAX_EQ 10
typedef struct {
  amp_prof p;
  int fam;
  double sr, osr;
  os4_t os;
  float in_gain, base_in_gain;
  op_t in_hp[2];
  bq_t bright;
  op_t hp[4], lp[4];
  float bias[4];
  env_t benv[4];
  bq_t voice;
  ts_t ts;
  int use_ts;
  bq_t eq[MAX_EQ]; /* active EQ / extra voicing at 1x */
  int neq;
  float pa_gain, sag_env;
  bq_t pres, reso;
  bq_t out_hp, out_lp;
  float out_level;
  /* knobs as read from the gear (0..1 positions), for user offsets */
  float g0, b0, m0, t0;
  int has_mid;
  float comp_thr, comp_ratio;
  env_t comp_env;
  sh_gear gear;
} amp_st;

/* triode transfer: asymmetric, smooth knee; normalized small-signal gain 1 */
static inline float triode(float x) {
  if (x >= 0) return x / sh_sqrtf(1.f + x * x); /* grid conduction: soft-ish */
  float u = -x * (1.f / 1.6f);
  return -1.6f * u / sh_sqrtf(sh_sqrtf(1.f + u * u * u * u)); /* cutoff: harder, later */
}
static inline float powerstage(float x) {
  /* push-pull: symmetric, gentle knee then firm limit */
  float a = sh_fabsf(x);
  float y = a < 0.5f ? a : 0.5f + 0.5f * sh_tanhf((a - 0.5f) * 2.f);
  return x < 0 ? -y : y;
}

static float taper(float g) { return g; }

static void amp_coeffs(amp_st *s, float gain, float bass, float mid, float treble) {
  amp_prof *p = &s->p;
  double osr = s->osr;
  float g = sh_clampf(gain, 0, 1);
  s->in_gain = (float)sh_db2lin(p->lo_db + (p->hi_db - p->lo_db) * taper(g));
  /* bright cap: more treble at low gain */
  bq_set(&s->bright, BQ_HSHELF, osr, 1800, 0.6, p->bright_db * (1.0 - g * 0.8));
  if (p->voice_db) bq_set(&s->voice, BQ_PEAK, osr, p->voice_hz, p->voice_q, p->voice_db);
  else bq_set(&s->voice, BQ_PEAK, osr, 1000, 1, 0);
  if (p->stack != STK_ACTIVE) {
    ts_design(&s->ts, p->stack, osr, treble, s->has_mid ? mid : 0.5, bass);
    s->use_ts = 1;
  }
}

static void amp_eq_active(amp_st *s, const sh_gear *g, float ub, float um, float ut) {
  /* bass amps and solid-state: shelves/peaks driven by the knobs.
   * -12..12 knobs are dB; 1..100 knobs are positions (50 = flat). */
  double sr = s->sr;
  s->neq = 0;
  sh_knob k;
  float off_b = (ub - 0.5f) * 24, off_m = (um - 0.5f) * 24, off_t = (ut - 0.5f) * 24;
#define DBOF(kk) ((kk).lo < 0 ? (kk).v : ((kk).v - 50.f) * 0.24f)
  float bdb = kn_exact(g, "bass", &k) ? DBOF(k) : 0;
  float mdb = kn_exact(g, "mid", &k) ? DBOF(k) : 0;
  float tdb = kn_exact(g, "treble", &k) ? DBOF(k) : 0;
  float mid_hz = 650;
  static const char *const MIDF[] = {"mid frequency", "mid freq.", "mid freq", "mid-frequency", "mid-freq", "mid. freq.", "mid. freq. select", NULL};
  if (kn_any_exact(g, MIDF, &k)) {
    if (k.hi <= 5) mid_hz = 220.f * sh_pow(10.f / 2.2f, (k.v - k.lo) / (k.hi - k.lo)); /* select switch */
    else if (k.hi <= 20) mid_hz = k.v * 1000.f;
    else if (k.hi <= 100 && k.lo >= 1) mid_hz = (float)(200.0 * sh_pow(10, (k.v - k.lo) / (k.hi - k.lo)));
    else mid_hz = k.v;
  }
  int lowshift = kn_find(g, "low-shift", &k) && k.v > 0.5f;
  int highshift = kn_find(g, "high-shift", &k) && k.v > 0.5f;
  /* 4.5.x: Eden WT D.I. switches: Mid-Shift moves the mid control down an octave */
  if (kn_exact(g, "mid-shift", &k) && k.v > 0.5f) mid_hz *= 0.5f;
  bq_set(&s->eq[s->neq++], BQ_LSHELF, sr, lowshift ? 60 : 110, 0.7, bdb + off_b);
  bq_set(&s->eq[s->neq++], BQ_PEAK, sr, mid_hz, 0.8, mdb + off_m);
  bq_set(&s->eq[s->neq++], BQ_HSHELF, sr, highshift ? 5000 : 2800, 0.7, tdb + off_t);
  if (kn_exact(g, "low-mid", &k)) {
    sh_knob f;
    float hz = kn_find(g, "low-mid freq", &f) ? f.v : 250;
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, hz, 1.0, DBOF(k));
  }
  if (kn_exact(g, "high-mid", &k)) {
    sh_knob f;
    float hz = kn_find(g, "high-mid freq", &f) ? (f.hi <= 20 ? f.v * 1000 : f.v) : 2500;
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, hz, 1.0, DBOF(k));
  }
  if (kn_exact(g, "lo mid", &k)) bq_set(&s->eq[s->neq++], BQ_PEAK, sr, 300, 0.9, DBOF(k));
  if (kn_exact(g, "hi mid", &k)) bq_set(&s->eq[s->neq++], BQ_PEAK, sr, 1800, 0.9, DBOF(k));
  /* graphic bands named by frequency, e.g. "180hz", "1.2khz" */
  for (int i = 0; i < g->nk && s->neq < MAX_EQ; i++) {
    const char *n = g->k[i].name;
    int len = 0;
    while (n[len]) len++;
    if (len < 3 || n[len - 2] != 'h' || n[len - 1] != 'z') continue;
    const char *q = n;
    double hz = 0, f = 0.1;
    while (*q >= '0' && *q <= '9') hz = hz * 10 + (*q++ - '0');
    if (*q == '.') {
      q++;
      while (*q >= '0' && *q <= '9') hz += (*q++ - '0') * f, f *= 0.1;
    }
    if (*q == 'k') hz *= 1000;
    if (hz > 10) bq_set(&s->eq[s->neq++], BQ_PEAK, sr, hz, 1.2, g->k[i].v);
  }
  if (kn_find(g, "enhance", &k) && s->neq < MAX_EQ) { /* mid scoop + top */
    float e = (k.v - k.lo) / (k.hi - k.lo);
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, 500, 0.6, -8 * e);
  }
  if (kn_find(g, "punch", &k) && s->neq < MAX_EQ) bq_set(&s->eq[s->neq++], BQ_PEAK, sr, 120, 0.9, (k.v - 50) * 0.12f);
  /* 4.5.x: Eden Bass Boost switch: the deep shelf of the real D.I. */
  if (kn_exact(g, "bass boost", &k) && k.v > 0.5f && s->neq < MAX_EQ) bq_set(&s->eq[s->neq++], BQ_LSHELF, sr, 60, 0.8, 5);
  if (kn_exact(g, "tone", &k) && s->neq < MAX_EQ) bq_set(&s->eq[s->neq++], BQ_HSHELF, sr, 1500, 0.6, ((k.v - k.lo) / (k.hi - k.lo) - 0.5f) * 14);
#undef DBOF
}

/* 4.5.x: a passive (Fender/Marshall/Vox) stack with extra controls the stack itself
   doesn't have: a Mid-Frequency knob (Hughes & Kettner-style) moves where the mid knob
   pushes or cuts; Punch (Orange OR) is a tight low-mid thump. */
static void amp_eq_passive_extras(amp_st *s, const sh_gear *g, float mid) {
  double sr = s->sr;
  sh_knob k;
  s->neq = 0;
  static const char *const MIDF[] = {"mid frequency", "mid freq.", "mid freq", "mid-frequency", "mid-freq", NULL};
  if (kn_any_exact(g, MIDF, &k) && s->neq < MAX_EQ) {
    float t = (k.v - k.lo) / (k.hi - k.lo);
    float hz = (float)(250.0 * sh_pow(8, t)); /* 250 Hz .. 2 kHz */
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, hz, 1.1, (mid - 0.5f) * 14);
  }
  /* DI Tube Pre: a three-way mid frequency switch (500 / 800 / 1.6k) for the mid knob */
  if (kn_exact(g, "mid. freq. select", &k) && s->neq < MAX_EQ)
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, k.v < 0.5f ? 500 : k.v < 1.5f ? 800 : 1600, 1.0, (mid - 0.5f) * 14);
  if (kn_exact(g, "punch", &k) && s->neq < MAX_EQ) {
    float t = (k.v - k.lo) / (k.hi - k.lo);
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, 140, 1.0, (t - 0.5f) * 10);
    bq_set(&s->eq[s->neq++], BQ_PEAK, sr, 600, 0.9, -(t - 0.5f) * 4);
  }
}

static void amp_proc(sh_block *b, float *L, float *R, int n) {
  (void)R;
  amp_st *s = (amp_st *)b->st;
  amp_prof *p = &s->p;
  for (int i = 0; i < n; i++) {
    float x = L[i];
    if (s->comp_ratio > 1) { /* bass amp built-in compressor */
      float e = env_run(&s->comp_env, x);
      float db = sh_lin2db_fast(e);
      if (db > s->comp_thr) x *= sh_db2lin_fast((s->comp_thr - db) * (1.f - 1.f / s->comp_ratio));
    }
    x = op_hp(&s->in_hp[0], x);
    float u[4];
    os4_up(&s->os, x * s->in_gain, u);
    for (int k = 0; k < 4; k++) {
      float y = u[k];
      y = bq_run(&s->bright, y);
      if (!p->solid) {
        for (int st = 0; st < p->stages; st++) {
          if (st == 1) y = bq_run(&s->voice, y);
          float e = env_run(&s->benv[st], y);
          float bias = s->bias[st] - 0.35f * e; /* blocking: bias shifts under load */
          float g = st ? p->stage_gain[st] : 1.f;
          y = triode(y * g + bias) - triode(bias);
          y = -y; /* inverting stage */
          y = op_hp(&s->hp[st], y);
          y = op_lp(&s->lp[st], y);
        }
      } else if (p->stages) { /* solid-state preamp: clean until it isn't */
        y = sh_tanhf(y * 0.8f) * 1.25f;
      }
      if (s->use_ts) y = ts_run(&s->ts, y) * 3.f;
      /* power amp */
      float drive = s->pa_gain;
      float a = sh_fabsf(y * drive);
      s->sag_env += (a > s->sag_env ? 0.002f : 0.00002f) * (a - s->sag_env);
      float sag = 1.f / (1.f + p->sag * s->sag_env);
      y = p->solid ? sh_tanhf(y * drive * 0.6f) / 0.6f : powerstage(y * drive * sag);
      u[k] = y;
    }
    float y = os4_down(&s->os, u);
    for (int e = 0; e < s->neq; e++) y = bq_run(&s->eq[e], y);
    y = bq_run(&s->pres, y);
    y = bq_run(&s->reso, y);
    y = bq_run(&s->out_hp, y);
    y = bq_run(&s->out_lp, y);
    L[i] = y * s->out_level;
  }
}

static void amp_apply_user(amp_st *s, float ug, float ub, float um, float ut) {
  /* user knobs: 0.5 = as the tone says; gain < 0 = tone's own */
  float g = ug >= 0 ? ug : s->g0;
  float off = 0.5f;
  float bass = sh_clampf(s->b0 + (ub - off), 0, 1), mid = sh_clampf(s->m0 + (um - off), 0, 1), tre = sh_clampf(s->t0 + (ut - off), 0, 1);
  amp_coeffs(s, g, bass, mid, tre);
  if (s->p.stack == STK_ACTIVE) amp_eq_active(s, &s->gear, ub, um, ut);
  else amp_eq_passive_extras(s, &s->gear, mid);
}

void amp_user(sh_block *b, float gain, float bass, float mid, float treble) {
  if (!b || !b->st) return;
  if (b->user) {
    b->user(b, gain, bass, mid, treble);
    return;
  }
  amp_apply_user((amp_st *)b->st, gain, bass, mid, treble);
}

int amp_build(sh_block *b, const sh_gear *g, const sh_spec *spec, sh_arena *a, double sr, float *gain_db_out) {
  amp_st *s = (amp_st *)ar_alloc(a, sizeof(amp_st));
  if (!s) return 0;
  const amp_map *m = MAP;
  while (m->match && !sh_has(g->key, m->match)) m++;
  s->fam = m->fam;
  s->p = prof_for(m->fam);
  s->gear = *g;
  s->sr = sr;
  s->osr = sr * 4;
  os4_init(&s->os);
  amp_prof *p = &s->p;
  /* gain knob: Gain / PreAmp / Volume / Loudness / Vol 1 / Speaker */
  sh_knob k;
  float gain = 0.6f;
  if (kn_find(g, "gain", &k) || kn_find(g, "preamp", &k) || kn_find(g, "loudness", &k) || kn_find(g, "vol", &k) || kn_find(g, "speaker", &k))
    gain = (k.v - k.lo) / (k.hi - k.lo);
  sh_knob k2;
  if (kn_exact(g, "loudness 2", &k2)) gain = sh_clampf(gain > (k2.v - k2.lo) / (k2.hi - k2.lo) ? gain : (k2.v - k2.lo) / (k2.hi - k2.lo), 0, 1);
  s->g0 = gain;
  s->b0 = kn_exact(g, "bass", &k) && k.lo >= 0 ? (k.v - k.lo) / (k.hi - k.lo) : 0.5f;
  s->has_mid = kn_exact(g, "mid", &k) || kn_exact(g, "midrange", &k);
  s->m0 = s->has_mid && k.lo >= 0 ? (k.v - k.lo) / (k.hi - k.lo) : 0.5f;
  s->t0 = kn_exact(g, "treble", &k) && k.lo >= 0 ? (k.v - k.lo) / (k.hi - k.lo) : 0.5f;
  if (kn_exact(g, "tone", &k) && p->stack != STK_ACTIVE) { /* single tone knob (Tiny Terror, Hawaiian) */
    float t = (k.v - k.lo) / (k.hi - k.lo);
    s->t0 = t, s->b0 = 1 - t * 0.6f, s->m0 = 0.5f;
  }
  if (kn_exact(g, "bright", &k) && k.v < 0.5f) p->bright_db = 0;
  op_lp_set(&s->in_hp[0], sr, p->hp_hz[0] < 20 ? 20 : p->hp_hz[0]);
  for (int i = 0; i < 4; i++) {
    op_lp_set(&s->hp[i], s->osr, p->hp_hz[i]);
    op_lp_set(&s->lp[i], s->osr, p->lp_hz[i]);
    env_set(&s->benv[i], s->osr, 5, 120);
    s->bias[i] = i == 0 ? 0.1f : 0.25f;
  }
  float pres = kn_find(g, "presence", &k) ? (k.v - k.lo) / (k.hi - k.lo) : 0.4f;
  bq_set(&s->pres, BQ_HSHELF, sr, p->pres_hz, 0.7, (pres - 0.4) * 14);
  float reso = (kn_find(g, "resonance", &k) || kn_find(g, "deep", &k)) ? (k.v - k.lo) / (k.hi - k.lo) : 0.3f;
  bq_set(&s->reso, BQ_PEAK, sr, spec->bass ? 70 : 100, 1.0, (reso - 0.3) * 10);
  bq_set(&s->out_hp, BQ_HP, sr, p->out_hp, 0.6, 0);
  bq_set(&s->out_lp, BQ_LP, sr, p->out_lp, 0.6, 0);
  if (kn_find(g, "compression", &k)) {
    float c = (k.v - k.lo) / (k.hi - k.lo);
    s->comp_thr = -10 - 26 * c, s->comp_ratio = 1 + 5 * c;
    env_set(&s->comp_env, sr, 3, 150);
  }
  if (kn_find(g, "blend", &k)) p->pa_drive *= 0.6f + 0.8f * (k.v - k.lo) / (k.hi - k.lo);
  if (kn_find(g, "mid. freq. select", &k)) p->voice_hz = k.v < 0.5f ? 500 : k.v < 1.5f ? 800 : 1600, p->voice_db = 3;
  s->pa_gain = p->pa_drive;
  s->out_level = 1.f;
  amp_apply_user(s, spec->user_gain, spec->user_bass ? spec->user_bass : 0.5f, spec->user_mid ? spec->user_mid : 0.5f, spec->user_treble ? spec->user_treble : 0.5f);
  if (gain_db_out) *gain_db_out = p->hi_db > 25 ? p->lo_db + (p->hi_db - p->lo_db) * s->g0 : 0;
  b->process = amp_proc;
  b->user = 0;
  b->st = s;
  b->name = m->label;
  return 1;
}
