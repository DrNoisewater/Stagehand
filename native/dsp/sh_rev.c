/*
 * Reverbs: an 8-line feedback delay network with input diffusion, per-line
 * damping and gentle modulation. Spring adds a dispersive "drip" chain.
 */
#include "sh_dsp.h"

#define NL 8
typedef struct {
  dl_t line[NL];
  int len[NL];
  float g[NL];
  op_t damp[NL];
  dl_t ap[4];
  int aplen[4];
  float apg;
  dl_t pre;
  int prelen;
  float mix, ph, rate;
  /* spring dispersion */
  int spring;
  float sz[12];
  float sa;
  op_t tone, tone2;
  op_t inhp;
  double sr;
} rev_t;

static const int BASE[NL] = {1123, 1291, 1453, 1607, 1801, 1949, 2113, 2293};
static const int APB[4] = {142, 107, 379, 277};

static void rev_proc(sh_block *b, float *L, float *R, int n) {
  rev_t *r = (rev_t *)b->st;
  float mix = r->mix * b->fxscale;
  if (mix > 1.2f) mix = 1.2f;
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    x = op_hp(&r->inhp, x);
    dl_push(&r->pre, x);
    x = dl_tap(&r->pre, r->prelen);
    if (r->spring) {
      /* chain of first-order allpasses: chirpy dispersion */
      for (int k = 0; k < 12; k++) {
        float y = -r->sa * x + r->sz[k];
        r->sz[k] = x + r->sa * y;
        x = y;
      }
    }
    for (int k = 0; k < 4; k++) { /* input diffusion */
      float d = dl_tap(&r->ap[k], r->aplen[k]);
      float v = x + r->apg * d;
      dl_push(&r->ap[k], v);
      x = d - r->apg * v;
    }
    r->ph += r->rate;
    if (r->ph >= 1) r->ph -= 1;
    float o[NL], s = 0;
    for (int k = 0; k < NL; k++) {
      float m = k < 2 ? 1.5f * sh_sin01(r->ph + k * 0.37f) : 0;
      o[k] = op_lp(&r->damp[k], (k < 2 ? dl_tapf(&r->line[k], r->len[k] + m) : dl_tap(&r->line[k], r->len[k])) * r->g[k]);
      s += o[k];
    }
    s *= 2.f / NL; /* Householder */
    for (int k = 0; k < NL; k++) dl_push(&r->line[k], x + o[k] - s);
    float wl = o[0] - o[2] + o[4] - o[6] + o[1] * 0.5f;
    float wr = o[1] - o[3] + o[5] - o[7] + o[0] * 0.5f;
    wl = op_lp(&r->tone, wl);
    wr = op_lp(&r->tone2, wr);
    if (R) {
      L[i] += wl * mix * 0.5f;
      R[i] += wr * mix * 0.5f;
    } else {
      L[i] += (wl + wr) * mix * 0.35f;
    }
  }
}

int rev_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int stereo) {
  (void)stereo;
  rev_t *r = (rev_t *)ar_alloc(a, sizeof(rev_t));
  if (!r) return 0;
  r->sr = sr;
  const char *k = g->key;
  float size = 1.0f, rt = 1.8f, damp = 6000, pre_ms = 8;
  float time = kn_find(g, "time", 0) ? kn_pos(g, "time", 0.6f) : kn_pos(g, "decay", 0.66f);
  float tone = kn_pos(g, "tone", 0.55f);
  float diff = kn_pos(g, "diffusion", 0.8f);
  r->mix = kn_pos(g, "mix", 0.5f);
  if (sh_has(k, "Spring")) {
    r->spring = 1, r->sa = 0.62f, size = 0.55f, rt = 0.8f + 2.2f * time, damp = 4200, pre_ms = 2;
    if (sh_has(k, "TubeSpring")) rt = 1.8f, r->mix = kn_pos(g, "mix", 0.4f);
  } else if (sh_has(k, "Plate")) {
    size = 0.8f, rt = 0.8f + 3.5f * time, damp = 8000, pre_ms = 4;
    if (kn_raw(g, "voice", 0) > 0.5f) damp = 5000;
  } else if (sh_has(k, "Chamber")) {
    size = 0.9f, rt = 0.6f + 2.8f * time, damp = 5500, pre_ms = 10;
  } else if (sh_has(k, "StudioVerb")) { /* hall */
    size = 1.6f, rt = 1.0f + 5.0f * time, damp = 5000, pre_ms = 22;
  } else { /* digital verb */
    size = 1.2f, rt = 0.6f + 4.0f * time, damp = 7000, pre_ms = 12;
  }
  damp = (float)(damp * sh_pow(2.2, (tone - 0.5) * 2));
  float depth = kn_pos(g, "depth", 0.5f);
  size *= 0.7f + 0.6f * depth;
  r->apg = 0.45f + 0.3f * diff;
  for (int i = 0; i < NL; i++) {
    r->len[i] = (int)(BASE[i] * size * sr / 48000.0);
    if (!dl_init(&r->line[i], a, r->len[i] + 8)) return 0;
    /* gain for the chosen RT60 */
    r->g[i] = (float)sh_pow(10, -3.0 * r->len[i] / (rt * sr));
    op_lp_set(&r->damp[i], sr, damp);
  }
  for (int i = 0; i < 4; i++) {
    r->aplen[i] = (int)(APB[i] * sr / 48000.0 * (0.6 + 0.4 * size));
    if (!dl_init(&r->ap[i], a, r->aplen[i] + 2)) return 0;
  }
  r->prelen = (int)(pre_ms * 0.001 * sr) + 1;
  if (!dl_init(&r->pre, a, r->prelen + 2)) return 0;
  r->rate = (float)(0.7 / sr);
  op_lp_set(&r->tone, sr, damp * 1.5);
  r->tone2 = r->tone;
  op_lp_set(&r->inhp, sr, 120);
  b->st = r, b->process = rev_proc, b->flags = BLK_FX, b->name = "reverb";
  return 1;
}
