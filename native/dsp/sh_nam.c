/*
 * Neural Amp Modeler inference (see sh_nam.h). Ported from
 * NeuralAmpModelerCore (MIT License, Copyright (c) 2023 Steven Atkinson):
 * same weight order, same maths, block processing over time so the inner
 * loops vectorise (SSE on Windows, SIMD128 in WebAssembly).
 */
#include "sh_nam.h"

#define NB 256 /* frames per internal block */
#define MAX_ARR 8
#define MAX_POST 8
#define MAX_LSTM 8

static inline void fcopy(float *d, const float *s, int n) {
  for (int i = 0; i < n; i++) d[i] = s[i];
}

/* ============================================================ JSON ===== */
enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ, J_NUMARR };
typedef struct jnode jnode;
struct jnode {
  int t, n;          /* type; children or numbers */
  const char *k;     /* key (raw) */
  int kl;
  jnode *first, *next;  /* children */
  double v;          /* number / bool */
  const char *s;     /* string (raw, escapes left in) */
  int sl;
  float *f;          /* numeric array */
};
typedef struct {
  const char *p, *e;
  sh_arena *a;
  int err, depth;
} jp;

static void ws(jp *j) {
  while (j->p < j->e && (*j->p == ' ' || *j->p == '\n' || *j->p == '\r' || *j->p == '\t')) j->p++;
}
static int isdig(char c) { return c >= '0' && c <= '9'; }

static double p10(int e) {
  static const double T[23] = {1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
                               1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22};
  double r = 1;
  int neg = e < 0;
  if (neg) e = -e;
  while (e > 22) r *= 1e22, e -= 22;
  r *= T[e];
  return neg ? 1.0 / r : r;
}

static double jnumber(jp *j) {
  const char *p = j->p, *e = j->e;
  int neg = 0, any = 0, digits = 0, ex = 0;
  uint64_t m = 0;
  if (p < e && (*p == '-' || *p == '+')) neg = *p == '-', p++;
  while (p < e && isdig(*p)) {
    any = 1;
    if (digits < 19) {
      if (m || *p != '0') m = m * 10 + (uint64_t)(*p - '0'), digits++;
    } else ex++;
    p++;
  }
  if (p < e && *p == '.') {
    p++;
    while (p < e && isdig(*p)) {
      any = 1;
      if (digits < 19) {
        if (m || *p != '0') m = m * 10 + (uint64_t)(*p - '0'), digits++;
        ex--;
      }
      p++;
    }
  }
  if (p < e && (*p == 'e' || *p == 'E')) {
    p++;
    int es = 0, en = 0;
    if (p < e && (*p == '-' || *p == '+')) es = *p == '-', p++;
    while (p < e && isdig(*p)) {
      if (en < 10000) en = en * 10 + (*p - '0');
      p++;
    }
    ex += es ? -en : en;
  }
  if (!any) {
    j->err = 1;
    return 0;
  }
  j->p = p;
  double v = (double)m;
  if (m && ex) v = ex < -300 ? 0 : v * p10(ex);
  return neg ? -v : v;
}

static int jstring(jp *j, const char **s, int *len) {
  if (j->p >= j->e || *j->p != '"') return 0;
  const char *b = ++j->p;
  while (j->p < j->e && *j->p != '"') {
    if (*j->p == '\\') j->p++;
    j->p++;
  }
  if (j->p >= j->e) return 0;
  *s = b, *len = (int)(j->p - b);
  j->p++;
  return 1;
}

static jnode *jvalue(jp *j);

static jnode *jnew(jp *j, int t) {
  jnode *n = (jnode *)ar_alloc(j->a, sizeof(jnode));
  if (!n) {
    j->err = 1;
    return 0;
  }
  n->t = t;
  return n;
}

static jnode *jarray(jp *j) {
  j->p++; /* [ */
  ws(j);
  if (j->p < j->e && (isdig(*j->p) || *j->p == '-' || *j->p == '.')) {
    /* all numbers: count, then parse straight into floats */
    int cnt = 1;
    for (const char *q = j->p; q < j->e && *q != ']'; q++)
      if (*q == ',') cnt++;
    jnode *n = jnew(j, J_NUMARR);
    if (!n) return 0;
    n->f = (float *)ar_alloc(j->a, sizeof(float) * (size_t)cnt);
    if (!n->f) {
      j->err = 1;
      return 0;
    }
    for (int i = 0; i < cnt; i++) {
      ws(j);
      n->f[i] = (float)jnumber(j);
      if (j->err) return 0;
      ws(j);
      if (i + 1 < cnt) {
        if (j->p >= j->e || *j->p != ',') {
          j->err = 1;
          return 0;
        }
        j->p++;
      }
    }
    n->n = cnt;
    ws(j);
    if (j->p >= j->e || *j->p != ']') {
      j->err = 1;
      return 0;
    }
    j->p++;
    return n;
  }
  jnode *n = jnew(j, J_ARR), *last = 0;
  if (!n) return 0;
  if (j->p < j->e && *j->p == ']') {
    j->p++;
    return n;
  }
  for (;;) {
    jnode *c = jvalue(j);
    if (!c) return 0;
    if (last) last->next = c;
    else n->first = c;
    last = c, n->n++;
    ws(j);
    if (j->p < j->e && *j->p == ',') {
      j->p++;
      continue;
    }
    if (j->p < j->e && *j->p == ']') {
      j->p++;
      return n;
    }
    j->err = 1;
    return 0;
  }
}

static jnode *jobject(jp *j) {
  j->p++; /* { */
  jnode *n = jnew(j, J_OBJ), *last = 0;
  if (!n) return 0;
  ws(j);
  if (j->p < j->e && *j->p == '}') {
    j->p++;
    return n;
  }
  for (;;) {
    ws(j);
    const char *k;
    int kl;
    if (!jstring(j, &k, &kl)) {
      j->err = 1;
      return 0;
    }
    ws(j);
    if (j->p >= j->e || *j->p != ':') {
      j->err = 1;
      return 0;
    }
    j->p++;
    jnode *c = jvalue(j);
    if (!c) return 0;
    c->k = k, c->kl = kl;
    if (last) last->next = c;
    else n->first = c;
    last = c, n->n++;
    ws(j);
    if (j->p < j->e && *j->p == ',') {
      j->p++;
      continue;
    }
    if (j->p < j->e && *j->p == '}') {
      j->p++;
      return n;
    }
    j->err = 1;
    return 0;
  }
}

static int jlit(jp *j, const char *w) {
  const char *p = j->p;
  while (*w) {
    if (p >= j->e || *p != *w) return 0;
    p++, w++;
  }
  j->p = p;
  return 1;
}

static jnode *jvalue(jp *j) {
  if (j->err || ++j->depth > 64) {
    j->err = 1;
    return 0;
  }
  ws(j);
  jnode *n = 0;
  if (j->p >= j->e) j->err = 1;
  else if (*j->p == '{') n = jobject(j);
  else if (*j->p == '[') n = jarray(j);
  else if (*j->p == '"') {
    n = jnew(j, J_STR);
    if (n && !jstring(j, &n->s, &n->sl)) j->err = 1;
  } else if (jlit(j, "true")) {
    if ((n = jnew(j, J_BOOL))) n->v = 1;
  } else if (jlit(j, "false")) n = jnew(j, J_BOOL);
  else if (jlit(j, "null")) n = jnew(j, J_NULL);
  else {
    n = jnew(j, J_NUM);
    if (n) n->v = jnumber(j);
  }
  j->depth--;
  return j->err ? 0 : n;
}

static int keyeq(const char *k, int kl, const char *s) {
  int i = 0;
  for (; i < kl; i++)
    if (s[i] != k[i]) return 0;
  return s[i] == 0;
}
static jnode *jget(const jnode *o, const char *key) {
  if (!o || o->t != J_OBJ) return 0;
  for (jnode *c = o->first; c; c = c->next)
    if (keyeq(c->k, c->kl, key)) return c;
  return 0;
}
static int jhas(const jnode *o, const char *key) {
  jnode *c = jget(o, key);
  return c && c->t != J_NULL;
}
static double jnum(const jnode *n, double def) { return n && (n->t == J_NUM || n->t == J_BOOL) ? n->v : def; }
static double jgetn(const jnode *o, const char *k, double def) { return jnum(jget(o, k), def); }
static int jstreq(const jnode *n, const char *s) { return n && n->t == J_STR && keyeq(n->s, n->sl, s); }
static int jlen(const jnode *n) { return n ? (n->t == J_NUMARR || n->t == J_ARR ? n->n : 0) : 0; }
static double jat(const jnode *n, int i) {
  if (!n) return 0;
  if (n->t == J_NUMARR) return i < n->n ? n->f[i] : 0;
  if (n->t == J_ARR) {
    jnode *c = n->first;
    while (c && i--) c = c->next;
    return jnum(c, 0);
  }
  return 0;
}
static jnode *jidx(const jnode *n, int i) {
  if (!n || n->t != J_ARR) return 0;
  jnode *c = n->first;
  while (c && i--) c = c->next;
  return c;
}

/* ====================================================== activations ===== */
enum { A_ID, A_TANH, A_HARDTANH, A_RELU, A_LEAKY, A_PRELU, A_SIGMOID, A_SILU, A_HSWISH, A_LHT, A_SOFTSIGN };
typedef struct {
  int type;
  float p0, p1, p2, p3; /* slope / min,max,minslope,maxslope */
  float *slopes;
  int nslopes;
} nact;

/* float-accurate tanh (rational minimax, |err| < 4e-7), vectorises */
static inline float ntanh(float x) {
  const float lim = 7.90531110763549805f;
  x = x < -lim ? -lim : x > lim ? lim : x;
  float x2 = x * x;
  float p = -2.76076847742355e-16f;
  p = p * x2 + 2.00018790482477e-13f;
  p = p * x2 + -8.60467152213735e-11f;
  p = p * x2 + 5.12229709037114e-08f;
  p = p * x2 + 1.48572235717979e-05f;
  p = p * x2 + 6.37261928875436e-04f;
  p = p * x2 + 4.89352455891786e-03f;
  p = p * x;
  float q = 1.19825839466702e-06f;
  q = q * x2 + 1.18534705686654e-04f;
  q = q * x2 + 2.26843463243900e-03f;
  q = q * x2 + 4.89352518554385e-03f;
  return p / q;
}
static inline float nsig(float x) { return 0.5f * ntanh(0.5f * x) + 0.5f; }

static void act_row(const nact *a, float *x, int n, int ch) {
  int i;
  switch (a->type) {
    case A_TANH:
      for (i = 0; i < n; i++) x[i] = ntanh(x[i]);
      break;
    case A_HARDTANH:
      for (i = 0; i < n; i++) x[i] = x[i] < -1.f ? -1.f : x[i] > 1.f ? 1.f : x[i];
      break;
    case A_RELU:
      for (i = 0; i < n; i++) x[i] = x[i] > 0.f ? x[i] : 0.f;
      break;
    case A_LEAKY:
    case A_PRELU: {
      float s = a->slopes && a->nslopes ? a->slopes[ch % a->nslopes] : a->p0;
      for (i = 0; i < n; i++) x[i] = x[i] > 0.f ? x[i] : s * x[i];
      break;
    }
    case A_SIGMOID:
      for (i = 0; i < n; i++) x[i] = nsig(x[i]);
      break;
    case A_SILU:
      for (i = 0; i < n; i++) x[i] = x[i] * nsig(x[i]);
      break;
    case A_HSWISH:
      for (i = 0; i < n; i++) {
        float t = x[i] + 3.f;
        t = t < 0.f ? 0.f : t > 6.f ? 6.f : t;
        x[i] = x[i] * t * (1.f / 6.f);
      }
      break;
    case A_LHT:
      for (i = 0; i < n; i++) {
        float v = x[i];
        x[i] = v < a->p0 ? (v - a->p0) * a->p2 + a->p0 : v > a->p1 ? (v - a->p1) * a->p3 + a->p1 : v;
      }
      break;
    case A_SOFTSIGN:
      for (i = 0; i < n; i++) x[i] = x[i] / (1.f + sh_fabsf(x[i]));
      break;
    default: break;
  }
}

/* ============================================================ model ===== */
typedef struct {
  int cin, cout, k, dil;
  float *w; /* [k][cout][cin], dense (groups expanded with zeros) */
  float *b; /* or NULL */
  int groups;
} nconv;

typedef struct {
  int on, shift, dim;
  nconv c; /* cond → (shift ? 2 : 1) * dim */
} nfilm;

enum { F_CONV_PRE, F_CONV_POST, F_MIX_PRE, F_MIX_POST, F_ACT_PRE, F_ACT_POST, F_L1_POST, F_H1_POST, F_N };
enum { G_NONE, G_GATED, G_BLENDED };

typedef struct {
  int C, B, zc, gate;
  nact act, act2;
  nconv conv, mix, l1, h1;
  int has_l1, has_h1;
  nfilm f[F_N];
} nlayer;

typedef struct {
  int in_size, cond, C, B, hout, head_size;
  nconv rc, hr;
  int nl;
  nlayer *L;
} narray;

enum { ARCH_WAVENET = 1, ARCH_LSTM };

struct nam_model {
  int arch;
  double sr;
  float loudness;
  int prewarm;
  long macs;
  /* WaveNet */
  int in_ch, out_ch, cond_ch;
  int na;
  narray A[MAX_ARR];
  float head_scale;
  int npost;
  nconv post[MAX_POST];
  nact post_act;
  nam_model *cond;
  /* LSTM */
  int nlstm, lin, hid;
  float *lw[MAX_LSTM], *lb[MAX_LSTM], *lh0[MAX_LSTM], *lc0[MAX_LSTM];
  float *hw, *hb;
};

typedef struct {
  sh_arena *a;
  const float *w;
  int nw, wi;
  char *err;
  int errlen;
  int fail;
  int size_pref;
} ld;

static void lerr(ld *L, const char *m) {
  if (L->fail) return;
  L->fail = 1;
  int i = 0;
  if (L->err && L->errlen > 0) {
    while (m[i] && i < L->errlen - 1) L->err[i] = m[i], i++;
    L->err[i] = 0;
  }
}

static float wnext(ld *L) {
  if (L->wi >= L->nw) {
    lerr(L, "the model file has fewer weights than its layout needs");
    return 0;
  }
  return L->w[L->wi++];
}

static int conv_make(ld *L, nconv *c, int cin, int cout, int k, int bias, int dil, int groups) {
  if (groups < 1) groups = 1;
  if (cin <= 0 || cout <= 0 || k <= 0 || cin % groups || cout % groups) {
    lerr(L, "the model file has an unexpected layer shape");
    return 0;
  }
  c->cin = cin, c->cout = cout, c->k = k, c->dil = dil < 1 ? 1 : dil, c->groups = groups;
  c->w = (float *)ar_alloc(L->a, sizeof(float) * (size_t)cin * cout * k);
  c->b = bias ? (float *)ar_alloc(L->a, sizeof(float) * (size_t)cout) : 0;
  if (!c->w || (bias && !c->b)) {
    lerr(L, "the model is too large");
    return 0;
  }
  return 1;
}
static void conv_weights(ld *L, nconv *c) {
  int opg = c->cout / c->groups, ipg = c->cin / c->groups;
  for (int g = 0; g < c->groups; g++)
    for (int i = 0; i < opg; i++)
      for (int j = 0; j < ipg; j++)
        for (int k = 0; k < c->k; k++) c->w[((size_t)k * c->cout + g * opg + i) * c->cin + g * ipg + j] = wnext(L);
  if (c->b)
    for (int i = 0; i < c->cout; i++) c->b[i] = wnext(L);
}

static int act_parse(ld *L, const jnode *n, nact *a) {
  sh_memset(a, 0, sizeof *a);
  const jnode *t = n && n->t == J_OBJ ? jget(n, "type") : n;
  if (!t || t->t != J_STR) {
    lerr(L, "the model file names an activation this player doesn't know");
    return 0;
  }
  if (jstreq(t, "Tanh") || jstreq(t, "Fasttanh")) a->type = A_TANH;
  else if (jstreq(t, "Hardtanh")) a->type = A_HARDTANH;
  else if (jstreq(t, "ReLU")) a->type = A_RELU;
  else if (jstreq(t, "LeakyReLU")) a->type = A_LEAKY, a->p0 = (float)(n->t == J_OBJ ? jgetn(n, "negative_slope", 0.01) : 0.01);
  else if (jstreq(t, "PReLU")) {
    a->type = A_PRELU, a->p0 = 0.01f;
    if (n->t == J_OBJ) {
      const jnode *s = jget(n, "negative_slopes");
      if (jhas(n, "negative_slope")) a->p0 = (float)jgetn(n, "negative_slope", 0.01);
      else if (s && jlen(s)) {
        a->nslopes = jlen(s);
        a->slopes = (float *)ar_alloc(L->a, sizeof(float) * (size_t)a->nslopes);
        if (!a->slopes) return 0;
        for (int i = 0; i < a->nslopes; i++) a->slopes[i] = (float)jat(s, i);
      }
    }
  } else if (jstreq(t, "Sigmoid")) a->type = A_SIGMOID;
  else if (jstreq(t, "SiLU")) a->type = A_SILU;
  else if (jstreq(t, "Hardswish")) a->type = A_HSWISH;
  else if (jstreq(t, "LeakyHardtanh") || jstreq(t, "LeakyHardTanh")) {
    a->type = A_LHT;
    a->p0 = (float)(n->t == J_OBJ ? jgetn(n, "min_val", -1) : -1);
    a->p1 = (float)(n->t == J_OBJ ? jgetn(n, "max_val", 1) : 1);
    a->p2 = (float)(n->t == J_OBJ ? jgetn(n, "min_slope", 0.01) : 0.01);
    a->p3 = (float)(n->t == J_OBJ ? jgetn(n, "max_slope", 0.01) : 0.01);
  } else if (jstreq(t, "Softsign")) a->type = A_SOFTSIGN;
  else {
    lerr(L, "the model file names an activation this player doesn't know");
    return 0;
  }
  return 1;
}

static void film_parse(const jnode *lc, const char *key, nfilm *f) {
  const jnode *n = jget(lc, key);
  f->on = 0, f->shift = 0;
  if (!n || n->t == J_NULL || (n->t == J_BOOL && !n->v)) return;
  if (n->t != J_OBJ) return;
  f->on = (int)jgetn(n, "active", 1) != 0;
  f->shift = (int)jgetn(n, "shift", 1) != 0;
  f->c.groups = (int)jgetn(n, "groups", 1);
}

static nam_model *load_dsp(ld *L, const jnode *root);

static long conv_macs(const nconv *c) { return c->w ? (long)c->cin * c->cout * c->k / c->groups : 0; }

static nam_model *load_wavenet(ld *L, const jnode *root, nam_model *m) {
  const jnode *cfg = jget(root, "config");
  const jnode *layers = jget(cfg, "layers");
  if (!layers || layers->t != J_ARR || !layers->n) {
    lerr(L, "the model file has no layers");
    return 0;
  }
  if (layers->n > MAX_ARR) {
    lerr(L, "the model has more layer groups than this player supports");
    return 0;
  }
  m->arch = ARCH_WAVENET;
  m->in_ch = (int)jgetn(cfg, "in_channels", 1);
  if (jhas(cfg, "condition_dsp")) {
    m->cond = load_dsp(L, jget(cfg, "condition_dsp"));
    if (!m->cond) return 0;
    if (m->cond->arch != ARCH_WAVENET) {
      lerr(L, "this model's condition network isn't supported");
      return 0;
    }
  }
  m->na = layers->n;
  /* layout first (weights are assigned below, in file order) */
  for (int ai = 0; ai < m->na; ai++) {
    const jnode *lc = jidx(layers, ai);
    narray *A = &m->A[ai];
    int gi = (int)jgetn(lc, "groups_input", 1), gm = (int)jgetn(lc, "groups_input_mixin", 1);
    int C = (int)jgetn(lc, "channels", 0);
    int B = jhas(lc, "bottleneck") ? (int)jgetn(lc, "bottleneck", C) : C;
    int l1on = 1, l1g = 1;
    const jnode *l1 = jget(lc, "layer1x1");
    if (l1 && l1->t == J_OBJ) l1on = (int)jgetn(l1, "active", 1) != 0, l1g = (int)jgetn(l1, "groups", 1);
    int in_size = (int)jgetn(lc, "input_size", 1), cs = (int)jgetn(lc, "condition_size", 1);
    int head_size = 0, head_dil = 1, head_k = 1, head_bias = 0;
    const jnode *hd = jget(lc, "head");
    if (hd && hd->t == J_OBJ) {
      head_size = (int)jgetn(hd, "out_channels", 0);
      head_dil = (int)jgetn(hd, "head_dilation", 1);
      head_k = (int)jgetn(hd, "kernel_size", 1);
      head_bias = (int)jgetn(hd, "bias", 0) != 0;
    } else if (jhas(lc, "head_size")) {
      head_size = (int)jgetn(lc, "head_size", 0);
      head_bias = (int)jgetn(lc, "head_bias", 0) != 0;
    } else {
      lerr(L, "the model file's layer group has no head");
      return 0;
    }
    const jnode *dil = jget(lc, "dilations");
    int nl = jlen(dil);
    if (nl <= 0) {
      lerr(L, "the model file's layer group has no dilations");
      return 0;
    }
    const jnode *ks = jget(lc, "kernel_sizes");
    int kfix = (int)jgetn(lc, "kernel_size", 0);
    if (!ks && kfix <= 0) {
      lerr(L, "the model file's layers have no kernel size");
      return 0;
    }
    if (ks && jlen(ks) != nl) {
      lerr(L, "the model file's kernel sizes don't match its dilations");
      return 0;
    }
    const jnode *act = jget(lc, "activation"), *gate = jget(lc, "gating_mode"), *sec = jget(lc, "secondary_activation");
    int h1on = 0, h1out = C, h1g = 1;
    const jnode *h1 = jget(lc, "head1x1");
    if (h1 && h1->t == J_OBJ) h1on = (int)jgetn(h1, "active", 0) != 0, h1out = (int)jgetn(h1, "out_channels", C), h1g = (int)jgetn(h1, "groups", 1);
    static const char *FK[F_N] = {"conv_pre_film", "conv_post_film", "input_mixin_pre_film", "input_mixin_post_film",
                                  "activation_pre_film", "activation_post_film", "layer1x1_post_film", "head1x1_post_film"};
    nfilm F[F_N];
    for (int f = 0; f < F_N; f++) film_parse(lc, FK[f], &F[f]);
    if (!l1on && B != C) {
      lerr(L, "the model file's layer shape isn't valid (bottleneck without layer 1x1)");
      return 0;
    }
    A->in_size = in_size, A->cond = cs, A->C = C, A->B = B, A->head_size = head_size, A->nl = nl;
    A->hout = h1on ? h1out : B;
    A->L = (nlayer *)ar_alloc(L->a, sizeof(nlayer) * (size_t)nl);
    if (!A->L) {
      lerr(L, "the model is too large");
      return 0;
    }
    if (!conv_make(L, &A->rc, in_size, C, 1, 0, 1, 1)) return 0;
    for (int li = 0; li < nl; li++) {
      nlayer *Y = &A->L[li];
      int k = ks ? (int)jat(ks, li) : kfix, d = (int)jat(dil, li);
      int gmode = G_NONE;
      const jnode *gn = gate && gate->t == J_ARR ? jidx(gate, li) : gate;
      if (gn && gn->t == J_STR) {
        if (jstreq(gn, "gated")) gmode = G_GATED;
        else if (jstreq(gn, "blended")) gmode = G_BLENDED;
        else if (!jstreq(gn, "none")) {
          lerr(L, "the model file has an unknown gating mode");
          return 0;
        }
      } else if (!gate && jget(lc, "gated")) gmode = jgetn(lc, "gated", 0) ? G_GATED : G_NONE;
      Y->C = C, Y->B = B, Y->gate = gmode, Y->zc = gmode != G_NONE ? 2 * B : B;
      if (!act_parse(L, act && act->t == J_ARR ? jidx(act, li) : act, &Y->act)) return 0;
      if (gmode != G_NONE) {
        if (sec && !(sec->t == J_NULL)) {
          if (!act_parse(L, sec->t == J_ARR ? jidx(sec, li) : sec, &Y->act2)) return 0;
        } else Y->act2.type = A_SIGMOID;
      }
      if (!conv_make(L, &Y->conv, C, Y->zc, k, 1, d, gi)) return 0;
      if (!conv_make(L, &Y->mix, cs, Y->zc, 1, 0, 1, gm)) return 0;
      Y->has_l1 = l1on, Y->has_h1 = h1on;
      if (l1on && !conv_make(L, &Y->l1, B, C, 1, 1, 1, l1g)) return 0;
      if (h1on && !conv_make(L, &Y->h1, B, h1out, 1, 1, 1, h1g)) return 0;
      int dims[F_N] = {C, Y->zc, cs, Y->zc, Y->zc, B, C, h1out};
      for (int f = 0; f < F_N; f++) {
        Y->f[f] = F[f];
        if (f == F_L1_POST && !l1on) Y->f[f].on = 0;
        if (f == F_H1_POST && !h1on) Y->f[f].on = 0;
        if (!Y->f[f].on) continue;
        Y->f[f].dim = dims[f];
        if (!conv_make(L, &Y->f[f].c, cs, (Y->f[f].shift ? 2 : 1) * dims[f], 1, 1, 1, F[f].c.groups)) return 0;
      }
    }
    if (!conv_make(L, &A->hr, A->hout, head_size, head_k, head_bias, head_dil, 1)) return 0;
    if (ai > 0) {
      if (A->hout != m->A[ai - 1].head_size || in_size != m->A[ai - 1].C) {
        lerr(L, "the model file's layer groups don't connect");
        return 0;
      }
    }
  }
  m->out_ch = m->A[m->na - 1].head_size;
  const jnode *hd = jget(cfg, "head");
  if (hd && hd->t == J_OBJ) {
    const jnode *hk = jget(hd, "kernel_sizes");
    int n = jlen(hk), ch = (int)jgetn(hd, "channels", 0), oc = (int)jgetn(hd, "out_channels", 1);
    if (n <= 0 || n > MAX_POST) {
      lerr(L, "the model file's output head isn't supported");
      return 0;
    }
    if (!act_parse(L, jget(hd, "activation"), &m->post_act)) return 0;
    int cin = m->out_ch;
    for (int i = 0; i < n; i++) {
      int co = i + 1 == n ? oc : ch;
      if (!conv_make(L, &m->post[i], cin, co, (int)jat(hk, i), 1, 1, 1)) return 0;
      cin = co;
    }
    m->npost = n, m->out_ch = oc;
  }
  m->head_scale = (float)jgetn(cfg, "head_scale", 1);
  /* weights, in the file's order */
  for (int ai = 0; ai < m->na; ai++) {
    narray *A = &m->A[ai];
    conv_weights(L, &A->rc);
    for (int li = 0; li < A->nl; li++) {
      nlayer *Y = &A->L[li];
      conv_weights(L, &Y->conv);
      conv_weights(L, &Y->mix);
      if (Y->has_l1) conv_weights(L, &Y->l1);
      if (Y->has_h1) conv_weights(L, &Y->h1);
      for (int f = 0; f < F_N; f++)
        if (Y->f[f].on) conv_weights(L, &Y->f[f].c);
    }
    conv_weights(L, &A->hr);
  }
  for (int i = 0; i < m->npost; i++) conv_weights(L, &m->post[i]);
  m->head_scale = wnext(L);
  if (L->fail) return 0;
  if (L->wi != L->nw) {
    lerr(L, "the model file has more weights than its layout needs");
    return 0;
  }
  /* settle time and cost */
  int pw = m->cond ? m->cond->prewarm : 1;
  long macs = m->cond ? m->cond->macs : 0;
  for (int ai = 0; ai < m->na; ai++) {
    narray *A = &m->A[ai];
    for (int li = 0; li < A->nl; li++) {
      nlayer *Y = &A->L[li];
      pw += Y->conv.dil * (Y->conv.k - 1);
      macs += conv_macs(&Y->conv) + conv_macs(&Y->mix) + conv_macs(&Y->l1) + conv_macs(&Y->h1);
      for (int f = 0; f < F_N; f++)
        if (Y->f[f].on) macs += conv_macs(&Y->f[f].c);
    }
    pw += A->hr.dil * (A->hr.k - 1);
    macs += conv_macs(&A->rc) + conv_macs(&A->hr);
  }
  if (m->npost) {
    int rf = 1;
    for (int i = 0; i < m->npost; i++) rf += m->post[i].k - 1, macs += conv_macs(&m->post[i]);
    pw += rf - 1;
  }
  m->prewarm = pw, m->macs = macs;
  m->cond_ch = m->cond ? m->cond->out_ch : m->in_ch;
  for (int ai = 0; ai < m->na; ai++)
    if (m->A[ai].cond != m->cond_ch) {
      lerr(L, "the model file's conditioning doesn't match");
      return 0;
    }
  if (m->A[0].in_size != m->in_ch) {
    lerr(L, "the model file's input doesn't match");
    return 0;
  }
  return m;
}

static nam_model *load_lstm(ld *L, const jnode *root, nam_model *m) {
  const jnode *cfg = jget(root, "config");
  m->arch = ARCH_LSTM;
  m->nlstm = (int)jgetn(cfg, "num_layers", 1);
  m->lin = (int)jgetn(cfg, "input_size", 1);
  m->hid = (int)jgetn(cfg, "hidden_size", 0);
  m->in_ch = (int)jgetn(cfg, "in_channels", 1);
  m->out_ch = (int)jgetn(cfg, "out_channels", 1);
  if (m->nlstm < 1 || m->nlstm > MAX_LSTM || m->hid < 1 || m->hid > 512 || m->lin != 1 || m->in_ch != 1) {
    lerr(L, "this LSTM model's shape isn't supported");
    return 0;
  }
  int H = m->hid;
  for (int l = 0; l < m->nlstm; l++) {
    int in = l == 0 ? m->lin : H;
    size_t nw = (size_t)4 * H * (in + H);
    m->lw[l] = (float *)ar_alloc(L->a, sizeof(float) * nw);
    m->lb[l] = (float *)ar_alloc(L->a, sizeof(float) * 4 * H);
    m->lh0[l] = (float *)ar_alloc(L->a, sizeof(float) * H);
    m->lc0[l] = (float *)ar_alloc(L->a, sizeof(float) * H);
    if (!m->lw[l] || !m->lb[l] || !m->lh0[l] || !m->lc0[l]) {
      lerr(L, "the model is too large");
      return 0;
    }
    for (size_t i = 0; i < nw; i++) m->lw[l][i] = wnext(L);
    for (int i = 0; i < 4 * H; i++) m->lb[l][i] = wnext(L);
    for (int i = 0; i < H; i++) m->lh0[l][i] = wnext(L);
    for (int i = 0; i < H; i++) m->lc0[l][i] = wnext(L);
    m->macs += (long)nw;
  }
  m->hw = (float *)ar_alloc(L->a, sizeof(float) * (size_t)m->out_ch * H);
  m->hb = (float *)ar_alloc(L->a, sizeof(float) * (size_t)m->out_ch);
  if (!m->hw || !m->hb) {
    lerr(L, "the model is too large");
    return 0;
  }
  for (int i = 0; i < m->out_ch * H; i++) m->hw[i] = wnext(L);
  for (int i = 0; i < m->out_ch; i++) m->hb[i] = wnext(L);
  if (L->fail) return 0;
  if (L->wi != L->nw) {
    lerr(L, "the model file has more weights than its layout needs");
    return 0;
  }
  int pw = (int)(0.5 * m->sr);
  m->prewarm = pw <= 0 ? 1 : pw;
  return m;
}

static nam_model *load_dsp(ld *L, const jnode *root) {
  if (!root || root->t != J_OBJ) {
    lerr(L, "this isn't a NAM model file");
    return 0;
  }
  const jnode *arch = jget(root, "architecture");
  if (jstreq(arch, "SlimmableContainer")) {
    const jnode *subs = jget(jget(root, "config"), "submodels");
    int n = subs && subs->t == J_ARR ? subs->n : 0;
    if (!n) {
      lerr(L, "the model container is empty");
      return 0;
    }
    return load_dsp(L, jget(jidx(subs, L->size_pref ? 0 : n - 1), "model"));
  }
  nam_model *m = (nam_model *)ar_alloc(L->a, sizeof(nam_model));
  if (!m) {
    lerr(L, "the model is too large");
    return 0;
  }
  m->sr = jgetn(root, "sample_rate", 48000);
  if (m->sr <= 0) m->sr = 48000;
  m->loudness = (float)jgetn(jget(root, "metadata"), "loudness", 0);
  const jnode *w = jget(root, "weights");
  const ld save = *L;
  L->w = w && w->t == J_NUMARR ? w->f : 0;
  L->nw = w && w->t == J_NUMARR ? w->n : 0;
  L->wi = 0;
  nam_model *r = 0;
  if (jstreq(arch, "WaveNet")) r = load_wavenet(L, root, m);
  else if (jstreq(arch, "LSTM")) r = load_lstm(L, root, m);
  else lerr(L, "this kind of NAM model isn't supported yet (only WaveNet and LSTM)");
  /* restore the parent's weight cursor (condition DSPs carry their own) */
  L->w = save.w, L->nw = save.nw, L->wi = save.wi;
  return r;
}

static uint8_t g_scratch[16u << 20]; /* JSON tree; loading is not concurrent */

nam_model *nam_load(const char *json, int len, void *mem, size_t bytes, int size_pref, char *err, int errlen) {
  if (err && errlen) err[0] = 0;
  sh_arena sa = {g_scratch, sizeof g_scratch, 0, 0};
  jp j = {json, json + len, &sa, 0, 0};
  jnode *root = jvalue(&j);
  ld L;
  sh_memset(&L, 0, sizeof L);
  L.err = err, L.errlen = errlen, L.size_pref = size_pref;
  if (!root || j.err) {
    lerr(&L, sa.failed ? "the model file is too large" : "the model file isn't valid JSON");
    return 0;
  }
  sh_arena ma = {(uint8_t *)mem, bytes, 0, 0};
  L.a = &ma;
  nam_model *m = load_dsp(&L, root);
  if (!m || L.fail || ma.failed) {
    if (ma.failed) lerr(&L, "the model is too large");
    return 0;
  }
  return m;
}

double nam_model_rate(const nam_model *m) { return m ? m->sr : 48000; }
float nam_model_loudness(const nam_model *m) { return m ? m->loudness : 0; }
int nam_model_prewarm(const nam_model *m) { return m ? m->prewarm : 0; }
long nam_model_macs(const nam_model *m) { return m ? m->macs : 0; }
const char *nam_model_kind(const nam_model *m) { return !m ? "" : m->arch == ARCH_LSTM ? "LSTM" : "WaveNet"; }

/* ========================================================== runtime ===== */
/* history for a convolution's input: rows of length len, newest block at pos */
typedef struct {
  float *buf;
  int rows, hist, len, pos;
} hist_t;

static int hist_init(hist_t *h, sh_arena *a, int rows, int hist) {
  h->rows = rows, h->hist = hist, h->len = hist + 4 * NB, h->pos = hist;
  h->buf = (float *)ar_alloc(a, sizeof(float) * (size_t)rows * h->len);
  return h->buf != 0;
}
/* copies a block in; returns the block start (row stride h->len), history before it */
static float *hist_push(hist_t *h, const float *x, int xs, int n) {
  if (h->pos + n > h->len) {
    for (int r = 0; r < h->rows; r++) {
      float *row = h->buf + (size_t)r * h->len;
      const float *src = row + h->pos - h->hist;
      for (int i = 0; i < h->hist; i++) row[i] = src[i];
    }
    h->pos = h->hist;
  }
  for (int r = 0; r < h->rows; r++) {
    float *d = h->buf + (size_t)r * h->len + h->pos;
    const float *s = x + (size_t)r * xs;
    for (int i = 0; i < n; i++) d[i] = s[i];
  }
  float *p = h->buf + h->pos;
  h->pos += n;
  return p;
}

/* y[o][t] = b[o] + sum_k sum_i w[k][o][i] * x[i][t - dil*(K-1-k)] */
static void conv_run(const nconv *c, const float *x, int xs, float *y, int ys, int n) {
  const int cin = c->cin, cout = c->cout, K = c->k;
  for (int o = 0; o < cout; o++) {
    float *yo = y + (size_t)o * ys;
    const float b = c->b ? c->b[o] : 0.f;
    for (int t = 0; t < n; t++) yo[t] = b;
    for (int k = 0; k < K; k++) {
      const int back = c->dil * (K - 1 - k);
      const float *w = c->w + ((size_t)k * cout + o) * cin;
      int i = 0;
      for (; i + 4 <= cin; i += 4) {
        const float w0 = w[i], w1 = w[i + 1], w2 = w[i + 2], w3 = w[i + 3];
        if (w0 == 0.f && w1 == 0.f && w2 == 0.f && w3 == 0.f) continue;
        const float *x0 = x + (size_t)i * xs - back, *x1 = x0 + xs, *x2 = x1 + xs, *x3 = x2 + xs;
        for (int t = 0; t < n; t++) yo[t] += w0 * x0[t] + w1 * x1[t] + w2 * x2[t] + w3 * x3[t];
      }
      for (; i < cin; i++) {
        const float w0 = w[i];
        if (w0 == 0.f) continue;
        const float *x0 = x + (size_t)i * xs - back;
        for (int t = 0; t < n; t++) yo[t] += w0 * x0[t];
      }
    }
  }
}

/* x[r][t] = x[r][t] * s[r][t] (+ s[dim + r][t]); in place on x */
static void film_run(const nfilm *f, float *x, int xs, const float *cond, float *tmp, int n) {
  conv_run(&f->c, cond, NB, tmp, NB, n);
  for (int r = 0; r < f->dim; r++) {
    float *xr = x + (size_t)r * xs;
    const float *sc = tmp + (size_t)r * NB;
    if (f->shift) {
      const float *sh = tmp + (size_t)(f->dim + r) * NB;
      for (int t = 0; t < n; t++) xr[t] = xr[t] * sc[t] + sh[t];
    } else
      for (int t = 0; t < n; t++) xr[t] *= sc[t];
  }
}

typedef struct {
  hist_t ch;
  float *z, *m, *ft, *ss, *l1, *h1, *nx, *pre;
} lrun;

typedef struct {
  float *rc, *hacc, *hout;
  hist_t hh;
  lrun *L;
} arun;

struct nam_run {
  const nam_model *m;
  nam_run *cond;
  float *cin, *cnd, *out;
  arun A[MAX_ARR];
  hist_t ph[MAX_POST];
  float *pb[MAX_POST + 1];
  /* LSTM */
  float *xh[MAX_LSTM], *c[MAX_LSTM], *ifgo;
};

#define NEWF(rows) ((float *)ar_alloc(a, sizeof(float) * (size_t)(rows) * NB))

nam_run *nam_run_new(const nam_model *m, sh_arena *a) {
  if (!m) return 0;
  nam_run *r = (nam_run *)ar_alloc(a, sizeof(nam_run));
  if (!r) return 0;
  r->m = m;
  if (m->arch == ARCH_LSTM) {
    int H = m->hid;
    for (int l = 0; l < m->nlstm; l++) {
      int in = l == 0 ? m->lin : H;
      r->xh[l] = (float *)ar_alloc(a, sizeof(float) * (size_t)(in + H));
      r->c[l] = (float *)ar_alloc(a, sizeof(float) * (size_t)H);
      if (!r->xh[l] || !r->c[l]) return 0;
      for (int i = 0; i < H; i++) r->xh[l][in + i] = m->lh0[l][i], r->c[l][i] = m->lc0[l][i];
    }
    r->ifgo = (float *)ar_alloc(a, sizeof(float) * (size_t)4 * H);
    r->out = NEWF(m->out_ch);
    return r->ifgo && r->out ? r : 0;
  }
  if (m->cond && !(r->cond = nam_run_new(m->cond, a))) return 0;
  r->cin = NEWF(m->in_ch);
  r->cnd = m->cond ? NEWF(m->cond->out_ch) : r->cin;
  if (!r->cin || !r->cnd) return 0;
  for (int ai = 0; ai < m->na; ai++) {
    const narray *A = &m->A[ai];
    arun *R = &r->A[ai];
    R->rc = NEWF(A->C);
    R->hacc = NEWF(A->hout);
    R->hout = NEWF(A->head_size);
    R->L = (lrun *)ar_alloc(a, sizeof(lrun) * (size_t)A->nl);
    if (!R->rc || !R->hacc || !R->hout || !R->L) return 0;
    if (!hist_init(&R->hh, a, A->hout, A->hr.dil * (A->hr.k - 1))) return 0;
    for (int li = 0; li < A->nl; li++) {
      const nlayer *Y = &A->L[li];
      lrun *Q = &R->L[li];
      int big = Y->zc > Y->C ? Y->zc : Y->C;
      if (A->cond > big) big = A->cond;
      if (!hist_init(&Q->ch, a, Y->C, Y->conv.dil * (Y->conv.k - 1))) return 0;
      Q->z = NEWF(Y->zc), Q->m = NEWF(Y->zc), Q->ft = NEWF(big), Q->ss = NEWF(2 * (big > Y->h1.cout ? big : Y->h1.cout));
      Q->l1 = NEWF(Y->C), Q->nx = NEWF(Y->C), Q->pre = NEWF(1);
      Q->h1 = Y->has_h1 ? NEWF(Y->h1.cout) : 0;
      if (!Q->z || !Q->m || !Q->ft || !Q->ss || !Q->l1 || !Q->nx || !Q->pre || (Y->has_h1 && !Q->h1)) return 0;
    }
  }
  for (int i = 0; i < m->npost; i++) {
    if (!hist_init(&r->ph[i], a, m->post[i].cin, m->post[i].k - 1)) return 0;
    if (!(r->pb[i] = NEWF(m->post[i].cin))) return 0;
  }
  r->out = NEWF(m->out_ch);
  return r->out ? r : 0;
}

static void layer_run(const nlayer *Y, lrun *Q, const float *x, const float *cond, int n) {
  const int B = Y->B;
  /* 1) dilated conv (its history holds what it saw, after the pre-FiLM) */
  const float *xin = x;
  if (Y->f[F_CONV_PRE].on) {
    for (int r = 0; r < Y->C; r++) fcopy(Q->ft + (size_t)r * NB, x + (size_t)r * NB, n);
    film_run(&Y->f[F_CONV_PRE], Q->ft, NB, cond, Q->ss, n);
    xin = Q->ft;
  }
  const float *p = hist_push(&Q->ch, xin, NB, n);
  conv_run(&Y->conv, p, Q->ch.len, Q->z, NB, n);
  if (Y->f[F_CONV_POST].on) film_run(&Y->f[F_CONV_POST], Q->z, NB, cond, Q->ss, n);
  /* 2) input mixin */
  const float *ci = cond;
  if (Y->f[F_MIX_PRE].on) {
    for (int r = 0; r < Y->f[F_MIX_PRE].dim; r++) fcopy(Q->ft + (size_t)r * NB, cond + (size_t)r * NB, n);
    film_run(&Y->f[F_MIX_PRE], Q->ft, NB, cond, Q->ss, n);
    ci = Q->ft;
  }
  conv_run(&Y->mix, ci, NB, Q->m, NB, n);
  if (Y->f[F_MIX_POST].on) film_run(&Y->f[F_MIX_POST], Q->m, NB, cond, Q->ss, n);
  for (int r = 0; r < Y->zc; r++) {
    float *zr = Q->z + (size_t)r * NB;
    const float *mr = Q->m + (size_t)r * NB;
    for (int t = 0; t < n; t++) zr[t] += mr[t];
  }
  if (Y->f[F_ACT_PRE].on) film_run(&Y->f[F_ACT_PRE], Q->z, NB, cond, Q->ss, n);
  /* 3) activation (top B rows hold the result) */
  if (Y->gate == G_NONE) {
    for (int c = 0; c < B; c++) act_row(&Y->act, Q->z + (size_t)c * NB, n, c);
  } else if (Y->gate == G_GATED) {
    for (int c = 0; c < B; c++) {
      float *a = Q->z + (size_t)c * NB, *g = Q->z + (size_t)(c + B) * NB;
      act_row(&Y->act, a, n, c);
      act_row(&Y->act2, g, n, c);
      for (int t = 0; t < n; t++) a[t] *= g[t];
    }
  } else {
    for (int c = 0; c < B; c++) {
      float *a = Q->z + (size_t)c * NB, *g = Q->z + (size_t)(c + B) * NB;
      fcopy(Q->pre, a, n);
      act_row(&Y->act, a, n, c);
      act_row(&Y->act2, g, n, c);
      for (int t = 0; t < n; t++) a[t] = g[t] * a[t] + (1.f - g[t]) * Q->pre[t];
    }
  }
  if (Y->f[F_ACT_POST].on) film_run(&Y->f[F_ACT_POST], Q->z, NB, cond, Q->ss, n);
  /* 4) residual and head paths */
  if (Y->has_l1) {
    conv_run(&Y->l1, Q->z, NB, Q->l1, NB, n);
    if (Y->f[F_L1_POST].on) film_run(&Y->f[F_L1_POST], Q->l1, NB, cond, Q->ss, n);
  }
  if (Y->has_h1) {
    conv_run(&Y->h1, Q->z, NB, Q->h1, NB, n);
    if (Y->f[F_H1_POST].on) film_run(&Y->f[F_H1_POST], Q->h1, NB, cond, Q->ss, n);
  }
  for (int r = 0; r < Y->C; r++) {
    float *o = Q->nx + (size_t)r * NB;
    const float *xi = x + (size_t)r * NB;
    if (Y->has_l1) {
      const float *l = Q->l1 + (size_t)r * NB;
      for (int t = 0; t < n; t++) o[t] = xi[t] + l[t];
    } else
      for (int t = 0; t < n; t++) o[t] = xi[t];
  }
}

/* one block (n <= NB) of a WaveNet: input rows in r->cin, output rows in r->out */
static void wavenet_block(nam_run *r, int n) {
  const nam_model *m = r->m;
  if (m->cond) {
    for (int c = 0; c < m->in_ch; c++) fcopy(r->cond->cin + (size_t)c * NB, r->cin + (size_t)c * NB, n);
    wavenet_block(r->cond, n);
    for (int c = 0; c < m->cond->out_ch; c++) fcopy(r->cnd + (size_t)c * NB, r->cond->out + (size_t)c * NB, n);
  }
  const float *lin = r->cin;
  const float *prev_head = 0;
  for (int ai = 0; ai < m->na; ai++) {
    const narray *A = &m->A[ai];
    arun *R = &r->A[ai];
    conv_run(&A->rc, lin, NB, R->rc, NB, n);
    for (int h = 0; h < A->hout; h++) {
      float *d = R->hacc + (size_t)h * NB;
      if (prev_head) fcopy(d, prev_head + (size_t)h * NB, n);
      else
        for (int t = 0; t < n; t++) d[t] = 0;
    }
    const float *x = R->rc;
    for (int li = 0; li < A->nl; li++) {
      const nlayer *Y = &A->L[li];
      lrun *Q = &R->L[li];
      layer_run(Y, Q, x, r->cnd, n);
      const float *ho = Y->has_h1 ? Q->h1 : Q->z;
      for (int h = 0; h < A->hout; h++) {
        float *d = R->hacc + (size_t)h * NB;
        const float *s = ho + (size_t)h * NB;
        for (int t = 0; t < n; t++) d[t] += s[t];
      }
      x = Q->nx;
    }
    const float *hp = hist_push(&R->hh, R->hacc, NB, n);
    conv_run(&A->hr, hp, R->hh.len, R->hout, NB, n);
    lin = x;
    prev_head = R->hout;
  }
  const float *fin = r->A[m->na - 1].hout;
  const int hs = m->A[m->na - 1].head_size;
  if (m->npost) {
    float *cur = r->pb[0];
    for (int c = 0; c < hs; c++) {
      const float *s = fin + (size_t)c * NB;
      float *d = cur + (size_t)c * NB;
      for (int t = 0; t < n; t++) d[t] = m->head_scale * s[t];
    }
    for (int i = 0; i < m->npost; i++) {
      for (int c = 0; c < m->post[i].cin; c++) act_row(&m->post_act, cur + (size_t)c * NB, n, c);
      const float *hp = hist_push(&r->ph[i], cur, NB, n);
      float *dst = i + 1 < m->npost ? r->pb[i + 1] : r->out;
      conv_run(&m->post[i], hp, r->ph[i].len, dst, NB, n);
      cur = dst;
    }
  } else {
    for (int c = 0; c < m->out_ch; c++) {
      const float *s = fin + (size_t)c * NB;
      float *d = r->out + (size_t)c * NB;
      for (int t = 0; t < n; t++) d[t] = m->head_scale * s[t];
    }
  }
}

static void lstm_block(nam_run *r, const float *in, float *out, int n) {
  const nam_model *m = r->m;
  const int H = m->hid;
  for (int t = 0; t < n; t++) {
    const float *inp = in + t;
    int insz = m->lin;
    for (int l = 0; l < m->nlstm; l++) {
      float *xh = r->xh[l], *c = r->c[l];
      for (int i = 0; i < insz; i++) xh[i] = inp[i];
      const int cols = insz + H;
      const float *W = m->lw[l], *b = m->lb[l];
      for (int g = 0; g < 4 * H; g++) {
        const float *wr = W + (size_t)g * cols;
        float acc = b[g];
        for (int j = 0; j < cols; j++) acc += wr[j] * xh[j];
        r->ifgo[g] = acc;
      }
      for (int i = 0; i < H; i++)
        c[i] = nsig(r->ifgo[H + i]) * c[i] + nsig(r->ifgo[i]) * ntanh(r->ifgo[2 * H + i]);
      for (int i = 0; i < H; i++) xh[insz + i] = nsig(r->ifgo[3 * H + i]) * ntanh(c[i]);
      inp = xh + insz;
      insz = H;
    }
    float acc = m->hb[0];
    for (int i = 0; i < H; i++) acc += m->hw[i] * inp[i];
    out[t] = acc;
  }
}

void nam_run_process(nam_run *r, const float *in, float *out, int n) {
  if (!r) {
    for (int i = 0; i < n; i++) out[i] = 0;
    return;
  }
  if (r->m->arch == ARCH_LSTM) {
    lstm_block(r, in, out, n);
    return;
  }
  for (int off = 0; off < n; off += NB) {
    int k = n - off < NB ? n - off : NB;
    fcopy(r->cin, in + off, k);
    for (int c = 1; c < r->m->in_ch; c++)
      for (int t = 0; t < k; t++) r->cin[(size_t)c * NB + t] = 0;
    wavenet_block(r, k);
    fcopy(out + off, r->out, k);
  }
}

void nam_run_prewarm(nam_run *r) {
  if (!r) return;
  float z[NB], o[NB];
  for (int i = 0; i < NB; i++) z[i] = 0;
  int left = r->m->prewarm;
  while (left > 0) {
    int k = left < NB ? left : NB;
    nam_run_process(r, z, o, k);
    left -= k;
  }
}

/* ===================================================== resampling ===== *
 * Streaming windowed-sinc resampler (16 taps, 512 phases, linear between
 * phases): used only when the capture's rate differs from the device's. */
#define RS_HALF 8
#define RS_PH 512
static float g_rs_tab[2][RS_PH + 1][2 * RS_HALF]; /* [cutoff: 0 = full, 1 = 44.1/48][phase][tap] */
static int g_rs_ready;

static void rs_tables(void) {
  if (g_rs_ready) return;
  for (int c = 0; c < 2; c++) {
    double fc = c ? 0.86 * 44100.0 / 48000.0 : 0.90; /* of Nyquist */
    for (int p = 0; p <= RS_PH; p++) {
      double frac = (double)p / RS_PH, sum = 0;
      for (int k = 0; k < 2 * RS_HALF; k++) {
        double x = (k - (RS_HALF - 1)) - frac; /* distance from the output point */
        double s = x == 0 ? fc : sh_sin(SH_PI * fc * x) / (SH_PI * x);
        double wx = x / (RS_HALF + 0.5);
        double w = sh_fabs(wx) >= 1 ? 0 : 0.42 + 0.5 * sh_cos(SH_PI * wx) + 0.08 * sh_cos(2 * SH_PI * wx); /* Blackman */
        g_rs_tab[c][p][k] = (float)(s * w);
        sum += s * w;
      }
      for (int k = 0; k < 2 * RS_HALF; k++) g_rs_tab[c][p][k] = (float)(g_rs_tab[c][p][k] / sum);
    }
  }
  g_rs_ready = 1;
}

typedef struct {
  float h[4 * RS_HALF + 4096]; /* input history */
  int hn;                      /* samples in h */
  double pos;                  /* next output position, in input samples (relative to h[0]) */
  double step;                 /* input samples per output sample */
  int tab;
} rs_t;

static void rs_init(rs_t *r, double in_rate, double out_rate) {
  rs_tables();
  sh_memset(r, 0, sizeof *r);
  r->step = in_rate / out_rate;
  r->tab = in_rate > out_rate * 1.001 || out_rate > in_rate * 1.001 ? 1 : 0;
  r->hn = 2 * RS_HALF; /* zeros */
  r->pos = RS_HALF - 1;
}

/* push n input samples; writes up to cap outputs, returns how many */
static int rs_run(rs_t *r, const float *in, int n, float *out, int cap) {
  int made = 0, i = 0;
  while (i < n) {
    int room = (int)(sizeof r->h / sizeof r->h[0]) - r->hn;
    int k = n - i < room ? n - i : room;
    fcopy(r->h + r->hn, in + i, k);
    r->hn += k, i += k;
    while (made < cap && r->pos + RS_HALF < r->hn) {
      int base = (int)r->pos;
      double frac = r->pos - base;
      double fp = frac * RS_PH;
      int ph = (int)fp;
      float a = (float)(fp - ph);
      const float *t0 = g_rs_tab[r->tab][ph], *t1 = g_rs_tab[r->tab][ph + 1];
      const float *x = r->h + base - (RS_HALF - 1);
      float acc = 0;
      for (int t = 0; t < 2 * RS_HALF; t++) acc += x[t] * (t0[t] + a * (t1[t] - t0[t]));
      out[made++] = acc;
      r->pos += r->step;
    }
    /* drop what is no longer needed */
    int keep_from = (int)r->pos - RS_HALF;
    if (keep_from > 2048) {
      fcopy(r->h, r->h + keep_from, (r->hn - keep_from)); /* forward copy is safe */
      r->hn -= keep_from, r->pos -= keep_from;
    }
  }
  return made;
}

/* ===================================================== the amp block ===== */
#define NA_FIFO 8192
typedef struct {
  nam_run *run;
  int resample;
  rs_t up, dn;          /* device → capture rate, capture rate → device */
  float fifo[NA_FIFO];  /* device-rate output waiting to be read */
  int fr, fw;
  float tmp_a[SH_MAX_BLOCK * 2 + 64], tmp_b[SH_MAX_BLOCK * 2 + 64];
  float g0, b0, m0, t0, p0; /* the tone's knob positions */
  float gain_ref, trim_db;
  float in_g, in_g_t;
  bq_t bass, mid, tre, pres;
  op_t dc;
  double sr;
  int bassamp;
} namamp_st;

static void namamp_coeffs(namamp_st *s, float g, float bass, float mid, float tre) {
  s->in_g_t = (float)sh_db2lin(s->trim_db + (g - s->gain_ref) * 12.0);
  double lo = s->bassamp ? 80 : 120;
  bq_set(&s->bass, BQ_LSHELF, s->sr, lo, 0.7, (bass - 0.5) * 14);
  bq_set(&s->mid, BQ_PEAK, s->sr, s->bassamp ? 500 : 750, 0.7, (mid - 0.5) * 12);
  bq_set(&s->tre, BQ_HSHELF, s->sr, s->bassamp ? 2500 : 3200, 0.7, (tre - 0.5) * 14);
}

static void namamp_user(sh_block *b, float ug, float ub, float um, float ut) {
  namamp_st *s = (namamp_st *)b->st;
  if (!s) return;
  float g = ug >= 0 ? ug : s->g0;
  namamp_coeffs(s, g, sh_clampf(s->b0 + (ub - 0.5f), 0, 1), sh_clampf(s->m0 + (um - 0.5f), 0, 1), sh_clampf(s->t0 + (ut - 0.5f), 0, 1));
}

static void namamp_core(namamp_st *s, float *x, int n) {
  for (int i = 0; i < n; i++) {
    s->in_g += 0.002f * (s->in_g_t - s->in_g);
    x[i] *= s->in_g;
  }
  if (!s->resample) {
    nam_run_process(s->run, x, x, n);
    return;
  }
  int m = rs_run(&s->up, x, n, s->tmp_a, (int)(sizeof s->tmp_a / sizeof s->tmp_a[0]));
  nam_run_process(s->run, s->tmp_a, s->tmp_a, m);
  int k = rs_run(&s->dn, s->tmp_a, m, s->tmp_b, (int)(sizeof s->tmp_b / sizeof s->tmp_b[0]));
  for (int i = 0; i < k; i++) {
    s->fifo[s->fw] = s->tmp_b[i];
    s->fw = (s->fw + 1) & (NA_FIFO - 1);
  }
  for (int i = 0; i < n; i++) {
    if (s->fr == s->fw) { /* should not happen (pre-filled); hold the last sample */
      x[i] = i ? x[i - 1] : 0;
      continue;
    }
    x[i] = s->fifo[s->fr];
    s->fr = (s->fr + 1) & (NA_FIFO - 1);
  }
}

static void namamp_proc(sh_block *b, float *L, float *R, int n) {
  (void)R;
  namamp_st *s = (namamp_st *)b->st;
  namamp_core(s, L, n);
  for (int i = 0; i < n; i++) {
    float y = op_hp(&s->dc, L[i]);
    y = bq_run(&s->bass, y);
    y = bq_run(&s->mid, y);
    y = bq_run(&s->tre, y);
    L[i] = bq_run(&s->pres, y);
  }
}

static float kpos(const sh_gear *g, const char *name, float def) {
  sh_knob k;
  if (kn_exact(g, name, &k) && k.hi > k.lo && k.lo >= 0) return (k.v - k.lo) / (k.hi - k.lo);
  return def;
}

/* how much louder quiet playing comes out than loud playing (dB): high-gain
   captures squash a lot, so their noise needs a firmer gate */
static float namamp_squash_db(namamp_st *s, float *buf, int n) {
  uint32_t seed = 777;
  double e[2] = {0, 0};
  for (int pass = 0; pass < 2; pass++) {
    float lev = pass ? 0.3f : 0.01f, lp = 0;
    double ein = 0, eout = 0;
    for (int off = 0; off < n; off += 256) {
      int m = n - off < 256 ? n - off : 256;
      for (int i = 0; i < m; i++) lp += 0.3f * (sh_randf(&seed) - lp), buf[i] = lp * lev;
      for (int i = 0; i < m; i++) ein += (double)buf[i] * buf[i];
      namamp_core(s, buf, m);
      if (off > n / 3)
        for (int i = 0; i < m; i++) eout += (double)buf[i] * buf[i];
    }
    e[pass] = sh_lin2db(sh_sqrt(eout / (ein + 1e-20)) + 1e-9);
  }
  float d = (float)(e[0] - e[1]);
  return d < 0 ? 0 : d;
}

int namamp_build(sh_block *b, const sh_gear *g, const sh_spec *spec, const nam_model *m, float gain_ref, float trim_db,
                 float *squash_cache, sh_arena *a, double sr, float *gain_db_out) {
  namamp_st *s = (namamp_st *)ar_alloc(a, sizeof(namamp_st));
  if (!s) return 0;
  s->run = nam_run_new(m, a);
  if (!s->run) return 0;
  s->sr = sr;
  s->bassamp = spec->bass;
  double mr = nam_model_rate(m);
  s->resample = mr < sr - 0.5 || mr > sr + 0.5;
  if (s->resample) {
    rs_init(&s->up, sr, mr);
    rs_init(&s->dn, mr, sr);
    for (int i = 0; i < 3; i++) s->fifo[s->fw++] = 0; /* absorbs ±1 sample per block */
  }
  sh_knob k;
  float gain = 0.5f;
  if (kn_find(g, "gain", &k) || kn_find(g, "preamp", &k) || kn_find(g, "loudness", &k) || kn_find(g, "vol", &k) || kn_find(g, "drive", &k))
    if (k.hi > k.lo) gain = (k.v - k.lo) / (k.hi - k.lo);
  s->g0 = sh_clampf(gain, 0, 1);
  s->b0 = kpos(g, "bass", 0.5f);
  s->m0 = kpos(g, "mid", kpos(g, "midrange", 0.5f));
  s->t0 = kpos(g, "treble", 0.5f);
  s->p0 = kpos(g, "presence", 0.5f);
  s->gain_ref = gain_ref >= 0 && gain_ref <= 1 ? gain_ref : 0.5f;
  s->trim_db = trim_db;
  bq_set(&s->pres, BQ_HSHELF, sr, s->bassamp ? 4000 : 5000, 0.7, (s->p0 - 0.5) * 8);
  op_lp_set(&s->dc, sr, 10);
  b->process = namamp_proc;
  b->user = namamp_user;
  b->st = s;
  b->name = "Real amp";
  namamp_user(b, spec->user_gain, spec->user_bass ? spec->user_bass : 0.5f, spec->user_mid ? spec->user_mid : 0.5f, spec->user_treble ? spec->user_treble : 0.5f);
  s->in_g = s->in_g_t;
  /* settle the network, measure how hard it squashes, settle again */
  float *buf = (float *)ar_alloc(a, sizeof(float) * 256);
  if (!buf) return 0;
  nam_run_prewarm(s->run);
  if (squash_cache && *squash_cache < 0) {
    *squash_cache = namamp_squash_db(s, buf, (int)(sr * 0.12));
    nam_run_prewarm(s->run);
  }
  if (gain_db_out) *gain_db_out = squash_cache && *squash_cache >= 0 ? *squash_cache * 1.6f : 0;
  return 1;
}
