/*
 * 4.20: The Lab, part 1: space, freezes and layers.
 *   Annwn, Apoptosis, Bifrost, Blue Prince, Duat, Event Horizon, Inanna, Olympus, Reliquary.
 * Live slot bits are in the order of each pedal's footswitch list in gear2014.json ("m").
 */

/* ---------------------------------------------------------------- ANNWN -- */
/* A cloud of grains from the last couple of seconds. The Veil: across is how far back the grains
   reach (50 ms to 2 s), up is how far their pitch scatters (none to an octave either way).
   Mist: airy, backwards pieces in a haze. Hound: pieces in pulses, like echoes running past.
   Hollow: long, dark pieces from anywhere in the recording, a still texture. Return: how long the
   cloud lingers after you stop. Cross (held): the recording stops changing and the cloud hangs on. */
typedef struct {
  wk_c c;
  wk_rec rec;
  wk_gr gr;
  wk_fdn fdn;
  env_t env;
  svf_t tone;
  uint32_t rng;
  int mode, cnt2, hop, glen, pulse;
  float reach, spread, lvl, rel, att;
} annwn_t;

static float annwn_run(wk_c *c, float x, float in0, float *dry) {
  annwn_t *s = (annwn_t *)c;
  int frozen = lab_on(c, 0);
  if (!frozen) rec_push(&s->rec, x);
  float e = env_run(&s->env, x);
  float want = frozen ? 1.f : e > 0.003f ? 1.f : 0.f;
  s->lvl += (want > s->lvl ? s->att : s->rel) * (want - s->lvl);
  if (--s->cnt2 <= 0) {
    s->cnt2 = s->hop;
    if (s->lvl > 0.001f) {
      float r = 0.5f + 0.5f * lab_rnd(&s->rng);
      float back = (float)c->sr * (0.05f + s->reach * (s->mode == 2 ? (0.3f + 0.7f * r) : (0.6f + 0.4f * r)));
      if (s->mode == 1) back = (float)c->sr * 0.15f * (float)(1 + (s->pulse++ % 4)) * (0.5f + s->reach); /* echoes in steps */
      float semis = s->spread * 12.f * lab_rnd(&s->rng);
      if (s->mode == 2) semis = (float)((int)(semis / 7.f)) * 7.f; /* Hollow: fifths and octaves only */
      double rate = sh_exp2f_fast(semis / 12.f);
      int len = s->glen;
      double start = (double)s->rec.w - back - (rate > 1 ? len * (rate - 1) : 0);
      if (s->mode == 0) gr_start(&s->gr, start + len, -rate, len, 0.6f); /* Mist: backwards */
      else gr_start(&s->gr, start, rate, len, s->mode == 1 ? 0.9f : 0.55f);
    }
  }
  float y = gr_run(&s->gr);
  float lp, bp, hp;
  svf_run(&s->tone, y, &lp, &bp, &hp);
  y = s->mode == 0 ? hp : s->mode == 2 ? lp : y;
  if (s->mode == 0) y = 0.6f * y + 0.6f * fdn_run(&s->fdn, y);
  return y * s->lvl * 1.4f;
}

static wk_c *annwn_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  annwn_t *s = (annwn_t *)ar_alloc(a, sizeof(annwn_t));
  if (!s) return 0;
  wk_base(&s->c, WK_ANNWN, g, sr, bass, live, 0.5f);
  s->mode = wk_sw(g, "texture", 0, 3);
  s->reach = (float)sh_clamp(wk_raw(g, "veil x", 40) / 100.0, 0, 1) * 1.95f;
  s->spread = (float)sh_clamp(wk_raw(g, "veil y", 25) / 100.0, 0, 1);
  float ret = (float)sh_clamp(wk_raw(g, "return", 2), 0.2, 8);
  s->rel = wk_k(sr, ret / 4.0), s->att = wk_k(sr, 0.05);
  static const float GL[3] = {0.12f, 0.06f, 0.3f}, HOP[3] = {0.03f, 0.04f, 0.06f};
  s->glen = (int)(GL[s->mode] * sr * (bass ? 1.4 : 1));
  s->hop = (int)(HOP[s->mode] * sr);
  s->rng = 0x51ed27u;
  env_set(&s->env, sr, 3, 120);
  if (s->mode == 0) wk_set(&s->tone, sr, 400 * s->c.fs, 0.7);
  else wk_set(&s->tone, sr, 1200 * s->c.fs, 0.7);
  if (!rec_init(&s->rec, a, (int)(2.6 * sr))) return 0;
  s->gr.buf = s->rec.buf, s->gr.len = s->rec.len;
  if (s->mode == 0) {
    if (!fdn_init(&s->fdn, a, sr, 1.2f, 20)) return 0;
    fdn_set(&s->fdn, 1.1f, 2.2f, 6000, 10, 1);
  }
  s->c.run = annwn_run;
  return &s->c;
}

/* ------------------------------------------------------------ APOPTOSIS -- */
/* Release captures the last moment of your playing (a chord) and holds it as a drone split into
   four bands: Body (lows), Bone (low mids), Dust (high mids), Air (highs). Fall: every band starts
   full and dies away, each over its own part of Lifespan (its slider: the higher, the longer it
   lives). Bloom: each band grows in over its time, then fades again. Mix: how loud it sits under
   your playing, which carries on as normal. */
typedef struct {
  wk_c c;
  wk_rec rec;
  float *seg;
  int C, L, hop, pos[4], age[4], on;
  uint32_t rng;
  wk_bands bands;
  float life[4], t, dt, bloom;
} apop_t;

static float apop_run(wk_c *c, float x, float in0, float *dry) {
  apop_t *s = (apop_t *)c;
  rec_push(&s->rec, x);
  if (lab_tap(c, 0)) {
    rec_copy(&s->rec, s->seg, s->C);
    s->on = 1, s->t = 0;
    for (int k = 0; k < 4; k++) s->age[k] = -k * s->hop, s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
  }
  if (!s->on) return 0;
  float v = 0;
  for (int k = 0; k < 4; k++) {
    int a = s->age[k]++;
    if (a < 0) continue;
    if (a >= s->L) a = s->age[k] = 0, s->pos[k] = (int)((0.5f + 0.5f * lab_rnd(&s->rng)) * (s->C - s->L - 1));
    float t = (float)a / s->L;
    v += s->seg[s->pos[k] + a] * (0.5f - 0.5f * sh_sin01(t + 0.25f));
  }
  v *= 0.5f;
  float b[4];
  bands_run(&s->bands, v, b);
  s->t += s->dt;
  float y = 0, alive = 0;
  for (int k = 0; k < 4; k++) {
    float u = s->t / s->life[k], gk;
    if (!s->bloom) gk = u < 6.9f ? sh_expf_fast(-u) : 0.f; /* -60 dB at 6.9 lives */
    else gk = u < 2 ? sh_sinf_fast((float)SH_PI * 0.5f * u) : 0.f; /* grows in over its time, fades over the same */
    y += b[k] * gk, alive += gk;
  }
  if (alive < 1e-4f && s->t > 0.01f) s->on = 0; /* (a bloom starts from nothing) */
  return y;
}

static wk_c *apop_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  apop_t *s = (apop_t *)ar_alloc(a, sizeof(apop_t));
  if (!s) return 0;
  wk_base(&s->c, WK_APOPTOSIS, g, sr, bass, live, 0.8f);
  s->c.add = 1, s->c.clean = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 80) / 100.0, 0, 1);
  float span = (float)sh_clamp(wk_raw(g, "lifespan", 3), 0.3, 12);
  static const char *N[4] = {"body", "bone", "dust", "air"};
  static const float D[4] = {70, 40, 60, 25};
  for (int k = 0; k < 4; k++) s->life[k] = span * (0.05f + 0.95f * (float)sh_clamp(wk_raw(g, N[k], D[k]) / 100.0, 0, 1)) / 6.9f * 3.f;
  s->bloom = (float)wk_sw(g, "fall/bloom", 0, 2);
  if (s->bloom)
    for (int k = 0; k < 4; k++) s->life[k] *= 2.3f; /* a bloom's time is the whole rise */
  s->dt = (float)(1.0 / sr);
  s->C = (int)(0.6 * sr), s->L = (int)((bass ? 0.2 : 0.14) * sr), s->hop = s->L / 4;
  s->rng = 0x6a09e667u;
  static const float X[3] = {250, 1000, 4000};
  float xs[3] = {X[0] * s->c.fs, X[1] * s->c.fs, X[2]};
  bands_init(&s->bands, sr, 4, xs);
  s->seg = (float *)ar_alloc(a, sizeof(float) * s->C);
  if (!s->seg || !rec_init(&s->rec, a, (int)(0.7 * sr))) return 0;
  s->c.run = apop_run;
  return &s->c;
}

/* -------------------------------------------------------------- BIFROST -- */
/* Two skies: Frost, an icy shimmer (a reverb whose tail climbs an octave each time round), and the
   Realm below, a dark ambience (at your pitch on Midgard, an octave down on Helheim). Rift: from all
   dark (down) to all ice (up). Realm: how big and long both are. Frost: how much the ice sparkles.
   Cross (held): swings the rift over to the other side while you hold it. */
typedef struct {
  wk_c c;
  wk_fdn ice, dark;
  wk_ps up, down;
  svf_t ihp, dlp;
  float frost, rift, cur, xk, fb;
  int hel;
} bif_t;

static float bif_run(wk_c *c, float x, float in0, float *dry) {
  bif_t *s = (bif_t *)c;
  float want = lab_on(c, 0) ? 1.f - s->rift : s->rift;
  s->cur += s->xk * (want - s->cur);
  /* ice: the tail is shifted up an octave and fed back in */
  float lp, bp, hp;
  float shim = wk_ps_run(&s->up, s->fb, 2.0);
  float iy = fdn_run(&s->ice, x + 0.55f * s->frost * shim);
  svf_run(&s->ihp, iy, &lp, &bp, &hp);
  iy = hp + (1 - s->frost) * 0.5f * lp;
  s->fb = iy;
  /* the realm below */
  float din = s->hel ? wk_ps_run(&s->down, x, 0.5) : x;
  float dy = fdn_run(&s->dark, din);
  svf_run(&s->dlp, dy, &lp, &bp, &hp);
  dy = lp;
  float gi = sh_sinf_fast(s->cur * (float)SH_PI * 0.5f), gd = sh_sinf_fast((1 - s->cur) * (float)SH_PI * 0.5f);
  return 1.6f * (iy * gi + dy * gd);
}

static wk_c *bif_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  bif_t *s = (bif_t *)ar_alloc(a, sizeof(bif_t));
  if (!s) return 0;
  wk_base(&s->c, WK_BIFROST, g, sr, bass, live, 0.45f);
  float realm = (float)sh_clamp(wk_raw(g, "realm", 50) / 100.0, 0, 1);
  s->frost = (float)sh_clamp(wk_raw(g, "frost", 60) / 100.0, 0, 1);
  s->rift = s->cur = (float)sh_clamp(wk_raw(g, "rift", 50) / 100.0, 0, 1);
  s->hel = wk_sw(g, "midgard/helheim", 0, 2);
  s->xk = wk_k(sr, 0.15);
  if (!fdn_init(&s->ice, a, sr, 2.0f, 20) || !fdn_init(&s->dark, a, sr, 2.2f, 40)) return 0;
  fdn_set(&s->ice, 0.8f + realm, 1.5f + 5.f * realm, 9000, 10, 1);
  fdn_set(&s->dark, 1.0f + realm, 2.f + 6.f * realm, 1400 * s->c.fs, 30, 1);
  if (!wk_ps_init(&s->up, a, sr, 2) || !wk_ps_init(&s->down, a, sr, 1)) return 0;
  wk_set(&s->ihp, sr, 500, 0.6);
  wk_set(&s->dlp, sr, 1800 * s->c.fs, 0.6);
  s->c.run = bif_run;
  return &s->c;
}

/* --------------------------------------------------------- BLUE PRINCE -- */
/* Three rooms: a Study (small, close, bright), the Hall (big and long) and the Cellar (dark, boomy).
   Pick one with its button and the sound walks there over Steps, through the rooms in between, as
   it plays. Draft (held): walks into the next room while you hold it. Depth: how much of the room
   you hear. Enter is the pedal's own on and off. */
static const float BP_ROOM[3][4] = {
    /* size, decay s, brightness Hz, wait ms */
    {0.45f, 0.7f, 7000, 6},
    {1.7f, 3.0f, 4800, 32},
    {1.1f, 1.7f, 650, 14},
};
typedef struct {
  wk_c c;
  wk_fdn f;
  float pos, k, p[4];
} bp_t;

static float bp_run(wk_c *c, float x, float in0, float *dry) {
  bp_t *s = (bp_t *)c;
  int room = (int)(c->lval + 0.5f);
  room = room < 0 ? 0 : room > 2 ? 2 : room;
  int want = lab_on(c, 0) ? (room + 1) % 3 : room; /* Draft: the next room (the Cellar's next is the Study) */
  s->pos += s->k * ((float)want - s->pos);           /* walks through the rooms in between */
  if (--c->cnt <= 0) {
    c->cnt = 32;
    int i = (int)s->pos;
    if (i > 1) i = 1;
    float f = s->pos - (float)i;
    const float *A = BP_ROOM[i], *B = BP_ROOM[i + 1];
    for (int j = 0; j < 4; j++) s->p[j] = A[j] + (B[j] - A[j]) * f;
    fdn_set(&s->f, s->p[0], s->p[1], s->p[2] * c->fs, s->p[3], 0);
  }
  return 1.5f * fdn_run(&s->f, x);
}

static wk_c *bp_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  bp_t *s = (bp_t *)ar_alloc(a, sizeof(bp_t));
  if (!s) return 0;
  wk_base(&s->c, WK_BLUEPRINCE, g, sr, bass, live, 0.45f);
  wk_blend((float)sh_clamp(wk_raw(g, "depth", 45) / 100.0, 0, 1), &s->c.gd, &s->c.gw);
  float steps = (float)sh_clamp(wk_raw(g, "steps", 0.8f), 0.05, 4);
  s->k = wk_k(sr, steps / 3.0);
  int room = (int)(s->c.live[SHP_LABV0 + WK_BLUEPRINCE] + 0.5f);
  s->pos = (float)(room < 0 ? 0 : room > 2 ? 2 : room); /* a new tone starts in its room */
  if (!fdn_init(&s->f, a, sr, 1.8f, 40)) return 0;
  const float *R = BP_ROOM[(int)s->pos];
  for (int j = 0; j < 4; j++) s->p[j] = R[j];
  fdn_set(&s->f, R[0], R[1], R[2] * s->c.fs, R[3], 1);
  s->c.run = bp_run;
  return &s->c;
}

/* ----------------------------------------------------------------- DUAT -- */
/* Four layers of the underworld, each with its own slider: Gate I a dark room, Gate II a deep hall,
   Gate III that hall an octave down, Gate IV two octaves down in a long, still dark. The balance:
   Heart (left) is your own sound, Feather (right) the underworld. Descend (held): only the layer
   Passage points to is heard, alone. */
typedef struct {
  wk_c c;
  wk_fdn f[4];
  wk_ps o1, o2;
  svf_t lp[4];
  float lvl[4], iso[4], ik;
  int pass;
} duat_t;

static float duat_run(wk_c *c, float x, float in0, float *dry) {
  duat_t *s = (duat_t *)c;
  int down = lab_on(c, 0);
  float d1 = wk_ps_run(&s->o1, x, 0.5), d2 = wk_ps_run(&s->o2, x, 0.25);
  float in[4] = {x, x, d1, d2}, y = 0, lp, bp, hp;
  for (int k = 0; k < 4; k++) {
    float w = down ? (k == s->pass ? 1.f : 0.f) : s->lvl[k];
    s->iso[k] += s->ik * (w - s->iso[k]);
    if (s->iso[k] < 1e-4f && s->lvl[k] <= 0 && !down) continue;
    svf_run(&s->lp[k], fdn_run(&s->f[k], in[k]), &lp, &bp, &hp);
    y += lp * s->iso[k];
  }
  if (down) *dry = 0; /* descending: only the layer */
  return 1.2f * y;
}

static wk_c *duat_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  duat_t *s = (duat_t *)ar_alloc(a, sizeof(duat_t));
  if (!s) return 0;
  wk_base(&s->c, WK_DUAT, g, sr, bass, live, 0.4f);
  wk_blend((float)sh_clamp(wk_raw(g, "balance", 40) / 100.0, 0, 1), &s->c.gd, &s->c.gw);
  static const char *N[4] = {"gate i", "gate ii", "gate iii", "gate iv"};
  static const float D[4] = {70, 50, 35, 20};
  static const float SZ[4] = {0.7f, 1.6f, 1.6f, 2.0f}, T[4] = {1.6f, 3.5f, 3.5f, 9.f}, DMP[4] = {2200, 1600, 1200, 800};
  for (int k = 0; k < 4; k++) {
    s->lvl[k] = s->iso[k] = (float)sh_clamp(wk_raw(g, N[k], D[k]) / 100.0, 0, 1);
    if (!fdn_init(&s->f[k], a, sr, SZ[k], 30)) return 0;
    fdn_set(&s->f[k], SZ[k], T[k], DMP[k] * s->c.fs, 10 + 8 * k, 1);
    wk_set(&s->lp[k], sr, DMP[k] * 1.5f * s->c.fs, 0.6);
  }
  s->pass = wk_sw(g, "passage", 0, 4);
  s->ik = wk_k(sr, 0.05);
  if (!wk_ps_init(&s->o1, a, sr, 1) || !wk_ps_init(&s->o2, a, sr, 1)) return 0;
  s->c.run = duat_run;
  return &s->c;
}

/* -------------------------------------------------------- EVENT HORIZON -- */
/* Echoes that fall into deep pitch: every time round the echo is stretched out in time (grains
   played slower than they were recorded) and dropped by Redshift semitones. Time: between echoes.
   Gravity across: how much each echo is stretched (none to three times). Gravity up: how hard it
   pulls them back round (more echoes). Collapse (held): everything falls in at once (more pull,
   twice the drop). */
typedef struct {
  wk_c c;
  wk_rec loop, src;
  wk_gr gr;
  op_t damp;
  float time, red, stretch, pull, fb, cur, ck, gp;
  int hop, cnt2, glen;
  double rp;
} eh_t;

static float eh_run(wk_c *c, float x, float in0, float *dry) {
  eh_t *s = (eh_t *)c;
  int col = lab_on(c, 0);
  s->cur += s->ck * ((col ? 0.92f : s->pull) - s->cur);
  /* the echo comes back from the loop, is stretched and dropped by grains, and goes round again */
  float back = rec_tap(&s->loop, s->time * (float)c->sr);
  rec_push(&s->src, back);
  float semis = s->red * (col ? 2.f : 1.f);
  double rate = sh_exp2f_fast(-semis / 12.f);
  /* the read point moves slower than time (a stretch), so it falls behind; when it has fallen as far
     back as the recording reaches, it starts again from now (the grains hide the jump) */
  s->rp += 1.0 / s->stretch - 1.0;
  if (s->rp < -(double)(s->src.len - 4 * s->glen)) s->rp = 0;
  if (--s->cnt2 <= 0) {
    s->cnt2 = s->hop;
    double start = (double)s->src.w + s->rp - s->glen * 1.2;
    gr_start(&s->gr, start, rate, s->glen, 1.f);
  }
  float y = gr_run(&s->gr) * 0.75f;
  y = op_lp(&s->damp, y);
  rec_push(&s->loop, x + sh_tanhf(y * s->cur * 1.1f));
  return y;
}

static wk_c *eh_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  eh_t *s = (eh_t *)ar_alloc(a, sizeof(eh_t));
  if (!s) return 0;
  wk_base(&s->c, WK_EVENTHORIZON, g, sr, bass, live, 0.4f);
  s->c.add = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "mix", 40) / 100.0, 0, 1);
  s->time = (float)(sh_clamp(wk_raw(g, "time", 400), 80, 1200) * 0.001);
  s->red = (float)sh_clamp(wk_raw(g, "redshift", 5), 0, 12);
  s->stretch = 1.f + 2.f * (float)sh_clamp(wk_raw(g, "gravity x", 50) / 100.0, 0, 1);
  s->pull = s->cur = 0.2f + 0.65f * (float)sh_clamp(wk_raw(g, "gravity y", 50) / 100.0, 0, 1);
  s->ck = wk_k(sr, 0.2);
  s->glen = (int)(0.09 * sr), s->hop = s->glen / 2;
  op_lp_set(&s->damp, sr, 3500 * s->c.fs);
  if (!rec_init(&s->loop, a, (int)(1.3 * sr)) || !rec_init(&s->src, a, (int)(1.0 * sr))) return 0;
  s->gr.buf = s->src.buf, s->gr.len = s->src.len;
  s->c.run = eh_run;
  return &s->c;
}

/* --------------------------------------------------------------- INANNA -- */
/* Seven bands of your sound (lowest I to highest VII), each with its own slider. Descent takes the
   bands away from the top down, one after another, as you turn it. Star, Earth or Both: echoes of
   the bright side, the dark side, or both (Mix sets how loud). Return (held): every band comes
   back at full while you hold it. */
typedef struct {
  wk_c c;
  wk_bands bands;
  float g[7], cur[7], gk, ek;
  dl_t dl;
  svf_t elp, ehp;
  int echo;
} inanna_t;

static float inanna_run(wk_c *c, float x, float in0, float *dry) {
  inanna_t *s = (inanna_t *)c;
  float b[7], y = 0;
  bands_run(&s->bands, x, b);
  int ret = lab_on(c, 0);
  for (int k = 0; k < 7; k++) {
    s->cur[k] += s->gk * ((ret ? 1.f : s->g[k]) - s->cur[k]);
    y += b[k] * s->cur[k];
  }
  /* the echo */
  float e = dl_tapf(&s->dl, 0.38f * (float)c->sr), lp, bp, hp, ein = 0;
  if (s->echo != 1) svf_run(&s->ehp, e, &lp, &bp, &hp), ein += hp;
  if (s->echo != 0) svf_run(&s->elp, e, &lp, &bp, &hp), ein += lp;
  dl_push(&s->dl, y + 0.45f * ein);
  *dry = y; /* the bands are the main sound */
  return ein * 1.4f;
}

static wk_c *inanna_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  inanna_t *s = (inanna_t *)ar_alloc(a, sizeof(inanna_t));
  if (!s) return 0;
  wk_base(&s->c, WK_INANNA, g, sr, bass, live, 0.35f);
  s->c.add = 1, s->c.own = 1, s->c.gw = (float)sh_clamp(wk_raw(g, "echoes", 35) / 100.0, 0, 1);
  s->c.clean = 1;
  static const char *N[7] = {"i", "ii", "iii", "iv", "v", "vi", "vii"};
  float d = (float)sh_clamp(wk_raw(g, "descent", 0) / 100.0, 0, 1);
  for (int k = 0; k < 7; k++) {
    float v = (float)sh_clamp(wk_raw(g, N[k], 75) / 100.0, 0, 1) * 1.33f; /* 75 is the band as it was */
    float att = d * 7.f - (6 - k);
    att = 1.f - (att < 0 ? 0 : att > 1 ? 1 : att);
    s->g[k] = s->cur[k] = v * att;
  }
  float X[6] = {120, 250, 500, 1000, 2000, 4000};
  for (int k = 0; k < 6; k++) X[k] *= s->c.fs;
  bands_init(&s->bands, sr, 7, X);
  s->echo = wk_sw(g, "echo", 2, 3);
  s->gk = wk_k(sr, 0.03);
  wk_set(&s->ehp, sr, 2200, 0.7);
  wk_set(&s->elp, sr, 600 * s->c.fs, 0.7);
  if (!dl_init(&s->dl, a, (int)(0.4 * sr) + 8)) return 0;
  s->c.run = inanna_run;
  return &s->c;
}

/* -------------------------------------------------------------- OLYMPUS -- */
/* Thunder (the lever): an octave fuzz, from a little hair to a storm. Sky: dark to bright. Storm:
   how fast it throbs (off at the bottom). Echo and Cloud: how much echo and how much reverb.
   Strike (held): every pick you make hits harder into the fuzz. Hold: the reverb's tail freezes
   and hangs there until you press it again. */
typedef struct {
  wk_c c;
  wk_fdn f;
  dl_t dl;
  env_t env;
  wk_onset on;
  svf_t tone;
  wk_keeper kp;
  float thunder, sky, rate, ph, echo, cloud, kick;
} olym_t;

static float olym_run(wk_c *c, float x, float in0, float *dry) {
  olym_t *s = (olym_t *)c;
  int hit = wk_onset_run(&s->on, x);
  if (hit && lab_on(c, 0)) s->kick = 1;
  s->kick *= 0.9995f;
  float drive = 1.f + 25.f * s->thunder * (1.f + 2.f * s->kick);
  float oct = sh_fabsf(x) * 1.6f - 0.5f * env_run(&s->env, x); /* an octave up, centred */
  float v = lab_sat(x + s->thunder * oct, drive);
  float lp, bp, hp;
  svf_run(&s->tone, v, &lp, &bp, &hp);
  v = lp + (hp - lp) * s->sky * 0.6f + lp * (1 - s->sky) * 0.3f;
  v = wk_keep(&s->kp, x, v);
  if (s->rate > 0.25f) {
    s->ph += s->rate / (float)c->sr;
    if (s->ph >= 1) s->ph -= 1;
    v *= 0.75f + 0.25f * sh_sin01(s->ph);
  }
  float e = dl_tapf(&s->dl, 0.33f * (float)c->sr);
  dl_push(&s->dl, v + 0.35f * e);
  s->f.freeze = lab_on(c, 1);
  float r = fdn_run(&s->f, v);
  return v + s->echo * e + s->cloud * 1.5f * r; /* Mix: from your own sound to the storm */
}

static wk_c *olym_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  olym_t *s = (olym_t *)ar_alloc(a, sizeof(olym_t));
  if (!s) return 0;
  wk_base(&s->c, WK_OLYMPUS, g, sr, bass, live, 1.f);
  s->thunder = (float)sh_clamp(wk_raw(g, "thunder", 45) / 100.0, 0, 1);
  s->sky = (float)sh_clamp(wk_raw(g, "sky", 55) / 100.0, 0, 1);
  s->rate = (float)sh_clamp(wk_raw(g, "storm", 4), 0, 10);
  s->echo = (float)sh_clamp(wk_raw(g, "echo", 25) / 100.0, 0, 1);
  s->cloud = (float)sh_clamp(wk_raw(g, "cloud", 30) / 100.0, 0, 1);
  env_set(&s->env, sr, 5, 60);
  wk_onset_init(&s->on, sr, bass, 0.003f);
  wk_set(&s->tone, sr, 1500 * s->c.fs, 0.7);
  wk_keep_init(&s->kp, sr);
  if (!dl_init(&s->dl, a, (int)(0.35 * sr) + 8) || !fdn_init(&s->f, a, sr, 1.6f, 30)) return 0;
  fdn_set(&s->f, 1.5f, 3.2f, 5000, 20, 1);
  s->c.run = olym_run;
  return &s->c;
}

/* ------------------------------------------------------------ RELIQUARY -- */
/* A cathedral. Incense: how big and how long it is (about 1.5 to 9 seconds). Choir: voices an
   octave and a fifth above your notes, sung through an "aah", rise in the reverb. Dust: how old
   and dark the stone is. Amen is the pedal's own on and off. */
typedef struct {
  wk_c c;
  wk_fdn f;
  wk_ps p12, p7;
  svf_t v1, v2;
  op_t dust;
  float choir;
} reliq_t;

static float reliq_run(wk_c *c, float x, float in0, float *dry) {
  reliq_t *s = (reliq_t *)c;
  float ch = 0;
  if (s->choir > 0) {
    float h = 0.6f * wk_ps_run(&s->p12, x, 2.0) + 0.5f * wk_ps_run(&s->p7, x, 1.4983);
    ch = (wk_bp(&s->v1, h) + 0.7f * wk_bp(&s->v2, h)) * s->choir * 2.f;
  }
  float r = fdn_run(&s->f, x + ch);
  return 1.6f * op_lp(&s->dust, r);
}

static wk_c *reliq_build(const sh_gear *g, sh_arena *a, double sr, int bass, const float *live) {
  reliq_t *s = (reliq_t *)ar_alloc(a, sizeof(reliq_t));
  if (!s) return 0;
  wk_base(&s->c, WK_RELIQUARY, g, sr, bass, live, 0.4f);
  s->choir = (float)sh_clamp(wk_raw(g, "choir", 45) / 100.0, 0, 1);
  float inc = (float)sh_clamp(wk_raw(g, "incense", 55) / 100.0, 0, 1);
  float dust = (float)sh_clamp(wk_raw(g, "dust", 30) / 100.0, 0, 1);
  if (!fdn_init(&s->f, a, sr, 2.5f, 60)) return 0;
  fdn_set(&s->f, 1.4f + 1.1f * inc, 1.5f + 7.5f * inc, 9000 - 7000 * dust, 25 + 30 * inc, 1);
  op_lp_set(&s->dust, sr, 14000 - 11000 * dust);
  wk_set(&s->v1, sr, 750, 6);
  wk_set(&s->v2, sr, 1150, 7);
  if (s->choir > 0 && (!wk_ps_init(&s->p12, a, sr, 2) || !wk_ps_init(&s->p7, a, sr, 1.5))) return 0;
  s->c.run = reliq_run;
  return &s->c;
}
