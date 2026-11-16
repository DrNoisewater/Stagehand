/*
 * 4.20: The Lab's shared parts for the thirty newer pedals (sh_lab1-3.h), included by sh_wacky.h.
 *
 *   lab_on / lab_tap  a pedal's live footswitches and buttons (SHP_LABW0 + its number): held, or just pressed
 *   wk_fdn            a smooth reverb (eight delay lines mixed into each other), size and decay can move while it plays
 *   wk_gr             grains: short faded pieces read from a recording, forwards or backwards, at any speed
 *   wk_bands          a splitter whose bands add back up to exactly the input (Apoptosis, Inanna, Mimic)
 *   wk_hil            a frequency shifter (every partial moved by the same number of Hz: Tezcatl)
 *   wk_rec            a recording you can copy from (captures)
 */

/* ------------------------------------------------------------ live slot -- */
static inline int lab_on(const wk_c *c, int i) { return (c->word >> i) & 1; }
static inline int lab_tap(const wk_c *c, int i) { return (c->rise >> i) & 1; }
static inline float lab_tempo(const wk_c *c) {
  float b = c->live[SHP_TEMPO];
  return b > 30 && b < 400 ? b : 120.f;
}

static void nothing_proc(sh_block *b, float *L, float *R, int n) { (void)b, (void)L, (void)R, (void)n; }

/* a cheap random number in -1..1 */
static inline float lab_rnd(uint32_t *s) { return sh_randf(s); }

/* ------------------------------------------------------------- reverb -- */
/* Eight delay lines mixed into each other every time round (a Householder matrix), each with a
   gentle low-pass, two of them slowly wobbling so it never rings metallic. Size scales the lines
   (0.3 small room .. 2.5 cathedral), decay is the time to die away by 60 dB, damp the brightness.
   All three can change while it plays (the lines are read between samples). freeze: nothing new
   goes in and nothing dies away. */
#define FDN_N 8
typedef struct {
  float *buf[FDN_N];
  int len[FDN_N], wi[FDN_N];
  float base[FDN_N], cur[FDN_N], g[FDN_N], lp[FDN_N], damp, size, t60, sk, ph, pr;
  double sr;
  int freeze;
  float pre_s, *pre;
  int prelen, pw;
  float apb[2][2048];
  int apw[2], apl[2];
} wk_fdn;

static const float FDN_MS[FDN_N] = {29.7f, 37.1f, 41.1f, 43.7f, 53.0f, 59.3f, 67.1f, 73.3f};

static int fdn_init(wk_fdn *f, sh_arena *a, double sr, float maxsize, float maxpre_ms) {
  f->sr = sr;
  for (int i = 0; i < FDN_N; i++) {
    f->base[i] = (float)(FDN_MS[i] * 0.001 * sr);
    f->len[i] = (int)(f->base[i] * maxsize) + 64;
    f->buf[i] = (float *)ar_alloc(a, sizeof(float) * f->len[i]);
    if (!f->buf[i]) return 0;
  }
  f->prelen = (int)(maxpre_ms * 0.001 * sr) + 4;
  f->pre = (float *)ar_alloc(a, sizeof(float) * f->prelen);
  f->apl[0] = (int)(0.0047 * sr), f->apl[1] = (int)(0.0113 * sr);
  if (f->apl[0] > 2047) f->apl[0] = 2047;
  if (f->apl[1] > 2047) f->apl[1] = 2047;
  f->sk = wk_k(sr, 0.12);
  f->size = 1, f->t60 = 2, f->damp = 0.5f;
  for (int i = 0; i < FDN_N; i++) f->cur[i] = f->base[i];
  f->pr = (float)(0.3 / sr);
  return f->pre != 0;
}

/* size 0.3..maxsize, t60 seconds, damp_hz brightness, pre_ms wait before it starts; at once = no glide */
static void fdn_set(wk_fdn *f, float size, float t60, float damp_hz, float pre_ms, int at_once) {
  f->size = size, f->t60 = t60 < 0.05f ? 0.05f : t60;
  f->damp = (float)(1 - sh_exp(-SH_TAU * (damp_hz < 200 ? 200 : damp_hz) / f->sr));
  f->pre_s = (float)(pre_ms * 0.001 * f->sr);
  if (f->pre_s > f->prelen - 2) f->pre_s = (float)(f->prelen - 2);
  if (at_once)
    for (int i = 0; i < FDN_N; i++) f->cur[i] = f->base[i] * size;
}

static inline float fdn_read(const float *b, int len, int w, float d) {
  float p = (float)w - 1 - d; /* w is where the next sample goes */
  while (p < 0) p += (float)len;
  int i = (int)p;
  float fr = p - (float)i;
  int j = i + 1 == len ? 0 : i + 1;
  return b[i] + (b[j] - b[i]) * fr;
}

static float fdn_run(wk_fdn *f, float x) {
  /* wait, then smear the start a little (two all-passes) */
  f->pre[f->pw] = x;
  float in = fdn_read(f->pre, f->prelen, f->pw, f->pre_s);
  f->pw = f->pw + 1 == f->prelen ? 0 : f->pw + 1;
  for (int k = 0; k < 2; k++) {
    int r = f->apw[k] - f->apl[k];
    if (r < 0) r += 2048;
    float d = f->apb[k][r];
    float v = in + 0.6f * d;
    f->apb[k][f->apw[k]] = v;
    f->apw[k] = (f->apw[k] + 1) & 2047;
    in = d - 0.6f * v;
  }
  if (f->freeze) in = 0;
  f->ph += f->pr;
  if (f->ph >= 1) f->ph -= 1;
  float o[FDN_N], sum = 0;
  for (int i = 0; i < FDN_N; i++) {
    float want = f->base[i] * f->size;
    if (want > f->len[i] - 8) want = (float)(f->len[i] - 8);
    f->cur[i] += f->sk * (want - f->cur[i]);
    float d = f->cur[i];
    if (i == 1) d += 6.f * sh_sin01(f->ph);
    if (i == 6) d += 5.f * sh_sin01(f->ph + 0.33f);
    o[i] = fdn_read(f->buf[i], f->len[i], f->wi[i], d);
    sum += o[i];
  }
  float h = sum * (2.f / FDN_N), y = 0;
  for (int i = 0; i < FDN_N; i++) {
    float g = f->freeze ? 1.f : sh_exp2f_fast(-3.f * 3.3219f * f->cur[i] / ((float)f->sr * f->t60)); /* 10^(-3 d / (sr t60)) */
    float v = (o[i] - h) * g;
    if (!f->freeze) f->lp[i] += f->damp * (v - f->lp[i]), v = f->lp[i];
    else f->lp[i] = v;
    f->buf[i][f->wi[i]] = v + in * (i & 1 ? -0.35f : 0.35f);
    f->wi[i] = f->wi[i] + 1 == f->len[i] ? 0 : f->wi[i] + 1;
    y += i & 1 ? -o[i] : o[i];
  }
  return y * 0.3f;
}

/* -------------------------------------------------------------- grains -- */
#define GR_MAX 12
typedef struct {
  double pos, rate;
  int age, len, on;
  float gain, hp; /* hp: a darker/thinner piece (unused = 0) */
} wk_grain1;

typedef struct {
  float *buf; /* a recording to read from (not owned) */
  int len;
  wk_grain1 g[GR_MAX];
} wk_gr;

/* start a grain: pos is where in buf (samples, any number: wraps), rate 1 = as played, -1 backwards */
static void gr_start(wk_gr *s, double pos, double rate, int len, float gain) {
  int k = 0;
  for (int i = 0; i < GR_MAX; i++)
    if (!s->g[i].on) {
      k = i;
      goto found;
    }
  {
    int old = 0; /* all busy: take the one nearest its end */
    for (int i = 1; i < GR_MAX; i++)
      if (s->g[i].len - s->g[i].age < s->g[old].len - s->g[old].age) old = i;
    k = old;
  }
found:
  s->g[k].pos = pos, s->g[k].rate = rate, s->g[k].len = len < 16 ? 16 : len, s->g[k].age = 0, s->g[k].on = 1, s->g[k].gain = gain;
}

static inline float gr_read(const wk_gr *s, double p) {
  int i = (int)p;
  if (p < i) --i;
  float f = (float)(p - i);
  i %= s->len;
  if (i < 0) i += s->len;
  int j = i + 1 == s->len ? 0 : i + 1;
  return s->buf[i] + (s->buf[j] - s->buf[i]) * f;
}

static float gr_run(wk_gr *s) {
  float y = 0;
  for (int i = 0; i < GR_MAX; i++) {
    wk_grain1 *g = &s->g[i];
    if (!g->on) continue;
    float t = (float)g->age / g->len;
    y += gr_read(s, g->pos + g->age * g->rate) * (0.5f - 0.5f * sh_sin01(t + 0.25f)) * g->gain;
    if (++g->age >= g->len) g->on = 0;
  }
  return y;
}

/* ---------------------------------------------------------------- bands -- */
/* Bands that add back up to the input exactly: band i is what lies between two low-passes. */
#define BANDS_MAX 8
typedef struct {
  int n;
  svf_t lp[BANDS_MAX - 1];
} wk_bands;

static void bands_init(wk_bands *b, double sr, int n, const float *cross) {
  b->n = n;
  for (int i = 0; i < n - 1; i++) wk_set(&b->lp[i], sr, cross[i], 0.6);
}
static inline void bands_run(wk_bands *b, float x, float *out) {
  float prev = 0;
  for (int i = 0; i < b->n - 1; i++) {
    float lp, bp, hp;
    svf_run(&b->lp[i], x, &lp, &bp, &hp);
    out[i] = lp - prev, prev = lp;
  }
  out[b->n - 1] = x - prev;
}

/* ------------------------------------------------------ frequency shift -- */
/* Two chains of all-passes 90 degrees apart (Olli Niemitalo's coefficients); then the pair is
   turned at the shift frequency. */
typedef struct {
  float x1[4], x2[4], y1[4], y2[4], u1[4], u2[4], v1[4], v2[4], dly;
  double ph;
} wk_hil;
static const float HIL_A[4] = {0.6923878f, 0.9360654f, 0.9882295f, 0.9987488f};
static const float HIL_B[4] = {0.4021921f, 0.8561711f, 0.9722910f, 0.9952885f};

static float hil_run(wk_hil *h, float x, float hz, double sr) {
  float a = x, b = x;
  for (int k = 0; k < 4; k++) {
    float c2 = HIL_A[k] * HIL_A[k];
    float y = c2 * (a + h->y2[k]) - h->x2[k];
    h->x2[k] = h->x1[k], h->x1[k] = a, h->y2[k] = h->y1[k], h->y1[k] = y, a = y;
    float d2 = HIL_B[k] * HIL_B[k];
    float z = d2 * (b + h->v2[k]) - h->u2[k];
    h->u2[k] = h->u1[k], h->u1[k] = b, h->v2[k] = h->v1[k], h->v1[k] = z, b = z;
  }
  float I = h->dly; /* one path a sample late */
  h->dly = a;
  h->ph += hz / sr;
  h->ph -= (double)(long long)h->ph;
  if (h->ph < 0) h->ph += 1;
  return I * sh_sin01((float)h->ph + 0.25f) + b * sh_sin01((float)h->ph); /* hz > 0 moves up */
}

/* ------------------------------------------------------------ recording -- */
typedef struct {
  float *buf;
  int len, w;
} wk_rec;
static int rec_init(wk_rec *r, sh_arena *a, int len) {
  r->len = len < 64 ? 64 : len;
  r->buf = (float *)ar_alloc(a, sizeof(float) * r->len);
  return r->buf != 0;
}
static inline void rec_push(wk_rec *r, float x) {
  r->buf[r->w] = x;
  r->w = r->w + 1 == r->len ? 0 : r->w + 1;
}
/* copy the last n samples into dst (oldest first) */
static void rec_copy(const wk_rec *r, float *dst, int n) {
  if (n > r->len) n = r->len;
  int start = r->w - n;
  if (start < 0) start += r->len;
  int first = r->len - start < n ? r->len - start : n;
  sh_memcpy(dst, r->buf + start, sizeof(float) * first);
  if (first < n) sh_memcpy(dst + first, r->buf, sizeof(float) * (n - first));
}
static inline float rec_tap(const wk_rec *r, float back) {
  float p = (float)r->w - back;
  while (p < 0) p += (float)r->len;
  int i = (int)p;
  float f = p - (float)i;
  if (i >= r->len) i -= r->len;
  int j = i + 1 == r->len ? 0 : i + 1;
  return r->buf[i] + (r->buf[j] - r->buf[i]) * f;
}

/* a soft clip that keeps quiet things untouched and never goes above 1 */
static inline float lab_sat(float x, float drive) { return sh_tanhf(x * drive) / sh_tanhf(drive); }

static wk_c *lab_build(int kind, const sh_gear *g, sh_arena *a, double sr, int bass, const float *live);
