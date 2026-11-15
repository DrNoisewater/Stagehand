/*
 * The wacky pedals: Quack (a duck), Croak (a frog), Caterwaul (a cat) and Blorp (an alien).
 * Each one listens to what you play: a new note starts its call, and the note's own loudness
 * carries it, so it follows your picking like a real envelope pedal. Nothing is a recording.
 * Every pedal has a Blend knob: at 0 you hear only your own sound, untouched.
 *
 * Included once, by sh_fx.c, so the build lists stay as they are.
 */

#define WK_CR 8 /* the filters move every 8 samples */

/* --------------------------------------------------------------- shared -- */

/* Finds the start of each note: a jump in loudness, or the click of a new pick (a burst of
   treble over the ringing string, which catches notes picked again at the same loudness). */
typedef struct {
  env_t fast, slow, hfast, hslow;
  svf_t hp;
  int armed, harmed, holdn, hold;
  int t; /* samples since the last new note */
} wk_onset;

static void wk_onset_init(wk_onset *o, double sr, int bass) {
  env_set(&o->fast, sr, 0.5, 30);
  env_set(&o->slow, sr, 40, 400);
  env_set(&o->hfast, sr, 0.3, 12);
  env_set(&o->hslow, sr, 25, 150);
  svf_set(&o->hp, sr, bass ? 1000 : 1500, 0.7);
  o->hold = (int)(sr * 0.07);
  o->armed = o->harmed = 1;
  o->t = 1 << 28;
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
  if (!o->holdn) {
    if (o->armed && f > 0.004f && f > 1.6f * s + 0.0015f) hit = 1;
    else if (o->harmed && hf > 0.002f && hf > 0.04f * f && hf > 2.5f * hs + 0.0005f) hit = 1;
  }
  if (hit) o->armed = o->harmed = 0, o->holdn = o->hold, o->t = 0;
  return hit;
}

/* The note squared up into a buzzy voice at the note's own loudness (it never lifts the hiss
   between notes: quiet input stays quiet). */
static inline float wk_buzz(float x, float env, float drive) { return sh_tanhf(drive * x / (env + 0.003f)) * env; }

/* a richer voice for the talking pedals: squared up and a little lopsided, so it has every
   harmonic (odd and even) for the mouth to shape; the offset this leaves is filtered out later */
static inline float wk_voice(float x, float env, float lvl, float drive) {
  float u = drive * (x / (env + 0.003f) + 0.3f); /* off centre: a narrow pulse, every harmonic */
  return sh_tanhf(u) * lvl;
}

/* the playing's average level (not its peaks), so a chord is no louder through the voice
   than one note at the same loudness */
static inline float wk_level(float *ms, float a, float x) {
  *ms += a * (x * x - *ms);
  return 1.414f * sh_sqrtf(*ms);
}

/* band-pass with a peak of 1 */
static inline float wk_bp(svf_t *f, float x) {
  float lp, bp, hp;
  svf_run(f, x, &lp, &bp, &hp);
  return f->k * bp;
}

static inline void wk_set(svf_t *f, double sr, double hz, double q) {
  if (hz < 25) hz = 25;
  svf_set(f, sr, hz, q);
}

/* only very loud peaks are rounded off; anything normal passes untouched */
static inline float wk_soft(float y) {
  float a = sh_fabsf(y);
  if (a <= 0.8f) return y;
  float s = 0.8f + 0.4f * sh_tanhf((a - 0.8f) * 2.5f);
  return y < 0 ? -s : s;
}

static inline float wk_smooth(float t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
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

enum { WK_QUACK = 1, WK_CROAK, WK_CATERWAUL, WK_BLORP };

typedef struct {
  int kind, bass, cnt;
  double sr;
  float gd, gw, fs;
  wk_onset on;
  env_t env, env2;
  op_t dc, tilt;
  svf_t lowcut;
  svf_t f1, f2, f3, f4;
  uint32_t rng;
  float ph, ph2, rate, depth, s, open, aw, ms, msa;
  float lin, lout, la, lg, lgs, lga, lgr; /* the level keeper */
  /* the knobs, 0..1 */
  float k1, k2;
  /* quack */
  float q1, q2, nas, drive, tau, makeup;
  bq_t notch;
  /* croak */
  svf_t divlp, sublp;
  env_t envlp;
  float sq, pos, rboost, rdec, subamt;
  /* caterwaul */
  dl_t dl;
  float eps, tm, A, rest, av, vibph;
  /* blorp */
  float cph, cf0, cdep, snh, snhs, snhrate, snhph, slew, vb, sw, swdec;
} wk_t;

/* The voices keep the playing's own loudness: low notes or high, one note or a chord, the
   effect comes out as loud as what went in. Both levels rise quickly and fall slowly, and the
   gain comes down fast, so a new note never jumps out. */
static inline float wk_keep(wk_t *w, float x, float y) {
  float xx = x * x, yy = y * y;
  w->lin += (xx > w->lin ? w->lga : w->la) * (xx - w->lin);
  w->lout += (yy > w->lout ? w->lga : w->la) * (yy - w->lout);
  float g = sh_sqrtf((w->lin + 1e-12f) / (w->lout + 1e-10f));
  w->lg = g > 20.f ? 20.f : g;
  w->lgs += (w->lg < w->lgs ? w->lgr : w->lga) * (w->lg - w->lgs);
  return y * w->lgs;
}

/* ---------------------------------------------------------------- QUACK -- */
/* A duck's "wa-ack": the note becomes a buzzy, nasal voice whose mouth (two vocal resonances)
   snaps open on each new note and closes downward, with a fixed nasal honk on top and the
   hollow notch a nose adds. Beak: how sharp, fast and nasal the quack is. Wobble: a warble
   on the quack, slow and gentle to fast and wide. */
static void quack_set(wk_t *w) {
  float b = w->k1, wb = w->k2;
  w->q1 = 3.f + 9.f * b, w->q2 = 4.f + 10.f * b;
  w->nas = 0.35f;
  w->drive = 15.f + 25.f * b;
  w->tau = 0.18f - 0.13f * b; /* seconds for the beak to close */
  w->rate = (float)((3.0 + 7.0 * wb) / w->sr);
  w->depth = 0.6f * wb;
  w->makeup = 1;
  wk_set(&w->f3, w->sr, 1500 * w->fs, 6 + 4 * b);
  bq_set(&w->notch, BQ_NOTCH, w->sr, 720 * w->fs, 1.6, 0);
  w->rdec = (float)sh_exp(-WK_CR / (w->tau * w->sr));
  w->swdec = (float)(1 - sh_exp(-WK_CR / (0.004 * w->sr))); /* the beak opens in about 4 ms */
}

static float quack_run(wk_t *w, float x) {
  if (wk_onset_run(&w->on, x)) w->s = 1;
  float e = env_run(&w->env, x);
  float lv = wk_level(&w->ms, w->msa, x);
  float src = op_hp(&w->tilt, wk_voice(x, e, lv, w->drive)); /* brighter voice: the mouth shows */
  if (--w->cnt <= 0) {
    w->cnt = WK_CR;
    w->open += w->swdec * (w->s - w->open);
    w->s *= w->rdec;
    w->ph += w->rate * WK_CR;
    if (w->ph >= 1) w->ph -= 1;
    float lfo = sh_sin01(w->ph);
    float mul = sh_exp2f_fast(w->depth * lfo);
    float p = w->open;
    wk_set(&w->f1, w->sr, (350 + 900 * p) * w->fs * mul, w->q1);
    wk_set(&w->f2, w->sr, (800 + 2200 * p) * w->fs * mul, w->q2);
    w->aw = 1.f - 0.3f * w->k2 * (0.5f + 0.5f * lfo);
  }
  float y = wk_bp(&w->f1, src) + 0.75f * wk_bp(&w->f2, src) + w->nas * wk_bp(&w->f3, src);
  y = bq_run(&w->notch, y);
  return y * w->makeup * w->aw;
}

/* ---------------------------------------------------------------- CROAK -- */
/* A frog's croak: the note one octave down (the old analog way: a flip-flop on the note's
   zero crossings), mixed with a buzzy copy, through a throat resonance, then chopped into a
   train of fast pulses (the "rrrr" of a croak). Each new note restarts the croak a little
   faster, settling as it rings ("rib-bit"). Throat: a bigger, lower throat with more of the
   octave down. Hop: how fast the pulses come, from a slow chug to a fast buzz. */
static void croak_set(wk_t *w) {
  float th = w->k1, hop = w->k2;
  w->rate = (float)((12.0 + 33.0 * hop) / w->sr);
  w->depth = 0.88f;
  w->subamt = (0.35f + 0.9f * th) * (w->bass ? 0.6f : 1.f);
  wk_set(&w->divlp, w->sr, (w->bass ? 160 : 280), 0.7);
  wk_set(&w->sublp, w->sr, (w->bass ? 350 : 600), 0.7);
  wk_set(&w->f1, w->sr, (720 - 470 * th) * w->fs, 2.5 + 4 * th);
  w->rdec = (float)sh_exp(-1.0 / (0.15 * w->sr));
  w->makeup = 1.f;
  w->sq = 1;
}

static float croak_run(wk_t *w, float x) {
  if (wk_onset_run(&w->on, x)) w->rboost = 1; /* the pulses speed up (no jump, so no click) */
  float e = env_run(&w->env, x);
  float lp, bp, hp;
  svf_run(&w->divlp, x, &lp, &bp, &hp);
  float el = env_run(&w->envlp, lp);
  if (w->pos <= 0 && lp > 0.25f * el) w->pos = 1, w->sq = -w->sq; /* one flip per cycle: half the pitch */
  else if (w->pos > 0 && lp < -0.25f * el) w->pos = 0;
  float sub;
  svf_run(&w->sublp, w->sq * el, &sub, &bp, &hp);
  float src = 0.6f * wk_buzz(x, e, 2.f) + w->subamt * sub;
  float tl, tb, thp;
  svf_run(&w->f1, src, &tl, &tb, &thp);
  float y = wk_keep(w, x, w->f1.k * tb * 1.2f + 0.45f * tl);
  /* the pulse train */
  float rate = w->rate * (1.f + 0.6f * w->rboost);
  w->rboost *= w->rdec;
  w->ph += rate;
  if (w->ph >= 1) w->ph -= 1;
  float c = 0.5f - 0.5f * sh_sin01(w->ph + 0.25f); /* 0 at the start of each pulse */
  float p = c * c;
  float am = (1.f - w->depth) + w->depth * p * 2.f;
  return y * am * w->makeup;
}

/* ------------------------------------------------------------ CATERWAUL -- */
/* A cat's "mee-ow": each new note is sung through a mouth that glides m - ee - ah - ow,
   while the pitch bends up and back (read through a short moving delay, like a vibrato
   pedal), and a long note ends in a wailing vibrato. Meow: how long and how far the meow
   goes. Hiss: breath and spit on the attack and a snarl in the voice. */
static const float CAT_V[4][4] = {
    /* F1, F2, F3, mouth */
    {300, 1100, 2600, 0.35f}, /* m */
    {360, 2300, 3200, 1.f},   /* ee */
    {850, 1400, 2700, 1.f},   /* ah */
    {540, 900, 2500, 0.8f},   /* ow */
};

static void cat_set(wk_t *w) {
  float m = w->k1;
  w->eps = 0.025f + 0.085f * m;    /* the highest point of the bend: about 0.4 to 1.9 semitones */
  w->tm = 0.28f + 0.42f * m;       /* seconds for the meow */
  w->A = w->eps * w->tm / (float)SH_PI;
  w->rate = (float)(5.5 / w->sr);  /* the wail */
  w->av = 0.012f / (float)(SH_TAU * 5.5) * (0.6f + 0.8f * m);
  w->rest = w->A + w->av + 0.0015f;
  w->drive = 15.f + 15.f * w->k2;
  w->makeup = 1;
  wk_set(&w->f4, w->sr, 5200 * (w->bass ? 0.7 : 1), 0.9);
  w->rng = 0x9e3779b9u;
}

static float cat_run(wk_t *w, float x) {
  wk_onset_run(&w->on, x);
  dl_push(&w->dl, x);
  float t = (float)w->on.t / (float)w->sr;
  if (--w->cnt <= 0) {
    w->cnt = WK_CR;
    float v = 3.f * wk_smooth(t / (w->tm * 1.15f));
    int i = (int)v;
    if (i > 2) i = 2;
    float f = wk_smooth(v - i);
    const float *a = CAT_V[i], *b = CAT_V[i + 1];
    float F1 = a[0] * sh_exp2f_fast(f * sh_log2f_fast(b[0] / a[0]));
    float F2 = a[1] * sh_exp2f_fast(f * sh_log2f_fast(b[1] / a[1]));
    float F3 = a[2] * sh_exp2f_fast(f * sh_log2f_fast(b[2] / a[2]));
    w->open = a[3] + (b[3] - a[3]) * f;
    wk_set(&w->f1, w->sr, F1 * w->fs, 5);
    wk_set(&w->f2, w->sr, F2 * w->fs, 7);
    wk_set(&w->f3, w->sr, F3 * w->fs, 8);
  }
  /* the bend: the delay shortens (pitch up) then lengthens back (pitch down) */
  float bump = t < w->tm ? 0.5f - 0.5f * sh_sin01(t / w->tm + 0.25f) : 0.f;
  w->vibph += w->rate;
  if (w->vibph >= 1) w->vibph -= 1;
  float wail = wk_smooth((t - 0.6f * w->tm) / 0.25f);
  float d = w->rest - w->A * bump + w->av * wail * sh_sin01(w->vibph);
  float xd = dl_tapf(&w->dl, d * (float)w->sr);
  float e = env_run(&w->env, xd);
  float es = env_run(&w->env2, xd);
  float lv = wk_level(&w->ms, w->msa, xd);
  float src = op_hp(&w->tilt, wk_voice(xd, e, lv, w->drive));
  /* hiss: breath, strongest on the attack */
  float n = sh_randf(&w->rng) * es * w->k2 * (0.35f + 1.2f * sh_expf_fast(-t / 0.09f));
  src += 0.5f * n;
  float y = (wk_bp(&w->f1, src) + 0.9f * wk_bp(&w->f2, src) + 0.4f * wk_bp(&w->f3, src)) * w->open * w->makeup;
  y += 0.9f * wk_bp(&w->f4, n);
  return y;
}

/* ---------------------------------------------------------------- BLORP -- */
/* Something not from here: a ring modulator (the note times a hidden tone, which gives
   clangy, off-key partials no instrument has) whose hidden tone swoops down on each new note
   ("bl-orp") and circles around; then a resonant mouth that jumps to a new random place a few
   times a second and slides there (bubbles). Vowel: the mouth, from a dark "ooo" to a bright
   "eee". Orbit: how fast the hidden tone circles and the bubbles come, slow drift to frantic. */
static void blorp_set(wk_t *w) {
  float v = w->k1, o = w->k2;
  w->vb = (float)(320 * sh_pow(2, 2.9 * v)) * w->fs;
  w->rate = (float)(0.25 * sh_pow(2, 5 * o) / w->sr); /* the orbit: 0.25 to 8 times a second */
  w->cdep = 0.25f + 0.5f * o;                          /* octaves */
  w->snhrate = (float)((1.5 + 14.0 * o) / w->sr);
  w->slew = (float)(1 - sh_exp(-1.0 / (0.012 * w->sr)));
  w->cf0 = w->bass ? 150.f : 270.f;
  w->swdec = (float)sh_exp(-1.0 / (0.15 * w->sr));
  w->makeup = 1;
  w->rng = 0x2545f491u;
}

static float blorp_run(wk_t *w, float x) {
  if (wk_onset_run(&w->on, x)) w->sw = 1;
  w->sw *= w->swdec;
  w->ph += w->rate;
  if (w->ph >= 1) w->ph -= 1;
  w->snhph += w->snhrate;
  if (w->snhph >= 1) w->snhph -= 1, w->snh = sh_randf(&w->rng);
  w->snhs += w->slew * (w->snh - w->snhs);
  /* the hidden tone */
  float lfo = sh_sin01(w->ph);
  float fc = w->cf0 * sh_exp2f_fast(w->cdep * lfo + 1.5f * w->sw);
  w->cph += fc / (float)w->sr;
  if (w->cph >= 1) w->cph -= 1;
  float e = env_run(&w->env, x);
  float r = (0.2f * x + 0.8f * wk_buzz(x, e, 7.f)) * sh_sin01(w->cph) * 1.41f;
  if (--w->cnt <= 0) {
    w->cnt = WK_CR;
    float cf = w->vb * sh_exp2f_fast(0.9f * w->snhs + 0.6f * w->sw);
    wk_set(&w->f1, w->sr, cf, 6);
    wk_set(&w->f2, w->sr, cf * 2.4f, 8);
  }
  float y = wk_bp(&w->f1, r) + 0.5f * wk_bp(&w->f2, r);
  return y * w->makeup;
}

/* -------------------------------------------------------------- the block -- */
static void wacky_proc(sh_block *b, float *L, float *R, int n) {
  wk_t *w = (wk_t *)b->st;
  for (int i = 0; i < n; i++) {
    float x = R ? 0.5f * (L[i] + R[i]) : L[i];
    float y;
    switch (w->kind) {
      case WK_QUACK: y = quack_run(w, x); break;
      case WK_CROAK: y = croak_run(w, x); break;
      case WK_CATERWAUL: y = cat_run(w, x); break;
      default: y = blorp_run(w, x); break;
    }
    /* no rumble or offset under the effect */
    float lc, bp, hp;
    svf_run(&w->lowcut, y, &lc, &bp, &hp);
    y = hp;
    if (w->kind != WK_CROAK) y = wk_keep(w, x, y); /* Croak keeps its level before its pulses */
    y = wk_soft(y) * w->gw;
    L[i] = L[i] * w->gd + y;
    if (R) R[i] = R[i] * w->gd + y;
  }
}

int wacky_kind(const char *key) {
  if (sh_has(key, "Pedal_Quack")) return WK_QUACK;
  if (sh_has(key, "Pedal_Croak")) return WK_CROAK;
  if (sh_has(key, "Pedal_Caterwaul")) return WK_CATERWAUL;
  if (sh_has(key, "Pedal_Blorp")) return WK_BLORP;
  return 0;
}

int wacky_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int bass) {
  int kind = wacky_kind(g->key);
  if (!kind) return 0;
  wk_t *w = (wk_t *)ar_alloc(a, sizeof(wk_t));
  if (!w) return 0;
  w->kind = kind, w->bass = bass, w->sr = sr;
  w->fs = bass ? 0.7f : 1.f;
  wk_blend(kn_pos(g, "blend", 0.7f), &w->gd, &w->gw);
  wk_onset_init(&w->on, sr, bass);
  env_set(&w->env, sr, 1, 50);
  env_set(&w->env2, sr, 5, 120);
  env_set(&w->envlp, sr, 1, 80);
  wk_set(&w->lowcut, sr, bass ? 25 : 30, 0.7);
  op_lp_set(&w->tilt, sr, 600 * w->fs);
  w->msa = (float)(1 - sh_exp(-1.0 / (0.012 * sr)));
  w->aw = 1, w->cnt = 0;
  w->la = (float)(1 - sh_exp(-1.0 / (0.03 * sr)));
  w->lga = (float)(1 - sh_exp(-1.0 / (0.01 * sr)));
  w->lgr = (float)(1 - sh_exp(-1.0 / (0.001 * sr)));
  w->lg = w->lgs = 1;
  switch (kind) {
    case WK_QUACK:
      w->k1 = kn_pos(g, "beak", 0.6f), w->k2 = kn_pos(g, "wobble", 0.25f);
      quack_set(w);
      b->name = "quack";
      break;
    case WK_CROAK:
      w->k1 = kn_pos(g, "throat", 0.5f), w->k2 = kn_pos(g, "hop", 0.5f);
      croak_set(w);
      b->name = "croak";
      break;
    case WK_CATERWAUL:
      w->k1 = kn_pos(g, "meow", 0.6f), w->k2 = kn_pos(g, "hiss", 0.25f);
      cat_set(w);
      if (!dl_init(&w->dl, a, (int)(sr * 0.06) + 8)) return 0;
      w->open = CAT_V[3][3];
      b->name = "caterwaul";
      break;
    default:
      w->k1 = kn_pos(g, "vowel", 0.5f), w->k2 = kn_pos(g, "orbit", 0.4f);
      blorp_set(w);
      b->name = "blorp";
      break;
  }
  b->st = w, b->process = wacky_proc;
  return 1;
}
