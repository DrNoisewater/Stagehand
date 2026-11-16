/*
 * The wacky pedals (4.20): fourteen pedals, each with the controls printed on its picture.
 *
 *   Quack      an envelope filter (a duck's wa-ack)          Croak      throat formants that pulse (a frog)
 *   Gobble     a talking vowel filter (a turkey)              Slug       slow swells, no pick attack
 *   Blorp      an XY-pad vowel mouth (an alien)               Boing      a pitch jump on a footswitch or lever
 *   Caterwaul  a pitch meow on each note, purr and hiss        Gremlin    a synth fuzz from your notes (sub, root, fifth)
 *   Invader    a single-note synth (bass, lead, laser, steps)  Confetti   echoes that climb or fall in pitch
 *   Blender    chopped, reversed or scattered slices           Fossil     freezes a chord into a drone
 *   Charmer    a sitar-like buzz with drone strings            Haunt      an organ-like octave blend through a spinning speaker
 *
 * Everything is made from the playing itself: no recordings, no song chart. The synths (Gremlin,
 * Invader) follow the pitch of the clean input to the whole chain (b->in0), not the sound after
 * earlier pedals. Footswitches, Boing's lever and Haunt's Slow/Fast come in live through the
 * engine's parameters (SHP_WK_*), so pressing them never rebuilds the tone.
 *
 * Knob values arrive in their own units (Hz, ms, semitones, dB, %); switch positions are 0, 1, 2…
 * Every pedal has Mix and Trim beside its faceplate: Mix 0 is the dry sound exactly.
 *
 * Included once, by sh_fx.c, so the build lists stay as they are.
 */

#define WK_CR 8 /* filters move every 8 samples */

/* the pedal numbers: bit (1 << n) in SHP_WK_HOLD / SHP_WK_LATCH. Keep these stable. */
enum {
  WK_QUACK = 1, WK_CROAK, WK_CATERWAUL, WK_BLORP, /* the 4.19 four keep their numbers */
  WK_GOBBLE, WK_SLUG, WK_BOING, WK_GREMLIN, WK_INVADER, WK_CONFETTI, WK_BLENDER, WK_FOSSIL, WK_CHARMER, WK_HAUNT,
  /* 4.20: the thirty that followed (sh_lab*.h) */
  WK_ANNWN, WK_APOPTOSIS, WK_BIFROST, WK_BLUEPRINCE, WK_CLAUDE, WK_DEJAVU, WK_DUAT, WK_EVENTHORIZON, WK_FENRIR, WK_INANNA,
  WK_JANUS, WK_KITSUNE, WK_KUKULKAN, WK_LONG, WK_MAUI, WK_MIMIC, WK_MOLT, WK_NATARAJA, WK_NOTHING, WK_OLYMPUS,
  WK_OUROBOROS, WK_PARASITE, WK_RELIQUARY, WK_SEANCE, WK_SEVERED, WK_SHANGO, WK_TEZCATL, WK_VELES, WK_WHOAREYOU, WK_WUKONG,
  WK_COUNT
};

static const char *const WK_KEYS[WK_COUNT] = {
    0, "Pedal_Quack", "Pedal_Croak", "Pedal_Caterwaul", "Pedal_Blorp", "Pedal_Gobble", "Pedal_Slug", "Pedal_Boing",
    "Pedal_Gremlin", "Pedal_Invader", "Pedal_Confetti", "Pedal_Blender", "Pedal_Fossil", "Pedal_Charmer", "Pedal_Haunt",
    "Pedal_Annwn", "Pedal_Apoptosis", "Pedal_Bifrost", "Pedal_BluePrince", "Pedal_Claude", "Pedal_DejaVu", "Pedal_Duat", "Pedal_EventHorizon", "Pedal_Fenrir", "Pedal_Inanna",
    "Pedal_Janus", "Pedal_Kitsune", "Pedal_Kukulkan", "Pedal_Long", "Pedal_Maui", "Pedal_Mimic", "Pedal_Molt", "Pedal_Nataraja", "Pedal_Nothing", "Pedal_Olympus",
    "Pedal_Ouroboros", "Pedal_Parasite", "Pedal_Reliquary", "Pedal_Seance", "Pedal_Severed", "Pedal_Shango", "Pedal_Tezcatl", "Pedal_Veles", "Pedal_WhoAreYou", "Pedal_Wukong"};

static const float WK_NOLIVE[SHP_COUNT];

/* --------------------------------------------------------------- shared -- */

/* a knob by its exact (lower-case) name, in its own units */
static float wk_raw(const sh_gear *g, const char *name, float def) {
  sh_knob k;
  return kn_exact(g, name, &k) ? k.v : def;
}
/* a knob's position 0..1 */
static float wk_pos(const sh_gear *g, const char *name, float def) {
  sh_knob k;
  if (!kn_exact(g, name, &k) || k.hi <= k.lo) return def;
  return (float)sh_clamp((k.v - k.lo) / (k.hi - k.lo), 0, 1);
}
/* a switch position 0..n-1 */
static int wk_sw(const sh_gear *g, const char *name, int def, int n) {
  float v = wk_raw(g, name, (float)def);
  int i = (int)(v + 0.5f);
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

static inline float wk_smooth(float t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
/* one-pole coefficient for a time constant in seconds */
static inline float wk_k(double sr, double sec) { return (float)(1 - sh_exp(-1.0 / ((sec < 1e-5 ? 1e-5 : sec) * sr))); }

static inline void wk_set(svf_t *f, double sr, double hz, double q) {
  if (hz < 25) hz = 25;
  if (hz > sr * 0.45) hz = sr * 0.45;
  svf_set(f, sr, hz, q);
}
/* band-pass with a peak of 1 */
static inline float wk_bp(svf_t *f, float x) {
  float lp, bp, hp;
  svf_run(f, x, &lp, &bp, &hp);
  return f->k * bp;
}
/* formant interpolation in log frequency */
static inline float wk_lerpf(float a, float b, float t) { return a * sh_exp2f_fast(t * sh_log2f_fast(b / a)); }

/* only very loud peaks are rounded off; anything normal passes untouched */
static inline float wk_soft(float y) {
  float a = sh_fabsf(y);
  if (a <= 0.8f) return y;
  float s = 0.8f + 0.4f * sh_tanhf((a - 0.8f) * 2.5f);
  return y < 0 ? -s : s;
}

/* Finds the start of each note: a jump in loudness, or the click of a new pick (a burst of
   treble over the ringing string, which catches notes picked again at the same loudness).
   floor: below this the playing is too quiet to count (muted noise never triggers). */
typedef struct {
  env_t fast, slow, hfast, hslow;
  svf_t hp;
  int armed, harmed, holdn, hold;
  int t; /* samples since the last new note */
  float floor;
} wk_onset;

static void wk_onset_init(wk_onset *o, double sr, int bass, float floor) {
  env_set(&o->fast, sr, 0.5, 30);
  env_set(&o->slow, sr, 40, 400);
  env_set(&o->hfast, sr, 0.3, 12);
  env_set(&o->hslow, sr, 25, 150);
  svf_set(&o->hp, sr, bass ? 1000 : 1500, 0.7);
  o->hold = (int)(sr * 0.07);
  o->armed = o->harmed = 1;
  o->t = 1 << 28;
  o->floor = floor;
}

static inline int wk_onset_run(wk_onset *o, float x) {
  float lp, bp, hp;
  svf_run(&o->hp, x, &lp, &bp, &hp);
  float f = env_run(&o->fast, x), s = env_run(&o->slow, x);
  float hf = env_run(&o->hfast, hp), hs = env_run(&o->hslow, hp);
  if (o->t < (1 << 28)) o->t++;
  if (o->holdn > 0) o->holdn--;
  if (!o->armed && f < 1.15f * s) o->armed = 1;
  if (!o->harmed && hf < 1.3f * hs) o->harmed = 1;
  int hit = 0;
  if (!o->holdn && f > o->floor) {
    if (o->armed && f > 1.6f * s + 0.0015f) hit = 1;
    else if (o->harmed && hf > 0.002f && hf > 0.04f * f && hf > 2.5f * hs + 0.0005f) hit = 1;
  }
  if (hit) o->armed = o->harmed = 0, o->holdn = o->hold, o->t = 0;
  return hit;
}

/* the playing's average level (not its peaks), so a chord is no louder than one note */
static inline float wk_level(float *ms, float a, float x) {
  *ms += a * (x * x - *ms);
  return 1.414f * sh_sqrtf(*ms);
}

/* Blend: equal loudness all the way across; at 0 the dry signal comes out exactly as it went in. */
static void wk_blend(float b, float *gd, float *gw) {
  if (b <= 0) {
    *gd = 1, *gw = 0;
    return;
  }
  if (b >= 1) {
    *gd = 0, *gw = 1;
    return;
  }
  *gd = (float)sh_cos(b * SH_PI * 0.5), *gw = (float)sh_sin(b * SH_PI * 0.5);
}

/* The level keeper: the effect comes out as loud as what went in (average levels; both rise
   quickly and fall slowly, and the gain comes down fast, so a new note never jumps out). */
typedef struct {
  float lin, lout, lgs, la, lga, lgr;
} wk_keeper;
static void wk_keep_init(wk_keeper *k, double sr) {
  k->la = wk_k(sr, 0.03), k->lga = wk_k(sr, 0.002), k->lgr = wk_k(sr, 0.001);
  k->lgs = 1;
}
/* (the gain is held to 4x at most, and both levels rise within a couple of milliseconds, so a
   fresh pick after a long fade never comes through hot) */
static inline float wk_keep(wk_keeper *k, float x, float y) {
  float xx = x * x, yy = y * y;
  k->lin += (xx > k->lin ? k->lga : k->la) * (xx - k->lin);
  k->lout += (yy > k->lout ? k->lga : k->la) * (yy - k->lout);
  float g = sh_sqrtf((k->lin + 1e-12f) / (k->lout + 1e-10f));
  if (g > 4.f) g = 4.f;
  k->lgs += (g < k->lgs ? k->lgr : k->la) * (g - k->lgs);
  return y * k->lgs;
}

/* -------------------------------------------------- the pitch shifter -- */
/* The same splice-matched shifter as the Drop and the pitch pedals (sh_pitch.c): the input is
   read back faster or slower through a short delay; when the read head runs out of room it
   jumps to where the waveform lines up best and the two heads cross-fade. Here the speed may
   change as it plays (Boing, Caterwaul, Confetti); it is set up for the largest shift up. */
typedef struct {
  float *buf;
  int len, w;
  double rp[2];
  int xf, xf_len;
  double dmin, dmax;
  int search, cmp;
} wk_ps;

static int wk_ps_init(wk_ps *p, sh_arena *a, double sr, double rmax) {
  double ms = sr / 1000.0;
  if (rmax < 1) rmax = 1;
  p->xf_len = (int)(8.0 * ms / (rmax - 1 > 1 ? rmax - 1 : 1));
  if (p->xf_len < 16) p->xf_len = 16;
  p->search = (int)(26.0 * ms);
  p->dmin = 3.5 * ms + p->xf_len * (rmax - 1) + 4.0 * ms;
  p->dmax = p->dmin + p->search + 6.0 * ms + p->xf_len * (rmax - 1);
  p->cmp = p->xf_len < 64 ? 64 : p->xf_len;
  p->len = (int)(p->dmax + p->cmp * rmax + p->xf_len * rmax + 64);
  p->buf = (float *)ar_alloc(a, sizeof(float) * p->len);
  p->rp[0] = -p->dmin - 64;
  return p->buf != 0;
}

static inline float wk_ps_read(const wk_ps *p, double pos) {
  int i = (int)pos;
  if (pos < i) --i;
  float f = (float)(pos - i);
  i %= p->len;
  if (i < 0) i += p->len;
  int j = i + 1 == p->len ? 0 : i + 1;
  return p->buf[i] + (p->buf[j] - p->buf[i]) * f;
}

static void wk_ps_splice(wk_ps *p, double now, double r) {
  double cur = p->rp[0];
  int jmax = p->cmp / 2;
  double room = (now - 1 - cur) / r;
  if (room < jmax) jmax = (int)room;
  int jmin = jmax - p->cmp;
  double best = -1e30, bestpos = r < 1 ? now - p->dmin : now - p->dmax;
  for (int d = 0; d <= p->search; d += 2) {
    double pos = r < 1 ? now - p->dmin - d : now - p->dmax + d;
    double c = 0, en = 1e-9;
    for (int j = jmin; j < jmax; j += 4) {
      float a = wk_ps_read(p, cur + j * r), b = wk_ps_read(p, pos + j * r);
      c += (double)a * b, en += (double)b * b;
    }
    double sc = c / sh_sqrt(en);
    if (sc > best) best = sc, bestpos = pos;
  }
  p->rp[1] = cur;
  p->rp[0] = bestpos;
  p->xf = p->xf_len;
}

/* r: the speed now (2^(semitones/12)), 0.25..4 */
static float wk_ps_run(wk_ps *p, float x, double r) {
  p->buf[p->w % p->len] = x;
  double now = (double)p->w;
  p->w++;
  double d = now - p->rp[0];
  if (p->xf <= 0 && (r < 1 ? d > p->dmax : d < p->dmin)) wk_ps_splice(p, now, r);
  if (d > p->len - 8) p->rp[0] = now - p->dmin; /* never read where nothing was written */
  float y = wk_ps_read(p, p->rp[0]);
  if (p->xf > 0) {
    float t = (float)p->xf / p->xf_len;
    t = t * t * (3 - 2 * t);
    y = y * (1 - t) + wk_ps_read(p, p->rp[1]) * t;
    p->rp[1] += r;
    p->xf--;
  }
  p->rp[0] += r;
  if (p->w >= 0x40000000) {
    int sh = (0x20000000 / p->len) * p->len;
    p->w -= sh, p->rp[0] -= sh, p->rp[1] -= sh;
  }
  return y;
}

/* ------------------------------------------------- the pitch follower -- */
/* For the synths: one note at a time, from the clean input. The input is filtered and taken
   down to about 12 kHz, and every few milliseconds the last stretch is compared with itself
   shifted (YIN: the period is where it lines up best). A reading counts only when it is clear;
   a chord, a muted string or silence gives none, and the synth fades out instead of hanging on.
   Low notes need a longer look, so bass follows a little more slowly. */
#define TRK_N 2048
typedef struct {
  int D, ph, H, hc, tmin, tmax, W, w;
  double fsd;
  bq_t aa[2];
  float buf[TRK_N];
  float x[TRK_N];
  float d[640];
  float f0;    /* Hz of the last clear reading */
  int valid;   /* a clear note now */
  int fresh;   /* set when a reading comes in (a new note or the same one) */
  int newnote; /* set when the note changes or starts */
  float cand;
  float gate;  /* below this level: no reading */
} wk_trk;

static void wk_trk_init(wk_trk *t, double sr, int bass) {
  t->D = (int)(sr / 12000.0 + 0.5);
  if (t->D < 1) t->D = 1;
  t->fsd = sr / t->D;
  double fmin = bass ? 28 : 60, fmax = bass ? 700 : 1400;
  t->tmax = (int)(t->fsd / fmin) + 2;
  if (t->tmax > 620) t->tmax = 620;
  t->tmin = (int)(t->fsd / fmax);
  if (t->tmin < 2) t->tmin = 2;
  t->W = t->tmax;
  t->H = bass ? 96 : 64; /* about 8 or 5 ms between readings */
  double cut = t->fsd * 0.42 < 4500 ? t->fsd * 0.42 : 4500;
  bq_set(&t->aa[0], BQ_LP, sr, cut, 0.54, 0);
  bq_set(&t->aa[1], BQ_LP, sr, cut, 1.31, 0);
  t->gate = 0.004f;
}

static void wk_trk_read(wk_trk *t) {
  int n = t->W + t->tmax;
  double e = 0;
  for (int j = 0; j < n; j++) {
    float v = t->buf[(t->w - n + j) & (TRK_N - 1)];
    t->x[j] = v;
    e += (double)v * v;
  }
  t->fresh = 1;
  if (sh_sqrt(e / n) < t->gate) {
    t->valid = 0;
    return;
  }
  /* the difference function and its running mean (YIN) */
  float *x = t->x, *d = t->d;
  double run = 0;
  int best = -1;
  d[0] = 1;
  for (int tau = 1; tau <= t->tmax; tau++) {
    double s = 0;
    for (int j = 0; j < t->W; j++) {
      float q = x[j] - x[j + tau];
      s += q * q;
    }
    run += s;
    d[tau] = (float)(run > 0 ? s * tau / run : 1);
  }
  for (int tau = t->tmin; tau < t->tmax; tau++)
    if (d[tau] < 0.15f) {
      while (tau + 1 < t->tmax && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  if (best < 0) {
    t->valid = 0;
    return;
  }
  float a = d[best - 1], b = d[best], c = d[best + 1];
  float den = a - 2 * b + c;
  float off = den > 1e-9f ? 0.5f * (a - c) / den : 0;
  if (off > 0.5f) off = 0.5f;
  if (off < -0.5f) off = -0.5f;
  float f = (float)(t->fsd / (best + off));
  /* a jump to a new note must be heard twice in a row (a stray octave is not believed), unless
     the reading is very clear (a clean new note: no need to wait) */
  int same = t->valid && sh_fabsf(sh_log2f_fast(f / t->f0)) < 0.045f;
  if (same) {
    t->f0 += 0.5f * (f - t->f0);
  } else if ((!t->valid && b < 0.06f) || (t->cand > 0 && sh_fabsf(sh_log2f_fast(f / t->cand)) < 0.045f)) {
    t->f0 = f, t->valid = 1, t->newnote = 1;
  } else {
    t->cand = f;
    return; /* keep the last answer until the next reading */
  }
  t->cand = 0;
}

static inline void wk_trk_run(wk_trk *t, float x) {
  float v = bq_run(&t->aa[1], bq_run(&t->aa[0], x));
  if (++t->ph < t->D) return;
  t->ph = 0;
  t->buf[t->w++ & (TRK_N - 1)] = v;
  if (++t->hc >= t->H) t->hc = 0, wk_trk_read(t);
}

/* band-limited oscillators (polyBLEP) */
static inline float wk_blep(float t, float dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
static inline float wk_saw(float ph, float dt) { return 2 * ph - 1 - wk_blep(ph, dt); }
static inline float wk_sq(float ph, float dt) {
  float p2 = ph + 0.5f;
  if (p2 >= 1) p2 -= 1;
  return (ph < 0.5f ? 1.f : -1.f) + wk_blep(ph, dt) - wk_blep(p2, dt);
}
static inline float wk_adv(float *ph, float dt) {
  *ph += dt;
  if (*ph >= 1) *ph -= 1;
  return *ph;
}

/* ------------------------------------------------------- the pedal base -- */
typedef struct wk_c wk_c;
typedef float (*wk_run_fn)(wk_c *c, float x, float in0, float *dry);
struct wk_c {
  int kind, bass, cnt, add; /* add: the effect sits on top of the dry sound (Fossil, Confetti) */
  int clean;                /* the effect is the playing itself, only louder or softer, moved or later: no low cut */
  int word, rise, wprev;    /* 4.20: this pedal's live slot (SHP_LABW0 + kind): held bits, and bits pressed this block */
  float lval;               /* 4.20: its live value (SHP_LABV0 + kind) */
  int own;                  /* 4.20: the pedal shapes your own sound too, so Mix 0 doesn't switch it off */
  double sr;
  const float *live;
  float gd, gw, trim, fs;
  svf_t lowcut;
  wk_run_fn run;
};

static inline int wk_held(const wk_c *c) { return ((int)c->live[SHP_WK_HOLD] >> c->kind) & 1; }
static inline int wk_latched(const wk_c *c) { return ((int)c->live[SHP_WK_LATCH] >> c->kind) & 1; }

static void wk_base(wk_c *c, int kind, const sh_gear *g, double sr, int bass, const float *live, float mixdef) {
  c->kind = kind, c->bass = bass, c->sr = sr;
  c->live = live ? live : WK_NOLIVE;
  c->fs = bass ? 0.7f : 1.f;
  wk_blend(wk_raw(g, "mix", mixdef * 100) / 100.f, &c->gd, &c->gw);
  c->trim = (float)sh_db2lin(sh_clamp(wk_raw(g, "trim", 0), -18, 6));
  wk_set(&c->lowcut, sr, bass ? 25 : 30, 0.7);
}

/* ---------------------------------------------------------------- QUACK -- */
/* An envelope filter: the harder you pick, the further the filter sweeps open (about 300 Hz to
   2.5 kHz), then it closes as the note dies: wa-ack. Beak: how sharp and nasal (resonance).
   Sens: how far a given pick moves it. Low/Band/High: which side of the filter you hear.
   Honk (held): the mouth jumps wide open on an "aah" with extra bite. */
typedef struct {
  wk_c c;
  env_t env;
  svf_t f;
  wk_keeper kp;
  int mode;
  float q, gain, honk, hk, ctl, comp;
} quack_t;

static float quack_run(wk_c *c, float x, float in0, float *dry) {
  quack_t *s = (quack_t *)c;
  float e = env_run(&s->env, x);
  s->honk += s->hk * ((float)wk_held(c) - s->honk);
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    float ctl = 1.f - sh_expf_fast(-e * s->gain);
    float fc = 300.f * sh_exp2f_fast(3.06f * ctl) * c->fs; /* 300 Hz .. 2.5 kHz */
    fc = wk_lerpf(fc, 1400.f * c->fs, s->honk);
    float q = s->q * (1.f + 0.8f * s->honk);
    if (q > 18) q = 18;
    wk_set(&s->f, c->sr, fc, q);
    s->comp = 1.f / (s->mode == 1 ? 1.f : sh_sqrtf(q));
  }
  float lp, bp, hp;
  svf_run(&s->f, x, &lp, &bp, &hp);
  float y = s->mode == 0 ? lp : s->mode == 1 ? s->f.k * bp * 1.5f : hp;
  return wk_keep(&s->kp, x, y * s->comp);
}

static wk_c *quack_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  quack_t *s = (quack_t *)ar_alloc(a, sizeof(quack_t));
  if (!s) return 0;
  wk_base(&s->c, WK_QUACK, g, sr, bass, live, 0.75f);
  float beak = wk_raw(g, "beak", 50) / 100.f, sens = wk_raw(g, "sens", 50) / 100.f;
  s->q = 0.7f + 11.3f * (float)sh_pow(sh_clamp(beak, 0, 1), 1.5);
  s->gain = 3.f * (float)sh_pow(2, 6 * sh_clamp(sens, 0, 1));
  s->mode = wk_sw(g, "low/band/high", 1, 3);
  env_set(&s->env, sr, 2, 150);
  s->hk = wk_k(sr, 0.012);
  wk_keep_init(&s->kp, sr);
  s->c.run = quack_run;
  return &s->c;
}

/* ---------------------------------------------------------------- CROAK -- */
/* Two throat resonances that open with your picking and pulse (the "rrr" of a croak). Each new
   note starts a fresh pulse, so short notes croak once and held notes keep pulsing. Throat:
   a small dark throat to a big bright one (about 250/700 Hz up to 700/1500 Hz). Hop: pulses a
   second. Depth: how much they pulse (0 = none). Low/High: High moves the throat up by half. */
typedef struct {
  wk_c c;
  env_t env;
  wk_onset on;
  svf_t f1, f2;
  wk_keeper kp;
  float b1, b2, hop, depth, ph, am, gate;
} croak_t;

static float croak_run(wk_c *c, float x, float in0, float *dry) {
  croak_t *s = (croak_t *)c;
  if (wk_onset_run(&s->on, x)) s->ph = 0;
  float e = env_run(&s->env, x);
  s->ph += s->hop;
  if (s->ph >= 1) s->ph -= 1;
  float p = 0.5f + 0.5f * sh_sin01(s->ph + 0.25f); /* 1 at the start of a pulse */
  p *= p;
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    s->gate = 1.f - sh_expf_fast(-e * 60.f);
    float mul = (0.85f + 0.3f * s->gate) * (1.f + 0.35f * s->depth * (p - 0.5f) * s->gate);
    wk_set(&s->f1, c->sr, s->b1 * mul, 6);
    wk_set(&s->f2, c->sr, s->b2 * mul, 8);
  }
  float src = sh_tanhf(3.f * x) * 0.34f + 0.5f * x; /* a little grit */
  float y = wk_keep(&s->kp, x, wk_bp(&s->f1, src) + 0.8f * wk_bp(&s->f2, src));
  float am = 1.f - s->depth * (1.f - p) * s->gate;
  return y * am;
}

static wk_c *croak_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  croak_t *s = (croak_t *)ar_alloc(a, sizeof(croak_t));
  if (!s) return 0;
  wk_base(&s->c, WK_CROAK, g, sr, bass, live, 0.75f);
  float t = (float)sh_clamp(wk_raw(g, "throat", 40) / 100.0, 0, 1);
  float hi = wk_sw(g, "low/high", 0, 2) ? 1.5f : 1.f;
  s->b1 = wk_lerpf(250, 700, t) * hi * s->c.fs;
  s->b2 = wk_lerpf(700, 1500, t) * hi * s->c.fs;
  s->hop = (float)(sh_clamp(wk_raw(g, "hop", 4), 1, 12) / sr);
  s->depth = (float)sh_clamp(wk_raw(g, "depth", 60) / 100.0, 0, 1);
  env_set(&s->env, sr, 2, 80);
  wk_onset_init(&s->on, sr, bass, 0.003f);
  wk_keep_init(&s->kp, sr);
  s->c.run = croak_run;
  return &s->c;
}

/* --------------------------------------------------------------- GOBBLE -- */
/* A talking filter: three vowel resonances. Auto: each note moves the mouth from a relaxed "uh"
   toward the chosen vowel, further the harder you pick, and wobbles it at Rate while the note
   sounds (gobble-gobble). Hold: the vowel stays put (Rate does nothing). Sens: how far a pick
   moves the mouth. */
static const float GOB_V[4][3] = {{800, 1200, 2500}, {400, 900, 2400}, {300, 2200, 3000}, {500, 1500, 2500} /* uh */};

typedef struct {
  wk_c c;
  env_t env;
  svf_t f[3];
  wk_keeper kp;
  int vowel, hold;
  float gain, rate, ph;
} gobble_t;

static float gobble_run(wk_c *c, float x, float in0, float *dry) {
  gobble_t *s = (gobble_t *)c;
  float e = env_run(&s->env, x);
  s->ph += s->rate;
  if (s->ph >= 1) s->ph -= 1;
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    float p;
    if (s->hold) p = 1;
    else {
      float ctl = 1.f - sh_expf_fast(-e * s->gain);
      /* the pick sets how far toward the vowel and how wide the gobble swings */
      float c7 = sh_exp2f_fast(0.7f * sh_log2f_fast(ctl + 1e-6f));
      p = c7 * (0.5f + 0.5f * sh_sin01(s->ph));
      p = p < 0 ? 0 : p > 1 ? 1 : p;
    }
    static const float Q[3] = {7, 9, 11};
    for (int i = 0; i < 3; i++) wk_set(&s->f[i], c->sr, wk_lerpf(GOB_V[3][i], GOB_V[s->vowel][i], p) * c->fs, Q[i]);
  }
  float src = 0.7f * x + 0.25f * sh_tanhf(4.f * x);
  float y = wk_bp(&s->f[0], src) + 1.5f * wk_bp(&s->f[1], src) + 1.0f * wk_bp(&s->f[2], src);
  return wk_keep(&s->kp, x, y);
}

static wk_c *gobble_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  gobble_t *s = (gobble_t *)ar_alloc(a, sizeof(gobble_t));
  if (!s) return 0;
  wk_base(&s->c, WK_GOBBLE, g, sr, bass, live, 0.75f);
  s->vowel = wk_sw(g, "vowel", 1, 3);
  s->gain = 3.f * (float)sh_pow(2, 6 * sh_clamp(wk_raw(g, "sens", 50) / 100.0, 0, 1));
  s->rate = (float)(sh_clamp(wk_raw(g, "rate", 5), 0.5, 12) / sr);
  s->hold = wk_sw(g, "auto/hold", 0, 2);
  env_set(&s->env, sr, 2, 120);
  wk_keep_init(&s->kp, sr);
  s->c.run = gobble_run;
  return &s->c;
}

/* ----------------------------------------------------------------- SLUG -- */
/* Volume swells: the pick's attack is taken away and each note fades in over Rise, then fades
   out over Tail once you stop. Single: every new note swells again. Flow: legato playing keeps
   one long swell until there is a real gap. Sens: how quiet a note can be and still count.
   It only shapes the volume: nothing is reversed and nothing rings on after you stop. */
typedef struct {
  wk_c c;
  env_t env;
  wk_onset on;
  int flow, open, phase, quiet, quietn; /* phase 0 rest, 1 dip, 2 rise, 3 full, 4 fall */
  float thr, g, g0, t, rise, fall, dip, pk, pkd;
} slug_t;

static float slug_run(wk_c *c, float x, float in0, float *dry) {
  slug_t *s = (slug_t *)c;
  float e = env_run(&s->env, x);
  int hit = wk_onset_run(&s->on, x);
  /* the gate: open while the note is loud enough; it closes once the note has faded to about a third of
     its peak (or below Sens), so Tail shapes every note's ending. Some room either way and a
     short hold, so a ringing note doesn't flicker. */
  s->pk *= s->pkd;
  if (e > s->pk) s->pk = e;
  float close = 0.5f * s->thr > 0.33f * s->pk ? 0.5f * s->thr : 0.33f * s->pk;
  if (!s->open && e > s->thr && (hit || e > 0.6f * s->pk)) s->open = 1, s->quiet = 0;
  else if (s->open && e > close) s->quiet = 0;
  else if (s->open && e < close && ++s->quiet > s->quietn) s->open = 0;
  if (hit && e > s->thr) s->pk = e;
  int resting = s->phase == 0 || s->phase == 4;
  if (s->open && hit && (!s->flow || resting)) /* a new swell: Single on every note, Flow after a gap */
    s->phase = s->g > 0.02f ? 1 : 2, s->t = 0, s->g0 = s->g;
  else if (s->open && resting) /* playing again without a clear pick: swell from where it is */
    s->phase = 2, s->t = 0, s->g0 = s->g;
  if (!s->open && (s->phase == 2 || s->phase == 3)) s->phase = 4;
  switch (s->phase) {
    case 1: /* a quick dip so the next swell starts from nothing, without a click */
      s->g *= s->dip;
      if (s->g < 0.02f) s->phase = 2, s->t = 0, s->g0 = s->g;
      break;
    case 2:
      s->t += s->rise;
      s->g = s->g0 + (1.f - s->g0) * wk_smooth(s->t);
      if (s->t >= 1) s->phase = 3, s->g = 1;
      break;
    case 4:
      s->g *= s->fall;
      if (s->g < 1e-4f) s->g = 0, s->phase = 0;
      break;
    default: break;
  }
  return x * s->g;
}

static wk_c *slug_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  slug_t *s = (slug_t *)ar_alloc(a, sizeof(slug_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_SLUG, g, sr, bass, live, 1.f);
  float sens = (float)sh_clamp(wk_raw(g, "sens", 50) / 100.0, 0, 1);
  s->thr = (float)sh_db2lin(-24 - 30 * sens);
  s->rise = (float)(1.0 / (sh_clamp(wk_raw(g, "rise", 350), 5, 1500) * 0.001 * sr));
  s->fall = (float)sh_exp(sh_log(0.001) / (sh_clamp(wk_raw(g, "tail", 800), 20, 2500) * 0.001 * sr));
  s->dip = (float)sh_exp(sh_log(0.01) / (0.004 * sr));
  s->flow = wk_sw(g, "single/flow", 1, 2);
  s->quietn = (int)(0.04 * sr);
  s->pkd = (float)sh_exp(-1.0 / (3.0 * sr));
  env_set(&s->env, sr, 1, 30);
  wk_onset_init(&s->on, sr, bass, s->thr * 0.7f);
  s->c.run = slug_run;
  return &s->c;
}

/* ---------------------------------------------------------------- BLORP -- */
/* An alien mouth on a touch pad: X moves the first resonance (about 250 Hz to 1 kHz), Y the
   second (800 Hz to 3 kHz); every corner is a different vowel. Talk: the mouth stays where you
   put it. Auto: it circles round that spot at Orbit (the spot itself stays as you left it).
   Wobble: a warble in pitch (up to about half a semitone) and a little in the mouth, only
   while you play. */
typedef struct {
  wk_c c;
  env_t env;
  dl_t dl;
  svf_t f1, f2, f3;
  wk_keeper kp;
  int autom;
  float x, y, orbit, ph, wob, vph, vrate, A, D0, gate, gk;
} blorp_t;

static float blorp_run(wk_c *c, float x, float in0, float *dry) {
  blorp_t *s = (blorp_t *)c;
  float e = env_run(&s->env, x);
  s->gate += s->gk * ((e > 0.004f ? 1.f : e / 0.004f) - s->gate);
  float xd = x;
  s->vph += s->vrate;
  if (s->vph >= 1) s->vph -= 1;
  float v = sh_sin01(s->vph);
  if (s->wob > 0) {
    dl_push(&s->dl, x);
    xd = dl_tapf(&s->dl, (s->D0 + s->A * s->gate * v) * (float)c->sr);
    *dry = dl_tapf(&s->dl, s->D0 * (float)c->sr); /* the dry sound waits with it, so they don't comb */
  }
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    float px = s->x, py = s->y;
    if (s->autom) {
      s->ph += s->orbit * WK_CR;
      if (s->ph >= 1) s->ph -= 1;
      px += 0.16f * sh_sin01(s->ph + 0.25f), py += 0.13f * sh_sin01(s->ph);
      px = px < 0 ? 0 : px > 1 ? 1 : px, py = py < 0 ? 0 : py > 1 ? 1 : py;
    }
    float m = 1.f + 0.06f * s->wob * v * s->gate;
    wk_set(&s->f1, c->sr, 250.f * sh_exp2f_fast(2.f * px) * m * c->fs, 8);
    wk_set(&s->f2, c->sr, 800.f * sh_exp2f_fast(1.907f * py) * m * c->fs, 10);
  }
  float src = 0.7f * xd + 0.3f * sh_tanhf(4.f * xd);
  float y = wk_bp(&s->f1, src) + 0.8f * wk_bp(&s->f2, src) + 0.25f * wk_bp(&s->f3, src);
  return wk_keep(&s->kp, xd, y);
}

static wk_c *blorp_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  blorp_t *s = (blorp_t *)ar_alloc(a, sizeof(blorp_t));
  if (!s) return 0;
  wk_base(&s->c, WK_BLORP, g, sr, bass, live, 0.75f);
  s->x = (float)sh_clamp(wk_raw(g, "mouth x", 50) / 100.0, 0, 1);
  s->y = (float)sh_clamp(wk_raw(g, "mouth y", 50) / 100.0, 0, 1);
  s->orbit = (float)(sh_clamp(wk_raw(g, "orbit", 0.7f), 0.1, 8) / sr);
  s->wob = (float)sh_clamp(wk_raw(g, "wobble", 30) / 100.0, 0, 1);
  s->autom = wk_sw(g, "talk/auto", 0, 2);
  s->vrate = (float)(5.5 / sr);
  s->A = (float)(0.0293 * s->wob / (SH_TAU * 5.5)); /* ±50 cents at the most */
  s->D0 = (float)(0.0293 / (SH_TAU * 5.5) + 0.0004);
  if (!dl_init(&s->dl, a, (int)(sr * 0.01) + 8)) return 0;
  wk_set(&s->f3, sr, 2800 * s->c.fs, 6);
  env_set(&s->env, sr, 2, 100);
  s->gk = wk_k(sr, 0.03);
  wk_keep_init(&s->kp, sr);
  s->c.run = blorp_run;
  return &s->c;
}

/* ---------------------------------------------------------------- BOING -- */
/* A pitch jump. Hold Jump and the pitch springs to Interval over Rise; let go and it comes back
   over Fall (from wherever it got to). The Bend lever moves it by hand and springs back. With
   both, the bigger one wins. At rest you hear your own sound exactly (no delay). */
static const float BOING_IV[4] = {-12, 7, 12, 24};
typedef struct {
  wk_c c;
  wk_ps ps;
  float iv, up, dn, j, lev, lk, a, ak;
} boing_t;

static float boing_run(wk_c *c, float x, float in0, float *dry) {
  boing_t *s = (boing_t *)c;
  if (wk_held(c)) {
    s->j += s->up;
    if (s->j > 1) s->j = 1;
  } else {
    s->j -= s->dn;
    if (s->j < 0) s->j = 0;
  }
  float lt = c->live[SHP_WK_LEVER];
  lt = lt < 0 ? 0 : lt > 1 ? 1 : lt;
  s->lev += s->lk * (lt - s->lev);
  float dmd = wk_smooth(s->j);
  if (s->lev > dmd) dmd = s->lev;
  double r = sh_exp2f_fast(s->iv * dmd / 12.f);
  float y = wk_ps_run(&s->ps, x, r);
  s->a += s->ak * ((dmd > 0.0005f ? 1.f : 0.f) - s->a);
  if (s->a < 1e-5f) s->a = 0; /* at rest: exactly your own sound */
  return x + (y - x) * s->a;
}

static wk_c *boing_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  boing_t *s = (boing_t *)ar_alloc(a, sizeof(boing_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_BOING, g, sr, bass, live, 1.f);
  s->iv = BOING_IV[wk_sw(g, "interval", 2, 4)];
  s->up = (float)(1.0 / (sh_clamp(wk_raw(g, "rise", 120), 20, 1000) * 0.001 * sr));
  s->dn = (float)(1.0 / (sh_clamp(wk_raw(g, "fall", 250), 20, 1500) * 0.001 * sr));
  s->lk = wk_k(sr, 0.01);
  s->ak = wk_k(sr, 0.004);
  if (!wk_ps_init(&s->ps, a, sr, s->iv > 0 ? sh_pow(2, s->iv / 12.0) : 1)) return 0;
  s->c.run = boing_run;
  return &s->c;
}

/* ------------------------------------------------------------ CATERWAUL -- */
/* A meow on each new note: the pitch slides up (or down) by Meow semitones and back within
   Tail, while a nasal mouth glides m - ee - ah - ow with it. Purr: a fast flutter in the
   volume (about 25 a second). Hiss: breathy noise that follows your playing (never on its
   own). Meow 0 leaves only the purr and the hiss. */
static const float CAT_V[4][4] = {
    /* F1, F2, F3, mouth */
    {300, 1100, 2600, 0.35f}, /* m */
    {360, 2300, 3200, 1.f},   /* ee */
    {850, 1400, 2700, 1.f},   /* ah */
    {540, 900, 2500, 0.8f},   /* ow */
};

typedef struct {
  wk_c c;
  wk_ps ps;
  wk_onset on;
  env_t env, envh;
  svf_t f1, f2, f3, hs;
  wk_keeper kp;
  uint32_t rng;
  float meow, sign, purr, hiss, tail, ofs, ok, a, ak, fa, open, pph, prate;
} cat_t;

static float cat_run(wk_c *c, float x, float in0, float *dry) {
  cat_t *s = (cat_t *)c;
  wk_onset_run(&s->on, x);
  float t = (float)s->on.t / (float)c->sr, u = t / s->tail;
  float bump = u < 1 ? sh_sinf_fast((float)SH_PI * (float)sh_pow(u, 0.7)) : 0.f;
  s->ofs += s->ok * (s->sign * s->meow * bump - s->ofs);
  float y = wk_ps_run(&s->ps, x, sh_exp2f_fast(s->ofs / 12.f));
  s->a += s->ak * ((s->meow > 0.05f && u < 1.2f ? 1.f : 0.f) - s->a);
  if (s->a < 1e-5f) s->a = 0;
  float xs = x + (y - x) * s->a;
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    float v = 3.f * wk_smooth(u);
    int i = (int)v;
    if (i > 2) i = 2;
    float f = wk_smooth(v - i);
    const float *p = CAT_V[i], *q = CAT_V[i + 1];
    wk_set(&s->f1, c->sr, wk_lerpf(p[0], q[0], f) * c->fs, 5);
    wk_set(&s->f2, c->sr, wk_lerpf(p[1], q[1], f) * c->fs, 7);
    wk_set(&s->f3, c->sr, wk_lerpf(p[2], q[2], f) * c->fs, 8);
    s->open = p[3] + (q[3] - p[3]) * f;
  }
  float src = 0.6f * xs + 0.35f * sh_tanhf(5.f * xs);
  float mouth = (wk_bp(&s->f1, src) + 0.9f * wk_bp(&s->f2, src) + 0.4f * wk_bp(&s->f3, src)) * s->open;
  float w = wk_keep(&s->kp, x, xs + (mouth * 1.6f - xs) * s->fa);
  /* purr */
  s->pph += s->prate;
  if (s->pph >= 1) s->pph -= 1;
  w *= 1.f - 0.6f * s->purr * (0.5f + 0.5f * sh_sin01(s->pph));
  /* hiss: noise above about 3.5 kHz, as loud as the playing allows */
  float eh = env_run(&s->envh, x);
  float lp, bp, hp;
  svf_run(&s->hs, sh_randf(&s->rng), &lp, &bp, &hp);
  float eg = eh > 0.002f ? eh - 0.002f : 0.f;
  return w + hp * eg * s->hiss * 0.9f;
}

static wk_c *cat_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  cat_t *s = (cat_t *)ar_alloc(a, sizeof(cat_t));
  if (!s) return 0;
  wk_base(&s->c, WK_CATERWAUL, g, sr, bass, live, 0.75f);
  s->meow = (float)sh_clamp(wk_raw(g, "meow", 3), 0, 7);
  s->purr = (float)sh_clamp(wk_raw(g, "purr", 20) / 100.0, 0, 1);
  s->hiss = (float)sh_clamp(wk_raw(g, "hiss", 0) / 100.0, 0, 1);
  s->tail = (float)(sh_clamp(wk_raw(g, "tail", 300), 50, 1200) * 0.001);
  s->sign = wk_sw(g, "up/down", 0, 2) ? -1.f : 1.f;
  s->fa = s->meow >= 2 ? 1.f : s->meow / 2.f;
  s->ok = wk_k(sr, 0.008), s->ak = wk_k(sr, 0.006);
  s->prate = (float)(25.0 / sr);
  s->rng = 0x9e3779b9u;
  wk_onset_init(&s->on, sr, bass, 0.003f);
  env_set(&s->envh, sr, 3, 50);
  wk_set(&s->hs, sr, 3500, 0.7);
  wk_keep_init(&s->kp, sr);
  s->open = CAT_V[3][3];
  if (!wk_ps_init(&s->ps, a, sr, sh_pow(2, 7 / 12.0))) return 0;
  s->c.run = cat_run;
  return &s->c;
}

/* -------------------------------------------------------------- GREMLIN -- */
/* A synth fuzz: the note you play (one at a time) becomes three oscillators, an octave below
   (Sub), the note itself (Root) and a fifth above (Fifth), as loud as you play. Bite: from a
   round, dark buzz to a torn, bright one. Glide: how long it slides from one note to the next.
   Chords and muted strings give the synth nothing to follow: it fades and your own sound stays. */
typedef struct {
  wk_c c;
  wk_trk trk;
  svf_t lp;
  float lf, gk, amp, ak, rk, ms, msa, p0, p1, p2, sub, root, fifth, drive, dnorm;
} grem_t;

static float grem_run(wk_c *c, float x, float in0, float *dry) {
  grem_t *s = (grem_t *)c;
  wk_trk_run(&s->trk, in0);
  float lv = wk_level(&s->ms, s->msa, in0);
  if (s->trk.newnote && (s->lf <= 0 || s->amp < 0.05f)) s->lf = sh_log2f_fast(s->trk.f0); /* after a gap: no slide in */
  s->trk.newnote = 0;
  if (s->trk.valid) s->lf += s->gk * (sh_log2f_fast(s->trk.f0) - s->lf);
  float on = s->trk.valid ? 1.f : 0.f;
  s->amp += (on > s->amp ? s->ak : s->rk) * (on - s->amp);
  if (s->amp < 1e-4f && !s->trk.valid) return 0;
  float f = sh_exp2f_fast(s->lf), dt = f / (float)c->sr;
  float o0 = wk_sq(wk_adv(&s->p0, dt * 0.5f), dt * 0.5f);
  float o1 = wk_saw(wk_adv(&s->p1, dt), dt);
  float o2 = wk_saw(wk_adv(&s->p2, dt * 1.4983f), dt * 1.4983f);
  float v = (s->sub * o0 + s->root * o1 + s->fifth * o2) * 0.5f;
  v = sh_tanhf(s->drive * v) * s->dnorm;
  float lp, bp, hp;
  svf_run(&s->lp, v, &lp, &bp, &hp);
  return lp * s->amp * lv * 1.2f;
}

static wk_c *grem_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  grem_t *s = (grem_t *)ar_alloc(a, sizeof(grem_t));
  if (!s) return 0;
  wk_base(&s->c, WK_GREMLIN, g, sr, bass, live, 0.8f);
  float bite = (float)sh_clamp(wk_raw(g, "bite", 45) / 100.0, 0, 1);
  s->sub = (float)sh_clamp(wk_raw(g, "sub", 40) / 100.0, 0, 1);
  s->root = (float)sh_clamp(wk_raw(g, "root", 75) / 100.0, 0, 1);
  s->fifth = (float)sh_clamp(wk_raw(g, "fifth", 20) / 100.0, 0, 1);
  float glide = (float)sh_clamp(wk_raw(g, "glide", 45), 0, 300) * 0.001f;
  s->gk = glide < 0.0005f ? 1.f : wk_k(sr, glide / 3.0);
  s->drive = 1.f + 7.f * bite;
  s->dnorm = 1.f / sh_tanhf(s->drive * 0.6f);
  wk_set(&s->lp, sr, (900 + 6000 * sh_pow(bite, 1.5)) * s->c.fs, 0.9);
  s->ak = wk_k(sr, 0.006), s->rk = wk_k(sr, 0.05);
  s->msa = wk_k(sr, 0.015);
  wk_trk_init(&s->trk, sr, bass);
  s->c.run = grem_run;
  return &s->c;
}

/* -------------------------------------------------------------- INVADER -- */
/* A single-note synth that plays what you play. Bass: square and sub. Lead: two saws a hair
   apart. Laser: each note dives down two octaves in a zap. Step: the note, a fifth, the octave,
   a fifth, round and round. Filter: how bright (a resonant low-pass). Speed: the filter's
   sweep (Bass, Lead), the zap's length (Laser, faster = shorter) or the steps a second (Step).
   Sync: Speed snaps to the song's beat. Hold (footswitch): the synth keeps its note while you
   play over it; with no clear note when you press it, it keeps nothing. */
typedef struct {
  wk_c c;
  wk_trk trk;
  svf_t lp;
  int voice, sync, held, hprev, step;
  float speed, fc, lf, amp, ak, rk, ms, msa, hf, hamp, p0, p1, p2, lph, zt, sph, nyq;
} inv_t;

static float inv_speed(inv_t *s) {
  if (!s->sync) return s->speed;
  float bpm = s->c.live[SHP_TEMPO];
  if (!(bpm > 30 && bpm < 400)) bpm = 120;
  static const float DIV[8] = {0.25f, 0.5f, 1, 2, 3, 4, 6, 8};
  float beat = bpm / 60.f, best = DIV[0];
  for (int i = 1; i < 8; i++)
    if (sh_fabsf(sh_log2f_fast(s->speed / (beat * DIV[i]))) < sh_fabsf(sh_log2f_fast(s->speed / (beat * best)))) best = DIV[i];
  return beat * best;
}

static float inv_run(wk_c *c, float x, float in0, float *dry) {
  inv_t *s = (inv_t *)c;
  wk_trk_run(&s->trk, in0);
  float lv = wk_level(&s->ms, s->msa, in0);
  int h = wk_held(c);
  if (h && !s->hprev) { /* Hold pressed: keep this note, if there is one */
    s->held = s->trk.valid && s->amp > 0.3f;
    s->hf = s->lf, s->hamp = lv;
  }
  if (!h) s->held = 0;
  s->hprev = h;
  float sp = inv_speed(s);
  if (s->trk.newnote) {
    s->zt = 0;
    if (s->lf <= 0 || s->amp < 0.05f) s->lf = sh_log2f_fast(s->trk.f0);
  }
  s->trk.newnote = 0;
  if (s->trk.valid) s->lf += 0.25f * (sh_log2f_fast(s->trk.f0) - s->lf);
  float on = s->held || s->trk.valid ? 1.f : 0.f;
  s->amp += (on > s->amp ? s->ak : s->rk) * (on - s->amp);
  float lev = s->held ? s->hamp : lv;
  float lf = s->held ? s->hf : s->lf;
  if (s->amp < 1e-4f && !on) return 0;
  float semis = 0;
  s->lph += sp / (float)c->sr;
  if (s->lph >= 1) s->lph -= 1;
  float cut = s->fc;
  if (s->voice == 2) { /* laser: a dive on each note */
    float T = 0.5f / sp;
    T = T < 0.03f ? 0.03f : T > 2.f ? 2.f : T;
    s->zt += 1.f / (float)c->sr;
    float u = s->zt / T;
    if (u < 1) semis = 24.f * (1 - u) * (1 - u);
  } else if (s->voice == 3) { /* step: 0, +7, +12, +7 */
    static const float PAT[4] = {0, 7, 12, 7};
    s->sph += sp / (float)c->sr;
    if (s->sph >= 1) s->sph -= 1, s->step = (s->step + 1) & 3;
    semis = PAT[s->step];
  } else {
    cut *= sh_exp2f_fast(0.9f * sh_sin01(s->lph));
  }
  float f = sh_exp2f_fast(lf + semis / 12.f), dt = f / (float)c->sr;
  if (dt > 0.45f) dt = 0.45f;
  float v;
  switch (s->voice) {
    case 0: v = 0.6f * wk_sq(wk_adv(&s->p0, dt), dt) + 0.5f * wk_sq(wk_adv(&s->p1, dt * 0.5f), dt * 0.5f); break;
    case 1: {
      float d1 = dt * 1.00405f, d2 = dt * 0.99596f; /* ±7 cents */
      v = 0.5f * wk_saw(wk_adv(&s->p0, d1), d1) + 0.5f * wk_saw(wk_adv(&s->p1, d2), d2);
      break;
    }
    case 2: v = 0.7f * wk_saw(wk_adv(&s->p0, dt), dt) + 0.3f * wk_sq(wk_adv(&s->p1, dt), dt); break;
    default: v = 0.8f * wk_sq(wk_adv(&s->p0, dt), dt); break;
  }
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    wk_set(&s->lp, c->sr, cut < s->nyq ? cut : s->nyq, 3.0);
  }
  float lp, bp, hp;
  svf_run(&s->lp, v, &lp, &bp, &hp);
  return sh_tanhf(lp * 0.9f) * s->amp * lev * 1.4f;
}

static wk_c *inv_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  inv_t *s = (inv_t *)ar_alloc(a, sizeof(inv_t));
  if (!s) return 0;
  wk_base(&s->c, WK_INVADER, g, sr, bass, live, 0.8f);
  s->voice = wk_sw(g, "voice", 1, 4);
  s->fc = (float)sh_clamp(wk_raw(g, "filter", 1800), 150, 8000);
  s->speed = (float)sh_clamp(wk_raw(g, "speed", 2), 0.25, 12);
  s->sync = wk_sw(g, "sync", 0, 2);
  s->nyq = (float)(sr * 0.45);
  s->ak = wk_k(sr, 0.005), s->rk = wk_k(sr, 0.06);
  s->msa = wk_k(sr, 0.015);
  wk_trk_init(&s->trk, sr, bass);
  s->c.run = inv_run;
  return &s->c;
}

/* ------------------------------------------------------------- CONFETTI -- */
/* Echoes that change pitch every time they come round: at +12 each repeat is an octave above
   the last; at -5 they fall. Echo: the time between repeats. Chaos: more repeats (feedback
   0.15 to 0.75) and a gentle random drift in their time and pitch. Burst (held): the repeats
   build up toward a wash (feedback eases up to 0.88) and settle back when you let go. The
   loop is filtered and rounded off every time round, so it can never run away. */
typedef struct {
  wk_c c;
  dl_t dl;
  wk_ps ps;
  op_t damp;
  uint32_t rng;
  float semis, echo, fb, fb0, uk, dk, chaos, snh[2], snhs[2], sk, sph, srate;
} conf_t;

static float conf_run(wk_c *c, float x, float in0, float *dry) {
  conf_t *s = (conf_t *)c;
  float want = wk_held(c) ? 0.88f : s->fb0;
  s->fb += (want > s->fb ? s->uk : s->dk) * (want - s->fb);
  s->sph += s->srate;
  if (s->sph >= 1) s->sph -= 1, s->snh[0] = sh_randf(&s->rng), s->snh[1] = sh_randf(&s->rng);
  s->snhs[0] += s->sk * (s->snh[0] - s->snhs[0]);
  s->snhs[1] += s->sk * (s->snh[1] - s->snhs[1]);
  float d = s->echo * (1.f + 0.08f * s->chaos * s->snhs[0]);
  float rd = dl_tapf(&s->dl, d * (float)c->sr);
  float sh = wk_ps_run(&s->ps, rd, sh_exp2f_fast((s->semis + 0.3f * s->chaos * s->snhs[1]) / 12.f));
  float lp = op_lp(&s->damp, sh);
  float loop = sh_tanhf(lp * 1.2f) * 0.8333f;
  dl_push(&s->dl, x + s->fb * loop);
  return loop;
}

static wk_c *conf_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  conf_t *s = (conf_t *)ar_alloc(a, sizeof(conf_t));
  if (!s) return 0;
  wk_base(&s->c, WK_CONFETTI, g, sr, bass, live, 0.35f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 35) / 100.0, 0, 1); /* echoes on top of the dry sound */
  s->semis = (float)sh_clamp(wk_raw(g, "pitch", 7), -12, 12);
  s->echo = (float)(sh_clamp(wk_raw(g, "echo", 240), 60, 800) * 0.001);
  s->chaos = (float)sh_clamp(wk_raw(g, "chaos", 25) / 100.0, 0, 1);
  s->fb = s->fb0 = 0.15f + 0.6f * s->chaos;
  s->uk = wk_k(sr, 0.15), s->dk = wk_k(sr, 0.3);
  s->sk = wk_k(sr, 0.2), s->srate = (float)(4.0 / sr);
  s->rng = 0x2545f491u;
  op_lp_set(&s->damp, sr, 4500 * s->c.fs);
  if (!dl_init(&s->dl, a, (int)(sr * 0.8 * 1.1) + 64)) return 0;
  /* the shifter adds its own short wait; take it off the echo time */
  if (!wk_ps_init(&s->ps, a, sr, s->semis > 0 ? sh_pow(2, (s->semis + 0.3) / 12.0) : 1)) return 0;
  s->echo -= (float)((s->ps.dmin + s->ps.dmax) * 0.5 / sr);
  if (s->echo < 0.02f) s->echo = 0.02f;
  s->c.run = conf_run;
  return &s->c;
}

/* -------------------------------------------------------------- BLENDER -- */
/* Slices of what you just played, Size long. Chop: each slice plays twice in a row, a stutter.
   Reverse: each slice plays backwards. Scatter: slices from anywhere in the last second and a
   half, each a little sharp or flat. Jam (held): stops listening, so it keeps chopping what it
   already has while you play over it; let go and it picks up the live playing again. Mix is
   the knob on the pedal. Reverse and Chop come out a slice late by nature (about Size). */
typedef struct {
  double pos, rate;
  int age, len, on;
} wk_grain;

typedef struct {
  wk_c c;
  float *buf;
  int len, w, mode, G, hop, cnt2, n, fade, jam, seam;
  double anchor;
  uint32_t rng;
  wk_grain gr[2];
  int next;
} blend_t;

static inline float bl_read(const blend_t *s, double p) {
  int i = (int)p;
  if (p < i) --i;
  float f = (float)(p - i);
  i %= s->len;
  if (i < 0) i += s->len;
  int j = i + 1 == s->len ? 0 : i + 1;
  return s->buf[i] + (s->buf[j] - s->buf[i]) * f;
}

static float blend_run(wk_c *c, float x, float in0, float *dry) {
  blend_t *s = (blend_t *)c;
  int jam = wk_held(c);
  if (s->jam && !jam) { /* let go of Jam: the old slice and the new playing meet with a short fade each side */
    for (int k = 1; k <= s->fade; k++) {
      int i = s->w - k;
      if (i < 0) i += s->len;
      s->buf[i] *= (float)(k - 1) / s->fade;
    }
    s->seam = s->fade;
  }
  s->jam = jam;
  if (!jam) {
    float v = x;
    if (s->seam > 0) v *= 1.f - (float)s->seam-- / s->fade;
    s->buf[s->w] = v, s->w = s->w + 1 == s->len ? 0 : s->w + 1;
  }
  double now = s->w; /* the newest sample is now - 1 */
  if (--s->cnt2 <= 0) {
    s->cnt2 = s->hop;
    wk_grain *g = &s->gr[s->next];
    s->next = (s->next + 1) & 1;
    g->on = 1, g->age = 0, g->len = s->G, g->rate = 1;
    if (s->mode == 0) { /* chop: a new slice every other time */
      if ((s->n++ & 1) == 0) s->anchor = now - s->G - 1;
      g->pos = s->anchor;
    } else if (s->mode == 1) { /* reverse */
      g->pos = now - 1, g->rate = -1;
    } else { /* scatter */
      double span = s->len - 3.0 * s->G;
      if (span > 1.5 * s->c.sr) span = 1.5 * s->c.sr;
      double back = 1.1 * s->G + (0.5 + 0.5 * sh_randf(&s->rng)) * span;
      g->pos = now - back;
      g->rate = sh_exp2f_fast(0.04f * sh_randf(&s->rng)); /* up to about half a semitone */
    }
  }
  float y = 0;
  for (int k = 0; k < 2; k++) {
    wk_grain *g = &s->gr[k];
    if (!g->on) continue;
    float t = (float)g->age / g->len, wv;
    if (s->mode == 0) { /* chop: hard edges with short fades, one slice after the other */
      int a = g->age, b = g->len - g->age;
      wv = a < s->fade ? (float)a / s->fade : b < s->fade ? (float)b / s->fade : 1.f;
    } else
      wv = 0.5f - 0.5f * sh_sin01(t + 0.25f); /* Hann: two at a time add up to one */
    y += bl_read(s, g->pos + g->age * g->rate) * wv;
    if (++g->age >= g->len) g->on = 0;
  }
  return y;
}

static wk_c *blend_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  blend_t *s = (blend_t *)ar_alloc(a, sizeof(blend_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_BLENDER, g, sr, bass, live, 0.5f);
  s->mode = wk_sw(g, "mode", 0, 3);
  s->G = (int)(sh_clamp(wk_raw(g, "size", 90), 20, 250) * 0.001 * sr);
  s->hop = s->mode == 0 ? s->G : s->G / 2;
  s->fade = (int)(0.003 * sr);
  s->len = (int)(2.2 * sr);
  s->rng = 0x1234567u;
  s->buf = (float *)ar_alloc(a, sizeof(float) * s->len);
  if (!s->buf) return 0;
  s->c.run = blend_run;
  return &s->c;
}

/* --------------------------------------------------------------- FOSSIL -- */
/* Freezes what you're playing into a drone. Press Capture and the last half second becomes a
   steady sound that fades in over Fade; it is played by many short overlapping pieces taken
   from random places in it, so it never loops or buzzes. Hold: the drone lasts while you hold
   Capture. Latch: one press captures, the next lets go, the next captures again. Level: how
   loud the drone is under your own playing, which carries on as normal. Nothing is saved: a
   new tone (or turning a knob) starts empty. */
#define FOS_V 4
typedef struct {
  float *seg;
  float g, gt;
  int on;
  int age[FOS_V], pos[FOS_V];
} fos_layer;

typedef struct {
  wk_c c;
  float *buf;
  int len, w, C, L, hop, cnt2, latch, prev, cur, latched;
  uint32_t rng;
  float lvl, step;
  fos_layer ly[2];
} fossil_t;

static void fos_capture(fossil_t *s) {
  /* the quieter of the two drones makes room (usually one that has already faded out) */
  int i = !s->ly[0].on ? 0 : !s->ly[1].on ? 1 : s->ly[0].g < s->ly[1].g ? 0 : 1;
  s->cur = i;
  fos_layer *l = &s->ly[s->cur];
  l->g = 0;
  int start = s->w - s->C;
  if (start < 0) start += s->len;
  int first = s->len - start < s->C ? s->len - start : s->C;
  sh_memcpy(l->seg, s->buf + start, sizeof(float) * first);
  if (first < s->C) sh_memcpy(l->seg + first, s->buf, sizeof(float) * (s->C - first));
  l->on = 1, l->gt = 1;
  for (int k = 0; k < FOS_V; k++) l->age[k] = -k * s->hop, l->pos[k] = (int)((0.5f + 0.5f * sh_randf(&s->rng)) * (s->C - s->L - 1));
  s->ly[s->cur ^ 1].gt = 0; /* an older drone fades out under the new one */
}

static float fossil_run(wk_c *c, float x, float in0, float *dry) {
  fossil_t *s = (fossil_t *)c;
  s->buf[s->w] = x;
  s->w = s->w + 1 == s->len ? 0 : s->w + 1;
  int h = wk_held(c);
  if (h && !s->prev) {
    if (!s->latch || !s->latched) fos_capture(s), s->latched = 1;
    else s->ly[s->cur].gt = 0, s->latched = 0;
  }
  if (!h && s->prev && !s->latch) s->ly[s->cur].gt = 0, s->latched = 0;
  s->prev = h;
  float y = 0;
  for (int i = 0; i < 2; i++) {
    fos_layer *l = &s->ly[i];
    if (!l->on) continue;
    if (l->g < l->gt) l->g = l->g + s->step > l->gt ? l->gt : l->g + s->step;
    else if (l->g > l->gt) l->g = l->g - s->step < l->gt ? l->gt : l->g - s->step;
    if (l->g <= 0 && l->gt <= 0) {
      l->on = 0;
      continue;
    }
    float v = 0;
    for (int k = 0; k < FOS_V; k++) {
      int a = l->age[k]++;
      if (a < 0) continue;
      if (a >= s->L) { /* a new piece from a random place */
        a = l->age[k] = 0;
        l->pos[k] = (int)((0.5f + 0.5f * sh_randf(&s->rng)) * (s->C - s->L - 1));
      }
      float t = (float)a / s->L;
      v += l->seg[l->pos[k] + a] * (0.5f - 0.5f * sh_sin01(t + 0.25f));
    }
    y += v * 0.5f * l->g; /* four Hann pieces a quarter apart add up to two */
  }
  return y * s->lvl;
}

static wk_c *fossil_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  fossil_t *s = (fossil_t *)ar_alloc(a, sizeof(fossil_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_FOSSIL, g, sr, bass, live, 1.f);
  s->c.add = 1, s->c.gd = 1, s->c.gw = 1;
  float db = wk_raw(g, "level", -9);
  s->lvl = db <= -59.5f ? 0.f : (float)sh_db2lin(sh_clamp(db, -60, 0));
  s->step = (float)(1.0 / (sh_clamp(wk_raw(g, "fade", 350), 30, 2000) * 0.001 * sr));
  s->latch = wk_sw(g, "hold/latch", 0, 2);
  s->len = (int)(1.0 * sr);
  s->C = (int)(0.6 * sr);
  s->L = (int)((bass ? 0.2 : 0.14) * sr);
  s->hop = s->L / FOS_V;
  s->rng = 0x7f4a7c15u;
  s->buf = (float *)ar_alloc(a, sizeof(float) * s->len);
  s->ly[0].seg = (float *)ar_alloc(a, sizeof(float) * s->C);
  s->ly[1].seg = (float *)ar_alloc(a, sizeof(float) * s->C);
  if (!s->buf || !s->ly[0].seg || !s->ly[1].seg) return 0;
  s->cur = 1;
  s->c.run = fossil_run;
  return &s->c;
}

/* -------------------------------------------------------------- CHARMER -- */
/* Sitar-like (not a model of a sitar): a bright buzz like a string on a flat bridge, a short
   metallic ring, and drone strings tuned to Key that ring along when your notes hit them
   (root, third, fifth, octave, octave and fifth). Buzz: how much buzz and ring. Drone: how
   loud the drone strings are; they only ring from your playing and die away when you stop.
   Min/Maj picks the third. Shift moves the key by semitones for the sharps and flats. */
#define CH_RES 5
typedef struct {
  wk_c c;
  env_t env;
  op_t hp, jlp;
  dl_t comb;
  wk_keeper kp;
  float buzz, drone, cg, ctap;
  float rc[CH_RES], rr[CH_RES], rb[CH_RES], ry1[CH_RES], ry2[CH_RES], rgain[CH_RES];
  op_t exh;
} charm_t;

static float charm_run(wk_c *c, float x, float in0, float *dry) {
  charm_t *s = (charm_t *)c;
  float e = env_run(&s->env, x);
  float h = op_hp(&s->hp, x);
  float jaw = sh_tanhf(6.f * h / (e + 0.005f)) * e; /* the bridge buzz: the note squared up */
  jaw -= op_lp(&s->jlp, jaw);                       /* only its bright part */
  float main = x + s->buzz * 0.9f * jaw;
  float cm = main + s->cg * dl_tapf(&s->comb, s->ctap);
  dl_push(&s->comb, cm);
  float y = wk_keep(&s->kp, x, cm);
  /* the drone strings */
  float ex = op_hp(&s->exh, x);
  float d = 0;
  for (int i = 0; i < CH_RES; i++) {
    float r = s->rb[i] * ex + s->rc[i] * s->ry1[i] - s->rr[i] * s->ry2[i];
    s->ry2[i] = s->ry1[i], s->ry1[i] = r;
    d += r * s->rgain[i];
  }
  return y + wk_soft(d * s->drone * 2.f);
}

static wk_c *charm_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  charm_t *s = (charm_t *)ar_alloc(a, sizeof(charm_t));
  if (!s) return 0;
  wk_base(&s->c, WK_CHARMER, g, sr, bass, live, 0.7f);
  static const int KEY[7] = {0, 2, 4, 5, 7, 9, 11};
  int key = KEY[wk_sw(g, "key", 1, 7)];
  float sv = wk_raw(g, "shift", 0);
  int shift = (int)sh_clamp(sv + (sv < 0 ? -0.5f : 0.5f), -6, 6);
  int third = wk_sw(g, "min/maj", 0, 2) ? 4 : 3;
  s->buzz = (float)sh_clamp(wk_raw(g, "buzz", 40) / 100.0, 0, 1);
  s->drone = (float)sh_clamp(wk_raw(g, "drone", 25) / 100.0, 0, 1);
  int root = (bass ? 36 : 48) + key + shift; /* C2/C3 and up */
  const int iv[CH_RES] = {0, third, 7, 12, 19};
  const float lvl[CH_RES] = {1, 0.7f, 0.8f, 0.7f, 0.45f};
  for (int i = 0; i < CH_RES; i++) {
    double f = 440.0 * sh_pow(2, (root + iv[i] - 69) / 12.0);
    double t60 = 2.4;
    double r = sh_pow(10, -3.0 / (t60 * sr));
    s->rc[i] = (float)(2 * r * sh_cos(SH_TAU * f / sr));
    s->rr[i] = (float)(r * r);
    s->rb[i] = (float)((1 - r) * 2 * sh_sin(SH_TAU * f / sr)); /* a peak of one at its note */
    s->rgain[i] = lvl[i];
  }
  s->cg = 0.38f * s->buzz;
  s->ctap = (float)(0.0011 * sr);
  if (!dl_init(&s->comb, a, (int)(sr * 0.004) + 8)) return 0;
  op_lp_set(&s->hp, sr, 250 * s->c.fs);
  op_lp_set(&s->jlp, sr, 1200);
  op_lp_set(&s->exh, sr, 70);
  env_set(&s->env, sr, 1, 60);
  wk_keep_init(&s->kp, sr);
  s->c.run = charm_run;
  return &s->c;
}

/* ---------------------------------------------------------------- HAUNT -- */
/* Organ-like (an octave blend, not a real organ): Low adds an octave below, Mid your own
   note, High an octave above, like an organ's drawbars, rounded off, evened out and with the
   pick's click softened. Then a spinning speaker: the top and the bottom turn at their own
   speeds, Slow (about 0.8 a second) or Fast (about 5), and take a moment to speed up or slow
   down, like the real thing. Spin: how deep the swirl is. The pedal chain before the rack is
   mono in Stagehand, so the swirl is heard as the throb and warble of the speaker, not as
   left and right. */
typedef struct {
  wk_c c;
  wk_ps dn, up;
  wk_keeper kp;
  wk_onset on;
  svf_t xo;
  dl_t dl;
  float lo, mid, hi, spin, hs, ds, hph, dph, hk, dk, att, ak;
  int fast;
} haunt_t;

static float haunt_run(wk_c *c, float x, float in0, float *dry) {
  haunt_t *s = (haunt_t *)c;
  if (wk_onset_run(&s->on, x)) s->att = 0.35f;
  s->att += s->ak * (1.f - s->att);
  float dn = s->lo > 0 ? wk_ps_run(&s->dn, x, 0.5) : 0.f;
  float up = s->hi > 0 ? wk_ps_run(&s->up, x, 2.0) : 0.f;
  float v = s->lo * dn + s->mid * x + s->hi * up;
  v = sh_tanhf(1.5f * v) * 0.6667f;
  v = wk_keep(&s->kp, x, v) * s->att;
  /* the speaker */
  int fast = wk_latched(c);
  s->hs += s->hk * ((fast ? 5.0f : 0.8f) - s->hs);
  s->ds += s->dk * ((fast ? 4.3f : 0.67f) - s->ds);
  s->hph += s->hs / (float)c->sr;
  if (s->hph >= 1) s->hph -= 1;
  s->dph += s->ds / (float)c->sr;
  if (s->dph >= 1) s->dph -= 1;
  float lp, bp, hp;
  svf_run(&s->xo, v, &lp, &bp, &hp);
  float hsin = sh_sin01(s->hph);
  dl_push(&s->dl, hp);
  float horn = dl_tapf(&s->dl, (float)c->sr * (0.0006f + 0.00035f * s->spin * hsin)) * (1.f - 0.75f * s->spin * (0.5f + 0.5f * hsin));
  float drum = lp * (1.f - 0.45f * s->spin * (0.5f + 0.5f * sh_sin01(s->dph)));
  return horn + drum;
}

static wk_c *haunt_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  haunt_t *s = (haunt_t *)ar_alloc(a, sizeof(haunt_t));
  if (!s) return 0;
  wk_base(&s->c, WK_HAUNT, g, sr, bass, live, 0.8f);
  s->lo = (float)sh_clamp(wk_raw(g, "low", 60) / 100.0, 0, 1);
  s->mid = (float)sh_clamp(wk_raw(g, "mid", 80) / 100.0, 0, 1);
  s->hi = (float)sh_clamp(wk_raw(g, "high", 30) / 100.0, 0, 1);
  s->spin = (float)sh_clamp(wk_raw(g, "spin", 35) / 100.0, 0, 1);
  s->fast = wk_latched(&s->c);
  s->hs = s->fast ? 5.0f : 0.8f, s->ds = s->fast ? 4.3f : 0.67f; /* a new tone starts at speed */
  s->hk = wk_k(sr, 0.2), s->dk = wk_k(sr, 0.35);             /* about 0.6 s and 1 s to get there */
  s->att = 1, s->ak = wk_k(sr, 0.012);
  wk_onset_init(&s->on, sr, bass, 0.004f);
  wk_set(&s->xo, sr, 800 * s->c.fs, 0.6);
  wk_keep_init(&s->kp, sr);
  if (!dl_init(&s->dl, a, (int)(sr * 0.003) + 8)) return 0;
  if (!wk_ps_init(&s->dn, a, sr, 1) || !wk_ps_init(&s->up, a, sr, 2)) return 0;
  s->c.run = haunt_run;
  return &s->c;
}

#include "sh_labcore.h"
#include "sh_lab1.h"
#include "sh_lab2.h"
#include "sh_lab3.h"

/* -------------------------------------------------------------- the block -- */
static void wacky_proc(sh_block *b, float *L, float *R, int n) {
  wk_c *c = (wk_c *)b->st;
  if (b->meas) return; /* the tone's loudness is matched on the dry sound */
  float fx = c->kind == WK_CONFETTI ? (b->fxscale < 2 ? b->fxscale : 2) : 1; /* echoes follow the FX knob */
  if (c->kind >= WK_ANNWN) {
    c->word = (int)c->live[SHP_LABW0 + c->kind];
    c->rise = c->word & ~c->wprev, c->wprev = c->word;
    c->lval = c->live[SHP_LABV0 + c->kind];
  }
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float x0 = b->in0 ? b->in0[i] : x;
    float dry = x;
    float y = c->run(c, x, x0, &dry);
    c->rise = 0; /* a press counts once */
    /* no rumble or offset under the effect, nothing wild out of it */
    if (!c->clean) {
      float lc, bp, hp;
      svf_run(&c->lowcut, y, &lc, &bp, &hp);
      y = hp;
    }
    y = wk_soft(y);
    if (!(sh_fabsf(y) < 4.f)) y = 0; /* never pass on a broken number */
    float o = c->gw <= 0 && !c->own ? x : c->add ? dry + y * c->gw * fx : dry * c->gd + y * c->gw; /* Mix 0: the input, untouched */
    o *= c->trim;
    L[i] = o;
    if (R) R[i] = o;
  }
}

/* the whole name (Pedal_Long is not Pedal_Longer), any case */
static int wk_eq(const char *a, const char *b) {
  for (; *a && *b; a++, b++) {
    char x = *a >= 'A' && *a <= 'Z' ? *a + 32 : *a, y = *b >= 'A' && *b <= 'Z' ? *b + 32 : *b;
    if (x != y) return 0;
  }
  return *a == *b;
}

int wacky_kind(const char *key) {
  for (int k = 1; k < WK_COUNT; k++)
    if (wk_eq(key, WK_KEYS[k])) return k;
  return 0;
}

int wacky_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  wk_c *c = 0;
  switch (wacky_kind(g->key)) {
    case WK_QUACK: c = quack_build(g, a, sr, bass, live); break;
    case WK_CROAK: c = croak_build(g, a, sr, bass, live); break;
    case WK_CATERWAUL: c = cat_build(g, a, sr, bass, live); break;
    case WK_BLORP: c = blorp_build(g, a, sr, bass, live); break;
    case WK_GOBBLE: c = gobble_build(g, a, sr, bass, live); break;
    case WK_SLUG: c = slug_build(g, a, sr, bass, live); break;
    case WK_BOING: c = boing_build(g, a, sr, bass, live); break;
    case WK_GREMLIN: c = grem_build(g, a, sr, bass, live); break;
    case WK_INVADER: c = inv_build(g, a, sr, bass, live); break;
    case WK_CONFETTI: c = conf_build(g, a, sr, bass, live); break;
    case WK_BLENDER: c = blend_build(g, a, sr, bass, live); break;
    case WK_FOSSIL: c = fossil_build(g, a, sr, bass, live); break;
    case WK_CHARMER: c = charm_build(g, a, sr, bass, live); break;
    case WK_HAUNT: c = haunt_build(g, a, sr, bass, live); break;
    case WK_NOTHING: /* nothing at all: no processing, no delay, not even a low cut */
      b->st = 0, b->process = nothing_proc, b->name = "nothing";
      return 1;
    default:
      if (wacky_kind(g->key) >= WK_ANNWN) c = lab_build(wacky_kind(g->key), g, a, sr, bass, live);
      break;
  }
  if (!c || a->failed) return 0;
  b->st = c, b->process = wacky_proc, b->name = WK_KEYS[c->kind] + 6;
  return 1;
}
