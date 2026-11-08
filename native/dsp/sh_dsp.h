/*
 * Stagehand DSP core: guitar/bass rig built from Rocksmith 2014 gear.
 * Internal header shared by the DSP sources.
 */
#ifndef SH_DSP_H
#define SH_DSP_H

#include "sh_math.h"
#include "sh_engine.h"

/* ------------------------------------------------------------ memory -- */
typedef struct {
  uint8_t *base;
  size_t size, used;
  int failed;
} sh_arena;

void *ar_alloc(sh_arena *a, size_t bytes); /* zeroed, 16-byte aligned; NULL-safe failure flag */
void sh_memset(void *p, int v, size_t n);
void sh_memcpy(void *d, const void *s, size_t n);

/* ------------------------------------------------------------- gear spec -- */
#define SH_MAX_KNOBS 16
#define SH_MAX_GEAR 16

typedef struct {
  char name[40]; /* lower-case */
  float v, lo, hi;
} sh_knob;

enum { SLOT_PRE, SLOT_AMP, SLOT_POST, SLOT_CAB, SLOT_RACK };

typedef struct {
  int slot;
  char key[64];
  int nk;
  sh_knob k[SH_MAX_KNOBS];
} sh_gear;

typedef struct {
  int ngear;
  sh_gear g[SH_MAX_GEAR];
  int bass;
  float user_gain, user_bass, user_mid, user_treble; /* 0..1, 0.5 = as the tone says; gain<0 = tone's own */
  float gate_db; /* 0 = automatic */
} sh_spec;

int sh_parse_spec(const char *text, sh_spec *out);

/* knob helpers: returns 1 if found */
int kn_find(const sh_gear *g, const char *needle, sh_knob *out);    /* name contains needle */
int kn_exact(const sh_gear *g, const char *name, sh_knob *out);     /* name equals */
float kn_pos(const sh_gear *g, const char *needle, float def);      /* 0..1 position */
float kn_raw(const sh_gear *g, const char *needle, float def);      /* raw value */
int sh_has(const char *hay, const char *needle);                   /* substring, case-insensitive */

/* ------------------------------------------------------------ filters -- */
typedef struct {
  double b0, b1, b2, a1, a2;
  double z1, z2;
} bq_t;

enum { BQ_LP, BQ_HP, BQ_BP, BQ_PEAK, BQ_LSHELF, BQ_HSHELF, BQ_NOTCH, BQ_AP };
void bq_set(bq_t *f, int type, double sr, double hz, double q, double db);
static inline float bq_run(bq_t *f, float x) {
  double y = f->b0 * x + f->z1;
  f->z1 = f->b1 * x - f->a1 * y + f->z2;
  f->z2 = f->b2 * x - f->a2 * y;
  return (float)y;
}
void bq_reset(bq_t *f);
double bq_mag_db(const bq_t *f, double sr, double hz);

typedef struct {
  float a, z;
} op_t; /* one-pole */
static inline void op_lp_set(op_t *f, double sr, double hz) { f->a = (float)(1.0 - sh_exp(-SH_TAU * hz / sr)); }
static inline float op_lp(op_t *f, float x) { return f->z += f->a * (x - f->z); }
static inline float op_hp(op_t *f, float x) { return x - (f->z += f->a * (x - f->z)); }

/* simple state-variable filter (Chamberlin/TPT) */
typedef struct {
  float g, k, ic1, ic2;
} svf_t;
static inline void svf_set(svf_t *f, double sr, double hz, double q) {
  if (hz > sr * 0.45) hz = sr * 0.45;
  f->g = (float)sh_tan(SH_PI * hz / sr);
  f->k = (float)(1.0 / q);
}
static inline void svf_run(svf_t *f, float x, float *lp, float *bp, float *hp) {
  float v3 = x - f->ic2;
  float v1 = (f->ic1 + f->g * v3) / (1.f + f->g * (f->g + f->k));
  float v2 = f->ic2 + f->g * v1;
  f->ic1 = 2.f * v1 - f->ic1;
  f->ic2 = 2.f * v2 - f->ic2;
  *lp = v2;
  *bp = v1;
  *hp = x - f->k * v1 - v2;
}

/* envelope follower */
typedef struct {
  float att, rel, env;
} env_t;
static inline void env_set(env_t *e, double sr, double att_ms, double rel_ms) {
  e->att = (float)(1.0 - sh_exp(-1000.0 / (sr * (att_ms < 0.01 ? 0.01 : att_ms))));
  e->rel = (float)(1.0 - sh_exp(-1000.0 / (sr * (rel_ms < 0.01 ? 0.01 : rel_ms))));
}
static inline float env_run(env_t *e, float x) {
  float a = sh_fabsf(x);
  e->env += (a > e->env ? e->att : e->rel) * (a - e->env);
  return e->env;
}

/* 4x oversampler (polyphase FIR) */
#define OS_TAPS 64
typedef struct {
  float h[OS_TAPS];
  float up[OS_TAPS / 4 * 2];
  int upos;
  float dn[OS_TAPS * 2];
  int dpos;
} os4_t;
void os4_init(os4_t *o);
void os4_up(os4_t *o, float x, float out[4]);
float os4_down(os4_t *o, const float in[4]);

/* delay line */
typedef struct {
  float *buf;
  int len, pos;
} dl_t;
int dl_init(dl_t *d, sh_arena *a, int len);
static inline void dl_push(dl_t *d, float x) {
  d->buf[d->pos] = x;
  if (++d->pos >= d->len) d->pos = 0;
}
static inline float dl_tap(const dl_t *d, int back) { /* back >= 1 */
  int i = d->pos - back;
  while (i < 0) i += d->len;
  return d->buf[i];
}
static inline float dl_tapf(const dl_t *d, float back) { /* fractional, cubic */
  if (back < 1.f) back = 1.f;
  if (back > d->len - 3) back = (float)(d->len - 3);
  int i = (int)back;
  float f = back - i;
  float xm1 = dl_tap(d, i - 1 < 1 ? 1 : i - 1), x0 = dl_tap(d, i), x1 = dl_tap(d, i + 1), x2 = dl_tap(d, i + 2);
  float c1 = 0.5f * (x1 - xm1), c2 = xm1 - 2.5f * x0 + 2.f * x1 - 0.5f * x2, c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/* ------------------------------------------------------------- blocks -- */
typedef struct sh_block sh_block;
typedef void (*sh_proc)(sh_block *b, float *L, float *R, int n);

#define BLK_FX 1 /* time effect: wet scaled by the FX knob */

struct sh_block {
  sh_proc process;
  int flags;
  float fxscale; /* set by engine, 0..2 */
  void *st;
  const char *name;
  void (*user)(sh_block *b, float gain, float bass, float mid, float treble); /* user knobs (amps) */
};

/* builders: return 0 on failure (unknown gear is skipped) */
int amp_build(sh_block *b, const sh_gear *g, const sh_spec *s, sh_arena *a, double sr, float *gain_db_out);
struct nam_model;
/* a real amp capture in the amp's place (sh_nam.c); gain_ref = the gain knob position the capture
   was made at, trim_db = input level correction */
int namamp_build(sh_block *b, const sh_gear *g, const sh_spec *s, const struct nam_model *m, float gain_ref, float trim_db,
                 float *squash_cache, sh_arena *a, double sr, float *gain_db_out);
void amp_user(sh_block *b, float gain, float bass, float mid, float treble);
int cab_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int bass);
int cab_build_ir(sh_block *b, const float *ir, int len, sh_arena *a);
int fx_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int stereo);
int rev_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int stereo);
/* Stagehand's own noise gate, in front of every tone. live (owned by the engine, read as it plays):
   live[0] = the player's measured noise floor (dB, peak envelope; < -150 = not known yet),
   live[1] = threshold offset (dB, + = stronger), live[2] = 1 when the gate is switched off;
   the gate writes live[3] = how open it is (0..1).
   It opens above max(thr_db, floor + 12) + offset and closes 6 dB lower. */
int gate_build_default(sh_block *b, sh_arena *a, double sr, float thr_db, float *live);

/* FFT (complex, in-place, n power of two) */
void sh_fft(double *re, double *im, int n, int inverse);

#endif
