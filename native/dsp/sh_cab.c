/*
 * Speaker cabinets. Each Rocksmith cabinet (model × mic × position) is turned
 * into a magnitude response from a speaker description, then into a
 * minimum-phase impulse response (cepstrum), convolved directly (zero latency).
 * A user's own IR file can replace it.
 */
#include "sh_dsp.h"

typedef struct {
  float res_hz, res_q;     /* low resonance */
  float hp_open;           /* extra low cut for open-back */
  float lp_hz;             /* top roll-off (4th order) */
  float peaks[5][3];       /* hz, dB, width (octaves) */
  float horn_db;           /* tweeter level relative (bass cabs), 0 = none */
  int count;               /* speakers */
  float novelty_lo, novelty_hi;
} spk_t;

static void add_peak(spk_t *s, int i, float hz, float db, float w) {
  s->peaks[i][0] = hz, s->peaks[i][1] = db, s->peaks[i][2] = w;
}

static spk_t speaker_for(const char *key, int bass_kind) {
  spk_t s;
  sh_memset(&s, 0, sizeof s);
  s.count = 1;
  s.res_q = 1.6f;
  int bass = sh_has(key, "Bass_Cab") || bass_kind;
  /* how many speakers and what size */
  float size = 12;
  if (sh_has(key, "412") || sh_has(key, "4120") || sh_has(key, "1960")) s.count = 4, size = 12;
  else if (sh_has(key, "810")) s.count = 8, size = 10;
  else if (sh_has(key, "610")) s.count = 6, size = 10;
  else if (sh_has(key, "410")) s.count = 4, size = 10;
  else if (sh_has(key, "310")) s.count = 3, size = 10;
  else if (sh_has(key, "415")) s.count = 4, size = 15;
  else if (sh_has(key, "1510")) s.count = 2, size = 15;
  else if (sh_has(key, "1515") || sh_has(key, "215")) s.count = 2, size = 15;
  else if (sh_has(key, "212") || sh_has(key, "2120") || sh_has(key, "1936")) s.count = 2, size = 12;
  else if (sh_has(key, "210") || sh_has(key, "CH21")) s.count = 2, size = 10;
  else if (sh_has(key, "115") || sh_has(key, "1150") || sh_has(key, "CS15")) s.count = 1, size = 15;
  else if (sh_has(key, "110")) s.count = 1, size = 10;
  else s.count = 1, size = 12;

  if (bass) {
    s.res_hz = size >= 15 ? 42 : 58;
    s.res_q = 1.4f;
    s.lp_hz = size >= 15 ? 2400 : 3800;
    add_peak(&s, 0, 120, 2, 1.0f);
    add_peak(&s, 1, 900, 1.5f, 1.2f);
    add_peak(&s, 2, 2200, 2, 0.6f);
    if (sh_has(key, "Eden") || sh_has(key, "CH") || sh_has(key, "CS410") || sh_has(key, "BT410") || sh_has(key, "BT212") || sh_has(key, "GB415"))
      s.horn_db = -8; /* tweeter */
    if (sh_has(key, "CH")) add_peak(&s, 3, 3500, 3, 0.5f); /* aluminium cones: bright */
    if (sh_has(key, "810")) s.lp_hz = 3200, add_peak(&s, 3, 250, 2, 0.8f);
    if (sh_has(key, "Orange")) add_peak(&s, 3, 600, 2, 0.8f);
    return s;
  }
  /* novelty / full-range */
  if (sh_has(key, "Audiophile")) { s.res_hz = 35, s.lp_hz = 19000, s.res_q = 0.7f; return s; }
  if (sh_has(key, "VintageHiFi")) { s.res_hz = 55, s.lp_hz = 11000, s.res_q = 0.8f; add_peak(&s, 0, 3000, 2, 1); return s; }
  if (sh_has(key, "PA")) { s.res_hz = 60, s.lp_hz = 14000, s.res_q = 0.9f; add_peak(&s, 0, 2500, 1.5f, 1); return s; }
  if (sh_has(key, "BoomBox")) { s.res_hz = 140, s.res_q = 2.2f, s.lp_hz = 7000; add_peak(&s, 0, 1600, 4, 0.8f); add_peak(&s, 1, 4000, 3, 0.5f); s.hp_open = 160; return s; }
  if (sh_has(key, "CabinetRadio")) { s.res_hz = 180, s.res_q = 1.5f, s.lp_hz = 4200; add_peak(&s, 0, 1000, 6, 0.8f); s.hp_open = 220; return s; }
  if (sh_has(key, "Gramophone")) { s.res_hz = 450, s.res_q = 2.5f, s.lp_hz = 3200; add_peak(&s, 0, 900, 8, 0.4f); add_peak(&s, 1, 1700, 6, 0.4f); add_peak(&s, 2, 2600, 5, 0.3f); s.hp_open = 500; return s; }
  if (sh_has(key, "JukeBox")) { s.res_hz = 90, s.res_q = 1.2f, s.lp_hz = 6000; add_peak(&s, 0, 300, 3, 1); add_peak(&s, 1, 2000, 2, 0.8f); return s; }

  s.res_hz = size >= 15 ? 70 : size <= 10 ? 105 : 88;
  s.res_q = s.count >= 4 ? 1.3f : 1.1f; /* real cabs: a gentle bump, not a boom */
  int open = sh_has(key, "TW1") || sh_has(key, "CA112") || sh_has(key, "CS") || sh_has(key, "OB") || sh_has(key, "JimmyBean") || sh_has(key, "AT0112") ||
             sh_has(key, "BT112") || sh_has(key, "AT112");
  if (open && s.count <= 2) s.hp_open = 110, s.res_q = 1.0f;
  if (sh_has(key, "Marshall") || sh_has(key, "GB412")) {
    /* greenback: warm, softer top */
    s.lp_hz = 4700;
    add_peak(&s, 0, 1900, 3.5f, 0.6f);
    add_peak(&s, 1, 2900, 2.5f, 0.4f);
    add_peak(&s, 2, 600, -1.5f, 0.8f);
    add_peak(&s, 3, 140, 1.5f, 0.6f);
  } else if (sh_has(key, "TW") || sh_has(key, "CA112") || sh_has(key, "AT")) {
    /* American / alnico, open and sparkly */
    s.lp_hz = size <= 10 ? 5600 : 6000;
    add_peak(&s, 0, 1200, 1.5f, 0.8f);
    add_peak(&s, 1, 2500, 4, 0.5f);
    add_peak(&s, 2, 4200, 3, 0.4f);
    add_peak(&s, 3, 450, -2, 0.9f);
  } else if (sh_has(key, "CS")) {
    /* solid-state combo: bright, flat */
    s.lp_hz = 6800;
    add_peak(&s, 0, 3000, 3, 0.6f);
    add_peak(&s, 1, 800, -1, 1);
  } else {
    /* Vintage 30 style (Mesa, Orange, ENGL, Bogner, Hughes): aggressive upper mids */
    s.lp_hz = 5300;
    add_peak(&s, 0, 2500, 6, 0.35f);
    add_peak(&s, 1, 3900, 3.5f, 0.3f);
    add_peak(&s, 2, 1300, 1.5f, 0.5f);
    add_peak(&s, 3, 400, -2.5f, 0.8f);
    add_peak(&s, 4, 130, 1.5f, 0.5f);
  }
  if (size >= 15) s.lp_hz *= 0.75f;
  return s;
}

/* 4.6: the movable mic. pos 0 (center of the cone) .. 1 (edge), ang 0 (straight on) .. 1 (45°
 * away), dist 0 (on the grille) .. 1 (a foot or more back). pos < 0: the named position in the key. */
typedef struct { double pos, ang, dist, room; } mic_place;

static double mic_db(const char *key, double f, const mic_place *mp) {
  double lf = sh_log(f / 1000.0) / SH_LN2; /* octaves from 1k */
  double d = 0;
  double edge = sh_has(key, "_Edge"), off = sh_has(key, "OffAxis");
  double cone = !edge && !off && sh_has(key, "_Cone");
  if (mp && mp->pos >= 0) {
    /* continuous: the cone's bright center fades into the edge's warmth */
    double e = sh_clamp((mp->pos - 0.12) / 0.6, 0, 1);
    edge = e * e * (3 - 2 * e);
    cone = 1 - edge;
    off = mp->ang;
  }
  if (sh_has(key, "_57_")) {
    d += 4 * sh_exp(-0.5 * ((lf - 2.3) / 0.6) * ((lf - 2.3) / 0.6)); /* presence ~5k */
    d += 2 * sh_exp(-0.5 * ((lf + 2.8) / 0.7) * ((lf + 2.8) / 0.7)); /* proximity ~150 */
  } else if (sh_has(key, "Condenser")) {
    d += 2 * sh_exp(-0.5 * ((lf - 3.2) / 0.8) * ((lf - 3.2) / 0.8));
  } else if (sh_has(key, "Ribbon")) {
    d += f > 2000 ? -5 * (1 - 1 / (1 + (f - 2000) / 3000)) : 0;
    d += 2.5 * sh_exp(-0.5 * ((lf + 2.3) / 0.8) * ((lf + 2.3) / 0.8));
  } else if (sh_has(key, "Tube")) {
    d += 1.5 * sh_exp(-0.5 * ((lf + 2.0) / 0.8) * ((lf + 2.0) / 0.8));
    d += f > 4000 ? -3 * (1 - 1 / (1 + (f - 4000) / 4000)) : 0;
  }
  if (edge > 0) d += edge * ((f > 1500 ? -6 * (1 - 1 / (1 + (f - 1500) / 2000)) : 0) + 1.0 * sh_exp(-0.5 * ((lf + 1.3) / 0.8) * ((lf + 1.3) / 0.8)));
  if (off > 0) d += off * ((f > 2500 ? -4 * (1 - 1 / (1 + (f - 2500) / 2500)) : 0) - 2.5 * sh_exp(-0.5 * ((lf - 2.6) / 0.25) * ((lf - 2.6) / 0.25)));
  if (cone > 0 && (mp && mp->pos >= 0 ? 1 : !off)) d += cone * (1 - off) * 1.5 * sh_exp(-0.5 * ((lf - 1.8) / 0.7) * ((lf - 1.8) / 0.7));
  if (mp && mp->dist > 0) {
    /* backing off: less proximity bass, the speaker's beam narrows the top a touch */
    d -= mp->dist * 5.0 / (1 + (f / 180) * (f / 180));
    d += f > 5000 ? -mp->dist * 3 * (1 - 1 / (1 + (f - 5000) / 4000)) : 0;
  }
  return d;
}

static void mic_from_knobs(const sh_gear *g, mic_place *mp) {
  sh_knob k;
  mp->pos = kn_exact(g, "mic position", &k) ? sh_clamp(k.v / 100.0, 0, 1) : -1;
  mp->ang = kn_exact(g, "mic angle", &k) ? sh_clamp(k.v / 100.0, 0, 1) : 0;
  mp->dist = kn_exact(g, "mic distance", &k) ? sh_clamp(k.v / 100.0, 0, 1) : 0;
  mp->room = kn_exact(g, "room mic", &k) ? sh_clamp(k.v / 100.0, 0, 1) : 0;
  if (mp->pos < 0 && (mp->ang > 0 || mp->dist > 0)) mp->pos = sh_has(g->key, "_Edge") ? 0.72 : sh_has(g->key, "OffAxis") ? 0.4 : 0.08;
}

static double speaker_db(const spk_t *s, double f, uint32_t seed) {
  double r = f / s->res_hz;
  /* 2nd-order HP with resonance */
  double hp = (r * r) / sh_sqrt((1 - r * r) * (1 - r * r) + (r / s->res_q) * (r / s->res_q));
  double d = 20 * sh_log10(hp + 1e-9);
  /* below the resonance a closed guitar cab falls away steeply (4th order overall) */
  if (s->lp_hz < 9000 && s->res_hz > 50 && s->res_hz < 130) {
    double r2 = f / (s->res_hz * 0.85);
    d += 10 * sh_log10(r2 * r2 * r2 * r2 / (1 + r2 * r2 * r2 * r2));
  }
  if (s->hp_open > 0) {
    double o = f / s->hp_open;
    d += 10 * sh_log10(o * o / (1 + o * o));
  }
  /* 4th-order top roll-off */
  double l = f / s->lp_hz;
  double lp = 1 / sh_sqrt(1 + l * l * l * l * l * l * l * l);
  /* real cones fall away much faster once they break up: another 12 dB/oct above */
  if (!s->horn_db && s->lp_hz < 9000) {
    double l2 = f / (s->lp_hz * 1.5);
    lp /= sh_sqrt(1 + l2 * l2 * l2 * l2);
  }
  double main = 20 * sh_log10(lp + 1e-9);
  if (s->horn_db) {
    double h = f / 3500, hl = f / 14000;
    double horn = sh_db2lin(s->horn_db) * (h * h * h * h / (1 + h * h * h * h)) / sh_sqrt(1 + hl * hl * hl * hl);
    main = 20 * sh_log10(lp + horn + 1e-9);
  }
  d += main;
  double lf = sh_log(f / 1000.0) / SH_LN2;
  for (int i = 0; i < 5; i++) {
    if (!s->peaks[i][0]) continue;
    double c = sh_log(s->peaks[i][0] / 1000.0) / SH_LN2, w = s->peaks[i][2];
    d += s->peaks[i][1] * sh_exp(-0.5 * ((lf - c) / w) * ((lf - c) / w));
  }
  /* multi-speaker interference: small dips in the upper mids */
  if (s->count >= 2) {
    d -= 1.5 * sh_exp(-0.5 * ((lf - 1.2) / 0.15) * ((lf - 1.2) / 0.15));
    d -= 1.2 * sh_exp(-0.5 * ((lf - 2.1) / 0.12) * ((lf - 2.1) / 0.12));
  }
  /* cone breakup irregularity, unique per cabinet */
  uint32_t st = seed;
  /* a real speaker's response is jagged between 1 and 7 kHz; that's much of
     what makes a mic'd cab sound like a cab rather than a filter */
  int full = s->lp_hz >= 9000;
  for (int i = 0; i < 12; i++) {
    double c = 0.1 + 2.7 * ((sh_rand(&st) & 1023) / 1023.0); /* 1.1k..7k */
    double g = (full ? 1.2 : 3.2) * (((sh_rand(&st) & 1023) / 1023.0) * 2 - 1);
    double w = 0.05 + 0.07 * ((sh_rand(&st) & 1023) / 1023.0);
    d += g * sh_exp(-0.5 * ((lf - c) / w) * ((lf - c) / w));
  }
  /* the cab's back panel and floor: a faint reflection about half a millisecond late */
  if (!full) {
    double ph = SH_TAU * f * 0.00047;
    double re = 1 + 0.22 * sh_cos(ph), im = -0.22 * sh_sin(ph);
    d += 10 * sh_log10(re * re + im * im);
  }
  return d;
}

/* ------------------------------------------------------------ convolver -- */
typedef struct {
  float *ir;
  int len;
  float *hist; /* 2*len */
  int pos;
} conv_t;

static void cab_proc(sh_block *b, float *L, float *R, int n) {
  (void)R;
  conv_t *c = (conv_t *)b->st;
  const int len = c->len;
  for (int i = 0; i < n; i++) {
    c->pos = c->pos == 0 ? len - 1 : c->pos - 1;
    c->hist[c->pos] = L[i];
    c->hist[c->pos + len] = L[i];
    const float *h = &c->hist[c->pos];
    const float *ir = c->ir;
    float s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    int k = 0;
    for (; k + 4 <= len; k += 4) {
      s0 += ir[k] * h[k];
      s1 += ir[k + 1] * h[k + 1];
      s2 += ir[k + 2] * h[k + 2];
      s3 += ir[k + 3] * h[k + 3];
    }
    for (; k < len; k++) s0 += ir[k] * h[k];
    L[i] = s0 + s1 + s2 + s3;
  }
}

int cab_build_ir(sh_block *b, const float *ir, int len, sh_arena *a) {
  conv_t *c = (conv_t *)ar_alloc(a, sizeof(conv_t));
  if (!c) return 0;
  if (len > 8192) len = 8192;
  c->len = len;
  c->ir = (float *)ar_alloc(a, sizeof(float) * len);
  c->hist = (float *)ar_alloc(a, sizeof(float) * len * 2);
  if (!c->ir || !c->hist) return 0;
  sh_memcpy(c->ir, ir, sizeof(float) * len);
  b->st = c;
  b->process = cab_proc;
  b->name = "Your cabinet";
  return 1;
}

#define CAB_FFT 8192
int cab_build(sh_block *b, const sh_gear *g, sh_arena *a, double sr, int bass_kind) {
  spk_t s = speaker_for(g->key, bass_kind);
  int bass = sh_has(g->key, "Bass_Cab") || bass_kind;
  mic_place mp;
  mic_from_knobs(g, &mp);
  int len = (int)(sr * (bass ? 0.032 : 0.022));
  if (len > CAB_FFT / 2) len = CAB_FFT / 2;
  /* the room: a floor bounce that comes sooner the closer the mic, and a few early reflections */
  int tail = (mp.dist > 0 || mp.room > 0) ? (int)(sr * 0.012) : 0;
  if (len + tail > CAB_FFT / 2) tail = CAB_FFT / 2 - len;
  /* scratch from the arena: re, im (double) */
  size_t mark = a->used;
  double *re = (double *)ar_alloc(a, sizeof(double) * CAB_FFT);
  double *im = (double *)ar_alloc(a, sizeof(double) * CAB_FFT);
  if (!re || !im) return 0;
  uint32_t seed = 2166136261u;
  for (const char *p = g->key; *p; p++) seed = (seed ^ (uint8_t)*p) * 16777619u;
  if (!seed) seed = 1;
  double ref = 0;
  {
    double f = 1000;
    ref = speaker_db(&s, f, seed) + mic_db(g->key, f, &mp);
  }
  for (int i = 0; i <= CAB_FFT / 2; i++) {
    double f = (double)i * sr / CAB_FFT;
    if (f < 10) f = 10;
    double db = speaker_db(&s, f, seed) + mic_db(g->key, f, &mp) - ref;
    if (db < -90) db = -90;
    re[i] = db * 0.11512925464970228; /* ln|H| */
    im[i] = 0;
    if (i && i < CAB_FFT / 2) re[CAB_FFT - i] = re[i], im[CAB_FFT - i] = 0;
  }
  /* real cepstrum → minimum phase */
  sh_fft(re, im, CAB_FFT, 1);
  for (int i = 1; i < CAB_FFT / 2; i++) re[i] *= 2, im[i] *= 2;
  for (int i = CAB_FFT / 2 + 1; i < CAB_FFT; i++) re[i] = 0, im[i] = 0;
  sh_fft(re, im, CAB_FFT, 0);
  for (int i = 0; i < CAB_FFT; i++) {
    double m = sh_exp(re[i]);
    double ph = im[i];
    re[i] = m * sh_cos(ph);
    im[i] = m * sh_sin(ph);
  }
  sh_fft(re, im, CAB_FFT, 1);
  conv_t *c = 0;
  float *ir = 0;
  /* keep ir in place: copy to float, then release scratch and allocate final */
  float tmp_first[8];
  (void)tmp_first;
  /* window tail */
  int fade = len / 4;
  for (int i = 0; i < len; i++) {
    double w = i < len - fade ? 1 : 0.5 + 0.5 * sh_cos(SH_PI * (i - (len - fade)) / fade);
    re[i] *= w;
  }
  if (tail > 0) {
    /* reflections: copies of the speaker's own response, later and quieter (im[] is free now) */
    static const double TAP_MS[6] = { 0, 2.3, 4.1, 6.4, 8.2, 10.5 };
    static const double TAP_G[6] = { 0, 0.55, -0.42, 0.33, -0.27, 0.2 };
    for (int i = 0; i < len + tail; i++) im[i] = i < len ? re[i] : 0;
    double floor_ms = 0.25 + 2.6 * mp.dist; /* the floor bounce: further back, later */
    int fd = (int)(sr * floor_ms / 1000.0);
    double fg = 0.45 * mp.dist;
    for (int i = 0; i < len; i++)
      if (i + fd < len + tail) im[i + fd] += fg * re[i];
    for (int t = 1; t < 6; t++) {
      int dly = (int)(sr * (TAP_MS[t] + 1.5 * mp.dist) / 1000.0);
      double gn = TAP_G[t] * mp.room;
      for (int i = 0; i < len && i + dly < len + tail; i++) im[i + dly] += gn * re[i];
    }
    len += tail;
    int fade2 = tail / 3;
    for (int i = 0; i < len; i++) re[i] = im[i] * (i < len - fade2 ? 1 : 0.5 + 0.5 * sh_cos(SH_PI * (i - (len - fade2)) / fade2));
  }
  /* normalise: unity gain at 1 kHz */
  double cr = 0, ci = 0;
  for (int i = 0; i < len; i++) cr += re[i] * sh_cos(-SH_TAU * 1000 * i / sr), ci += re[i] * sh_sin(-SH_TAU * 1000 * i / sr);
  double g1k = sh_sqrt(cr * cr + ci * ci);
  double norm = g1k > 1e-9 ? 1 / g1k : 1;
  /* move result to the front of re as floats (re is at least len*2 floats big) */
  float *fr = (float *)re;
  for (int i = 0; i < len; i++) fr[i] = (float)(re[i] * norm);
  /* allocate final buffers after the scratch; the scratch is wasted but small */
  (void)mark;
  c = (conv_t *)ar_alloc(a, sizeof(conv_t));
  if (!c) return 0;
  ir = (float *)ar_alloc(a, sizeof(float) * len);
  c->hist = (float *)ar_alloc(a, sizeof(float) * len * 2);
  if (!ir || !c->hist) return 0;
  sh_memcpy(ir, fr, sizeof(float) * len);
  c->ir = ir;
  c->len = len;
  b->st = c;
  b->process = cab_proc;
  b->name = g->key;
  return 1;
}
