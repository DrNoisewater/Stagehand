/*
 * Pitch pedals: octave down/up, pitch shifters, bass emulator.
 */
#include "sh_dsp.h"

static float P(const sh_gear *g, const char *n, float def) { return kn_pos(g, n, def); }
static float RAW(const sh_gear *g, const char *n, float def) { return kn_raw(g, n, def); }

/* ================================================================ pitch == */
typedef struct {
  dl_t d;
  bq_t body;     /* 4.5.x: Bass Emulator Body */
  int use_body;
  float panl, panr; /* 4.5.x: Studio Pitch Pan (stereo racks) */
  float ratio, ph, win, mix;
  op_t lp, hp;
  int rect;
  float rect_mix;
} pitch_t;
static void pitch_proc(sh_block *b, float *L, float *R, int n) {
  pitch_t *p = (pitch_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float w;
    if (p->rect) {
      w = op_hp(&p->hp, sh_fabsf(x) * 2.f);
      w = op_lp(&p->lp, w);
    } else {
      dl_push(&p->d, x);
      p->ph += (1.f - p->ratio) / p->win;
      while (p->ph >= 1) p->ph -= 1;
      while (p->ph < 0) p->ph += 1;
      float p2 = p->ph + 0.5f;
      if (p2 >= 1) p2 -= 1;
      float a1 = dl_tapf(&p->d, 4 + p->ph * p->win), a2 = dl_tapf(&p->d, 4 + p2 * p->win);
      float g1 = 1 - sh_fabsf(p->ph * 2 - 1), g2 = 1 - sh_fabsf(p2 * 2 - 1);
      w = op_lp(&p->lp, a1 * g1 + a2 * g2);
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
  float semis = -12;
  p->mix = P(g, "mix", 0.6f);
  if (sh_has(k, "OctaveUp")) {
    p->rect = 1, p->mix = P(g, "octave-up", 0.66f);
    op_lp_set(&p->hp, sr, 120);
  } else if (sh_has(k, "MultiPitch") || sh_has(k, "StudioPitch")) {
    semis = RAW(g, "pitch", -12);
  } else if (sh_has(k, "BassEmulator")) {
    semis = -12, p->mix = 0.9f;
  }
  p->ratio = (float)sh_pow(2, semis / 12.0);
  p->win = (float)(sr * 0.045);
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
  if (!dl_init(&p->d, a, (int)(sr * 0.1))) return 0;
  b->st = p, b->process = pitch_proc, b->name = "pitch";
  return 1;
}

