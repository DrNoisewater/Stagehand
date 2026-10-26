/* Memory, gear spec parsing, filters, oversampling, FFT. */
#include "sh_dsp.h"

void sh_memset(void *p, int v, size_t n) {
  uint8_t *d = (uint8_t *)p;
  while (n--) *d++ = (uint8_t)v;
}
void sh_memcpy(void *d, const void *s, size_t n) {
  uint8_t *a = (uint8_t *)d;
  const uint8_t *b = (const uint8_t *)s;
  while (n--) *a++ = *b++;
}

void *ar_alloc(sh_arena *a, size_t bytes) {
  size_t at = (a->used + 15) & ~(size_t)15;
  if (!a->base || at + bytes > a->size) {
    a->failed = 1;
    return 0;
  }
  a->used = at + bytes;
  void *p = a->base + at;
  sh_memset(p, 0, bytes);
  return p;
}

/* ------------------------------------------------------------- strings -- */
static char lc(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

int sh_has(const char *hay, const char *needle) {
  if (!hay || !needle) return 0;
  for (; *hay; hay++) {
    const char *h = hay, *n = needle;
    while (*h && *n && lc(*h) == lc(*n)) h++, n++;
    if (!*n) return 1;
  }
  return 0;
}

static int sh_eq(const char *a, const char *b) {
  while (*a && *b && lc(*a) == lc(*b)) a++, b++;
  return !*a && !*b;
}

static double parse_num(const char **p) {
  const char *s = *p;
  double sign = 1, v = 0, f = 0.1;
  while (*s == ' ') s++;
  if (*s == '-') sign = -1, s++;
  else if (*s == '+') s++;
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  if (*s == '.') {
    s++;
    while (*s >= '0' && *s <= '9') v += (*s++ - '0') * f, f *= 0.1;
  }
  if (*s == 'e' || *s == 'E') {
    s++;
    int es = 1, ev = 0;
    if (*s == '-') es = -1, s++;
    else if (*s == '+') s++;
    while (*s >= '0' && *s <= '9') ev = ev * 10 + (*s++ - '0');
    v *= sh_pow(10, es * ev);
  }
  *p = s;
  return sign * v;
}

/* copies a tab/newline-terminated field */
static const char *field(const char *s, char *out, int cap, int lower) {
  int n = 0;
  while (*s && *s != '\t' && *s != '\n' && *s != '\r') {
    if (n < cap - 1) out[n++] = lower ? lc(*s) : *s;
    s++;
  }
  out[n] = 0;
  if (*s == '\t') s++;
  return s;
}

/*
 * Spec format, one item per line, tab separated:
 *   kind <tab> guitar|bass
 *   gear <tab> pre|amp|post|cab|rack <tab> Key
 *   k <tab> Knob Name <tab> value <tab> min <tab> max     (applies to the last gear)
 *   gate <tab> dB
 */
int sh_parse_spec(const char *t, sh_spec *o) {
  sh_memset(o, 0, sizeof(*o));
  char w[64];
  while (t && *t) {
    t = field(t, w, sizeof w, 1);
    if (sh_eq(w, "kind")) {
      t = field(t, w, sizeof w, 1);
      o->bass = sh_eq(w, "bass");
    } else if (sh_eq(w, "gear") && o->ngear < SH_MAX_GEAR) {
      sh_gear *g = &o->g[o->ngear++];
      t = field(t, w, sizeof w, 1);
      g->slot = sh_eq(w, "amp") ? SLOT_AMP : sh_eq(w, "post") ? SLOT_POST : sh_eq(w, "cab") ? SLOT_CAB : sh_eq(w, "rack") ? SLOT_RACK : SLOT_PRE;
      t = field(t, g->key, sizeof g->key, 0);
    } else if (sh_eq(w, "k") && o->ngear) {
      sh_gear *g = &o->g[o->ngear - 1];
      if (g->nk < SH_MAX_KNOBS) {
        sh_knob *k = &g->k[g->nk++];
        t = field(t, k->name, sizeof k->name, 1);
        k->v = (float)parse_num(&t);
        if (*t == '\t') t++;
        k->lo = (float)parse_num(&t);
        if (*t == '\t') t++;
        k->hi = (float)parse_num(&t);
        if (k->hi <= k->lo) k->lo = 0, k->hi = 100;
      }
    } else if (sh_eq(w, "gate")) {
      o->gate_db = (float)parse_num(&t);
    }
    while (*t && *t != '\n') t++;
    if (*t == '\n') t++;
  }
  return o->ngear;
}

int kn_find(const sh_gear *g, const char *needle, sh_knob *out) {
  for (int i = 0; i < g->nk; i++)
    if (sh_has(g->k[i].name, needle)) {
      if (out) *out = g->k[i];
      return 1;
    }
  return 0;
}
int kn_exact(const sh_gear *g, const char *name, sh_knob *out) {
  for (int i = 0; i < g->nk; i++)
    if (sh_eq(g->k[i].name, name)) {
      if (out) *out = g->k[i];
      return 1;
    }
  return 0;
}
float kn_pos(const sh_gear *g, const char *needle, float def) {
  sh_knob k;
  if (!kn_find(g, needle, &k)) return def;
  return (float)sh_clamp((k.v - k.lo) / (k.hi - k.lo), 0, 1);
}
float kn_raw(const sh_gear *g, const char *needle, float def) {
  sh_knob k;
  return kn_find(g, needle, &k) ? k.v : def;
}

/* -------------------------------------------------------------- biquad -- */
void bq_reset(bq_t *f) { f->z1 = f->z2 = 0; }

void bq_set(bq_t *f, int type, double sr, double hz, double q, double db) {
  if (hz > sr * 0.49) hz = sr * 0.49;
  if (hz < 1) hz = 1;
  if (q <= 0) q = 0.707;
  double A = sh_pow(10, db / 40), w = SH_TAU * hz / sr, cw = sh_cos(w), sw = sh_sin(w), al = sw / (2 * q);
  double b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case BQ_LP: b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = b0, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al; break;
    case BQ_HP: b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = b0, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al; break;
    case BQ_BP: b0 = al, b1 = 0, b2 = -al, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al; break;
    case BQ_NOTCH: b0 = 1, b1 = -2 * cw, b2 = 1, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al; break;
    case BQ_AP: b0 = 1 - al, b1 = -2 * cw, b2 = 1 + al, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al; break;
    case BQ_PEAK: b0 = 1 + al * A, b1 = -2 * cw, b2 = 1 - al * A, a0 = 1 + al / A, a1 = -2 * cw, a2 = 1 - al / A; break;
    case BQ_LSHELF: {
      double s = 2 * sh_sqrt(A) * al;
      b0 = A * ((A + 1) - (A - 1) * cw + s), b1 = 2 * A * ((A - 1) - (A + 1) * cw), b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s, a1 = -2 * ((A - 1) + (A + 1) * cw), a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    case BQ_HSHELF: {
      double s = 2 * sh_sqrt(A) * al;
      b0 = A * ((A + 1) + (A - 1) * cw + s), b1 = -2 * A * ((A - 1) + (A + 1) * cw), b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s, a1 = 2 * ((A - 1) - (A + 1) * cw), a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
  }
  f->b0 = b0 / a0, f->b1 = b1 / a0, f->b2 = b2 / a0, f->a1 = a1 / a0, f->a2 = a2 / a0;
}

double bq_mag_db(const bq_t *f, double sr, double hz) {
  double w = SH_TAU * hz / sr, c1 = sh_cos(w), s1 = sh_sin(w), c2 = sh_cos(2 * w), s2 = sh_sin(2 * w);
  double nr = f->b0 + f->b1 * c1 + f->b2 * c2, ni = -(f->b1 * s1 + f->b2 * s2);
  double dr = 1 + f->a1 * c1 + f->a2 * c2, di = -(f->a1 * s1 + f->a2 * s2);
  return 10 * sh_log10((nr * nr + ni * ni) / (dr * dr + di * di + 1e-300) + 1e-300);
}

/* --------------------------------------------------------- oversampler -- */
static double bessel_i0(double x) {
  double s = 1, t = 1;
  for (int k = 1; k < 40; k++) {
    t *= (x / (2 * k)) * (x / (2 * k));
    s += t;
  }
  return s;
}

void os4_init(os4_t *o) {
  sh_memset(o, 0, sizeof(*o));
  const double fc = 0.427 / 4.0, beta = 7.0; /* cycles per (4x) sample */
  double sum = 0, i0b = bessel_i0(beta);
  for (int i = 0; i < OS_TAPS; i++) {
    double m = i - (OS_TAPS - 1) / 2.0;
    double x = SH_TAU * fc * m;
    double sinc = m == 0 ? 2 * fc : sh_sin(x) / (SH_PI * m);
    double r = 2.0 * i / (OS_TAPS - 1) - 1;
    double w = bessel_i0(beta * sh_sqrt(1 - r * r)) / i0b;
    o->h[i] = (float)(sinc * w);
    sum += sinc * w;
  }
  for (int i = 0; i < OS_TAPS; i++) o->h[i] = (float)(o->h[i] / sum);
}

void os4_up(os4_t *o, float x, float out[4]) {
  const int H = OS_TAPS / 4;
  o->upos = (o->upos + 1) % H;
  o->up[o->upos] = x;
  o->up[o->upos + H] = x;
  const float *hist = &o->up[o->upos + 1]; /* oldest .. newest over H samples */
  for (int p = 0; p < 4; p++) {
    float s = 0;
    for (int j = 0; j < H; j++) s += o->h[p + 4 * j] * hist[H - 1 - j];
    out[p] = s * 4.f;
  }
}

float os4_down(os4_t *o, const float in[4]) {
  for (int p = 0; p < 4; p++) {
    o->dpos = (o->dpos + 1) % OS_TAPS;
    o->dn[o->dpos] = in[p];
    o->dn[o->dpos + OS_TAPS] = in[p];
  }
  const float *hist = &o->dn[o->dpos + 1];
  float s = 0;
  for (int k = 0; k < OS_TAPS; k++) s += o->h[k] * hist[OS_TAPS - 1 - k];
  return s;
}

/* ---------------------------------------------------------------- delay -- */
int dl_init(dl_t *d, sh_arena *a, int len) {
  d->len = len < 4 ? 4 : len;
  d->pos = 0;
  d->buf = (float *)ar_alloc(a, sizeof(float) * d->len);
  return d->buf != 0;
}

/* ------------------------------------------------------------------ FFT -- */
void sh_fft(double *re, double *im, int n, int inverse) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      double t = re[i];
      re[i] = re[j], re[j] = t;
      t = im[i], im[i] = im[j], im[j] = t;
    }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = SH_TAU / len * (inverse ? 1 : -1);
    double wr = sh_cos(ang), wi = sh_sin(ang);
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int k = 0; k < len / 2; k++) {
        int a = i + k, b = i + k + len / 2;
        double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr, im[b] = im[a] - xi;
        re[a] += xr, im[a] += xi;
        double t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse)
    for (int i = 0; i < n; i++) re[i] /= n, im[i] /= n;
}
