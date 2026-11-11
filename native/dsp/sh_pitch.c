/*
 * Pitch pedals: octave down/up, pitch shifters, bass emulator.
 */
#include "sh_dsp.h"

static float P(const sh_gear *g, const char *n, float def) { return kn_pos(g, n, def); }
static float RAW(const sh_gear *g, const char *n, float def) { return kn_raw(g, n, def); }

/* ================================================================ pitch == */
/* Pitch shifting the way the Drop does it: the input is read back faster or slower through a short delay
   line. When the read head drifts out of range it jumps to the point where the waveform lines up best
   (the splice lands in phase) and the two heads cross-fade, so held notes don't warble or flutter.
   Delay: about 4 to 45 ms; a shift up needs a little more room (the heads run toward the input). */
#define PS_MIN_MS 3.5
#define PS_SEARCH_MS 26.0 /* one period of a bass's low E */
#define PS_SPAN_MS 6.0
#define PS_XF_MS 8.0

typedef struct {
  float *buf;
  int len;       /* buffer length (samples) */
  int w;         /* samples written (wraps back now and then) */
  double rp[2];  /* read heads, in absolute samples: [0] playing, [1] fading out */
  int xf, xf_len;
  double r;      /* speed: 2^(semitones/12) */
  double dmin, dmax;  /* allowed delay range */
  int search, cmp;
  float wet;     /* level match for the shifted copy */
  bq_t body;     /* 4.5.x: Bass Emulator Body */
  int use_body;
  float panl, panr; /* 4.5.x: Studio Pitch Pan (stereo racks) */
  float mix;
  op_t lp, hp;
  int rect;
} pitch_t;

static inline float ps_read(const pitch_t *p, double pos) {
  int i = (int)pos;
  if (pos < i) --i;
  float f = (float)(pos - i);
  i %= p->len;
  if (i < 0) i += p->len;
  int j = i + 1 == p->len ? 0 : i + 1;
  return p->buf[i] + (p->buf[j] - p->buf[i]) * f;
}

/* move the playing head to the best-matching point in the other end of the range */
static void ps_splice(pitch_t *p, double now) {
  double cur = p->rp[0], r = p->r;
  /* compare the two heads over the stretch around the splice that has already been written */
  int jmax = p->cmp / 2;
  double room = (now - 1 - cur) / r;
  if (room < jmax) jmax = (int)room;
  int jmin = jmax - p->cmp;
  double best = -1e30, bestpos = 0;
  for (int d = 0; d <= p->search; d += 2) {
    /* down: the new head starts near the shortest delay; up: near the longest */
    double pos = r < 1 ? now - p->dmin - d : now - p->dmax + d;
    double c = 0, en = 1e-9;
    for (int j = jmin; j < jmax; j += 4) {
      float a = ps_read(p, cur + j * r), b = ps_read(p, pos + j * r);
      c += (double)a * b, en += (double)b * b;
    }
    double sc = c / sh_sqrt(en);
    if (sc > best) best = sc, bestpos = pos;
  }
  p->rp[1] = cur;
  p->rp[0] = bestpos;
  p->xf = p->xf_len;
}

static float ps_run(pitch_t *p, float x) {
  p->buf[p->w % p->len] = x;
  double now = (double)p->w;
  p->w++;
  double d = now - p->rp[0];
  if (p->xf <= 0 && (p->r < 1 ? d > p->dmax : d < p->dmin)) ps_splice(p, now);
  float y = ps_read(p, p->rp[0]);
  if (p->xf > 0) {
    float t = (float)p->xf / p->xf_len; /* 1 -> 0 */
    t = t * t * (3 - 2 * t); /* the copies line up, so the weights add to one */
    y = y * (1 - t) + ps_read(p, p->rp[1]) * t;
    p->rp[1] += p->r;
    p->xf--;
  }
  p->rp[0] += p->r;
  if (p->w >= 0x40000000) { /* keep positions small, on a whole number of buffer lengths */
    int sh = (0x20000000 / p->len) * p->len;
    p->w -= sh, p->rp[0] -= sh, p->rp[1] -= sh;
  }
  return y;
}

static void pitch_proc(sh_block *b, float *L, float *R, int n) {
  pitch_t *p = (pitch_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float w;
    if (p->rect) {
      w = op_hp(&p->hp, sh_fabsf(x) * 2.f);
      w = op_lp(&p->lp, w);
    } else {
      w = op_lp(&p->lp, ps_run(p, x) * p->wet);
    }
    if (p->use_body) w = bq_run(&p->body, w);
    L[i] = L[i] * (1 - p->mix * 0.6f) + w * p->mix * (R ? p->panl : 1.f);
    if (R) R[i] = R[i] * (1 - p->mix * 0.6f) + w * p->mix * p->panr;
  }
}

int pitch_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr) {
  pitch_t *p = (pitch_t *)ar_alloc(a, sizeof(pitch_t));
  if (!p) return 0;
  const char *k = g->key;
  double semis = -12;
  p->mix = P(g, "mix", 0.6f);
  if (sh_has(k, "OctaveUp")) {
    p->rect = 1, p->mix = P(g, "octave-up", 0.66f);
    op_lp_set(&p->hp, sr, 120);
  } else if (sh_has(k, "MultiPitch") || sh_has(k, "StudioPitch")) {
    semis = RAW(g, "pitch", -12);
  } else if (sh_has(k, "BassEmulator")) {
    semis = -12, p->mix = 0.9f;
  }
  double ms = sr / 1000.0;
  p->r = sh_pow(2, semis / 12.0);
  /* a shift up runs the heads toward the input: shorter fades, and room for the old head to finish its fade */
  p->xf_len = (int)(PS_XF_MS * ms / (p->r - 1 > 1 ? p->r - 1 : 1));
  if (p->xf_len < 16) p->xf_len = 16;
  p->dmin = p->r < 1 ? PS_MIN_MS * ms + p->xf_len * p->r : PS_MIN_MS * ms + p->xf_len * (p->r - 1) + PS_XF_MS * 0.5 * ms;
  p->search = (int)(PS_SEARCH_MS * ms);
  p->dmax = p->dmin + p->search + PS_SPAN_MS * ms;
  if (p->r > 1) p->dmax += p->xf_len * (p->r - 1); /* a new head never starts so close it must jump again */
  p->cmp = p->xf_len < 64 ? 64 : p->xf_len;
  p->rp[0] = -p->dmin - 64;
  p->wet = 0.85f;
  {
    sh_knob kx;
    p->panl = p->panr = 1;
    if (kn_exact(g, "pan", &kx)) { /* constant power, 50 = centre */
      float t = (kx.v - kx.lo) / (kx.hi - kx.lo);
      p->panl = (float)sh_sqrt(2 * (1 - t)), p->panr = (float)sh_sqrt(2 * t);
    }
    if (kn_exact(g, "body", &kx)) {
      p->use_body = 1;
      bq_set(&p->body, BQ_PEAK, sr, 110, 0.8, ((kx.v - kx.lo) / (kx.hi - kx.lo) - 0.3) * 14);
    }
  }
  float tone = P(g, "tone", 0.5f);
  op_lp_set(&p->lp, sr, (sh_has(k, "Sub") || sh_has(k, "BassEmulator") ? 400 : 1500) * sh_pow(6, tone));
  if (!p->rect) {
    p->len = (int)(p->dmax + p->cmp * p->r + p->xf_len + 64);
    p->buf = (float *)ar_alloc(a, sizeof(float) * p->len);
    if (!p->buf) return 0;
  }
  b->st = p, b->process = pitch_proc, b->name = "pitch";
  return 1;
}

