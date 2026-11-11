/*
 * Drive pedals: overdrives, distortions, fuzzes and boosters, built from their circuits.
 *
 * Each pedal is the chain of its real stages, with part values from the circuits they follow:
 * coupling caps (high-pass), op-amp gain stages (gain set by resistor/cap pairs, limited by the
 * chip's bandwidth and slew rate, soft at the 9 V rails), transistor stages (exponential, with
 * saturation and cutoff, so they clip unevenly), diode clippers (the diode equation solved every
 * sample), and the real tone networks. The nonlinear part runs 4x oversampled.
 *
 * Signal scale: 1.0 is about 1 V from the guitar ("Set level" puts a strum's peaks at -6 dBFS).
 * Playing softer or turning the guitar down sends less into the circuit, and it cleans up the
 * way the real one does, because nothing here is a fixed curve.
 */
#include "sh_dsp.h"

static float P(const sh_gear *g, const char *n, float def) { return kn_pos(g, n, def); }
static float RAW(const sh_gear *g, const char *n, float def) { return kn_raw(g, n, def); }

/* audio-taper pot: about 10% at half way, as a real "A" pot */
static double taper(double p) { return (sh_exp(p * 4.0) - 1) / (sh_exp(4.0) - 1); }
static double rc_hz(double r, double c) { return 1.0 / (SH_TAU * r * c); }

/* ------------------------------------------------------------- parts -- */
#define VT 0.02585f
typedef struct {
  float is, nvt;
} dio_t;
static const dio_t D_SI = {2.52e-9f, 1.752f * VT};  /* 1N914 / 1N4148 */
static const dio_t D_GE = {2.0e-7f, 1.3f * VT};     /* 1N34A germanium: about 0.3 V */
static const dio_t D_FET = {1.0e-10f, 3.0f * VT};   /* MOSFET used as a clipper: soft, about 1.2 V */

/* A diode clipper: a node fed from u through R, with C and diode strings to ground
   (np diodes in series for the positive side, nn for the negative).
   C dv/dt = (u - v)/R - Id(v), solved by backward Euler and Newton every sample.
   The same equation covers diodes in an op-amp's feedback loop (u = the gain path's
   voltage, R = the feedback resistor, C = its cap). */
typedef struct {
  float k, invR; /* k = T/C */
  dio_t p, n;
  float np, nn;
  int sym; /* same diodes both ways: one exp gives both */
  float v, vp;
} clip_t;
static void clip_set(clip_t *c, double osr, double R, double C, dio_t d, int np, int nn) {
  c->k = (float)(1.0 / (osr * C));
  c->invR = (float)(1.0 / R);
  c->p = c->n = d;
  c->np = (float)np, c->nn = (float)nn;
  c->sym = np == nn;
}
static inline float dexp(float x) { return sh_expf_fast(x > 30.f ? 30.f : x < -30.f ? -30.f : x); }
/* natural log, float accuracy (the engine's fast log is too rough for a transistor's law) */
static inline float lnf(float x) {
  union { float f; uint32_t u; } v = {x};
  int e = (int)((v.u >> 23) & 255) - 127;
  v.u = (v.u & 0x007fffff) | 0x3f800000;
  float m = v.f;
  if (m > 1.41421356f) m *= 0.5f, e++;
  float s = (m - 1.f) / (m + 1.f), s2 = s * s;
  return 2.f * s * (1.f + s2 * (0.33333333f + s2 * (0.2f + s2 * (0.14285714f + s2 * 0.11111111f)))) + e * 0.69314718f;
}
static inline float clip_run(clip_t *c, float u) {
  float v0 = c->v;
  float v = v0 + (v0 - c->vp); /* start from where it was heading */
  c->vp = v0;
  float ap = 1.f / (c->np * c->p.nvt), an = 1.f / (c->nn * c->n.nvt);
  int same = c->sym;
  for (int it = 0; it < 10; it++) {
    float ep = dexp(v * ap), en = same ? 1.f / ep : dexp(-v * an);
    float id = c->p.is * (ep - 1.f) - c->n.is * (en - 1.f);
    float gd = c->p.is * ep * ap + c->n.is * en * an;
    float F = v - v0 - c->k * ((u - v) * c->invR - id);
    float dv = F / (1.f + c->k * (c->invR + gd));
    if (dv > 0.2f) dv = 0.2f;
    if (dv < -0.2f) dv = -0.2f;
    v -= dv;
    if (sh_fabsf(dv) < 1e-6f) break;
  }
  return c->v = v;
}

/* An op-amp gain stage (non-inverting): y = x + (Zf/Zg) x.
   Zg: up to two series R-C legs to ground (each a high-pass current), Zf: Rf with Cf across it.
   The gain part is limited by the chip's gain-bandwidth, then by its slew rate and the rails. */
typedef struct {
  op_t hp[2];
  float w[2];   /* Rf / Rg of each leg */
  op_t cf, gbw; /* Rf·Cf roll-off, gain-bandwidth roll-off */
  float rail, slew, last;
} opamp_t;
static void opamp_set(opamp_t *o, double osr, double rf, double rg1, double cg1, double rg2, double cg2, double cf, double gbw, double rail,
                      double slew_v_per_us) {
  op_lp_set(&o->hp[0], osr, rc_hz(rg1, cg1));
  o->w[0] = (float)(rf / rg1);
  if (rg2 > 0) op_lp_set(&o->hp[1], osr, rc_hz(rg2, cg2)), o->w[1] = (float)(rf / rg2);
  double fc = rf > 0 && cf > 0 ? rc_hz(rf, cf) : osr * 0.45;
  op_lp_set(&o->cf, osr, fc > osr * 0.45 ? osr * 0.45 : fc);
  double g = 1 + o->w[0] + o->w[1];
  double fb = gbw / g;
  op_lp_set(&o->gbw, osr, fb > osr * 0.45 ? osr * 0.45 : fb);
  o->rail = (float)rail;
  o->slew = slew_v_per_us > 0 ? (float)(slew_v_per_us * 1e6 / osr) : 1e9f;
}
static inline float rails(float x, float r) { /* soft at the rails, linear well inside them */
  float t = x / r, t2 = t * t;
  return r * t / sh_sqrtf(sh_sqrtf(1.f + t2 * t2));
}
static inline float opamp_run(opamp_t *o, float x) {
  float i = op_hp(&o->hp[0], x) * o->w[0];
  if (o->w[1] > 0) i += op_hp(&o->hp[1], x) * o->w[1];
  float y = x + op_lp(&o->gbw, op_lp(&o->cf, i));
  y = rails(y, o->rail);
  float d = y - o->last;
  if (d > o->slew) y = o->last + o->slew;
  else if (d < -o->slew) y = o->last - o->slew;
  return o->last = y;
}

/* A common-emitter transistor stage. Input: the signal at the base (V). The collector
   current follows the transistor's exponential law with emitter resistance Re:
     q = n·Vt·ln(Ic/Ic0) + (Ic − Ic0)·Re
   It is cut off at Ic = 0 (a soft edge) and saturates at Icmax (a firmer edge), so the
   two halves of the wave clip differently, as a real transistor does. Output = −ΔIc·Rc (inverting). */
typedef struct {
  float ic0, re, nvt, rc, icmax, ic;
} bjt_t;
static void bjt_set(bjt_t *t, double ic0, double re, double n, double rc, double vcc) {
  t->ic0 = (float)ic0, t->re = (float)re, t->nvt = (float)(n * VT), t->rc = (float)rc;
  t->icmax = (float)((vcc - 0.15) / (rc + re));
  if (t->icmax < t->ic0 * 1.05f) t->icmax = t->ic0 * 1.05f;
  t->ic = t->ic0;
}
static inline float bjt_run(bjt_t *t, float q) {
  float w = t->ic;
  for (int it = 0; it < 8; it++) {
    float f = t->nvt * lnf(w / t->ic0) + (w - t->ic0) * t->re - q;
    float fp = t->nvt / w + t->re;
    float nw = w - f / fp;
    if (nw <= w * 0.05f) nw = w * 0.05f;          /* toward cutoff: never cross zero */
    if (nw > t->icmax * 4.f) nw = t->icmax * 4.f;
    if (sh_fabsf(nw - w) < 1e-9f + 1e-5f * w) { w = nw; break; }
    w = nw;
  }
  t->ic = w;
  /* saturation: the current can't go past what the collector resistor allows */
  float r = w / t->icmax, r2 = r * r;
  float ws = w / sh_sqrtf(sh_sqrtf(1.f + r2 * r2));
  return -(ws - t->ic0) * t->rc;
}

/* A second 2x step inside the 4x one (8x in all): hard clipping makes edges sharp enough that 4x
   leaves audible grit. Short half-band filters (11 taps, -94 dB where it matters). */
#define HB1 0.295187740f
#define HB3 (-0.052301092f)
#define HB5 0.007113352f
typedef struct {
  float x[6];  /* input history at 4x, newest first */
  float v[11]; /* processed history at 8x, newest first */
} os2_t;
static inline void os2_up(os2_t *o, float in, float out[2]) {
  for (int k = 5; k > 0; k--) o->x[k] = o->x[k - 1];
  o->x[0] = in;
  out[0] = 2.f * (HB5 * (o->x[0] + o->x[5]) + HB3 * (o->x[1] + o->x[4]) + HB1 * (o->x[2] + o->x[3]));
  out[1] = o->x[2];
}
static inline float os2_down(os2_t *o, const float in[2]) {
  for (int k = 10; k > 1; k--) o->v[k] = o->v[k - 2];
  o->v[1] = in[0], o->v[0] = in[1];
  return 0.5f * o->v[5] + HB5 * (o->v[0] + o->v[10]) + HB3 * (o->v[2] + o->v[8]) + HB1 * (o->v[4] + o->v[6]);
}

/* passive "big muff" style tone: a low-pass and a high-pass blended by one pot (mid scoop at half way) */
typedef struct {
  op_t lp, hp;
  float t;
} blend_t;
static void blend_set(blend_t *b, double sr, double lp_hz, double hp_hz, double t) {
  op_lp_set(&b->lp, sr, lp_hz), op_lp_set(&b->hp, sr, hp_hz);
  b->t = (float)t;
}
static inline float blend_run(blend_t *b, float x) { return op_lp(&b->lp, x) * (1 - b->t) + op_hp(&b->hp, x) * b->t; }

/* ============================================================ pedals == */
enum { DR_TS, DR_RAT, DR_DS1, DR_MUFF, DR_FF, DR_RANGE, DR_LINE, DR_GERM, DR_CUSTOM, DR_GUV, DR_ALLOY, DR_SHRED, DR_BASSDIST };

typedef struct {
  int type;
  os4_t os;
  os2_t os2;
  /* 1x before the oversampled part */
  op_t in_hp;
  bq_t pre[2];
  int npre;
  /* oversampled */
  opamp_t oa[2];
  clip_t cl[2];
  bjt_t q[3];
  op_t ihp[2], ilp[2]; /* inter-stage filters */
  float g[3];          /* plain gains between stages */
  float fb, bias;      /* fuzz face: the DC feedback that moves the bias */
  op_t fb_lp;
  float rail;
  /* 1x after */
  blend_t bl;
  op_t tlp, thp;       /* first-order tone filters */
  float tmix;
  tmb_t tmb;
  int use_tmb;
  bq_t post[4];
  int npost;
  /* clean blend (bass pedals) */
  op_t dry_lp;
  float dry, wet;
  float level;
  op_t dc;
  float tiny; /* a signal far below hearing that keeps the filters out of very slow tiny numbers */
} drv_t;

/* the oversampled heart of each pedal */
static inline float drv_core(drv_t *d, float x) {
  switch (d->type) {
    case DR_TS: { /* Tube Screamer: op-amp with diodes in its feedback loop, added to the clean signal */
      float i = op_hp(&d->oa[0].hp[0], x) * d->oa[0].w[0];
      float v = clip_run(&d->cl[0], i);
      return rails(x + v, 4.3f);
    }
    case DR_RAT: /* op-amp at huge gain (LM308: slow, slew-limited), then silicon diodes to ground */
    case DR_DS1: /* transistor booster, op-amp, silicon diodes to ground */
    case DR_GERM:
    case DR_CUSTOM:
    case DR_GUV:
    case DR_BASSDIST: {
      if (d->type == DR_DS1) x = bjt_run(&d->q[0], x);
      float y = opamp_run(&d->oa[0], x);
      return clip_run(&d->cl[0], y);
    }
    case DR_ALLOY:
    case DR_SHRED: { /* two op-amp stages, each clipped by silicon diodes */
      float y = clip_run(&d->cl[0], opamp_run(&d->oa[0], x));
      y = op_hp(&d->ihp[0], y);
      if (d->type == DR_SHRED) y = op_lp(&d->ilp[0], y);
      return clip_run(&d->cl[1], opamp_run(&d->oa[1], y));
    }
    case DR_MUFF: { /* transistor input stage, two clipping stages (diodes in feedback), coupling caps between */
      float y = bjt_run(&d->q[0], x);
      y = op_hp(&d->ihp[0], y);
      y = clip_run(&d->cl[0], -d->g[0] * y);
      y = rails(y, d->rail);
      y = op_hp(&d->ihp[1], y);
      y = clip_run(&d->cl[1], -d->g[1] * y);
      return rails(y, d->rail);
    }
    case DR_FF: { /* two germanium transistors, DC-coupled, with feedback that sets (and moves) the bias */
      float y1 = bjt_run(&d->q[0], x - d->bias);
      float y2 = bjt_run(&d->q[1], y1 * d->g[0]);
      /* the feedback network follows the second stage's average: hard playing shifts the bias,
         which gives the sputter and the swell as a note dies away */
      d->bias = op_lp(&d->fb_lp, y2) * d->fb;
      return y2;
    }
    case DR_RANGE:
    case DR_LINE: return bjt_run(&d->q[0], x);
  }
  return x;
}

static void drv_proc(sh_block *b, float *L, float *R, int n) {
  (void)R;
  drv_t *d = (drv_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = L[i] + d->tiny;
    d->tiny = -d->tiny;
    float dry = x;
    x = op_hp(&d->in_hp, x);
    for (int k = 0; k < d->npre; k++) x = bq_run(&d->pre[k], x);
    float u[4];
    os4_up(&d->os, x, u);
    for (int k = 0; k < 4; k++) {
      float w[2];
      os2_up(&d->os2, u[k], w);
      w[0] = drv_core(d, w[0]), w[1] = drv_core(d, w[1]);
      u[k] = os2_down(&d->os2, w);
    }
    float y = os4_down(&d->os, u);
    y = op_hp(&d->dc, y);
    if (d->type == DR_MUFF || d->type == DR_DS1 || d->type == DR_ALLOY) y = blend_run(&d->bl, y);
    if (d->tmix >= 0) { /* first-order tone: low-pass plus some of what it removes */
      float lp = op_lp(&d->tlp, y);
      y = lp + d->tmix * (y - lp);
    }
    if (d->use_tmb) y = tmb_run(&d->tmb, y);
    for (int k = 0; k < d->npost; k++) y = bq_run(&d->post[k], y);
    y *= d->level;
    if (d->dry > 0) y = y * d->wet + op_lp(&d->dry_lp, dry) * d->dry;
    L[i] = y;
  }
}

int drive_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  drv_t *d = (drv_t *)ar_alloc(a, sizeof(drv_t));
  if (!d) return 0;
  const char *k = g->key;
  double osr = sr * 8; /* the circuit runs at 8x */
  os4_init(&d->os);
  float gain = P(g, "gain", 0.7f), tone = P(g, "tone", 0.5f);
  d->tmix = -1;
  d->level = 1;
  d->tiny = 1e-15f;
  d->rail = 4.3f;
  op_lp_set(&d->in_hp, sr, 20);
  op_lp_set(&d->dc, sr, 8);

  if (sh_has(k, "SuperDrive") || sh_has(k, "Overdrive")) {
    /* Tube Screamer: Rg 4.7k + 47n (720 Hz), Rf 51k + 500k drive, Cf 51p, two silicon diodes in the loop.
       Tone: 1k/220n low-pass (723 Hz) with the treble control adding the top back. */
    d->type = DR_TS;
    double rf = 51e3 + 500e3 * taper(gain);
    op_lp_set(&d->oa[0].hp[0], osr, rc_hz(4.7e3, 47e-9));
    d->oa[0].w[0] = (float)(rf / 4.7e3);
    clip_set(&d->cl[0], osr, rf, 51e-12, D_SI, 1, 1);
    op_lp_set(&d->tlp, sr, 723);
    d->tmix = (float)(0.04 + 1.25 * tone * tone);
    d->level = 1.6f;
    if (sh_has(k, "Bass")) {
      /* bass version: the clean bass blended under, and a filter on the driven part */
      d->wet = P(g, "blend", 0.55f), d->dry = 1 - d->wet;
      op_lp_set(&d->dry_lp, sr, 20000);
      d->level = 2.2f;
      bq_set(&d->post[d->npost++], BQ_LP, sr, 600 * sh_pow(15, P(g, "filter", 0.75f)), 0.7, 0);
    }
  } else if (sh_has(k, "VintageDistortion")) {
    /* RAT: LM308 with Rf = 100k pot, Rg legs 47R+2.2u (1.5 kHz) and 560R+4.7u (60 Hz), Cf 100p;
       1k into 1N914s; the Filter: 1.5k + 100k pot into 3.3n (32 kHz down to 475 Hz). Tone here = brighter. */
    d->type = DR_RAT;
    double rf = 100e3 * taper(gain) + 100;
    opamp_set(&d->oa[0], osr, rf, 47, 2.2e-6, 560, 4.7e-6, 100e-12, 1.0e6, 4.0, 0.3);
    clip_set(&d->cl[0], osr, 1e3, 3.3e-9, D_SI, 1, 1);
    op_lp_set(&d->tlp, sr, rc_hz(1.5e3 + 100e3 * taper(1 - tone), 3.3e-9));
    d->tmix = 0;
    d->level = 0.787f;
  } else if (sh_has(k, "MetalDistortion")) {
    /* "Alloy": a metal distortion: tight low cut, two hard-clipped op-amp stages, a deep mid scoop */
    d->type = DR_ALLOY;
    bq_set(&d->pre[d->npre++], BQ_HP, sr, 160, 0.6, 0);
    opamp_set(&d->oa[0], osr, 4.7e3 + 470e3 * taper(gain), 2.2e3, 0.1e-6, 0, 0, 47e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 2.2e3, 4.7e-9, D_SI, 1, 1);
    op_lp_set(&d->ihp[0], osr, 120);
    opamp_set(&d->oa[1], osr, 47e3, 4.7e3, 1e-6, 0, 0, 100e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[1], osr, 2.2e3, 10e-9, D_SI, 1, 1);
    blend_set(&d->bl, sr, 300, 1500, 0.25 + 0.6 * tone);
    bq_set(&d->post[d->npost++], BQ_PEAK, sr, 3200, 1.0, 4);
    bq_set(&d->post[d->npost++], BQ_LP, sr, 9000, 0.7, 0);
    d->level = 1.48f;
  } else if (sh_has(k, "Pedal_Distortion") || (sh_has(k, "Distortion") && !sh_has(k, "Bass"))) {
    /* DS-1: transistor booster, op-amp (Rg 4.7k + 470n, Rf = 100k dist pot, Cf 100p),
       2.2k into 1N4148s with 10n, then the tone: 234 Hz low-pass blended with a 1.6 kHz high-pass */
    d->type = DR_DS1;
    bjt_set(&d->q[0], 0.45e-3, 220, 1.0, 10e3, 9);
    opamp_set(&d->oa[0], osr, 100e3 * taper(gain) + 1e3, 4.7e3, 0.47e-6, 0, 0, 100e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 2.2e3, 10e-9, D_SI, 1, 1);
    blend_set(&d->bl, sr, 234, 1600, tone);
    d->level = 1.94f;
  } else if (sh_has(k, "Buzz") || sh_has(k, "CaptFuzzle") || sh_has(k, "BassFuzz")) {
    /* Big Muff: input transistor stage, two clipping stages with a diode pair and 470p across 100k,
       coupling caps between, the passive tone (a low-pass and a high-pass blended), recovery. */
    d->type = DR_MUFF;
    if (sh_has(k, "CaptFuzzle")) gain = sh_clampf((RAW(g, "gain", 100) - 1) / 149.f, 0, 1);
    double lp = 408, hp = 1800, ihp = 110, c = 470e-12;
    dio_t dd = D_SI;
    if (sh_has(k, "BuzzToo")) lp = 320, hp = 2200, ihp = 60, c = 560e-12;           /* the darker, bassier "green" one */
    if (sh_has(k, "CaptFuzzle")) lp = 480, hp = 1500, ihp = 140, c = 390e-12;       /* harder and brighter */
    if (sh_has(k, "BassFuzz")) lp = 400, hp = 1800, ihp = 40, c = 470e-12;
    bjt_set(&d->q[0], 0.5e-3, 390, 1.0, 15e3, 9);
    op_lp_set(&d->ihp[0], osr, ihp);
    op_lp_set(&d->ihp[1], osr, ihp);
    d->g[0] = (float)(1.5 + 60 * taper(gain));
    d->g[1] = 30;
    clip_set(&d->cl[0], osr, 100e3, c, dd, 1, 1);
    clip_set(&d->cl[1], osr, 100e3, c, dd, 1, 1);
    blend_set(&d->bl, sr, lp, hp, tone);
    d->level = sh_has(k, "BuzzToo") ? 2.06f : sh_has(k, "CaptFuzzle") ? 1.45f : sh_has(k, "BassFuzz") ? 1.61f : 1.86f;
    if (sh_has(k, "BassFuzz")) {
      float f = P(g, "filter", 0.75f);
      bq_set(&d->post[d->npost++], BQ_LP, sr, 600 * sh_pow(15, f), 0.7, 0);
      d->wet = 0.8f, d->dry = 0.6f;
      op_lp_set(&d->dry_lp, sr, 180);
    }
  } else if (sh_has(k, "FuzzWasHe")) {
    /* Fuzz Face (germanium): Q1 runs nearly saturated (33k collector, little headroom on one side),
       Q2 with the fuzz pot bypassing its emitter resistor; DC feedback from Q2 back to Q1's base. */
    d->type = DR_FF;
    bjt_set(&d->q[0], 0.24e-3, 150, 1.25, 33e3, 9);
    double re2 = 1000 * (1 - gain) + 15;
    bjt_set(&d->q[1], 0.9e-3, re2, 1.25, 8.2e3, 9);
    d->g[0] = 0.06f;
    d->fb = (float)(0.004 + 0.02 * gain);
    op_lp_set(&d->fb_lp, osr, 9);
    op_lp_set(&d->tlp, sr, 700 * sh_pow(15, tone)); /* the tone: dark (700 Hz) to open (10 kHz) */
    d->tmix = 0;
    d->level = 0.527f;
  } else if (sh_has(k, "GermaniumDrive")) {
    /* germanium overdrive: op-amp gain into germanium diodes (one one way, two the other): soft and uneven */
    d->type = DR_GERM;
    opamp_set(&d->oa[0], osr, 1e3 + 220e3 * taper(gain), 4.7e3, 0.22e-6, 0, 0, 220e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 4.7e3, 10e-9, D_GE, 1, 2);
    op_lp_set(&d->tlp, sr, 800);
    d->tmix = (float)(0.03 + 1.4 * tone * tone);
    d->level = 2.09f;
  } else if (sh_has(k, "LineDrive")) {
    /* a clean transistor booster (preamp style): up to about +20 dB, warm when pushed */
    d->type = DR_LINE;
    double re = 3.3e3 / (1 + 30 * taper(gain));
    bjt_set(&d->q[0], 1.0e-3, re, 1.0, 4.7e3, 9);
    bq_set(&d->pre[d->npre++], BQ_PEAK, sr, 250, 0.7, 1.5);
    op_lp_set(&d->tlp, sr, 2500);
    d->tmix = (float)(0.3 + 1.0 * tone);
    d->level = 0.787f;
  } else if (sh_has(k, "CustomDrive")) {
    int tight = RAW(g, "voicing", 0) > 0.5f;
    /* voicing 1: MOSFET clipping after a tight low cut (hard but rounded); voicing 0: uneven silicon
       clipping with more lows and a mid push */
    d->type = DR_CUSTOM;
    opamp_set(&d->oa[0], osr, 2.2e3 + 330e3 * taper(gain), 3.3e3, tight ? 0.15e-6 : 0.47e-6, 0, 0, 100e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 2.2e3, 6.8e-9, tight ? D_FET : D_SI, 1, tight ? 1 : 2);
    if (!tight) bq_set(&d->pre[d->npre++], BQ_PEAK, sr, 900, 0.8, 3);
    op_lp_set(&d->tlp, sr, 600 * sh_pow(16, tone));
    d->tmix = 0;
    d->level = tight ? 0.55f : 1.1f;
  } else if (sh_has(k, "Guvnor")) {
    /* Guv'nor: op-amp into silicon diodes, then a Marshall amp's passive tone stack, plus "Deep" */
    d->type = DR_GUV;
    gain = P(g, "gain", 0.12f);
    opamp_set(&d->oa[0], osr, 1e3 + 100e3 * taper(gain) * 3, 2.2e3, 1e-6, 0, 0, 100e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 4.7e3, 4.7e-9, D_SI, 1, 1);
    sh_knob kk;
    double bas = 0.5, mid = 0.5, tre = 0.5;
    if (kn_exact(g, "bass", &kk)) bas = (kk.v - kk.lo) / (kk.hi - kk.lo);
    if (kn_exact(g, "mid", &kk)) mid = (kk.v - kk.lo) / (kk.hi - kk.lo);
    if (kn_exact(g, "treble", &kk)) tre = (kk.v - kk.lo) / (kk.hi - kk.lo);
    ts_design(&d->tmb, 1, sr, tre, mid, bas);
    d->use_tmb = 1;
    /* Deep: a resonant low boost after the clipping, as on the real pedal (0..+12 dB) */
    if (kn_exact(g, "deep", &kk)) bq_set(&d->post[d->npost++], BQ_PEAK, sr, 85, 1.1, (kk.v - kk.lo) / (kk.hi - kk.lo) * 12);
    d->level = 1.31f;
  } else if (sh_has(k, "ShredZone")) {
    /* Metal Zone: mid push, two high-gain stages each clipped hard, a 3-band active EQ */
    d->type = DR_SHRED;
    bq_set(&d->pre[d->npre++], BQ_HP, sr, 140, 0.6, 0);
    bq_set(&d->pre[d->npre++], BQ_PEAK, sr, 1000, 0.8, 6);
    opamp_set(&d->oa[0], osr, 4.7e3 + 680e3 * taper(gain), 2.2e3, 0.1e-6, 0, 0, 47e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 2.2e3, 4.7e-9, D_SI, 1, 1);
    op_lp_set(&d->ihp[0], osr, 150);
    op_lp_set(&d->ilp[0], osr, 6000);
    opamp_set(&d->oa[1], osr, 100e3, 4.7e3, 0.47e-6, 0, 0, 100e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[1], osr, 2.2e3, 10e-9, D_SI, 1, 1);
    bq_set(&d->post[d->npost++], BQ_LSHELF, sr, 120, 0.7, RAW(g, "bass", 0) * 1.6);
    bq_set(&d->post[d->npost++], BQ_PEAK, sr, 900, 0.9, RAW(g, "mid", 0) * 1.6);
    bq_set(&d->post[d->npost++], BQ_HSHELF, sr, 3500, 0.7, RAW(g, "treble", 0) * 1.6);
    bq_set(&d->post[d->npost++], BQ_LP, sr, 8000, 0.7, 0);
    d->level = 0.709f;
  } else if (sh_has(k, "BassDistortion")) {
    /* bass distortion: only the upper part is clipped; the lows pass clean underneath */
    d->type = DR_BASSDIST;
    bq_set(&d->pre[d->npre++], BQ_HP, sr, 180, 0.6, 0);
    opamp_set(&d->oa[0], osr, 2.2e3 + 330e3 * taper(gain), 3.3e3, 0.22e-6, 0, 0, 100e-12, 3e6, 4.3, 3);
    clip_set(&d->cl[0], osr, 2.2e3, 6.8e-9, D_SI, 1, 1);
    float f = P(g, "filter", 0.5f);
    op_lp_set(&d->tlp, sr, 600 * sh_pow(15, f));
    d->tmix = 0;
    bq_set(&d->post[d->npost++], BQ_HSHELF, sr, 1600, 0.6, (tone - 0.5) * 16);
    d->wet = 0.8f, d->dry = 0.75f;
    op_lp_set(&d->dry_lp, sr, 160);
    d->level = 0.889f;
  } else {
    return 0;
  }
  b->st = d;
  b->process = drv_proc;
  b->name = "drive";
  return 1;
}

/* Range Booster (treble booster): a small input cap feeds a germanium transistor, so mostly the
   top end gets boosted; pushed hard it breaks up unevenly. */
int boost_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  drv_t *d = (drv_t *)ar_alloc(a, sizeof(drv_t));
  if (!d) return 0;
  os4_init(&d->os);
  float v = P(g, "boost", 0.85f);
  d->type = DR_RANGE;
  d->tmix = -1;
  d->tiny = 1e-15f;
  op_lp_set(&d->in_hp, sr, 20);
  op_lp_set(&d->dc, sr, 8);
  /* 5n into the transistor's input: a first-order high-pass around 1.5 kHz, with a little of the lows left */
  bq_set(&d->pre[d->npre++], BQ_HSHELF, sr, 1500, 0.6, 14);
  bq_set(&d->pre[d->npre++], BQ_LP, sr, 9000, 0.7, 0);
  bjt_set(&d->q[0], 1.0e-3, 60, 1.3, 3.9e3, 9);
  d->level = (float)(0.038 * sh_db2lin(14 * v));
  b->st = d, b->process = drv_proc, b->name = "booster";
  return 1;
}
