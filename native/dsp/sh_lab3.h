/*
 * 4.20: The Lab, part 3: pitch, synths and voices.
 *   Fenrir, Long, Parasite, Tezcatl, Veles, Who Are You, Wukong; and lab_build for all thirty.
 */

/* --------------------------------------------------------------- FENRIR -- */
/* A wolf on a chain. Bite: how hard the fuzz bites. Growl: an octave below, growling under it.
   Bind: how much of the wolf you hear against your own sound. Restrain (the wheel): a gate that
   keeps it quiet between notes (higher shuts sooner). Break (held): the wolf howls, the pitch
   rising by Howl semitones while you hold it. Chain is the pedal's own on and off. */
typedef struct {
  wk_c c;
  wk_ps oct, howl;
  env_t gate;
  svf_t tone;
  wk_keeper kp;
  float bite, growl, thr, gg, ga, gr, hs, hk, iv, a, ak;
} fen_t;

static float fen_run(wk_c *c, float x, float in0, float *dry) {
  fen_t *s = (fen_t *)c;
  float e = env_run(&s->gate, x);
  float want = e > s->thr ? 1.f : 0.f;
  s->gg += (want > s->gg ? s->ga : s->gr) * (want - s->gg);
  float v = x + s->growl * 1.4f * wk_ps_run(&s->oct, x, 0.5);
  v = lab_sat(v, 1.f + 40.f * s->bite);
  float lp, bp, hp;
  svf_run(&s->tone, v, &lp, &bp, &hp);
  v = wk_keep(&s->kp, x, lp) * s->gg;
  int br = lab_on(c, 0);
  s->hs += s->hk * ((br ? 1.f : 0.f) - s->hs);
  float h = wk_ps_run(&s->howl, v, sh_exp2f_fast(s->iv * s->hs / 12.f));
  s->a += s->ak * ((s->hs > 0.002f ? 1.f : 0.f) - s->a);
  if (s->a < 1e-5f) s->a = 0;
  return v + (h - v) * s->a;
}

static wk_c *fen_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  fen_t *s = (fen_t *)ar_alloc(a, sizeof(fen_t));
  if (!s) return 0;
  wk_base(&s->c, WK_FENRIR, g, sr, bass, live, 0.7f);
  wk_blend((float)sh_clamp(wk_raw(g, "bind", 70) / 100.0, 0, 1), &s->c.gd, &s->c.gw);
  s->bite = (float)sh_clamp(wk_raw(g, "bite", 55) / 100.0, 0, 1);
  s->growl = (float)sh_clamp(wk_raw(g, "growl", 40) / 100.0, 0, 1);
  s->iv = (float)sh_clamp(wk_raw(g, "howl", 7), 0, 12);
  s->thr = (float)sh_db2lin(-75 + 45 * sh_clamp(wk_raw(g, "restrain", 30) / 100.0, 0, 1));
  s->ga = wk_k(sr, 0.001), s->gr = wk_k(sr, 0.06), s->hk = wk_k(sr, 0.08), s->ak = wk_k(sr, 0.004);
  env_set(&s->gate, sr, 1, 80);
  wk_set(&s->tone, sr, 3500 * s->c.fs, 0.7);
  wk_keep_init(&s->kp, sr);
  if (!wk_ps_init(&s->oct, a, sr, 1) || !wk_ps_init(&s->howl, a, sr, sh_pow(2, s->iv / 12.0))) return 0;
  s->c.run = fen_run;
  return &s->c;
}

/* ----------------------------------------------------------------- LONG -- */
/* A dragon's breath. Breath (the ribbon): a resonant filter from dark to open. Wind: a vibrato.
   Rain: echoes (more and louder). Thunder: an octave below. Cloud: reverb. Pearl: a second voice
   with you: a close double (Unison), a fifth up, or an octave up. Ascend (held): the whole sound
   rises an octave while you hold it. */
typedef struct {
  wk_c c;
  wk_ps harm, sub, asc;
  dl_t vib, echo;
  svf_t f;
  wk_fdn rev;
  wk_keeper kp;
  float hratio, wind, rain, thunder, cloud, vph, vr, as, ask, a, ak;
} long_t;

static float long_run(wk_c *c, float x, float in0, float *dry) {
  long_t *s = (long_t *)c;
  float v = x + 0.5f * wk_ps_run(&s->harm, x, s->hratio);
  if (s->thunder > 0) v += s->thunder * 1.2f * wk_ps_run(&s->sub, x, 0.5);
  float lp, bp, hp;
  svf_run(&s->f, v, &lp, &bp, &hp);
  v = wk_keep(&s->kp, x, lp);
  s->vph += s->vr;
  if (s->vph >= 1) s->vph -= 1;
  dl_push(&s->vib, v);
  float msr = (float)c->sr * 0.001f;
  v = dl_tapf(&s->vib, msr * (2.f + 1.2f * s->wind * (1.f + sh_sin01(s->vph))));
  float e = dl_tapf(&s->echo, 0.3f * (float)c->sr);
  dl_push(&s->echo, v + (0.2f + 0.6f * s->rain) * e);
  v += s->rain * e;
  v += s->cloud * 1.4f * fdn_run(&s->rev, v);
  s->as += s->ask * ((lab_on(c, 0) ? 1.f : 0.f) - s->as);
  float up = wk_ps_run(&s->asc, v, sh_exp2f_fast(s->as));
  s->a += s->ak * ((s->as > 0.002f ? 1.f : 0.f) - s->a);
  if (s->a < 1e-5f) s->a = 0;
  *dry = 0;
  return v + (up - v) * s->a;
}

static wk_c *long_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  long_t *s = (long_t *)ar_alloc(a, sizeof(long_t));
  if (!s) return 0;
  wk_base(&s->c, WK_LONG, g, sr, bass, live, 1.f);
  s->c.own = 1;
  float br = (float)sh_clamp(wk_raw(g, "breath", 60) / 100.0, 0, 1);
  wk_set(&s->f, sr, 200 * sh_pow(40, br) * s->c.fs, 2.2);
  s->wind = (float)sh_clamp(wk_raw(g, "wind", 25) / 100.0, 0, 1);
  s->rain = (float)sh_clamp(wk_raw(g, "rain", 30) / 100.0, 0, 1);
  s->thunder = (float)sh_clamp(wk_raw(g, "thunder", 25) / 100.0, 0, 1);
  s->cloud = (float)sh_clamp(wk_raw(g, "cloud", 35) / 100.0, 0, 1);
  static const float HR[3] = {1.0058f, 1.4983f, 2.f};
  s->hratio = HR[wk_sw(g, "pearl", 0, 3)];
  s->vr = (float)(5.2 / sr);
  s->ask = wk_k(sr, 0.2), s->ak = wk_k(sr, 0.004);
  wk_keep_init(&s->kp, sr);
  if (!wk_ps_init(&s->harm, a, sr, s->hratio) || !wk_ps_init(&s->sub, a, sr, 1) || !wk_ps_init(&s->asc, a, sr, 2)) return 0;
  if (!dl_init(&s->vib, a, (int)(0.006 * sr) + 8) || !dl_init(&s->echo, a, (int)(0.31 * sr) + 8) || !fdn_init(&s->rev, a, sr, 1.6f, 20)) return 0;
  fdn_set(&s->rev, 1.4f, 2.6f, 5500, 15, 1);
  s->c.run = long_run;
  return &s->c;
}

/* ------------------------------------------------------------- PARASITE -- */
/* A synth creature that feeds on your held notes: the longer a note rings, the louder it grows
   (Hunger: how long to grow to full). It sings your note, a fifth above or an octave above. Tame:
   smooth; Feral: torn and snarling. Host: how loud your own sound is; Creature: how loud it can
   grow. Feed (held): it grows four times as fast. One note at a time: a chord starves it. */
typedef struct {
  wk_c c;
  wk_trk trk;
  svf_t f;
  float host, creat, gk, gr, ratio, lf, amp, ak, rk, ms, msa, p0, p1, feral;
} para_t;

static float para_run(wk_c *c, float x, float in0, float *dry) {
  para_t *s = (para_t *)c;
  wk_trk_run(&s->trk, in0);
  float lv = wk_level(&s->ms, s->msa, in0);
  if (s->trk.newnote) s->gr = 0, s->lf = sh_log2f_fast(s->trk.f0); /* a new note: a new creature */
  s->trk.newnote = 0;
  if (s->trk.valid) s->lf += 0.3f * (sh_log2f_fast(s->trk.f0) - s->lf);
  float k = s->gk * (lab_on(c, 0) ? 4.f : 1.f);
  if (s->trk.valid) s->gr += k * (1.f - s->gr);
  else s->gr *= 0.9995f;
  float on = s->trk.valid ? 1.f : 0.f;
  s->amp += (on > s->amp ? s->ak : s->rk) * (on - s->amp);
  *dry = x * s->host;
  if (s->amp < 1e-4f && !s->trk.valid) return 0;
  float f = sh_exp2f_fast(s->lf) * s->ratio, dt = f / (float)c->sr;
  if (dt > 0.45f) dt = 0.45f;
  float v = 0.6f * wk_saw(wk_adv(&s->p0, dt), dt) + 0.4f * wk_sq(wk_adv(&s->p1, dt * 0.5f), dt * 0.5f);
  if (s->feral) v = sh_tanhf(5.f * v) * 0.6f;
  if (--c->cnt <= 0) c->cnt = WK_CR, wk_set(&s->f, c->sr, (s->feral ? 900 + 3500 * s->gr : 2000) * c->fs, s->feral ? 4.0 : 0.7);
  float lp, bp, hp;
  svf_run(&s->f, v, &lp, &bp, &hp);
  return lp * s->gr * s->amp * lv * s->creat * 1.6f;
}

static wk_c *para_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  para_t *s = (para_t *)ar_alloc(a, sizeof(para_t));
  if (!s) return 0;
  wk_base(&s->c, WK_PARASITE, g, sr, bass, live, 1.f);
  s->c.add = 1, s->c.own = 1, s->c.gw = 1;
  s->host = (float)sh_clamp(wk_raw(g, "host", 80) / 100.0, 0, 1);
  s->creat = (float)sh_clamp(wk_raw(g, "creature", 70) / 100.0, 0, 1);
  s->gk = wk_k(sr, sh_clamp(wk_raw(g, "hunger", 2), 0.2, 8) / 3.0);
  static const float R[3] = {1, 1.4983f, 2};
  s->ratio = R[wk_sw(g, "voice", 0, 3)];
  s->feral = (float)wk_sw(g, "tame/feral", 0, 2);
  s->ak = wk_k(sr, 0.005), s->rk = wk_k(sr, 0.06), s->msa = wk_k(sr, 0.015);
  wk_trk_init(&s->trk, sr, bass);
  wk_set(&s->f, sr, 2000, 0.7);
  s->c.run = para_run;
  return &s->c;
}

/* -------------------------------------------------------------- TEZCATL -- */
/* A smoking mirror. On the mirror: across moves every part of the sound up or down by the same
   number of hertz (left down, right up, the middle none; a bell-like, out-of-this-world sound), up
   is how much of the mirror you hear. Smoke smears it into grains, Shadow darkens it, Ash burns it.
   The arrows set the mirror moving by itself: up and down sweep it endlessly higher or lower,
   right wobbles it, left breathes the mix in and out; press the lit one to stop. Vanish (held):
   only the mirror is heard. Reveal is the pedal's own on and off. */
typedef struct {
  wk_c c;
  wk_hil h;
  wk_rec rec;
  wk_gr gr;
  svf_t sh;
  uint32_t rng;
  float shift, wet, smoke, ash, mph, drift, vk, vg;
  int motion, glen, cnt2;
} tez_t;

static float tez_run(wk_c *c, float x, float in0, float *dry) {
  tez_t *s = (tez_t *)c;
  float hz = s->shift, wet = s->wet, dt = 1.f / (float)c->sr;
  s->mph += dt;
  switch (s->motion) {
    case 1: s->drift += 60.f * dt; break;
    case 3: s->drift -= 60.f * dt; break;
    case 2: hz += 150.f * sh_sin01(s->mph * 0.3f - (int)(s->mph * 0.3f)); break;
    case 4: wet += 0.3f * sh_sin01(s->mph * 0.25f - (int)(s->mph * 0.25f)); break;
    default: break;
  }
  if (s->drift > 600) s->drift -= 1200;
  if (s->drift < -600) s->drift += 1200;
  hz += s->drift;
  wet = wet < 0 ? 0 : wet > 1 ? 1 : wet;
  float m = hil_run(&s->h, x, hz, c->sr);
  if (s->smoke > 0) {
    rec_push(&s->rec, m);
    if (--s->cnt2 <= 0) {
      s->cnt2 = s->glen / 3;
      gr_start(&s->gr, (double)s->rec.w - s->glen * (1.2 + 2.0 * (0.5 + 0.5 * lab_rnd(&s->rng))), 1, s->glen, 0.75f);
    }
    m = m * (1 - s->smoke) + gr_run(&s->gr) * s->smoke * 1.3f;
  }
  float lp, bp, hp;
  svf_run(&s->sh, m, &lp, &bp, &hp);
  m = s->ash > 0 ? lab_sat(lp, 1.f + 10.f * s->ash) * (0.3f + 0.7f * (1 - s->ash)) + lp * 0.0f : lp;
  s->vg += s->vk * ((lab_on(c, 0) ? 0.f : 1.f) - s->vg);
  *dry = x * (1.f - wet) * s->vg;
  return m * (lab_on(c, 0) ? 1.f : wet);
}

static wk_c *tez_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  tez_t *s = (tez_t *)ar_alloc(a, sizeof(tez_t));
  if (!s) return 0;
  wk_base(&s->c, WK_TEZCATL, g, sr, bass, live, 1.f);
  s->c.add = 1, s->c.own = 1, s->c.gw = 1;
  float u = (float)(sh_clamp(wk_raw(g, "mirror x", 60), 0, 100) - 50) / 50.f;
  s->shift = (u < 0 ? -1.f : 1.f) * 600.f * u * u;
  s->wet = (float)sh_clamp(wk_raw(g, "mirror y", 50) / 100.0, 0, 1);
  s->smoke = 0.8f * (float)sh_clamp(wk_raw(g, "smoke", 20) / 100.0, 0, 1);
  s->ash = (float)sh_clamp(wk_raw(g, "ash", 25) / 100.0, 0, 1);
  float shadow = (float)sh_clamp(wk_raw(g, "shadow", 70) / 100.0, 0, 1);
  wk_set(&s->sh, sr, 400 * sh_pow(40, shadow), 0.7);
  s->motion = wk_sw(g, "motion", 0, 5);
  s->glen = (int)((0.02 + 0.13 * s->smoke) * sr);
  s->vk = wk_k(sr, 0.01), s->vg = 1;
  s->rng = 0x510e527fu;
  if (!rec_init(&s->rec, a, (int)(0.6 * sr))) return 0;
  s->gr.buf = s->rec.buf, s->gr.len = s->rec.len;
  s->c.run = tez_run;
  return &s->c;
}

/* ---------------------------------------------------------------- VELES -- */
/* Four voices like drawbars: Root an octave below, Earth your own note, Dream a fifth above, Night
   an octave above. Still: they stay put. Drift: each wanders a little out of tune, slowly. Turn:
   they take turns, low and high swapping places. Wander: how fast they move. Underworld (lit):
   what they are playing becomes a drone beneath you until you press it again. */
typedef struct {
  wk_c c;
  wk_ps p0, p2, p3;
  wk_rec rec;
  float *seg;
  float lvl[4], wr, ph, dn[4], dt[4], cent, g;
  int motion, C, L, hop, age[4], pos[4], prev;
  uint32_t rng;
} veles_t;

static float veles_run(wk_c *c, float x, float in0, float *dry) {
  veles_t *s = (veles_t *)c;
  s->ph += s->wr;
  if (s->ph >= 1) {
    s->ph -= 1;
    for (int k = 0; k < 4; k++) s->dt[k] = lab_rnd(&s->rng);
  }
  float d[4] = {0, 0, 0, 0}, gm[4] = {1, 1, 1, 1};
  if (s->motion == 1)
    for (int k = 0; k < 4; k++) s->dn[k] += 0.00002f * (s->dt[k] - s->dn[k]), d[k] = s->dn[k] * 15.f;
  if (s->motion == 2) {
    float t = sh_sin01(s->ph);
    gm[0] = gm[2] = 0.5f + 0.5f * t, gm[1] = gm[3] = 0.5f - 0.5f * t;
  }
  float v = s->lvl[1] * gm[1] * x;
  if (s->lvl[0] > 0) v += s->lvl[0] * gm[0] * wk_ps_run(&s->p0, x, 0.5f * sh_exp2f_fast(d[0] / 1200.f));
  if (s->lvl[2] > 0) v += s->lvl[2] * gm[2] * wk_ps_run(&s->p2, x, 1.4983f * sh_exp2f_fast(d[2] / 1200.f));
  if (s->lvl[3] > 0) v += s->lvl[3] * gm[3] * wk_ps_run(&s->p3, x, 2.f * sh_exp2f_fast(d[3] / 1200.f));
  v *= 0.8f;
  rec_push(&s->rec, v);
  /* the underworld drone */
  int on = lab_on(c, 0);
  if (on && !s->prev) {
    rec_copy(&s->rec, s->seg, s->C);
    for (int k = 0; k < 4; k++) s->age[k] = -k * s->hop, s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
  }
  s->prev = on;
  s->g += 0.00005f * ((on ? 1.f : 0.f) - s->g);
  if (s->g > 1e-4f) {
    float dr = 0;
    for (int k = 0; k < 4; k++) {
      int a = s->age[k]++;
      if (a < 0) continue;
      if (a >= s->L) a = s->age[k] = 0, s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
      dr += s->seg[s->pos[k] + a] * (0.5f - 0.5f * sh_sin01((float)a / s->L + 0.25f));
    }
    v += dr * 0.5f * s->g;
  }
  return v;
}

static wk_c *veles_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  veles_t *s = (veles_t *)ar_alloc(a, sizeof(veles_t));
  if (!s) return 0;
  wk_base(&s->c, WK_VELES, g, sr, bass, live, 0.7f);
  static const char *N[4] = {"root", "earth", "dream", "night"};
  static const float D[4] = {60, 80, 40, 30};
  for (int k = 0; k < 4; k++) s->lvl[k] = (float)sh_clamp(wk_raw(g, N[k], D[k]) / 100.0, 0, 1);
  s->wr = (float)(sh_clamp(wk_raw(g, "wander", 0.4f), 0.05, 4) / sr);
  s->motion = wk_sw(g, "motion", 1, 3);
  s->C = (int)(0.6 * sr), s->L = (int)(0.16 * sr), s->hop = s->L / 4;
  s->rng = 0x9b05688cu;
  s->prev = lab_on(&s->c, 0);
  s->seg = (float *)ar_alloc(a, sizeof(float) * s->C);
  if (!s->seg || !rec_init(&s->rec, a, (int)(0.7 * sr))) return 0;
  if (!wk_ps_init(&s->p0, a, sr, 1) || !wk_ps_init(&s->p2, a, sr, 1.52) || !wk_ps_init(&s->p3, a, sr, 2.02)) return 0;
  s->c.run = veles_run;
  return &s->c;
}

/* ---------------------------------------------------------- WHO ARE YOU -- */
/* A dizzy caterpillar. Wonder: how far the mouth wanders through the vowels (a, e, i, o, u); Smoke:
   how fast and woozy it all moves. Size: how far the pitch drifts on each note. Grow: notes sink
   as you hold them (getting bigger); Shrink: they float up. Who? is the pedal's own on and off. */
static const float WAY_V[5][3] = {{800, 1200, 2500}, {450, 1900, 2600}, {300, 2250, 3000}, {500, 900, 2400}, {330, 750, 2300}};
typedef struct {
  wk_c c;
  wk_ps ps;
  wk_onset on;
  svf_t f[3];
  wk_keeper kp;
  float size, wonder, rate, ph, wph, drift, dk, dir;
} way_t;

static float way_run(wk_c *c, float x, float in0, float *dry) {
  way_t *s = (way_t *)c;
  if (wk_onset_run(&s->on, x)) s->drift = 0;
  s->drift += s->dk * (1.f - s->drift);
  s->ph += s->rate / (float)c->sr;
  if (s->ph >= 1) s->ph -= 1;
  s->wph += s->rate * 1.7f / (float)c->sr;
  if (s->wph >= 1) s->wph -= 1;
  float semis = s->dir * s->size * 5.f * s->drift + s->size * 0.6f * sh_sin01(s->wph);
  float y = wk_ps_run(&s->ps, x, sh_exp2f_fast(semis / 12.f));
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    float p = s->wonder * 4.f * (0.5f + 0.5f * sh_sin01(s->ph));
    int i = (int)p;
    if (i > 3) i = 3;
    float f = wk_smooth(p - (float)i);
    static const float Q[3] = {6, 8, 10};
    for (int k = 0; k < 3; k++) wk_set(&s->f[k], c->sr, wk_lerpf(WAY_V[i][k], WAY_V[i + 1][k], f) * c->fs, Q[k]);
  }
  float src = 0.7f * y + 0.3f * sh_tanhf(4.f * y);
  float m = wk_bp(&s->f[0], src) + 1.2f * wk_bp(&s->f[1], src) + 0.6f * wk_bp(&s->f[2], src);
  return wk_keep(&s->kp, x, 0.4f * y + m);
}

static wk_c *way_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  way_t *s = (way_t *)ar_alloc(a, sizeof(way_t));
  if (!s) return 0;
  wk_base(&s->c, WK_WHOAREYOU, g, sr, bass, live, 0.8f);
  s->size = (float)sh_clamp(wk_raw(g, "size", 40) / 100.0, 0, 1);
  float smoke = (float)sh_clamp(wk_raw(g, "smoke", 40) / 100.0, 0, 1);
  s->rate = 0.1f + 2.9f * smoke * smoke;
  s->wonder = (float)sh_clamp(wk_raw(g, "wonder", 50) / 100.0, 0, 1);
  s->dir = wk_sw(g, "grow/shrink", 0, 2) ? 1.f : -1.f;
  s->dk = wk_k(sr, 0.6);
  wk_onset_init(&s->on, sr, bass, 0.003f);
  wk_keep_init(&s->kp, sr);
  if (!wk_ps_init(&s->ps, a, sr, sh_pow(2, (s->size * 5.6) / 12.0))) return 0;
  s->c.run = way_run;
  return &s->c;
}

/* --------------------------------------------------------------- WUKONG -- */
/* The Monkey King. The Ruyi staff raises your pitch (none to an octave). Defiance: an octave fuzz.
   Each lit Clone is a copy of you a moment later in another voice: low ones on Earth, bright fifths
   and octaves in Heaven, up and down by turns in Havoc. Cloud: an echo. Uproar (held): every clone
   joins in at once, thicker. Awaken is the pedal's own on and off. */
static const float WU_IV[3][5] = {{-12, -5, -12, -7, -24}, {7, 12, 19, 12, 24}, {12, -12, 7, -5, 19}};
typedef struct {
  wk_c c;
  wk_ps main, cl[5];
  dl_t dl, echo;
  env_t env;
  wk_keeper kp;
  float ruyi, def, cloud, ratio[5], g[5], cfb;
  int en[5];
} wu_t;

static float wu_run(wk_c *c, float x, float in0, float *dry) {
  wu_t *s = (wu_t *)c;
  float v = s->ruyi > 0.01f ? wk_ps_run(&s->main, x, sh_exp2f_fast(s->ruyi / 12.f)) : x;
  if (s->def > 0) {
    float oct = sh_fabsf(v) * 1.6f - 0.5f * env_run(&s->env, v);
    v = wk_keep(&s->kp, x, lab_sat(v + s->def * oct, 1.f + 18.f * s->def));
  }
  int up = lab_on(c, 0), n = 0;
  for (int i = 0; i < 5; i++) n += up || s->en[i];
  float norm = n ? 0.8f / sh_sqrtf((float)n) : 0.f, cl = 0;
  float fb = up ? 0.3f : 0.f;
  for (int i = 0; i < 5; i++) {
    float want = up || s->en[i] ? norm : 0.f;
    s->g[i] += 0.001f * (want - s->g[i]);
    if (s->g[i] < 1e-4f && want == 0) continue;
    float d = dl_tapf(&s->dl, (float)((0.06 * (i + 1)) * c->sr));
    cl += wk_ps_run(&s->cl[i], d, s->ratio[i]) * s->g[i];
  }
  dl_push(&s->dl, v + fb * cl);
  float e = dl_tapf(&s->echo, 0.35f * (float)c->sr);
  dl_push(&s->echo, v + cl + 0.45f * e);
  *dry = 0;
  return v + cl + s->cloud * e;
}

static wk_c *wu_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  wu_t *s = (wu_t *)ar_alloc(a, sizeof(wu_t));
  if (!s) return 0;
  wk_base(&s->c, WK_WUKONG, g, sr, bass, live, 1.f);
  s->c.own = 1;
  s->ruyi = (float)sh_clamp(wk_raw(g, "ruyi", 0), 0, 12);
  s->def = (float)sh_clamp(wk_raw(g, "defiance", 40) / 100.0, 0, 1);
  s->cloud = (float)sh_clamp(wk_raw(g, "cloud", 30) / 100.0, 0, 1);
  int mode = wk_sw(g, "mode", 1, 3);
  static const char *N[5] = {"clone 1", "clone 2", "clone 3", "clone 4", "clone 5"};
  int n = 0;
  for (int i = 0; i < 5; i++) s->en[i] = wk_sw(g, N[i], i < 2, 2), n += s->en[i];
  for (int i = 0; i < 5; i++) {
    s->ratio[i] = sh_exp2f_fast(WU_IV[mode][i] / 12.f);
    s->g[i] = s->en[i] ? 0.8f / sh_sqrtf((float)(n ? n : 1)) : 0.f;
    if (!wk_ps_init(&s->cl[i], a, sr, s->ratio[i] > 1 ? s->ratio[i] : 1)) return 0;
  }
  env_set(&s->env, sr, 5, 60);
  wk_keep_init(&s->kp, sr);
  if (!wk_ps_init(&s->main, a, sr, 2) || !dl_init(&s->dl, a, (int)(0.31 * sr) + 8) || !dl_init(&s->echo, a, (int)(0.36 * sr) + 8)) return 0;
  s->c.run = wu_run;
  return &s->c;
}

/* ------------------------------------------------------------ lab_build -- */
static wk_c *lab_build(int kind, const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  switch (kind) {
    case WK_ANNWN: return annwn_build(g, a, sr, bass, live);
    case WK_APOPTOSIS: return apop_build(g, a, sr, bass, live);
    case WK_BIFROST: return bif_build(g, a, sr, bass, live);
    case WK_BLUEPRINCE: return bp_build(g, a, sr, bass, live);
    case WK_CLAUDE: return claude_build(g, a, sr, bass, live);
    case WK_DEJAVU: return dv_build(g, a, sr, bass, live);
    case WK_DUAT: return duat_build(g, a, sr, bass, live);
    case WK_EVENTHORIZON: return eh_build(g, a, sr, bass, live);
    case WK_FENRIR: return fen_build(g, a, sr, bass, live);
    case WK_INANNA: return inanna_build(g, a, sr, bass, live);
    case WK_JANUS: return janus_build(g, a, sr, bass, live);
    case WK_KITSUNE: return kit_build(g, a, sr, bass, live);
    case WK_KUKULKAN: return kuku_build(g, a, sr, bass, live);
    case WK_LONG: return long_build(g, a, sr, bass, live);
    case WK_MAUI: return maui_build(g, a, sr, bass, live);
    case WK_MIMIC: return mimic_build(g, a, sr, bass, live);
    case WK_MOLT: return molt_build(g, a, sr, bass, live);
    case WK_NATARAJA: return nat_build(g, a, sr, bass, live);
    case WK_OLYMPUS: return olym_build(g, a, sr, bass, live);
    case WK_OUROBOROS: return ouro_build(g, a, sr, bass, live);
    case WK_PARASITE: return para_build(g, a, sr, bass, live);
    case WK_RELIQUARY: return reliq_build(g, a, sr, bass, live);
    case WK_SEANCE: return seance_build(g, a, sr, bass, live);
    case WK_SEVERED: return sev_build(g, a, sr, bass, live);
    case WK_SHANGO: return shango_build(g, a, sr, bass, live);
    case WK_TEZCATL: return tez_build(g, a, sr, bass, live);
    case WK_VELES: return veles_build(g, a, sr, bass, live);
    case WK_WHOAREYOU: return way_build(g, a, sr, bass, live);
    case WK_WUKONG: return wu_build(g, a, sr, bass, live);
    default: return 0;
  }
}
