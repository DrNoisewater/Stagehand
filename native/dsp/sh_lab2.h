/*
 * 4.20: The Lab, part 2: time, loops and captures.
 *   Claude, Deja Vu, Janus, Kitsune, Kukulkan, Maui, Mimic, Molt, Nataraja, Ouroboros, Seance,
 *   Severed, Shango.
 * What these record lives only in the pedal while it plays: a new tone (or turning a saved
 * control) starts empty. Footswitches and buttons never rebuild, so they never lose it.
 */

/* --------------------------------------------------------------- CLAUDE -- */
/* Catches the rise and fall of a phrase (its loudness over time, not its notes) and plays later
   phrases through it. Hear (lit): the next phrase you play is learned, up to Context seconds.
   Shape (lit): each new phrase is shaped by it once. Repeat (lit): it is shaped round and round.
   Clear: forget it. Recall: start the shape again now. */
#define CL_FPS 200
typedef struct {
  wk_c c;
  wk_onset on;
  float *env, ms, msa, g, gk, peak;
  int n, max, rec, armed, t, playing, step, cnt2, quiet, gapn, done;
} claude_t;

static void claude_learned(claude_t *s) {
  s->rec = 0, s->done = 1;
  for (int i = 0; i < s->n; i++) s->env[i] /= s->peak;
}

static float claude_run(wk_c *c, float x, float in0, float *dry) {
  claude_t *s = (claude_t *)c;
  int hit = wk_onset_run(&s->on, x);
  float lv = wk_level(&s->ms, s->msa, x);
  int hear = lab_on(c, 0), shape = lab_on(c, 1), rep = lab_on(c, 2);
  if (lab_tap(c, 3)) s->n = 0, s->playing = 0;
  if (hear && !s->rec && !s->armed && !s->done) s->armed = 1;
  if (!hear) s->armed = 0;
  if (s->armed && (hit || lv > 0.01f)) s->armed = 0, s->rec = 1, s->n = 0, s->peak = 1e-6f, s->cnt2 = 0;
  if (s->rec && !hear) { /* Hear switched off while learning: keep what there is */
    if (s->n > CL_FPS / 4) claude_learned(s);
    else s->rec = 0, s->n = 0;
  }
  /* a new phrase: playing again after a quiet moment */
  if (lv < 0.004f) {
    if (++s->quiet > s->gapn) s->done = 0; /* with Hear still lit, the next phrase is learned anew */
  } else {
    if (s->quiet > s->gapn && (shape || rep) && s->n) s->playing = 1, s->t = 0, s->cnt2 = 0;
    s->quiet = 0;
  }
  if (lab_tap(c, 4) && s->n) s->playing = 1, s->t = 0, s->cnt2 = 0;
  if (--s->cnt2 <= 0) {
    s->cnt2 = s->step;
    if (s->rec) {
      s->env[s->n] = lv;
      if (lv > s->peak) s->peak = lv;
      if (++s->n >= s->max) claude_learned(s);
    } else if (s->playing && !hear && (shape || rep) && s->n) {
      if (++s->t >= s->n) {
        if (rep) s->t = 0;
        else s->playing = 0;
      }
    }
  }
  float want = 1;
  if (!hear && !s->rec && s->playing && (shape || rep) && s->n) want = s->env[s->t < s->n ? s->t : s->n - 1];
  s->g += s->gk * (want - s->g);
  return x * s->g;
}

static wk_c *claude_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  claude_t *s = (claude_t *)ar_alloc(a, sizeof(claude_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_CLAUDE, g, sr, bass, live, 1.f);
  s->max = (int)(sh_clamp(wk_raw(g, "context", 2), 0.5, 8) * CL_FPS);
  s->env = (float *)ar_alloc(a, sizeof(float) * (s->max + 2));
  if (!s->env) return 0;
  s->step = (int)(sr / CL_FPS);
  s->msa = wk_k(sr, 0.01), s->gk = wk_k(sr, 0.004), s->g = 1;
  s->gapn = (int)(0.3 * sr);
  wk_onset_init(&s->on, sr, bass, 0.003f);
  s->c.run = claude_run;
  return &s->c;
}

/* -------------------------------------------------------------- DEJA VU -- */
/* Enter catches the last 1, 2, 4 or 8 beats (Loop) of your playing. Repeat (lit) plays it round
   and round on top of you, cut into sixteenths, and Fracture glitches them: a slice played twice,
   backwards, at half speed or skipped. Real keeps it clean; Sim makes it a crunchy copy. */
typedef struct {
  wk_c c;
  wk_rec rec;
  float *loop;
  int n, max, pos, slice, si, mode, sn, sstart, have;
  float frac, rate, rp, g;
  uint32_t rng;
  int sim, beats, hold;
  float held;
} dv_t;

static float dv_run(wk_c *c, float x, float in0, float *dry) {
  dv_t *s = (dv_t *)c;
  rec_push(&s->rec, x);
  if (lab_tap(c, 0)) {
    float L = (float)s->beats * 60.f / lab_tempo(c);
    int n = (int)(L * (float)c->sr);
    if (n > s->max) n = s->max;
    if (n < 64) n = 64;
    rec_copy(&s->rec, s->loop, n);
    s->n = n, s->have = 1, s->pos = 0, s->si = 0;
    s->slice = n / (s->beats * 4);
    if (s->slice < 32) s->slice = 32;
  }
  float want = lab_on(c, 1) && s->have ? 1.f : 0.f;
  s->g += 0.002f * (want - s->g);
  if (s->g < 1e-4f || !s->have) return 0;
  if (s->si <= 0) { /* a new sixteenth: maybe a glitch */
    s->si = s->slice;
    int next = s->sstart + s->slice;
    if (next >= s->n) next = 0;
    float r = 0.5f + 0.5f * lab_rnd(&s->rng);
    s->mode = 0, s->rate = 1;
    if (r < s->frac) {
      float k = 0.5f + 0.5f * lab_rnd(&s->rng);
      if (k < 0.35f) s->mode = 1;                  /* the same slice again */
      else if (k < 0.65f) s->mode = 2, s->rate = -1; /* backwards */
      else if (k < 0.85f) s->mode = 3, s->rate = 0.5f; /* half speed */
      else next = (next + s->slice) % s->n, s->mode = 4; /* skip one */
    }
    if (s->mode != 1) s->sstart = next;
    s->rp = s->mode == 2 ? (float)(s->slice - 1) : 0;
  }
  int age = s->slice - s->si;
  s->si--;
  int idx = s->sstart + (int)s->rp;
  s->rp += s->rate;
  idx %= s->n;
  if (idx < 0) idx += s->n;
  float v = s->loop[idx];
  int f = 96; /* a short fade at each slice's ends */
  float w = age < f ? (float)age / f : s->si < f ? (float)s->si / f : 1.f;
  v *= w;
  if (s->sim) { /* a crunchy copy: fewer steps, held samples */
    if ((age & 3) == 0) s->held = (float)((int)(v * 48.f)) / 48.f;
    v = s->held * w;
  }
  return v * s->g;
}

static wk_c *dv_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  dv_t *s = (dv_t *)ar_alloc(a, sizeof(dv_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_DEJAVU, g, sr, bass, live, 0.7f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 70) / 100.0, 0, 1);
  static const int B[4] = {1, 2, 4, 8};
  s->beats = B[wk_sw(g, "loop", 1, 4)];
  s->sim = wk_sw(g, "real/sim", 0, 2);
  s->frac = (float)sh_clamp(wk_raw(g, "fracture", 40) / 100.0, 0, 1) * 0.8f;
  s->max = (int)(4.0 * sr);
  s->rng = 0x3c6ef372u;
  s->loop = (float *)ar_alloc(a, sizeof(float) * s->max);
  if (!s->loop || !rec_init(&s->rec, a, s->max + 64)) return 0;
  s->c.run = dv_run;
  return &s->c;
}

/* ---------------------------------------------------------------- JANUS -- */
/* Two faces. The Past: your playing comes back backwards, in pieces Reverse long, aged (darker,
   wobblier) by Age, fading over Fade. The Future: a plain echo, Delay apart, Repeats times. Crossing:
   from all past (left) to all future (right). Threshold (lit): the two swap sides, smoothly. */
typedef struct {
  wk_c c;
  wk_rec pr;
  float *pbuf;
  int plen, gl, gpos, cnt2;
  dl_t fut;
  op_t age1, age2;
  float fade, age, wph, wrate, dtime, rep, cross, cur, ck;
  uint32_t rng;
  int gage[2];
  double gstart[2], now;
} janus_t;

static float janus_run(wk_c *c, float x, float in0, float *dry) {
  janus_t *s = (janus_t *)c;
  /* the past: backwards pieces of what went in (with their own repeats) */
  s->wph += s->wrate;
  if (s->wph >= 1) s->wph -= 1;
  float wob = s->age * 0.0025f * (float)c->sr * (0.5f + 0.5f * sh_sin01(s->wph));
  float past = 0;
  for (int k = 0; k < 2; k++) { /* two pieces half a piece apart, each read backwards from where it began */
    int a = s->gage[k]++;
    if (a >= s->gl) s->gage[k] = 1, a = 0;
    if (a < 0) continue;
    if (a == 0) s->gstart[k] = s->now - 1;
    float t = (float)a / s->gl;
    past += rec_tap(&s->pr, (float)(s->now - (s->gstart[k] - a)) + wob) * (0.5f - 0.5f * sh_sin01(t + 0.25f));
  }
  s->now += 1;
  past = op_lp(&s->age2, op_lp(&s->age1, past));
  rec_push(&s->pr, x + s->fade * past);
  /* the future */
  float fu = dl_tapf(&s->fut, s->dtime);
  dl_push(&s->fut, x + s->rep * fu);
  float want = lab_on(c, 0) ? 1.f - s->cross : s->cross;
  s->cur += s->ck * (want - s->cur);
  return 1.3f * (past * sh_sinf_fast((1 - s->cur) * (float)SH_PI * 0.5f) + fu * sh_sinf_fast(s->cur * (float)SH_PI * 0.5f));
}

static wk_c *janus_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  janus_t *s = (janus_t *)ar_alloc(a, sizeof(janus_t));
  if (!s) return 0;
  wk_base(&s->c, WK_JANUS, g, sr, bass, live, 0.5f);
  s->gl = (int)(sh_clamp(wk_raw(g, "reverse", 300), 60, 800) * 0.001 * sr);
  s->gage[0] = 0, s->gage[1] = -s->gl / 2;
  s->age = (float)sh_clamp(wk_raw(g, "age", 30) / 100.0, 0, 1);
  s->fade = 0.75f * (float)sh_clamp(wk_raw(g, "fade", 50) / 100.0, 0, 1);
  s->dtime = (float)(sh_clamp(wk_raw(g, "delay", 450), 60, 1200) * 0.001 * sr);
  s->rep = 0.85f * (float)sh_clamp(wk_raw(g, "repeats", 40) / 100.0, 0, 1);
  s->cross = s->cur = (float)sh_clamp(wk_raw(g, "crossing", 50) / 100.0, 0, 1);
  s->ck = wk_k(sr, 0.15);
  s->wrate = (float)(0.6 / sr);
  op_lp_set(&s->age1, sr, 12000 - 10500 * s->age);
  op_lp_set(&s->age2, sr, 14000 - 11000 * s->age);
  if (!rec_init(&s->pr, a, (int)(2.0 * sr)) || !dl_init(&s->fut, a, (int)(1.25 * sr) + 8)) return 0;
  s->c.run = janus_run;
  return &s->c;
}

/* -------------------------------------------------------------- KITSUNE -- */
/* Nine tails, nine voices: each lit tail is a copy of you a little later (40 to 340 ms) and gently
   out of tune with the others (Drift). Mask: the voices' face, from a dark "oo" to a bright "ee".
   Trick: the lit pattern turns round by one tail. */
typedef struct {
  wk_c c;
  dl_t dl;
  svf_t f1, f2;
  float d[9], rate[9], ph[9], g[9], depth;
  int en[9], rot;
} kit_t;

static float kit_run(wk_c *c, float x, float in0, float *dry) {
  kit_t *s = (kit_t *)c;
  if (lab_tap(c, 0)) s->rot = (s->rot + 1) % 9;
  dl_push(&s->dl, x);
  int non = 0;
  for (int i = 0; i < 9; i++) non += s->en[i];
  float norm = non ? 1.f / sh_sqrtf((float)non) : 0.f, y = 0;
  for (int i = 0; i < 9; i++) {
    float want = s->en[(i + 9 - s->rot) % 9] ? norm : 0.f;
    s->g[i] += 0.0007f * (want - s->g[i]);
    if (s->g[i] < 1e-4f && want == 0) continue;
    s->ph[i] += s->rate[i];
    if (s->ph[i] >= 1) s->ph[i] -= 1;
    y += dl_tapf(&s->dl, s->d[i] + s->depth * (1.f + sh_sin01(s->ph[i]))) * s->g[i];
  }
  float m = wk_bp(&s->f1, y) + 0.8f * wk_bp(&s->f2, y);
  return 0.6f * y + 0.9f * m;
}

static wk_c *kit_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  kit_t *s = (kit_t *)ar_alloc(a, sizeof(kit_t));
  if (!s) return 0;
  wk_base(&s->c, WK_KITSUNE, g, sr, bass, live, 0.45f);
  static const char *N[9] = {"tail 1", "tail 2", "tail 3", "tail 4", "tail 5", "tail 6", "tail 7", "tail 8", "tail 9"};
  for (int i = 0; i < 9; i++) {
    s->en[i] = wk_sw(g, N[i], (i % 2) == 0, 2);
    s->d[i] = (float)((0.040 + 0.037 * i) * sr);
    s->rate[i] = (float)((0.13 + 0.07 * i) / sr);
    s->ph[i] = 0.11f * i;
  }
  float drift = (float)sh_clamp(wk_raw(g, "drift", 35) / 100.0, 0, 1);
  s->depth = (float)((0.0002 + 0.0028 * drift) * sr);
  float mask = (float)sh_clamp(wk_raw(g, "mask", 40) / 100.0, 0, 1);
  wk_set(&s->f1, sr, wk_lerpf(350, 800, mask) * s->c.fs, 5);
  wk_set(&s->f2, sr, wk_lerpf(900, 2400, mask) * s->c.fs, 6);
  int non = 0;
  for (int i = 0; i < 9; i++) non += s->en[i];
  for (int i = 0; i < 9; i++) s->g[i] = s->en[i] && non ? 1.f / sh_sqrtf((float)non) : 0.f;
  if (!dl_init(&s->dl, a, (int)(0.4 * sr) + 16)) return 0;
  s->c.run = kit_run;
  return &s->c;
}

/* ------------------------------------------------------------- KUKULKAN -- */
/* A six-step climb. Rise (lit) starts it: your playing is moved by each step's semitones in turn
   (Steps 1 to 6), stepping in quarter, eighth or sixteenth notes of the song's beat. Wind feeds
   each step back into the next, so the steps pile up like a stair. */
typedef struct {
  wk_c c;
  wk_ps ps;
  dl_t dl;
  float semi[6], cur, sk, wind, ph, g;
  int step, div;
} kuku_t;

static float kuku_run(wk_c *c, float x, float in0, float *dry) {
  kuku_t *s = (kuku_t *)c;
  float want = lab_on(c, 0) ? 1.f : 0.f;
  s->g += 0.0015f * (want - s->g);
  float steps = lab_tempo(c) / 60.f * (float)s->div;
  s->ph += steps / (float)c->sr;
  if (s->ph >= 1) s->ph -= 1, s->step = (s->step + 1) % 6;
  if (!lab_on(c, 0) && s->g < 0.01f) s->step = 0, s->ph = 0;
  s->cur += s->sk * (s->semi[s->step] - s->cur);
  float back = dl_tapf(&s->dl, (float)c->sr / steps);
  float y = wk_ps_run(&s->ps, x + s->wind * back, sh_exp2f_fast(s->cur / 12.f));
  dl_push(&s->dl, sh_tanhf(y));
  return y * s->g;
}

static wk_c *kuku_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  kuku_t *s = (kuku_t *)ar_alloc(a, sizeof(kuku_t));
  if (!s) return 0;
  wk_base(&s->c, WK_KUKULKAN, g, sr, bass, live, 0.6f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 60) / 100.0, 0, 1);
  static const char *N[6] = {"step 1", "step 2", "step 3", "step 4", "step 5", "step 6"};
  static const float D[6] = {0, 3, 5, 7, 10, 12};
  float top = 0;
  for (int i = 0; i < 6; i++) {
    s->semi[i] = (float)sh_clamp(wk_raw(g, N[i], D[i]), -12, 12);
    if (s->semi[i] > top) top = s->semi[i];
  }
  s->wind = 0.7f * (float)sh_clamp(wk_raw(g, "wind", 45) / 100.0, 0, 1);
  static const int DIV[3] = {1, 2, 4};
  s->div = DIV[wk_sw(g, "rate", 1, 3)];
  s->sk = wk_k(sr, 0.006);
  s->cur = s->semi[0];
  if (!wk_ps_init(&s->ps, a, sr, sh_pow(2, top / 12.0)) || !dl_init(&s->dl, a, (int)(1.05 * sr) + 8)) return 0;
  s->c.run = kuku_run;
  return &s->c;
}

/* ----------------------------------------------------------------- MAUI -- */
/* Slows the world down like a tape running out. Haul (held): your playing slows down to the
   speed of the lit Sun (I as it is, II three quarters, III half, IV a quarter, V an eighth),
   taking Horizon to get there, and pitch drops with it; let go and it comes back up and catches
   up with you. The Drag hook does the same by hand, as far as you pull it. Tide: an echo of the
   slowed sound. */
typedef struct {
  wk_c c;
  wk_rec rec;
  dl_t echo;
  float sun, sp, k, lag, ret, tide;
  double maxlag;
} maui_t;

static float maui_run(wk_c *c, float x, float in0, float *dry) {
  maui_t *s = (maui_t *)c;
  rec_push(&s->rec, x);
  float lever = c->lval < 0 ? 0 : c->lval > 1 ? 1 : c->lval;
  float want = 1.f;
  if (lab_on(c, 0)) want = s->sun;
  float dr = 1.f + (s->sun - 1.f) * lever;
  if (dr < want) want = dr;
  s->sp += s->k * (want - s->sp);
  s->lag += 1.f - s->sp;
  if (s->lag > s->maxlag) s->lag = (float)s->maxlag;
  /* back to normal speed: catch up with the playing (a quick crossfade to it) */
  if (want > 0.999f && s->sp > 0.995f && s->lag > 1) s->ret += 0.0005f;
  else s->ret = 0;
  float slow = rec_tap(&s->rec, s->lag + 1);
  float y = slow;
  if (s->ret > 0) {
    float now = rec_tap(&s->rec, 1);
    y = slow + (now - slow) * (s->ret > 1 ? 1 : s->ret);
    if (s->ret >= 1) s->lag = 0, s->ret = 0;
  }
  float e = dl_tapf(&s->echo, 0.42f * (float)c->sr);
  dl_push(&s->echo, y + 0.45f * e);
  *dry = 0; /* the sound itself is slowed: nothing plays at full speed beside it */
  return y + s->tide * e;
}

static wk_c *maui_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  maui_t *s = (maui_t *)ar_alloc(a, sizeof(maui_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_MAUI, g, sr, bass, live, 1.f);
  s->c.own = 1;
  static const float SUN[5] = {1, 0.75f, 0.5f, 0.25f, 0.125f};
  s->sun = SUN[wk_sw(g, "sun", 2, 5)];
  s->tide = (float)sh_clamp(wk_raw(g, "tide", 30) / 100.0, 0, 1);
  s->k = wk_k(sr, sh_clamp(wk_raw(g, "horizon", 1.2f), 0.1, 4) / 3.0);
  s->sp = 1;
  s->maxlag = 3.8 * sr;
  if (!rec_init(&s->rec, a, (int)(4.0 * sr)) || !dl_init(&s->echo, a, (int)(0.45 * sr) + 8)) return 0;
  s->c.run = maui_run;
  return &s->c;
}

/* ---------------------------------------------------------------- MIMIC -- */
/* Learns the rise and fall (Rhythm) and the colour (Tone) of a phrase, then puts them on whatever
   you play. Listen (held): learns while you hold it (up to 4 s). Catch: learns the last 2 seconds
   at once. Clear: forgets. Speak (lit): your playing takes on what it learned, round and round.
   Inherit: how much. */
#define MI_B 8
#define MI_FPS 100
typedef struct {
  wk_c c;
  wk_bands bands;
  float *imp, *hist; /* frames: [amp, band 0..7] */
  float bl[MI_B], amp, a1, gk, gain[MI_B], gt[MI_B], vca, vt, inherit;
  int n, max, hn, hw, step, cnt2, t, listening, what;
} mimic_t;

static float mimic_run(wk_c *c, float x, float in0, float *dry) {
  mimic_t *s = (mimic_t *)c;
  float b[MI_B];
  bands_run(&s->bands, x, b);
  for (int i = 0; i < MI_B; i++) s->bl[i] += s->a1 * (b[i] * b[i] - s->bl[i]);
  s->amp += s->a1 * (x * x - s->amp);
  if (lab_tap(c, 3)) s->n = 0;
  int listen = lab_on(c, 0);
  if (listen && !s->listening) s->n = 0;
  s->listening = listen;
  if (lab_tap(c, 2)) { /* catch the last two seconds */
    int m = s->hn < s->max ? s->hn : s->max;
    for (int f = 0; f < m; f++) {
      int src = (s->hw - m + f + s->hn * 4) % s->hn;
      for (int j = 0; j <= MI_B; j++) s->imp[f * (MI_B + 1) + j] = s->hist[src * (MI_B + 1) + j];
    }
    s->n = m, s->t = 0;
  }
  if (--s->cnt2 <= 0) {
    s->cnt2 = s->step;
    float fr[MI_B + 1];
    fr[0] = sh_sqrtf(s->amp);
    for (int i = 0; i < MI_B; i++) fr[i + 1] = sh_sqrtf(s->bl[i]);
    for (int j = 0; j <= MI_B; j++) s->hist[s->hw * (MI_B + 1) + j] = fr[j];
    s->hw = (s->hw + 1) % s->hn;
    if (listen && s->n < s->max) {
      for (int j = 0; j <= MI_B; j++) s->imp[s->n * (MI_B + 1) + j] = fr[j];
      s->n++;
    }
    if (lab_on(c, 1) && s->n > 4 && !listen) {
      s->t = (s->t + 1) % s->n;
      const float *F = s->imp + s->t * (MI_B + 1);
      float peak = 1e-6f;
      for (int f = 0; f < s->n; f++) peak = s->imp[f * (MI_B + 1)] > peak ? s->imp[f * (MI_B + 1)] : peak;
      float va = s->what != 1 ? F[0] / peak : 1.f;
      s->vt = 1.f + (va - 1.f) * s->inherit;
      float tot = 1e-9f, ltot = 1e-9f;
      for (int i = 0; i < MI_B; i++) tot += F[i + 1], ltot += sh_sqrtf(s->bl[i]);
      for (int i = 0; i < MI_B; i++) {
        float want = 1.f;
        if (s->what != 0) {
          float tf = F[i + 1] / tot, lf = sh_sqrtf(s->bl[i]) / ltot;
          want = tf / (lf + 0.02f);
          want = want > 4 ? 4 : want;
        }
        s->gt[i] = 1.f + (want - 1.f) * s->inherit;
      }
    } else {
      s->vt = 1;
      for (int i = 0; i < MI_B; i++) s->gt[i] = 1;
    }
  }
  float y = 0;
  for (int i = 0; i < MI_B; i++) s->gain[i] += s->gk * (s->gt[i] - s->gain[i]), y += b[i] * s->gain[i];
  s->vca += s->gk * (s->vt - s->vca);
  return y * s->vca;
}

static wk_c *mimic_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  mimic_t *s = (mimic_t *)ar_alloc(a, sizeof(mimic_t));
  if (!s) return 0;
  wk_base(&s->c, WK_MIMIC, g, sr, bass, live, 1.f);
  s->inherit = (float)sh_clamp(wk_raw(g, "inherit", 75) / 100.0, 0, 1);
  s->what = wk_sw(g, "rhythm/tone/both", 2, 3);
  s->max = 4 * MI_FPS, s->hn = 2 * MI_FPS;
  s->imp = (float *)ar_alloc(a, sizeof(float) * (MI_B + 1) * s->max);
  s->hist = (float *)ar_alloc(a, sizeof(float) * (MI_B + 1) * s->hn);
  if (!s->imp || !s->hist) return 0;
  s->step = (int)(sr / MI_FPS);
  s->a1 = wk_k(sr, 0.012);
  float X[MI_B - 1] = {150, 300, 600, 1200, 2400, 4800, 9600};
  for (int i = 0; i < MI_B - 1; i++) X[i] *= s->c.fs;
  bands_init(&s->bands, sr, MI_B, X);
  s->vca = s->vt = 1, s->gk = wk_k(sr, 0.006);
  for (int i = 0; i < MI_B; i++) s->gain[i] = s->gt[i] = 1;
  s->c.run = mimic_run;
  return &s->c;
}

/* ----------------------------------------------------------------- MOLT -- */
/* Held notes shed skins: copies come off every Shed, each one thinner than the last (Age) and a
   little further out of tune, up or down. Decay: how many skins before they're gone. */
typedef struct {
  wk_c c;
  dl_t dl;
  wk_ps ps;
  svf_t hp;
  op_t lp;
  float time, fb, ratio;
} molt_t;

static float molt_run(wk_c *c, float x, float in0, float *dry) {
  molt_t *s = (molt_t *)c;
  float back = dl_tapf(&s->dl, s->time);
  float lp, bp, hp;
  svf_run(&s->hp, back, &lp, &bp, &hp);
  float v = op_lp(&s->lp, wk_ps_run(&s->ps, hp, s->ratio));
  dl_push(&s->dl, x + s->fb * v);
  return v * 1.3f;
}

static wk_c *molt_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  molt_t *s = (molt_t *)ar_alloc(a, sizeof(molt_t));
  if (!s) return 0;
  wk_base(&s->c, WK_MOLT, g, sr, bass, live, 0.5f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 50) / 100.0, 0, 1);
  float age = (float)sh_clamp(wk_raw(g, "age", 50) / 100.0, 0, 1);
  s->time = (float)((0.12 + 0.78 * sh_clamp(wk_raw(g, "shed", 40) / 100.0, 0, 1)) * sr);
  s->fb = 0.3f + 0.55f * (float)sh_clamp(wk_raw(g, "decay", 55) / 100.0, 0, 1);
  float cents = (5 + 30 * age) * (wk_sw(g, "up/down", 0, 2) ? -1 : 1);
  s->ratio = sh_exp2f_fast(cents / 1200.f);
  wk_set(&s->hp, sr, (80 + 900 * age) * s->c.fs, 0.6);
  op_lp_set(&s->lp, sr, 7000);
  if (!dl_init(&s->dl, a, (int)(0.95 * sr) + 8) || !wk_ps_init(&s->ps, a, sr, s->ratio > 1 ? s->ratio : 1)) return 0;
  s->c.run = molt_run;
  return &s->c;
}

/* ------------------------------------------------------------- NATARAJA -- */
/* A dance in eight steps. Dance (lit) starts it: on every lit step your sound swells in (Create),
   stays (Hold, part of the step), and falls away (Rest); unlit steps are silent. Change: how much a
   filter opens with each step. Tempo: steps (eighth notes) at this many beats a minute. Reset:
   back to step one. */
typedef struct {
  wk_c c;
  svf_t f;
  int en[8], step;
  float ph, rate, att, hold, rel, env, dance, fmin, chg;
} nat_t;

static float nat_run(wk_c *c, float x, float in0, float *dry) {
  nat_t *s = (nat_t *)c;
  if (lab_tap(c, 1)) s->step = 0, s->ph = 0;
  int on = lab_on(c, 0);
  s->dance += 0.002f * ((on ? 1.f : 0.f) - s->dance);
  if (s->dance < 1e-4f && !on) {
    s->step = 0, s->ph = 0;
    return x;
  }
  s->ph += s->rate;
  if (s->ph >= 1) s->ph -= 1, s->step = (s->step + 1) & 7;
  float target = s->en[s->step] && s->ph < s->hold ? 1.f : 0.f;
  s->env += (target > s->env ? s->att : s->rel) * (target - s->env);
  if (--c->cnt <= 0) {
    c->cnt = WK_CR;
    wk_set(&s->f, c->sr, s->fmin * sh_exp2f_fast(6.f * s->chg * s->env), 1.4);
  }
  float lp, bp, hp;
  svf_run(&s->f, x, &lp, &bp, &hp);
  float y = (s->chg > 0.01f ? lp : x) * s->env;
  return x + (y - x) * s->dance;
}

static wk_c *nat_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  nat_t *s = (nat_t *)ar_alloc(a, sizeof(nat_t));
  if (!s) return 0;
  s->c.clean = 1;
  wk_base(&s->c, WK_NATARAJA, g, sr, bass, live, 1.f);
  static const char *N[8] = {"step 1", "step 2", "step 3", "step 4", "step 5", "step 6", "step 7", "step 8"};
  static const int D[8] = {1, 0, 1, 1, 0, 1, 1, 0};
  for (int i = 0; i < 8; i++) s->en[i] = wk_sw(g, N[i], D[i], 2);
  s->rate = (float)(sh_clamp(wk_raw(g, "tempo", 120), 40, 240) / 60.0 * 2 / sr);
  s->att = wk_k(sr, sh_clamp(wk_raw(g, "create", 10), 1, 200) * 0.001 / 2);
  s->rel = wk_k(sr, sh_clamp(wk_raw(g, "rest", 60), 5, 500) * 0.001 / 3);
  s->hold = 0.05f + 0.9f * (float)sh_clamp(wk_raw(g, "hold", 40) / 100.0, 0, 1);
  s->chg = (float)sh_clamp(wk_raw(g, "change", 50) / 100.0, 0, 1);
  s->fmin = 17000.f * sh_exp2f_fast(-6.f * s->chg);
  wk_set(&s->f, sr, s->fmin, 1.4);
  s->c.run = nat_run;
  return &s->c;
}

/* ------------------------------------------------------------ OUROBOROS -- */
/* An echo that eats its tail: every time round, the echo is filtered, distorted (Acid) and moved in
   pitch: Shed climbs and thins, Devour sinks and darkens. Memory: time between echoes. Digest: how
   long it goes round. Swallow (held): it goes round almost for ever (and never runs away). Wake
   is the pedal's own on and off. */
typedef struct {
  wk_c c;
  dl_t dl;
  wk_ps ps;
  svf_t f;
  float time, fb, cur, k, drive, ratio;
  int devour;
} ouro_t;

static float ouro_run(wk_c *c, float x, float in0, float *dry) {
  ouro_t *s = (ouro_t *)c;
  s->cur += s->k * ((lab_on(c, 0) ? 0.97f : s->fb) - s->cur);
  float back = dl_tapf(&s->dl, s->time);
  float lp, bp, hp;
  svf_run(&s->f, back, &lp, &bp, &hp);
  float v = s->devour ? lp : hp;
  v = sh_tanhf(v * s->drive) / s->drive;
  v = wk_ps_run(&s->ps, v, s->ratio);
  dl_push(&s->dl, x + s->cur * v);
  return v * 1.2f;
}

static wk_c *ouro_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  ouro_t *s = (ouro_t *)ar_alloc(a, sizeof(ouro_t));
  if (!s) return 0;
  wk_base(&s->c, WK_OUROBOROS, g, sr, bass, live, 0.4f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 40) / 100.0, 0, 1);
  s->fb = s->cur = 0.2f + 0.73f * (float)sh_clamp(wk_raw(g, "digest", 55) / 100.0, 0, 1);
  s->drive = 1.f + 8.f * (float)sh_clamp(wk_raw(g, "acid", 35) / 100.0, 0, 1);
  s->time = (float)(sh_clamp(wk_raw(g, "memory", 380), 60, 1500) * 0.001 * sr);
  s->devour = wk_sw(g, "shed/devour", 0, 2);
  s->ratio = sh_exp2f_fast((s->devour ? -2.f : 2.f) / 12.f);
  s->k = wk_k(sr, 0.25);
  if (s->devour) wk_set(&s->f, sr, 1400 * s->c.fs, 0.7);
  else wk_set(&s->f, sr, 260 * s->c.fs, 0.7);
  if (!dl_init(&s->dl, a, (int)(1.55 * sr) + 8) || !wk_ps_init(&s->ps, a, sr, s->ratio > 1 ? s->ratio : 1)) return 0;
  s->c.run = ouro_run;
  return &s->c;
}

/* --------------------------------------------------------------- SEANCE -- */
/* Listen (lit): it remembers what you play. Stop for a moment and the last phrase (Memory: 1, 2, 4
   or 8 seconds) answers back from the other side: far away (Distance), sometimes backwards
   (Reverse: how often), fading over a few replies (Decay). Start playing again and it falls
   silent. Summon: an answer now. */
typedef struct {
  wk_c c;
  float *buf;
  int len, w, D, dcnt, quiet, gapn, played, playn;
  float lp1, lp2, mem, dist, decay, rev, gain, duck, dk, ms, msa;
  /* the answer being played */
  int on, start, n, dir;
  double rp;
  uint32_t rng;
  wk_fdn f;
  op_t far;
} seance_t;

static void seance_answer(seance_t *s) {
  int n = (int)(s->mem * s->c.sr / s->D);
  if (n > s->len - 8) n = s->len - 8;
  if (s->played < 64) return;
  if (n > s->played) n = s->played;
  s->n = n, s->start = s->w - n, s->on = 1, s->gain = 0.75f;
  s->dir = (0.5f + 0.5f * lab_rnd(&s->rng)) < s->rev ? -1 : 1;
  s->rp = s->dir > 0 ? 0 : n - 1;
}

static float seance_run(wk_c *c, float x, float in0, float *dry) {
  seance_t *s = (seance_t *)c;
  int listen = lab_on(c, 0);
  float lv = wk_level(&s->ms, s->msa, x);
  /* remember (at about 24 kHz, a little filtered) */
  s->lp1 += 0.45f * (x - s->lp1), s->lp2 += 0.45f * (s->lp1 - s->lp2);
  if (listen && ++s->dcnt >= s->D) {
    s->dcnt = 0;
    s->buf[s->w] = s->lp2;
    s->w = s->w + 1 == s->len ? 0 : s->w + 1;
    if (lv > 0.004f && s->played < s->len) s->played++;
  }
  if (lv > 0.004f) {
    s->quiet = 0, s->playn++;
  } else if (++s->quiet == s->gapn && listen && s->playn > (int)(0.3 * c->sr)) {
    seance_answer(s), s->playn = 0;
  }
  if (lab_tap(c, 1)) seance_answer(s);
  s->duck += s->dk * ((lv > 0.006f ? 0.f : 1.f) - s->duck);
  float y = 0;
  if (s->on) {
    double pos = s->start + s->rp;
    int i = (int)pos;
    float fr = (float)(pos - i);
    i %= s->len;
    if (i < 0) i += s->len;
    int j = i + 1 == s->len ? 0 : i + 1;
    y = (s->buf[i] + (s->buf[j] - s->buf[i]) * fr) * s->gain;
    s->rp += s->dir * (1.0 / s->D);
    if (s->rp >= s->n || s->rp < 0) { /* the next, quieter reply */
      s->gain *= s->decay;
      s->rp = s->dir > 0 ? 0 : s->n - 1;
      if (s->gain < 0.05f) s->on = 0;
    }
  }
  y = op_lp(&s->far, y) * s->duck;
  float r = fdn_run(&s->f, y);
  return (y * (1.f - 0.6f * s->dist) + r * s->dist) * 1.4f;
}

static wk_c *seance_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  seance_t *s = (seance_t *)ar_alloc(a, sizeof(seance_t));
  if (!s) return 0;
  wk_base(&s->c, WK_SEANCE, g, sr, bass, live, 0.6f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 60) / 100.0, 0, 1);
  static const float M[4] = {1, 2, 4, 8};
  s->mem = M[wk_sw(g, "memory", 1, 4)];
  s->dist = (float)sh_clamp(wk_raw(g, "distance", 50) / 100.0, 0, 1);
  s->decay = 0.8f * (float)sh_clamp(wk_raw(g, "decay", 50) / 100.0, 0, 1);
  s->rev = (float)sh_clamp(wk_raw(g, "reverse", 50) / 100.0, 0, 1);
  s->D = (int)(sr / 24000.0 + 0.5);
  if (s->D < 1) s->D = 1;
  s->len = (int)(9.0 * sr / s->D);
  s->buf = (float *)ar_alloc(a, sizeof(float) * s->len);
  if (!s->buf) return 0;
  s->gapn = (int)(0.45 * sr);
  s->msa = wk_k(sr, 0.02), s->dk = wk_k(sr, 0.08), s->duck = 1;
  s->rng = 0xa54ff53au;
  op_lp_set(&s->far, sr, 9000 - 7800 * s->dist);
  if (!fdn_init(&s->f, a, sr, 1.8f, 40)) return 0;
  fdn_set(&s->f, 1.6f, 3.5f, 3000, 30, 1);
  s->c.run = seance_run;
  return &s->c;
}

/* -------------------------------------------------------------- SEVERED -- */
/* Two sounds that never meet. Work: tight, even and bright, with a short slap. Home: warm and soft,
   a gentle chorus in a small room. The buttons pick the one you're in; the footswitch swaps to the
   other (Overtime lights) and back, taking Memory to cross. Innie/Outie: how much of the other
   sound leaks through (none at Innie, half at Outie). */
typedef struct {
  wk_c c;
  env_t env;
  svf_t pres, warm;
  dl_t slap, ch;
  wk_fdn room;
  float p, k, bleed, ph1, ph2;
  int state;
} sev_t;

static float sev_run(wk_c *c, float x, float in0, float *dry) {
  sev_t *s = (sev_t *)c;
  int side = s->state ^ lab_on(c, 0);
  s->p += s->k * ((float)side - s->p);
  float lp, bp, hp;
  /* work */
  float e = env_run(&s->env, x) + 1e-5f;
  float cg = e > 0.02f ? sh_exp2f_fast(-0.833f * sh_log2f_fast(e / 0.02f)) : 1.f; /* 6:1 above -34 dB */
  float w = x * cg * 2.2f;
  svf_run(&s->pres, w, &lp, &bp, &hp);
  w = sh_tanhf(1.5f * (w + 0.5f * hp)) / 1.2f;
  float sl = dl_tapf(&s->slap, 0.09f * (float)c->sr);
  dl_push(&s->slap, w);
  w += 0.25f * sl;
  /* home */
  svf_run(&s->warm, x, &lp, &bp, &hp);
  float hm = sh_tanhf(1.4f * lp) / 1.1f;
  dl_push(&s->ch, hm);
  s->ph1 += (float)(0.6 / c->sr), s->ph2 += (float)(0.83 / c->sr);
  if (s->ph1 >= 1) s->ph1 -= 1;
  if (s->ph2 >= 1) s->ph2 -= 1;
  float msr = (float)c->sr * 0.001f;
  hm = 0.6f * hm + 0.35f * dl_tapf(&s->ch, msr * (7 + 2 * sh_sin01(s->ph1))) + 0.35f * dl_tapf(&s->ch, msr * (9 + 2 * sh_sin01(s->ph2)));
  hm += 0.3f * fdn_run(&s->room, hm);
  float q = s->p * (1.f - s->bleed) + 0.5f * s->bleed;
  *dry = 0;
  return w * sh_sinf_fast((1 - q) * (float)SH_PI * 0.5f) + hm * sh_sinf_fast(q * (float)SH_PI * 0.5f);
}

static wk_c *sev_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  sev_t *s = (sev_t *)ar_alloc(a, sizeof(sev_t));
  if (!s) return 0;
  wk_base(&s->c, WK_SEVERED, g, sr, bass, live, 1.f);
  s->c.own = 1;
  s->state = wk_sw(g, "state", 0, 2);
  s->p = (float)(s->state ^ ((int)s->c.live[SHP_LABW0 + WK_SEVERED] & 1));
  s->k = wk_k(sr, sh_clamp(wk_raw(g, "memory", 0.6f), 0.02, 3) / 3.0);
  s->bleed = (float)sh_clamp(wk_raw(g, "innie/outie", 0) / 100.0, 0, 1);
  env_set(&s->env, sr, 3, 120);
  wk_set(&s->pres, sr, 2500, 0.7);
  wk_set(&s->warm, sr, 3500 * s->c.fs, 0.6);
  if (!dl_init(&s->slap, a, (int)(0.1 * sr) + 8) || !dl_init(&s->ch, a, (int)(0.02 * sr) + 8) || !fdn_init(&s->room, a, sr, 0.6f, 10)) return 0;
  fdn_set(&s->room, 0.5f, 0.6f, 4000, 5, 1);
  s->c.run = sev_run;
  return &s->c;
}

/* --------------------------------------------------------------- SHANGO -- */
/* Call and answer. Hold Call and play: your call is caught (up to Length), burned by Fire and
   shaped by Tone. Answer sends it back: after Delay, moved by Pitch, repeating (Repeats). Balance:
   from your live playing to the answer. */
typedef struct {
  wk_c c;
  float *call;
  int max, n, rec, on, wait, waitn;
  double rp;
  wk_ps ps;
  svf_t tone;
  float fire, tmix, rep, gain, ratio, gl, ga;
} shango_t;

static float shango_run(wk_c *c, float x, float in0, float *dry) {
  shango_t *s = (shango_t *)c;
  int calling = lab_on(c, 0);
  float lp, bp, hp;
  float v = sh_tanhf(x * s->fire) / sh_tanhf(s->fire * 0.3f) * 0.3f;
  svf_run(&s->tone, v, &lp, &bp, &hp);
  v = lp + (hp - lp) * s->tmix;
  if (calling && !s->rec) s->rec = 1, s->n = 0;
  if (s->rec) {
    if (calling && s->n < s->max) s->call[s->n++] = v;
    else s->rec = 0;
  }
  if (lab_tap(c, 1) && s->n > 64) s->on = 1, s->wait = s->waitn, s->rp = 0, s->gain = 1;
  float y = 0;
  if (s->on) {
    if (s->wait > 0) s->wait--;
    else {
      int i = (int)s->rp;
      float in = i < s->n ? s->call[i] : 0;
      float fade = i < 64 ? i / 64.f : s->n - i < 64 ? (s->n - i) / 64.f : 1.f;
      y = in * fade * s->gain;
      if (++s->rp >= s->n) {
        s->rp = 0, s->gain *= s->rep, s->wait = s->waitn;
        if (s->gain < 0.03f) s->on = 0;
      }
    }
  }
  y = wk_ps_run(&s->ps, y, s->ratio);
  *dry = x * s->gl;
  return y * s->ga * 1.3f;
}

static wk_c *shango_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  shango_t *s = (shango_t *)ar_alloc(a, sizeof(shango_t));
  if (!s) return 0;
  wk_base(&s->c, WK_SHANGO, g, sr, bass, live, 1.f);
  s->c.add = 1, s->c.own = 1, s->c.gw = 1;
  s->fire = 1.f + 12.f * (float)sh_clamp(wk_raw(g, "fire", 40) / 100.0, 0, 1);
  s->tmix = (float)sh_clamp(wk_raw(g, "tone", 55) / 100.0, 0, 1);
  s->max = (int)(sh_clamp(wk_raw(g, "length", 1.5f), 0.25, 4) * sr);
  s->waitn = (int)(sh_clamp(wk_raw(g, "delay", 400), 0, 2000) * 0.001 * sr);
  float semis = (float)sh_clamp(wk_raw(g, "pitch", 7), -12, 12);
  s->ratio = sh_exp2f_fast(semis / 12.f);
  s->rep = 0.85f * (float)sh_clamp(wk_raw(g, "repeats", 40) / 100.0, 0, 1);
  wk_blend((float)sh_clamp(wk_raw(g, "balance", 50) / 100.0, 0, 1), &s->gl, &s->ga);
  wk_set(&s->tone, sr, 1200 * s->c.fs, 0.7);
  s->call = (float *)ar_alloc(a, sizeof(float) * (s->max + 1));
  if (!s->call || !wk_ps_init(&s->ps, a, sr, s->ratio > 1 ? s->ratio : 1)) return 0;
  s->c.run = shango_run;
  return &s->c;
}
