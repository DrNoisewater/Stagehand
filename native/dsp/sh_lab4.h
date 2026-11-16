/*
 * 4.21: The Lab, part 4: the ten that filled the gaps.
 *   Anansi (arpeggiator), Glitchcraft (lo-fi crusher), Hermes (radio), Icarus (jet flanger and
 *   phaser), Mothball (worn tape and records), Phoenix (reverse swell reverb), Raijin (drums from
 *   your playing), Saturn (ring modulator), Selene (pumping to the beat), and Reliquary, the relic
 *   of endless sustain (kept as Pedal_Sustaint: Pedal_Reliquary is the cathedral, now Cathedral).
 */

/* --------------------------------------------------------------- ANANSI -- */
/* The spider's web: Weave (lit) turns what you play into an arpeggio, the steps climbing and
   falling through your note, its fifth and its octaves (Octaves: one, two or three of them), in
   time with the song (Rate: quarter, eighth, eighth-triplet or sixteenth notes). Pattern: up, down,
   up and down, or at random. The eight lit stones on the web are the eight steps of each turn: an
   unlit one rests. Gate: how long each step sounds. Hold (lit): the web keeps spinning on the last
   thing you played after you stop. */
static const float AN_NOTES[3][7] = {{0, 7, 12}, {0, 7, 12, 19, 24}, {-12, -5, 0, 7, 12, 19, 24}};
static const int AN_N[3] = {3, 5, 7};
typedef struct {
  wk_c c;
  wk_ps ps;
  wk_rec rec;
  float *seg;
  int en[8], oct, pat, div, step, idx, dir, C, L, age[3], pos[3], held;
  float ph, gate, env, att, rel, semi, ms, msa, hk, hg;
  uint32_t rng;
} anansi_t;

static int an_next(anansi_t *s) {
  int n = AN_N[s->oct];
  switch (s->pat) {
    case 0: s->idx = (s->idx + 1) % n; break;
    case 1: s->idx = (s->idx + n - 1) % n; break;
    case 2:
      if (s->idx + s->dir < 0 || s->idx + s->dir >= n) s->dir = -s->dir;
      s->idx += s->dir;
      break;
    default: {
      int j = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * n);
      s->idx = j >= n ? n - 1 : j;
    }
  }
  return s->idx;
}

static float anansi_run(wk_c *c, float x, float in0, float *dry) {
  anansi_t *s = (anansi_t *)c;
  int weave = lab_on(c, 0), hold = lab_on(c, 1);
  float lv = wk_level(&s->ms, s->msa, x);
  rec_push(&s->rec, x);
  /* Hold: catch the last moment you played and keep it going as the web's thread */
  if (hold && !s->held) {
    rec_copy(&s->rec, s->seg, s->C);
    for (int k = 0; k < 3; k++) s->age[k] = -k * (s->L / 3), s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
  }
  s->held = hold;
  s->hg += s->hk * ((hold && lv < 0.01f ? 1.f : 0.f) - s->hg);
  float src = x;
  if (s->hg > 1e-4f) {
    float t = 0;
    for (int k = 0; k < 3; k++) {
      int a = s->age[k]++;
      if (a < 0) continue;
      if (a >= s->L) a = s->age[k] = 0, s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
      t += s->seg[s->pos[k] + a] * (0.5f - 0.5f * sh_sin01((float)a / s->L + 0.25f));
    }
    src = x * (1 - s->hg) + t * 0.67f * s->hg;
  }
  if (!weave) {
    s->step = 0, s->ph = 0, s->idx = s->pat == 1 ? AN_N[s->oct] - 1 : 0, s->env = 0, s->dir = 1;
    s->semi = AN_NOTES[s->oct][s->idx];
    return src;
  }
  float steps = lab_tempo(c) / 60.f * (float)s->div;
  s->ph += steps / (float)c->sr;
  if (s->ph >= 1) {
    s->ph -= 1;
    s->step = (s->step + 1) & 7;
    s->semi = AN_NOTES[s->oct][an_next(s)];
  }
  float want = s->en[s->step] && s->ph < s->gate ? 1.f : 0.f;
  s->env += (want > s->env ? s->att : s->rel) * (want - s->env);
  float y = wk_ps_run(&s->ps, src, sh_exp2f_fast(s->semi / 12.f));
  *dry = src;
  return y * s->env;
}

static wk_c *anansi_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  anansi_t *s = (anansi_t *)ar_alloc(a, sizeof(anansi_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_ANANSI, g, sr, bass, live, 1.f);
  s->c.own = 1;
  static const char *N[8] = {"step 1", "step 2", "step 3", "step 4", "step 5", "step 6", "step 7", "step 8"};
  for (int i = 0; i < 8; i++) s->en[i] = wk_sw(g, N[i], 1, 2);
  s->oct = wk_sw(g, "octaves", 1, 3);
  s->pat = wk_sw(g, "pattern", 0, 4);
  int r = wk_sw(g, "rate", 1, 4); /* 1/4, 1/8, 1/8 triplet, 1/16 */
  s->div = r + 1; /* steps a beat */
  s->gate = 0.15f + 0.8f * (float)sh_clamp(wk_raw(g, "gate", 60) / 100.0, 0, 1);
  s->att = wk_k(sr, 0.002), s->rel = wk_k(sr, 0.012), s->msa = wk_k(sr, 0.02), s->hk = wk_k(sr, 0.05);
  s->dir = 1, s->semi = 0, s->idx = s->pat == 1 ? AN_N[s->oct] - 1 : 0;
  s->semi = AN_NOTES[s->oct][s->idx];
  s->rng = 0x6a09e667u;
  s->C = (int)(0.5 * sr), s->L = (int)(0.12 * sr);
  s->held = lab_on(&s->c, 1);
  s->seg = (float *)ar_alloc(a, sizeof(float) * s->C);
  if (!s->seg || !rec_init(&s->rec, a, (int)(0.6 * sr)) || !wk_ps_init(&s->ps, a, sr, 4)) return 0;
  s->c.run = anansi_run;
  return &s->c;
}

/* ---------------------------------------------------------- GLITCHCRAFT -- */
/* A witch's brew of old video games. Bits: how many steps the sound is cut into (16, smooth, down
   to 1, a buzz). Rate: how few samples a second it keeps (the whole range down to a few hundred: the
   aliasing whine of old consoles). Grit: drives it in hot first. Crumble: the steps softened a
   little. Shatter: raw, and every so often a scrap is repeated, as if the game froze. */
typedef struct {
  wk_c c;
  op_t aa, smooth;
  float levels, hold, held, cnt, drive;
  int shatter, rep, repn, rp, cnt2;
  float *buf;
  int blen, bw;
  uint32_t rng;
} glitch_t;

static float glitch_run(wk_c *c, float x, float in0, float *dry) {
  glitch_t *s = (glitch_t *)c;
  float v = s->drive > 1.01f ? lab_sat(x * 0.9f, s->drive) * 0.5f : x;
  if (!s->shatter) v = op_lp(&s->aa, v);
  s->cnt += 1;
  if (s->cnt >= s->hold) {
    s->cnt -= s->hold;
    s->held = sh_floorf(v * s->levels + 0.5f) / s->levels;
  }
  float y = s->held;
  if (s->shatter) { /* now and then the last scrap repeats */
    s->buf[s->bw] = y;
    s->bw = s->bw + 1 == s->blen ? 0 : s->bw + 1;
    if (s->rep > 0) {
      y = s->buf[(s->rp + s->repn - s->rep) % s->blen];
      if (--s->rep == 0) s->cnt2 = (int)(c->sr * (0.15 + 0.4 * (0.5 + 0.5 * lab_rnd(&s->rng))));
    } else if (--s->cnt2 <= 0) {
      s->repn = (int)(c->sr * (0.02 + 0.05 * (0.5 + 0.5 * lab_rnd(&s->rng))));
      s->rep = s->repn * 2;
      s->rp = (s->bw - s->repn + s->blen) % s->blen;
    }
  } else {
    y = op_lp(&s->smooth, y);
  }
  return y;
}

static wk_c *glitch_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  glitch_t *s = (glitch_t *)ar_alloc(a, sizeof(glitch_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_GLITCHCRAFT, g, sr, bass, live, 1.f);
  float bits = (float)sh_clamp(wk_raw(g, "bits", 6), 1, 16);
  s->levels = sh_exp2f_fast(bits - 1);
  float rate = (float)sh_clamp(wk_raw(g, "rate", 40) / 100.0, 0, 1);
  float keep = 48000.f * sh_exp2f_fast(-6.5f * rate); /* 48 kHz down to about 500 a second */
  s->hold = (float)(sr / keep);
  if (s->hold < 1) s->hold = 1;
  s->drive = 1.f + 9.f * (float)sh_clamp(wk_raw(g, "grit", 30) / 100.0, 0, 1);
  s->shatter = wk_sw(g, "crumble/shatter", 0, 2);
  op_lp_set(&s->aa, sr, sh_clamp(keep * 0.45, 200, sr * 0.45));
  op_lp_set(&s->smooth, sr, sh_clamp(keep * 0.6, 400, sr * 0.45));
  s->blen = (int)(0.1 * sr);
  s->buf = (float *)ar_alloc(a, sizeof(float) * s->blen);
  if (!s->buf) return 0;
  s->rng = 0xbb67ae85u, s->cnt2 = (int)(0.3 * sr);
  s->c.run = glitch_run;
  return &s->c;
}

/* --------------------------------------------------------------- HERMES -- */
/* Your playing through an old radio. The Dial tunes it: on one of the five stations (the dial's
   marks) it comes in clear; between them it drifts out of tune (moved up or down by up to a few
   hundred hertz), whistles and hisses. AM: a small, narrow, warm speaker; FM: wide and clean;
   Shortwave: thin, fading in and out, warbling. Static: how much hiss and crackle there is (it
   comes and goes with your playing, so silence stays silent). Drift: how much the tuning wanders
   on its own. Scan (held): the needle sweeps across the stations by itself. */
typedef struct {
  wk_c c;
  wk_hil h;
  svf_t lo, hi, crk;
  env_t env;
  float dial, cur, k, stat, drift, dph, wh, fade, fph, scan;
  int band;
  uint32_t rng;
} hermes_t;

static float hermes_run(wk_c *c, float x, float in0, float *dry) {
  hermes_t *s = (hermes_t *)c;
  float dt = 1.f / (float)c->sr;
  if (lab_on(c, 0)) s->scan += 0.12f * dt; /* about eight seconds across the dial */
  float want = s->dial + s->scan;
  want -= (float)(int)want;
  /* the needle wanders a little on its own */
  s->dph += 0.07f * dt;
  if (s->dph >= 1) s->dph -= 1;
  want += s->drift * 0.04f * sh_sin01(s->dph);
  s->cur += s->k * (want - s->cur);
  float d = s->cur * 5.f - 0.5f;          /* stations at 0.1, 0.3, 0.5, 0.7, 0.9 */
  float off = d - sh_floorf(d + 0.5f);    /* -0.5..0.5 from the nearest */
  float clear = 1.f - wk_smooth(sh_fabsf(off) * 2.f > 1 ? 1 : sh_fabsf(off) * 2.f);
  clear = clear * clear;
  float lp, bp, hp;
  float v = off * 2.f * 450.f;            /* out of tune by up to 450 Hz */
  float y = sh_fabsf(v) > 1 ? hil_run(&s->h, x, v, c->sr) : x;
  svf_run(&s->hi, y, &lp, &bp, &hp), y = hp;
  svf_run(&s->lo, y, &lp, &bp, &hp), y = lp;
  if (s->band == 0) y = sh_tanhf(1.8f * y) / 1.5f; /* AM: a small speaker pushed */
  if (s->band == 2) { /* shortwave: fading and warbling */
    s->fph += 0.31f * dt;
    if (s->fph >= 1) s->fph -= 1;
    y *= 0.6f + 0.4f * sh_sin01(s->fph);
  }
  y *= 0.35f + 0.65f * clear;
  float e = env_run(&s->env, x);
  float noise = lab_rnd(&s->rng);
  svf_run(&s->crk, noise, &lp, &bp, &hp);
  float hiss = (s->stat * (0.15f + 0.85f * (1.f - clear))) * e * (bp * 1.6f + (lab_rnd(&s->rng) > 0.996f ? noise * 4.f : 0));
  s->wh += (300.f + 2600.f * sh_fabsf(off)) * dt;
  if (s->wh >= 1) s->wh -= 1;
  float whistle = 0.25f * (1.f - clear) * e * sh_sin01(s->wh);
  return y + hiss + whistle;
}

static wk_c *hermes_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  hermes_t *s = (hermes_t *)ar_alloc(a, sizeof(hermes_t));
  if (!s) return 0;
  wk_base(&s->c, WK_HERMES, g, sr, bass, live, 1.f);
  s->dial = s->cur = (float)sh_clamp(wk_raw(g, "dial", 50) / 100.0, 0, 1);
  s->stat = (float)sh_clamp(wk_raw(g, "static", 30) / 100.0, 0, 1);
  s->drift = (float)sh_clamp(wk_raw(g, "drift", 20) / 100.0, 0, 1);
  s->band = wk_sw(g, "band", 0, 3);
  static const float LO[3] = {3200, 11000, 2600}, HI[3] = {320, 70, 450};
  wk_set(&s->lo, sr, LO[s->band], s->band == 1 ? 0.7 : 1.1);
  wk_set(&s->hi, sr, HI[s->band] * s->c.fs, 0.8);
  wk_set(&s->crk, sr, 2500, 0.5);
  env_set(&s->env, sr, 5, 250);
  s->k = wk_k(sr, 0.15);
  s->rng = 0x3c6ef372u;
  s->c.run = hermes_run;
  return &s->c;
}

/* --------------------------------------------------------------- ICARUS -- */
/* Flying too near the sun. Phase: a six-stage phaser, a soft swirl; Flange: a jet-plane flanger.
   Manual: where the sweep sits, Depth: how far it swings either side, Rate: how fast. Feedback:
   how hard it rings (a whistling edge at the top). Dive (held): the wings melt: the sweep falls all
   the way down over a second and rings hard, the classic jet dive; let go and it climbs back. */
typedef struct {
  wk_c c;
  dl_t dl;
  float ap[6], fb, ph, rate, depth, man, dive, dk, last, a;
  int flange;
} icarus_t;

static float icarus_run(wk_c *c, float x, float in0, float *dry) {
  icarus_t *s = (icarus_t *)c;
  s->dive += s->dk * ((lab_on(c, 0) ? 1.f : 0.f) - s->dive);
  s->ph += s->rate;
  if (s->ph >= 1) s->ph -= 1;
  float lfo = 0.5f + 0.5f * sh_sin01(s->ph);
  float pos = s->man + s->depth * (lfo - 0.5f);
  pos = pos * (1.f - s->dive);   /* the dive pulls it down to the bottom */
  pos = pos < 0 ? 0 : pos > 1 ? 1 : pos;
  float fb = s->fb + (0.92f - s->fb) * s->dive;
  float y;
  if (s->flange) {
    float d = (float)c->sr * 0.001f * (0.12f + 7.5f * pos * pos);
    float w = dl_tapf(&s->dl, d);
    dl_push(&s->dl, sh_tanhf(x + fb * w));
    y = (x + w) * (1.f - fb) / (2.f - fb); /* lows come out as loud as they went in */
  } else {
    if (--c->cnt <= 0) {
      c->cnt = WK_CR;
      float f = 120.f * sh_exp2f_fast(6.5f * pos); /* 120 Hz .. 11 kHz */
      float t = (float)sh_tan(SH_PI * f / c->sr);
      s->a = (t - 1) / (t + 1);
    }
    float a = s->a;
    float v = x + fb * 0.8f * s->last;
    for (int i = 0; i < 6; i++) {
      float o = a * v + s->ap[i];
      s->ap[i] = v - a * o;
      v = o;
    }
    s->last = sh_tanhf(v);
    y = 0.6f * (x + v);
  }
  return y;
}

static wk_c *icarus_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  icarus_t *s = (icarus_t *)ar_alloc(a, sizeof(icarus_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_ICARUS, g, sr, bass, live, 1.f);
  s->rate = (float)(sh_clamp(wk_raw(g, "rate", 0.5f), 0.05, 8) / sr);
  s->depth = (float)sh_clamp(wk_raw(g, "depth", 60) / 100.0, 0, 1);
  s->fb = 0.9f * (float)sh_clamp(wk_raw(g, "feedback", 40) / 100.0, 0, 1);
  s->man = (float)sh_clamp(wk_raw(g, "manual", 50) / 100.0, 0, 1);
  s->flange = wk_sw(g, "phase/flange", 1, 2);
  s->dk = wk_k(sr, 0.4);
  if (!dl_init(&s->dl, a, (int)(0.012 * sr) + 8)) return 0;
  s->c.run = icarus_run;
  return &s->c;
}

/* ------------------------------------------------------------- MOTHBALL -- */
/* A tape that's been in the attic. Wow: a slow, seasick wobble in pitch; Flutter: a fast one. Age:
   the highs and lows worn away, a little squash and hiss. Crackle: the pops of an old record.
   Dropout: now and then the sound sags away for a moment, like worn tape. All the noises come and
   go with your playing. Stop (held): the tape winds down to a halt, falling in pitch; let go and it
   spins back up to where you are. */
typedef struct {
  wk_c c;
  wk_rec rec;
  svf_t lo, hi, cr;
  env_t env;
  float wow, flt, age, crk, drop, w1, w2, w3, sp, lag, ret, dg, dt, base;
  int dcnt;
  uint32_t rng;
} moth_t;

static float moth_run(wk_c *c, float x, float in0, float *dry) {
  moth_t *s = (moth_t *)c;
  rec_push(&s->rec, x);
  float t = 1.f / (float)c->sr;
  s->w1 += 0.55f * t, s->w2 += 7.3f * t, s->w3 += 11.1f * t;
  if (s->w1 >= 1) s->w1 -= 1;
  if (s->w2 >= 1) s->w2 -= 1;
  if (s->w3 >= 1) s->w3 -= 1;
  /* the tape stopping: speed falls to nothing in about two thirds of a second */
  float want = lab_on(c, 0) ? 0.f : 1.f;
  float k = want < s->sp ? 0.00004f * 48000.f / (float)c->sr : 1.f;
  s->sp += (want - s->sp) * (want < s->sp ? k * 2.f : 1.f);
  if (s->sp < 0) s->sp = 0;
  s->lag += 1.f - s->sp;
  if (s->lag > 3.5f * (float)c->sr) s->lag = 3.5f * (float)c->sr;
  if (want > 0.5f && s->lag > 1) { /* let go: spin back up (catch up with you) */
    s->ret += 0.0006f;
    if (s->ret >= 1) s->lag = 0, s->ret = 0;
  }
  float mod = s->base + s->wow * 0.0045f * (float)c->sr * (1 + sh_sin01(s->w1)) + s->flt * 0.00035f * (float)c->sr * (1 + 0.6f * sh_sin01(s->w2) + 0.4f * sh_sin01(s->w3));
  float y = rec_tap(&s->rec, s->lag + mod);
  if (s->ret > 0) y += (rec_tap(&s->rec, mod) - y) * s->ret;
  float lp, bp, hp;
  if (s->age > 0) {
    svf_run(&s->hi, y, &lp, &bp, &hp), y = hp;
    svf_run(&s->lo, y, &lp, &bp, &hp), y = lp;
    y = lab_sat(y, 1.f + 2.5f * s->age);
  }
  float e = env_run(&s->env, x);
  /* sags */
  if (--s->dcnt <= 0) {
    s->dcnt = (int)(c->sr * (0.25 + 0.9 * (0.5 + 0.5 * lab_rnd(&s->rng))));
    s->dt = (0.5f + 0.5f * lab_rnd(&s->rng)) < s->drop ? 0.15f : 1.f;
  }
  s->dg += 0.0015f * (s->dt - s->dg);
  y *= s->dg;
  /* crackle and hiss, only with your playing */
  float n = lab_rnd(&s->rng);
  float pop = (0.5f + 0.5f * lab_rnd(&s->rng)) < s->crk * 0.0025f ? n * 6.f : 0.f;
  svf_run(&s->cr, pop + 0.15f * s->age * n, &lp, &bp, &hp);
  y += e * (bp * 0.6f + 0.02f * s->age * n);
  return y;
}

static wk_c *moth_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  moth_t *s = (moth_t *)ar_alloc(a, sizeof(moth_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_MOTHBALL, g, sr, bass, live, 1.f);
  s->c.own = 1;
  s->wow = (float)sh_clamp(wk_raw(g, "wow", 30) / 100.0, 0, 1);
  s->flt = (float)sh_clamp(wk_raw(g, "flutter", 25) / 100.0, 0, 1);
  s->age = (float)sh_clamp(wk_raw(g, "age", 40) / 100.0, 0, 1);
  s->crk = (float)sh_clamp(wk_raw(g, "crackle", 30) / 100.0, 0, 1);
  s->drop = 0.6f * (float)sh_clamp(wk_raw(g, "dropout", 10) / 100.0, 0, 1);
  wk_set(&s->lo, sr, 16000 * sh_pow(0.2, s->age), 0.6);
  wk_set(&s->hi, sr, (40 + 200 * s->age) * s->c.fs, 0.6);
  wk_set(&s->cr, sr, 3000, 0.7);
  env_set(&s->env, sr, 5, 300);
  s->base = (float)(0.002 * sr);
  s->sp = 1, s->dg = 1, s->dt = 1;
  s->rng = 0xa54ff53au;
  if (!rec_init(&s->rec, a, (int)(3.7 * sr))) return 0;
  s->c.run = moth_run;
  return &s->c;
}

/* -------------------------------------------------------------- PHOENIX -- */
/* A reverb that rises out of the ashes: every new note's reverb swells up over Rise instead of
   trailing away, like a recording played backwards (louder and louder, then gone). Size: how big and long the room. Bloom: how
   long the swell stays up before it falls away. Tone: dark to bright. Rebirth (held): the reverb
   climbs an octave each time round, rising into the sky. */
typedef struct {
  wk_c c;
  wk_fdn f;
  wk_onset on;
  wk_ps ps;
  svf_t tone;
  float sw, rise, bloom, held, hk, rb, rk, fb, back;
  int t, holdn;
} phoenix_t;

static float phoenix_run(wk_c *c, float x, float in0, float *dry) {
  phoenix_t *s = (phoenix_t *)c;
  if (wk_onset_run(&s->on, x)) s->t = 0, s->sw *= 0.3f; /* a new note: the swell starts again */
  s->t++;
  float target = s->t < s->holdn ? 1.f : 0.f;
  if (target > s->sw) s->sw = s->sw + s->rise > 1 ? 1 : s->sw + s->rise; /* a straight climb over Rise */
  else s->sw += s->hk * (target - s->sw);
  s->rb += s->rk * ((lab_on(c, 0) ? 1.f : 0.f) - s->rb);
  float back = s->rb > 0.001f ? wk_ps_run(&s->ps, s->fb, 2.0) * s->rb : 0.f;
  float r = fdn_run(&s->f, x + 0.6f * back);
  s->fb = r;
  float lp, bp, hp;
  svf_run(&s->tone, r + back, &lp, &bp, &hp);
  float y = lp * s->sw * s->sw;
  return y * 2.2f;
}

static wk_c *phoenix_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  phoenix_t *s = (phoenix_t *)ar_alloc(a, sizeof(phoenix_t));
  if (!s) return 0;
  wk_base(&s->c, WK_PHOENIX, g, sr, bass, live, 0.5f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 50) / 100.0, 0, 1);
  float rise = (float)sh_clamp(wk_raw(g, "rise", 0.8f), 0.1, 3);
  s->rise = (float)(1.0 / (rise * sr));
  float size = (float)sh_clamp(wk_raw(g, "size", 60) / 100.0, 0, 1);
  s->bloom = (float)sh_clamp(wk_raw(g, "bloom", 40) / 100.0, 0, 1);
  s->holdn = (int)((rise + 0.1f + 2.5f * s->bloom) * sr);
  s->hk = wk_k(sr, 0.1 + 0.6 * s->bloom);
  float tone = (float)sh_clamp(wk_raw(g, "tone", 55) / 100.0, 0, 1);
  wk_set(&s->tone, sr, 800 * sh_pow(18, tone), 0.6);
  s->rk = wk_k(sr, 0.3);
  wk_onset_init(&s->on, sr, bass, 0.003f);
  if (!fdn_init(&s->f, a, sr, 2.4f, 20) || !wk_ps_init(&s->ps, a, sr, 2)) return 0;
  fdn_set(&s->f, 0.8f + 1.4f * size, 1.5f + 6.f * size, 7000, 10, 1);
  s->c.run = phoenix_run;
  return &s->c;
}

/* --------------------------------------------------------------- RAIJIN -- */
/* The thunder god's drums, played by your picking. Each new note you pick sets off a drum: kicks
   and snares by turns (a phrase starts on a kick), a clap on every fourth beat and on the hardest hits. Kick, Snare,
   Clap: how loud each is. Sense: how gentle a pick still counts. Tone: from deep and dark to tight
   and bright. Mix: from your guitar alone to the drums alone. Roll (held): while your note rings,
   the snare rolls in sixteenths of the song's beat. */
typedef struct {
  wk_c c;
  wk_onset on;
  wk_trk trk;
  svf_t sn, cl, kt;
  env_t env;
  float kick, snare, clap, tone, ke, kp, kf, se, sp, ce, avg, ms, msa, rph, kv, sv, cv;
  int n, cc, roll;
  uint32_t rng;
} raijin_t;

static float raijin_run(wk_c *c, float x, float in0, float *dry) {
  raijin_t *s = (raijin_t *)c;
  float dt = 1.f / (float)c->sr;
  wk_trk_run(&s->trk, in0);
  float lv = wk_level(&s->ms, s->msa, x);
  float e = env_run(&s->env, x);
  if (wk_onset_run(&s->on, x)) {
    float v = e / (s->avg + 1e-4f);
    /* as loud as your playing, a little more on the harder hits */
    float vel = 2.5f * e * (v > 2 ? 1.f : 0.5f + 0.25f * v);
    vel = vel > 1 ? 1 : vel;
    if (s->on.t > (int)(0.6 * c->sr)) s->n = 0; /* after a pause, the phrase starts on a kick */
    if ((s->n & 1) == 0) s->ke = vel, s->kf = 1;
    else s->se = vel;
    if (v > 1.6f || (s->n & 3) == 3) s->ce = vel, s->cc = 0; /* hard hits, and every fourth beat */
    s->n++;
    s->avg += 0.3f * (e - s->avg);
  }
  /* the roll: sixteenths while your note rings */
  if (lab_on(c, 0) && lv > 0.006f) {
    s->rph += lab_tempo(c) / 60.f * 4.f * dt;
    if (s->rph >= 1) s->rph -= 1, s->se = (0.55f + 0.2f * lab_rnd(&s->rng)) * (2.5f * lv > 1 ? 1 : 2.5f * lv);
  } else s->rph = 0.999f;
  float y = 0, lp, bp, hp;
  /* kick: a sine falling from about 140 Hz to 45 */
  if (s->ke > 1e-4f) {
    s->kf *= 0.9993f;
    s->kp += (45.f + 95.f * s->kf) * s->tone * dt;
    if (s->kp >= 1) s->kp -= 1;
    y += s->kick * s->ke * sh_sin01(s->kp);
    s->ke *= s->kv;
  }
  /* snare: a ringing drum and a burst of noise */
  if (s->se > 1e-4f) {
    s->sp += 190.f * s->tone * dt;
    if (s->sp >= 1) s->sp -= 1;
    svf_run(&s->sn, lab_rnd(&s->rng), &lp, &bp, &hp);
    y += s->snare * s->se * (0.4f * sh_sin01(s->sp) + 0.9f * bp);
    s->se *= s->sv;
  }
  /* clap: three quick bursts, then a tail */
  if (s->ce > 1e-4f) {
    s->cc++;
    int ms = (int)(s->cc * 1000.f * dt);
    float burst = ms < 30 ? ((ms % 10) < 3 ? 1.f : 0.25f) : 1.f;
    svf_run(&s->cl, lab_rnd(&s->rng), &lp, &bp, &hp);
    y += s->clap * s->ce * burst * bp * 1.3f;
    if (ms >= 30) s->ce *= s->cv;
  }
  return y;
}

static wk_c *raijin_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  raijin_t *s = (raijin_t *)ar_alloc(a, sizeof(raijin_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_RAIJIN, g, sr, bass, live, 0.5f);
  s->kick = (float)sh_clamp(wk_raw(g, "kick", 70) / 100.0, 0, 1) * 0.9f;
  s->snare = (float)sh_clamp(wk_raw(g, "snare", 60) / 100.0, 0, 1) * 0.6f;
  s->clap = (float)sh_clamp(wk_raw(g, "clap", 40) / 100.0, 0, 1) * 0.6f;
  float tone = (float)sh_clamp(wk_raw(g, "tone", 50) / 100.0, 0, 1);
  s->tone = 0.75f + 0.5f * tone;
  float sense = (float)sh_clamp(wk_raw(g, "sense", 60) / 100.0, 0, 1);
  wk_onset_init(&s->on, sr, bass, (float)sh_db2lin(-30 - 30 * sense));
  wk_trk_init(&s->trk, sr, bass);
  wk_set(&s->sn, sr, 1500 + 2500 * tone, 0.9);
  wk_set(&s->cl, sr, 900 + 1200 * tone, 1.6);
  env_set(&s->env, sr, 2, 80);
  s->kv = (float)sh_exp(-1.0 / ((0.25 - 0.1 * tone) * sr));
  s->sv = (float)sh_exp(-1.0 / ((0.13 - 0.05 * tone) * sr));
  s->cv = (float)sh_exp(-1.0 / (0.12 * sr));
  s->msa = wk_k(sr, 0.03), s->avg = 0.05f;
  s->rng = 0x510e527fu;
  s->c.run = raijin_run;
  return &s->c;
}

/* --------------------------------------------------------------- SATURN -- */
/* A ring modulator: your sound times a tone (the planet's orbit), so every note splits into two
   new ones, its pitch plus and minus the orbit's: clangy bells, robots and broken radios. Orbit:
   the tone, from a slow throb (Low, about 2 to 300 Hz) up to high clang (High, about 30 Hz to 3
   kHz). Wobble: the orbit swings up and down. Tilt: dark to bright. Eclipse (held): the orbit locks
   onto your own note (twice its pitch), so it rings in tune. */
typedef struct {
  wk_c c;
  wk_trk trk;
  svf_t tl;
  float orbit, cur, k, wob, wph, ph, tilt, track;
} saturn_t;

static float saturn_run(wk_c *c, float x, float in0, float *dry) {
  saturn_t *s = (saturn_t *)c;
  wk_trk_run(&s->trk, in0);
  float dt = 1.f / (float)c->sr;
  if (s->trk.valid) s->track = s->trk.f0 * 2.f;
  float want = lab_on(c, 0) && s->track > 0 ? s->track : s->orbit;
  s->cur += s->k * (want - s->cur);
  s->wph += (0.3f + 5.f * s->wob) * dt;
  if (s->wph >= 1) s->wph -= 1;
  float f = s->cur * sh_exp2f_fast(s->wob * 1.2f * sh_sin01(s->wph));
  s->ph += f * dt;
  if (s->ph >= 1) s->ph -= 1;
  float y = x * sh_sin01(s->ph) * 2.4f;
  float lp, bp, hp;
  svf_run(&s->tl, y, &lp, &bp, &hp);
  return lp + (hp - lp) * s->tilt + bp * 0.3f;
}

static wk_c *saturn_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  saturn_t *s = (saturn_t *)ar_alloc(a, sizeof(saturn_t));
  if (!s) return 0;
  wk_base(&s->c, WK_SATURN, g, sr, bass, live, 1.f);
  int high = wk_sw(g, "low/high", 1, 2);
  float o = (float)sh_clamp(wk_raw(g, "orbit", 50) / 100.0, 0, 1);
  s->orbit = s->cur = high ? 30.f * sh_exp2f_fast(6.64f * o) : 2.f * sh_exp2f_fast(7.23f * o);
  s->wob = (float)sh_clamp(wk_raw(g, "wobble", 15) / 100.0, 0, 1);
  s->tilt = (float)sh_clamp(wk_raw(g, "tilt", 50) / 100.0, 0, 1);
  wk_set(&s->tl, sr, 1200, 0.6);
  s->k = wk_k(sr, 0.03);
  wk_trk_init(&s->trk, sr, bass);
  s->c.run = saturn_run;
  return &s->c;
}

/* --------------------------------------------------------------- SELENE -- */
/* The moon pulling the tide: your sound ducks at the start of every beat and swells back, the
   pumping of a dance record. Rate: half, quarter or eighth notes of the song's beat. Depth: how far
   it ducks. Shape: from a soft, rounded breath to a sharp pump. Swing: every other pulse comes a
   little late. */
typedef struct {
  wk_c c;
  float ph, depth, k, swing, g;
  int odd;
  double div2;
} selene_t;

static float selene_run(wk_c *c, float x, float in0, float *dry) {
  selene_t *s = (selene_t *)c;
  float rate = lab_tempo(c) / 60.f * (float)s->div2;
  s->ph += rate / (float)c->sr;
  float len = s->odd ? 1.f - s->swing : 1.f + s->swing;
  if (s->ph >= len) s->ph -= len, s->odd ^= 1;
  float t = s->ph / len;
  float duck = sh_exp2f_fast(s->k * sh_log2f_fast(1.f - t + 1e-6f)); /* 1 at the beat, falling to 0 */
  float want = 1.f - s->depth * duck;
  s->g += 0.02f * (want - s->g);
  return x * s->g;
}

static wk_c *selene_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  selene_t *s = (selene_t *)ar_alloc(a, sizeof(selene_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_SELENE, g, sr, bass, live, 1.f);
  static const double DIV[3] = {0.5, 1, 2};
  s->div2 = DIV[wk_sw(g, "rate", 1, 3)];
  s->depth = 0.97f * (float)sh_clamp(wk_raw(g, "depth", 70) / 100.0, 0, 1);
  s->k = 1.f + 7.f * (float)sh_clamp(wk_raw(g, "shape", 40) / 100.0, 0, 1);
  s->swing = 0.33f * (float)sh_clamp(wk_raw(g, "swing", 0) / 100.0, 0, 1);
  s->g = 1;
  s->c.run = selene_run;
  return &s->c;
}

/* ------------------------------------------------- RELIQUARY (endless sustain) -- */
/* The relic of endless sustain. Grace: how strongly a note is held up as it dies (like a bow
   on the string). After the note has rung for Vigil seconds it begins to Bloom: it swells into
   singing feedback, an octave and a fifth glowing over it. Halo: a shimmer of light above it all.
   Faith: the note dies when you mute it, as a held note should; Miracle: the last note you played
   rings on after you stop, until you play another. Eternal (held): the note rings forever, as it is
   right now, while you play over it. */
typedef struct {
  wk_c c;
  env_t env;
  wk_onset on;
  wk_rec rec;
  wk_ps p8, p5, ph;
  wk_fdn halo;
  float *seg;
  int C, L, age[4], pos[4], froze, ring, vig, miracle;
  float grace, bloom, halo_amt, gk, gn, fz, fk, bl, bk, ms, msa, last, lv;
  uint32_t rng;
} sustaint_t;

static void sus_freeze(sustaint_t *s) {
  rec_copy(&s->rec, s->seg, s->C);
  for (int k = 0; k < 4; k++) s->age[k] = -k * (s->L / 4), s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
}

static float sustaint_run(wk_c *c, float x, float in0, float *dry) {
  sustaint_t *s = (sustaint_t *)c;
  float e = env_run(&s->env, x);
  float lv = wk_level(&s->ms, s->msa, x);
  int hit = wk_onset_run(&s->on, x);
  rec_push(&s->rec, x);
  if (hit) s->ring = 0;
  s->ring++;
  /* grace: held up as it dies (more gain as it gets quieter, up to +30 dB, never on silence) */
  float target = 0.12f;
  float g = e > 1e-4f ? target / e : 1.f;
  float gmax = 1.f + 15.f * s->grace;
  g = g < 1 ? 1 : g > gmax ? gmax : g;
  if (e < 0.0008f) g = 1.f + (g - 1.f) * (e / 0.0008f);
  s->gn += s->gk * (g - s->gn);
  float v = x * (1.f + (s->gn - 1.f) * s->grace);
  /* bloom: after the vigil, swelling into feedback, an octave and a fifth above */
  float want = s->ring > s->vig && lv > 0.004f ? s->bloom : 0.f;
  s->bl += (want > s->bl ? s->bk : s->bk * 4.f) * (want - s->bl);
  if (s->bl > 1e-4f) {
    float o = wk_ps_run(&s->p8, v, 2.0), f = wk_ps_run(&s->p5, v, 1.5);
    v = v + s->bl * (0.7f * lab_sat(o, 2.f) + 0.35f * f);
  }
  /* the frozen note: Eternal, or (Miracle) the last note after you stop */
  int eternal = lab_on(c, 0);
  int stopped = lv < 0.002f && s->last > 0.004f;
  s->last += 0.0005f * (lv - s->last);
  int want_fz = eternal || (s->miracle && (s->froze ? !hit : stopped));
  if (want_fz && !s->froze) sus_freeze(s);
  s->froze = want_fz;
  s->fz += s->fk * ((want_fz ? 1.f : 0.f) - s->fz);
  float fr = 0;
  if (s->fz > 1e-4f) {
    for (int k = 0; k < 4; k++) {
      int a = s->age[k]++;
      if (a < 0) continue;
      if (a >= s->L) a = s->age[k] = 0, s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
      fr += s->seg[s->pos[k] + a] * (0.5f - 0.5f * sh_sin01((float)a / s->L + 0.25f));
    }
    fr *= 0.45f * s->fz;
  }
  float y = v + fr;
  if (s->halo_amt > 0) y += s->halo_amt * fdn_run(&s->halo, wk_ps_run(&s->ph, y, 2.0) * 0.5f + y * 0.3f);
  return y;
}

static wk_c *sustaint_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  sustaint_t *s = (sustaint_t *)ar_alloc(a, sizeof(sustaint_t));
  if (!s) return 0;
  wk_base(&s->c, WK_SUSTAINT, g, sr, bass, live, 1.f);
  s->grace = (float)sh_clamp(wk_raw(g, "grace", 60) / 100.0, 0, 1);
  s->bloom = (float)sh_clamp(wk_raw(g, "bloom", 40) / 100.0, 0, 1);
  s->halo_amt = (float)sh_clamp(wk_raw(g, "halo", 25) / 100.0, 0, 1);
  s->vig = (int)(sh_clamp(wk_raw(g, "vigil", 1.5f), 0.2, 6) * sr);
  s->miracle = wk_sw(g, "faith/miracle", 0, 2);
  env_set(&s->env, sr, 3, 150);
  wk_onset_init(&s->on, sr, bass, 0.003f);
  s->gk = wk_k(sr, 0.05), s->gn = 1, s->fk = wk_k(sr, 0.08), s->bk = wk_k(sr, 0.8), s->msa = wk_k(sr, 0.03);
  s->C = (int)(0.6 * sr), s->L = (int)(0.18 * sr);
  s->rng = 0x9b05688cu;
  s->froze = lab_on(&s->c, 0);
  s->seg = (float *)ar_alloc(a, sizeof(float) * s->C);
  if (!s->seg || !rec_init(&s->rec, a, (int)(0.7 * sr))) return 0;
  if (!wk_ps_init(&s->p8, a, sr, 2) || !wk_ps_init(&s->p5, a, sr, 1.5) || !wk_ps_init(&s->ph, a, sr, 2)) return 0;
  if (!fdn_init(&s->halo, a, sr, 2.f, 10)) return 0;
  fdn_set(&s->halo, 1.6f, 5.f, 8000, 5, 1);
  if (s->froze) sus_freeze(s);
  s->c.run = sustaint_run;
  return &s->c;
}
