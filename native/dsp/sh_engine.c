/*
 * The engine: up to SH_SLOTS prepared tones, one playing; crossfades between
 * them; input gain, volume, output limiter and meters.
 */
#include "sh_dsp.h"
#include "sh_nam.h"

#define MAX_BLOCKS 24
#define SLOT_BYTES (7u << 20)
#define NAM_BYTES (2u << 20) /* a parsed capture per slot */
#define XFADE_MS 30
#define DR_LEN 8192
#define RM_LEN 8192
#define RM_AP 1024

typedef struct {
  sh_arena ar;
  sh_block b[MAX_BLOCKS];
  int nb;
  int stereo_from; /* first stereo block index */
  int amp;         /* amp block index or -1 */
  int cab;         /* cab block index or -1 */
  float out_gain;
  int valid;
  char amp_name[48];
  char spec_text[4096];
  int bass;
  /* a real amp capture in place of the modelled amp */
  nam_model *nam;
  uint8_t *nam_mem;
  int nam_full; /* the capture includes the cabinet */
  float nam_ref, nam_trim, nam_squash; /* squash: measured once per capture (dB), <0 = not yet */
  /* low-end correction measured at build (keeps every tone from booming) */
  bq_t cls[2];
  float cls_db;
} slot_t;

struct sh_engine {
  double sr;
  float p[SHP_COUNT];
  slot_t slot[SH_SLOTS];
  int active, prev;
  int xf, xf_len;
  float bufL[SH_MAX_BLOCK], bufR[SH_MAX_BLOCK], pL[SH_MAX_BLOCK], pR[SH_MAX_BLOCK], inb[SH_MAX_BLOCK];
  op_t dc;
  float in_g, vol_g, in_g_t, vol_g_t;
  /* meters */
  double m_in2, m_out2;
  float m_inpk, m_outpk;
  int m_n;
  float gate_open;
  /* the player's noise floor, learned from the quiet moments between notes (10 ms frames) */
  float gate_live[4];
  float nf_frame[40];  /* frame peaks (dB), last 400 ms */
  int nf_i, nf_n, nf_pos;
  float nf_pk;         /* this frame's peak so far */
  float nf_recent;     /* recent playing peak (dB), falls slowly */
  /* drop: pitch shifter on the input */
  float dr_buf[DR_LEN];
  int dr_w;
  double dr_rp[2];   /* two read heads (absolute sample positions) */
  int dr_xf;         /* crossfade samples left (head 1 fading in) */
  int dr_on;         /* semitones, 0 = off */
  float dr_ratio, dr_mix, dr_mix_t;
  /* room: stereo early reflections around the cabinet */
  float rm_buf[RM_LEN];
  int rm_w;
  op_t rm_lp, rm_hp;
  float rm_amt;
  int rm_tl[6], rm_tr[6];
  float rm_g[6];
  float rm_ap[2][RM_AP];
  int rm_api[2];
  /* custom IRs per slot */
  float *ir[SH_SLOTS];
  int irlen[SH_SLOTS];
};

size_t sh_engine_mem_needed(void) { return sizeof(sh_engine) + (size_t)SH_SLOTS * (SLOT_BYTES + NAM_BYTES) + 64; }

sh_engine *sh_engine_init(void *mem, size_t bytes, double sr) {
  if (!mem || bytes < sh_engine_mem_needed()) return 0;
  uint8_t *base = (uint8_t *)(((uintptr_t)mem + 15) & ~(uintptr_t)15);
  sh_engine *e = (sh_engine *)base;
  sh_memset(e, 0, sizeof(*e));
  e->sr = sr;
  uint8_t *p = base + ((sizeof(sh_engine) + 15) & ~(size_t)15);
  for (int i = 0; i < SH_SLOTS; i++) {
    e->slot[i].ar.base = p + (size_t)i * SLOT_BYTES;
    e->slot[i].ar.size = SLOT_BYTES;
    e->slot[i].nam_mem = p + (size_t)SH_SLOTS * SLOT_BYTES + (size_t)i * NAM_BYTES;
  }
  e->active = -1, e->prev = -1;
  e->p[SHP_INPUT] = 0.5f, e->p[SHP_VOLUME] = 0.7f, e->p[SHP_GAIN] = -1, e->p[SHP_BASS] = 0.5f, e->p[SHP_MID] = 0.5f, e->p[SHP_TREBLE] = 0.5f, e->p[SHP_FX] = 0.5f;
  e->in_g = e->in_g_t = 1, e->vol_g = e->vol_g_t = 1;
  e->dr_ratio = 1;
  e->p[SHP_ROOM] = 0.5f, e->rm_amt = 0.5f;
  {
    /* reflection times (ms) differ left and right so the room is wide */
    static const float tl[6] = {6.3f, 11.9f, 17.7f, 24.1f, 31.9f, 41.3f}, tr[6] = {7.7f, 13.1f, 20.3f, 27.3f, 35.1f, 44.9f};
    static const float g[6] = {0.62f, 0.5f, 0.42f, 0.33f, 0.25f, 0.18f};
    double k = sr / 1000.0;
    for (int i = 0; i < 6; i++) {
      e->rm_tl[i] = (int)(tl[i] * k), e->rm_tr[i] = (int)(tr[i] * k), e->rm_g[i] = g[i];
      if (e->rm_tl[i] >= RM_LEN - 1) e->rm_tl[i] = RM_LEN - 2;
      if (e->rm_tr[i] >= RM_LEN - 1) e->rm_tr[i] = RM_LEN - 2;
    }
    op_lp_set(&e->rm_lp, sr, 5200);
    op_lp_set(&e->rm_hp, sr, 160);
    e->rm_api[0] = (int)(4.7 * k) < RM_AP ? (int)(4.7 * k) : RM_AP - 1;
    e->rm_api[1] = (int)(6.1 * k) < RM_AP ? (int)(6.1 * k) : RM_AP - 1;
  }
  e->xf_len = (int)(sr * XFADE_MS / 1000);
  op_lp_set(&e->dc, sr, 12);
  e->gate_live[0] = -200, e->gate_live[3] = 1;
  e->nf_recent = -20;
  return e;
}

/* --------------------------------------------------------------- build -- */
static const char *DEFAULT_CAB_GTR = "Cab_GB412CMKIII_57_Cone";
static const char *DEFAULT_CAB_BASS = "Bass_Cab_AT810BC_57_Cone";

static int add_block(slot_t *s) {
  if (s->nb >= MAX_BLOCKS) return -1;
  sh_memset(&s->b[s->nb], 0, sizeof(sh_block));
  return s->nb++;
}

static int build_into(sh_engine *e, slot_t *s, const sh_spec *sp, const float *ir, int irlen) {
  double sr = e->sr;
  sh_arena *a = &s->ar;
  a->used = 0, a->failed = 0;
  s->nb = 0, s->amp = -1, s->cab = -1, s->stereo_from = MAX_BLOCKS, s->amp_name[0] = 0;
  s->bass = sp->bass;
  int has_gate = 0, has_cab = 0, has_amp = 0;
  for (int i = 0; i < sp->ngear; i++) {
    if (sh_has(sp->g[i].key, "NoiseGate")) has_gate = 1;
    if (sp->g[i].slot == SLOT_CAB) has_cab = 1;
    if (sp->g[i].slot == SLOT_AMP) has_amp = 1;
  }
  /* Stagehand's own gate always comes first: it follows the player's noise floor;
     with a gate pedal in the tone it only does that (the pedal sets the rest) */
  int gate_i = add_block(s); /* filled after the amp is known */
  float amp_db = 0;
  static const int ORDER[5] = {SLOT_PRE, SLOT_AMP, SLOT_POST, SLOT_CAB, SLOT_RACK};
  for (int o = 0; o < 5; o++) {
    int want = ORDER[o];
    for (int i = 0; i < sp->ngear; i++) {
      const sh_gear *g = &sp->g[i];
      if (g->slot != want) continue;
      if (want == SLOT_CAB && s->nam && s->nam_full) continue; /* the capture has its own speaker */
      int bi = add_block(s);
      if (bi < 0) break;
      sh_block *b = &s->b[bi];
      int ok;
      int stereo = want == SLOT_RACK;
      if (want == SLOT_AMP || sh_has(g->key, "EdenWTDI")) {
        float db = 0;
        if (want == SLOT_AMP && s->nam) ok = namamp_build(b, g, sp, s->nam, s->nam_ref, s->nam_trim, &s->nam_squash, a, sr, &db);
        else ok = amp_build(b, g, sp, a, sr, &db);
        if (ok && want == SLOT_AMP) {
          s->amp = bi, amp_db = db;
          int n = 0;
          for (const char *c = b->name; *c && n < 47; c++) s->amp_name[n++] = *c;
          s->amp_name[n] = 0;
        }
      } else if (want == SLOT_CAB) {
        ok = ir && irlen > 0 ? cab_build_ir(b, ir, irlen, a) : cab_build(b, g, a, sr, sp->bass);
        if (ok) s->cab = bi;
      } else {
        ok = fx_build(b, g, a, sr, stereo);
      }
      if (!ok) {
        s->nb--;
        sh_memset(b, 0, sizeof(*b));
        continue;
      }
      if (stereo && s->stereo_from == MAX_BLOCKS) s->stereo_from = bi;
    }
    if (want == SLOT_POST && !has_cab && has_amp && !(s->nam && s->nam_full)) { /* every amp needs a speaker */
      sh_gear cg;
      sh_memset(&cg, 0, sizeof cg);
      const char *ck = sp->bass ? DEFAULT_CAB_BASS : DEFAULT_CAB_GTR;
      int n = 0;
      while (ck[n] && n < 63) cg.key[n] = ck[n], n++;
      int bi = add_block(s);
      if (bi >= 0) {
        int ok = ir && irlen > 0 ? cab_build_ir(&s->b[bi], ir, irlen, a) : cab_build(&s->b[bi], &cg, a, sr, sp->bass);
        if (ok) s->cab = bi;
        else s->nb--;
      }
    }
  }
  {
    float thr = sp->gate_db ? sp->gate_db : (float)sh_clamp(-80 + 0.55 * amp_db, -80, -54);
    if (has_gate) thr = -200;
    if (!gate_build_default(&s->b[gate_i], a, sr, thr, e->gate_live)) return 0;
  }
  for (int i = 0; i < s->nb; i++) s->b[i].fxscale = e->p[SHP_FX] * 2;
  return !a->failed && s->nb > 0;
}

/* a strummed chord (or bass notes) for loudness matching */
static void test_signal(float *x, int n, double sr, int bass, sh_arena *a) {
  static const float GTR[6] = {82.41f, 123.47f, 164.81f, 207.65f, 246.94f, 329.63f};
  static const float BAS[2] = {41.2f, 55.0f};
  const float *f = bass ? BAS : GTR;
  int ns = bass ? 2 : 6;
  sh_memset(x, 0, sizeof(float) * n);
  uint32_t seed = 12345;
  for (int s = 0; s < ns; s++) {
    int len = (int)(sr / f[s]);
    float *buf = (float *)ar_alloc(a, sizeof(float) * (len + 1));
    if (!buf) return;
    for (int i = 0; i < len; i++) buf[i] = sh_randf(&seed) * 0.5f;
    int start = bass ? s * (int)(sr * 0.2) : s * (int)(sr * 0.012);
    int p = 0;
    float last = 0;
    for (int i = start; i < n; i++) {
      float v = buf[p];
      int q = p + 1 == len ? 0 : p + 1;
      float nv = 0.4985f * (v + buf[q]);
      buf[p] = nv;
      p = q;
      /* pickup-ish: a little low-pass */
      last += 0.5f * (v - last);
      x[i] += last * (bass ? 0.55f : 0.22f);
    }
  }
}

static void run_chain(slot_t *s, float *L, float *R, int n) {
  for (int i = 0; i < s->nb; i++) {
    sh_block *b = &s->b[i];
    if (!b->process) continue;
    if (i == s->stereo_from) sh_memcpy(R, L, sizeof(float) * n);
    b->process(b, L, i >= s->stereo_from ? R : 0, n);
  }
  if (s->stereo_from >= s->nb) sh_memcpy(R, L, sizeof(float) * n);
  if (s->cls_db < -0.05f)
    for (int i = 0; i < n; i++) L[i] = bq_run(&s->cls[0], L[i]), R[i] = bq_run(&s->cls[1], R[i]);
}

/* How much stronger the lows (around 120 Hz, or 70 Hz for bass) come out
   than the mids (around 1 kHz), relative to what went in, in dB. */
static double low_vs_mid_db(slot_t *s, const float *x, int n, double sr, int bass, float *L, float *R) {
  bq_t il[2] = {{0}}, ol[2] = {{0}}, im[2] = {{0}}, om[2] = {{0}}; /* filters start from silence */
  for (int k = 0; k < 2; k++) {
    bq_set(&il[k], BQ_BP, sr, bass ? 70 : 120, 0.8, 0), bq_set(&ol[k], BQ_BP, sr, bass ? 70 : 120, 0.8, 0);
    bq_set(&im[k], BQ_BP, sr, 1000, 1.0, 0), bq_set(&om[k], BQ_BP, sr, 1000, 1.0, 0);
  }
  double eil = 1e-12, eol = 1e-12, eim = 1e-12, eom = 1e-12;
  int skip = (int)(sr * 0.08);
  for (int off = 0; off < n; off += 512) {
    int m = n - off < 512 ? n - off : 512;
    sh_memcpy(L, x + off, sizeof(float) * m);
    run_chain(s, L, R, m);
    for (int i = 0; i < m; i++) {
      float a = bq_run(&il[1], bq_run(&il[0], x[off + i])), b = bq_run(&ol[1], bq_run(&ol[0], L[i]));
      float c = bq_run(&im[1], bq_run(&im[0], x[off + i])), d = bq_run(&om[1], bq_run(&om[0], L[i]));
      if (off + i >= skip) eil += (double)a * a, eol += (double)b * b, eim += (double)c * c, eom += (double)d * d;
    }
  }
  return 10 * sh_log10((eol / eil) / (eom / eim));
}

int sh_engine_build(sh_engine *e, int si, const char *text) {
  if (!e || si < 0 || si >= SH_SLOTS) return 0;
  slot_t *s = &e->slot[si];
  if (si == e->active || si == e->prev) return 0; /* never rebuild what is playing */
  static sh_spec sp; /* large; builds are not concurrent */
  if (!sh_parse_spec(text, &sp)) return 0;
  sp.user_gain = e->p[SHP_GAIN], sp.user_bass = e->p[SHP_BASS], sp.user_mid = e->p[SHP_MID], sp.user_treble = e->p[SHP_TREBLE];
  s->valid = 0;
  /* 1) build, measure loudness of the dry tone */
  s->cls_db = 0;
  if (!build_into(e, s, &sp, e->ir[si], e->irlen[si])) return 0;
  int n = (int)(e->sr * 0.45);
  float *x = (float *)ar_alloc(&s->ar, sizeof(float) * n);
  float *L = (float *)ar_alloc(&s->ar, sizeof(float) * 512), *R = (float *)ar_alloc(&s->ar, sizeof(float) * 512);
  if (!x || !L || !R) return 0;
  test_signal(x, n, e->sr, sp.bass, &s->ar);
  for (int i = 0; i < s->nb; i++) s->b[i].fxscale = 0;
  /* 0) lows vs mids: if this tone booms (as some Rocksmith gear does here),
     add a low shelf that brings the lows back in line, at most 10 dB */
  {
    double meas = low_vs_mid_db(s, x, n, e->sr, sp.bass, L, R);
    double want = sp.bass ? 4.0 : -3.0;
    double corr = want - meas;
    if (corr > 0) corr = 0;
    if (corr < -10) corr = -10;
    if (!build_into(e, s, &sp, e->ir[si], e->irlen[si])) return 0;
    x = (float *)ar_alloc(&s->ar, sizeof(float) * n);
    L = (float *)ar_alloc(&s->ar, sizeof(float) * 512), R = (float *)ar_alloc(&s->ar, sizeof(float) * 512);
    if (!x || !L || !R) return 0;
    test_signal(x, n, e->sr, sp.bass, &s->ar);
    for (int i = 0; i < s->nb; i++) s->b[i].fxscale = 0;
    s->cls_db = (float)corr;
    for (int k = 0; k < 2; k++) bq_set(&s->cls[k], BQ_LSHELF, e->sr, sp.bass ? 150 : 250, 0.7, corr), bq_reset(&s->cls[k]);
  }
  double acc = 0;
  int cnt = 0, skip = (int)(e->sr * 0.08);
  for (int off = 0; off < n; off += 512) {
    int m = n - off < 512 ? n - off : 512;
    sh_memcpy(L, x + off, sizeof(float) * m);
    run_chain(s, L, R, m);
    for (int i = 0; i < m; i++)
      if (off + i >= skip) acc += (double)L[i] * L[i] + (double)R[i] * R[i], cnt += 2;
  }
  double rms = cnt ? sh_sqrt(acc / cnt) : 0;
  double target = sp.bass ? 0.19 : 0.16;
  float gain = (float)(rms > 1e-6 ? target / rms : 1);
  if (gain > 30) gain = 30;
  /* 2) build again for a clean state */
  if (!build_into(e, s, &sp, e->ir[si], e->irlen[si])) return 0;
  bq_reset(&s->cls[0]), bq_reset(&s->cls[1]);
  s->out_gain = gain;
  int tl = 0;
  while (text[tl] && tl < (int)sizeof(s->spec_text) - 1) s->spec_text[tl] = text[tl], tl++;
  s->spec_text[tl] = 0;
  s->valid = 1;
  return 1;
}

int sh_engine_set_ir(sh_engine *e, int si, const float *ir, int len) {
  if (!e || si < 0 || si >= SH_SLOTS) return 0;
  /* the IR lives in the slot's arena tail: store a copy in a fixed region */
  static float store[SH_SLOTS][8192];
  if (len > 8192) len = 8192;
  if (ir && len > 0) {
    sh_memcpy(store[si], ir, sizeof(float) * len);
    e->ir[si] = store[si], e->irlen[si] = len;
  } else {
    e->ir[si] = 0, e->irlen[si] = 0;
  }
  return 1;
}

static char g_nam_err[200];
const char *sh_engine_nam_error(void) { return g_nam_err; }

int sh_engine_set_nam(sh_engine *e, int si, const char *json, int len, int full_rig, float gain_ref, float trim_db) {
  g_nam_err[0] = 0;
  if (!e || si < 0 || si >= SH_SLOTS) return 0;
  slot_t *s = &e->slot[si];
  if (si == e->active || si == e->prev) { /* never change what is playing */
    const char *m = "that slot is playing";
    int i = 0;
    while (m[i]) g_nam_err[i] = m[i], i++;
    g_nam_err[i] = 0;
    return 0;
  }
  s->nam = 0, s->valid = 0;
  if (!json || len <= 0) return 1;
  s->nam = nam_load(json, len, s->nam_mem, NAM_BYTES, 0, g_nam_err, sizeof g_nam_err);
  s->nam_full = full_rig, s->nam_ref = gain_ref, s->nam_trim = trim_db, s->nam_squash = -1;
  return s->nam != 0;
}

void sh_engine_select(sh_engine *e, int si) {
  if (!e || si < 0 || si >= SH_SLOTS || !e->slot[si].valid || si == e->active) return;
  e->prev = e->active;
  e->active = si;
  e->xf = e->prev >= 0 ? e->xf_len : 0;
  if (!e->xf) e->prev = -1;
}

int sh_engine_selected(const sh_engine *e) { return e ? e->active : -1; }

const char *sh_engine_describe(sh_engine *e, int si) {
  if (!e || si < 0 || si >= SH_SLOTS || !e->slot[si].valid) return "";
  return e->slot[si].amp_name;
}

void sh_engine_param(sh_engine *e, int id, float v) {
  if (!e || id < 0 || id >= SHP_COUNT) return;
  e->p[id] = v;
  if (id == SHP_GATE) { /* 0 = auto, + = stronger (dB), -30 or lower = off */
    e->gate_live[2] = v <= -30 ? 1.f : 0.f;
    e->gate_live[1] = v <= -30 ? 0.f : (float)sh_clamp(v, -20, 20);
  }
  if (id == SHP_INPUT) e->in_g_t = (float)sh_db2lin((sh_clamp(v, 0, 1) - 0.5) * 24);
  if (id == SHP_VOLUME) {
    /* 0.7 is unity; above it the knob adds up to +12 dB so the guitar can sit
       well on top of a loud song (the limiter keeps it clean) */
    double c = sh_clamp(v, 0, 1);
    if (c <= 0.7) {
      double x = c / 0.7;
      e->vol_g_t = (float)(x * x);
    } else
      e->vol_g_t = (float)sh_db2lin((c - 0.7) / 0.3 * 12);
  }
  if (id == SHP_DROP) {
    int st = (int)(v + 0.5f);
    if (st < 0) st = 0;
    if (st > 12) st = 12;
    if (st) e->dr_ratio = (float)sh_exp(-st / 12.0 * 0.6931471805599453), e->dr_on = st;
    e->dr_mix_t = st ? 1.0f : 0.0f;
  }
  if (id == SHP_ROOM) e->rm_amt = (float)sh_clamp(v, 0, 1);
  if (id == SHP_FX)
    for (int s = 0; s < SH_SLOTS; s++)
      for (int i = 0; i < e->slot[s].nb; i++) e->slot[s].b[i].fxscale = v * 2;
  if (id == SHP_GAIN || id == SHP_BASS || id == SHP_MID || id == SHP_TREBLE)
    for (int s = 0; s < SH_SLOTS; s++)
      if (e->slot[s].valid && e->slot[s].amp >= 0) amp_user(&e->slot[s].b[e->slot[s].amp], e->p[SHP_GAIN], e->p[SHP_BASS], e->p[SHP_MID], e->p[SHP_TREBLE]);
}

static inline float limit(float x) {
  /* soft knee at -3 dBFS, ceiling just under 0 dBFS */
  const float k = 0.708f;
  float a = sh_fabsf(x);
  if (a <= k) return x;
  float y = k + (0.98f - k) * sh_tanhf((a - k) / (0.98f - k));
  return x < 0 ? -y : y;
}

/* ---------------------------------------------------------------- drop --
 * A low-latency polyphonic pitch drop: the input is read back slower through
 * a short delay line; when the delay grows too long the read head jumps
 * forward to the best-matching point (so the splice lands in phase) and the
 * two heads crossfade. Delay varies with splice alignment (roughly 4–44 ms).
 * Search spans a low E bass period; correlated heads use unity-sum fades. */
#define DR_MIN_MS 3.5
#define DR_SEARCH_MS 26.0
#define DR_SPAN_MS 6.0
#define DR_XF_MS 8.0

static inline float dr_read(const sh_engine *e, double pos) {
  int i = (int)pos;
  if (pos < i) --i; /* floor, including initial negative read positions */
  float f = (float)(pos - i);
  float a = e->dr_buf[i & (DR_LEN - 1)], b = e->dr_buf[(i + 1) & (DR_LEN - 1)];
  return a + (b - a) * f;
}

static void dr_splice(sh_engine *e, double now) {
  double k = e->sr / 1000.0;
  double r = e->dr_ratio;
  int xf = (int)(DR_XF_MS * k);
  double dmin = DR_MIN_MS * k + xf * r;
  int search = (int)(DR_SEARCH_MS * k);
  double cur = e->dr_rp[0];
  /* candidates: new head positions with delay in [dmin, dmin + search] */
  double best = -1e30, bestpos = now - dmin - search * 0.5;
  int cmp = xf < 64 ? 64 : xf;
  for (int d = 0; d <= search; d += 2) {
    double pos = now - dmin - d;
    double c = 0, en = 1e-9;
    for (int j = 0; j < cmp; j += 4) {
      float a = dr_read(e, cur + j * r), b = dr_read(e, pos + j * r);
      c += (double)a * b, en += (double)b * b;
    }
    double sc = c / sh_sqrt(en);
    if (sc > best) best = sc, bestpos = pos;
  }
  e->dr_rp[1] = cur;     /* the old head keeps going while it fades out */
  e->dr_rp[0] = bestpos; /* the new head fades in */
  e->dr_xf = xf;
}

static void drop_process(sh_engine *e, float *x, int n) {
  if (e->dr_mix <= 0 && e->dr_mix_t <= 0) {
    /* keep the buffer filled so turning it on is seamless */
    for (int i = 0; i < n; i++) e->dr_buf[e->dr_w++ & (DR_LEN - 1)] = x[i];
    e->dr_rp[0] = e->dr_w - DR_MIN_MS * e->sr / 1000.0 - 64;
    e->dr_xf = 0;
    return;
  }
  double k = e->sr / 1000.0;
  double r = e->dr_ratio;
  double dmax = DR_MIN_MS * k + DR_XF_MS * k + DR_SEARCH_MS * k + DR_SPAN_MS * k;
  int xf_len = (int)(DR_XF_MS * k);
  for (int i = 0; i < n; i++) {
    float dry = x[i];
    e->dr_buf[e->dr_w & (DR_LEN - 1)] = dry;
    double now = (double)e->dr_w;
    e->dr_w++;
    if (e->dr_xf <= 0 && now - e->dr_rp[0] > dmax) dr_splice(e, now);
    float y = dr_read(e, e->dr_rp[0]);
    if (e->dr_xf > 0) {
      float t = (float)e->dr_xf / xf_len; /* 1 → 0 */
      /* These are phase-aligned copies, not independent sources. Equal-power
       * gains sum to sqrt(2) at mid-fade and pulse the amp drive by +3 dB.
       * Smooth unity-sum weights preserve amplitude without sharp fade edges. */
      t = t * t * (3 - 2 * t);
      y = y * (1 - t) + dr_read(e, e->dr_rp[1]) * t;
      e->dr_rp[1] += r;
      e->dr_xf--;
    }
    e->dr_rp[0] += r;
    e->dr_mix += 0.003f * (e->dr_mix_t - e->dr_mix);
    if (e->dr_mix_t <= 0 && e->dr_mix < 1e-4f) e->dr_mix = 0;
    if (e->dr_mix_t >= 1 && e->dr_mix > 1 - 1e-4f) e->dr_mix = 1;
    x[i] = dry + (y - dry) * e->dr_mix;
  }
  if (e->dr_w > 0x40000000) { /* keep positions small */
    int sh = 0x20000000;
    e->dr_w -= sh, e->dr_rp[0] -= sh, e->dr_rp[1] -= sh;
  }
}

/* ---------------------------------------------------------------- room -- */
static void room_process(sh_engine *e, float *L, float *R, int n, int bass) {
  float amt = e->rm_amt * (bass ? 0.35f : 1.0f);
  float wet = amt * 0.32f;
  for (int i = 0; i < n; i++) {
    float m = 0.5f * (L[i] + R[i]);
    float s = op_lp(&e->rm_lp, m);
    s = s - op_lp(&e->rm_hp, s);
    e->rm_buf[e->rm_w & (RM_LEN - 1)] = s;
    float wl = 0, wr = 0;
    for (int t = 0; t < 6; t++) {
      wl += e->rm_buf[(e->rm_w - e->rm_tl[t]) & (RM_LEN - 1)] * e->rm_g[t];
      wr += e->rm_buf[(e->rm_w - e->rm_tr[t]) & (RM_LEN - 1)] * e->rm_g[t];
    }
    e->rm_w++;
    /* one short allpass per side for a little diffusion */
    for (int c = 0; c < 2; c++) {
      float *ap = e->rm_ap[c];
      int len = e->rm_api[c];
      int idx = (e->rm_w) % len;
      float in = c ? wr : wl;
      float d = ap[idx];
      float o = -0.6f * in + d;
      ap[idx] = in + 0.6f * o;
      if (c) wr = o; else wl = o;
    }
    L[i] += wl * wet;
    R[i] += wr * wet;
  }
}

/* The noise floor: a 400 ms stretch of steady, quiet input well below the playing is noise. */
static void floor_frame(sh_engine *e, float db) {
  e->nf_frame[e->nf_i] = db;
  e->nf_i = (e->nf_i + 1) % 40;
  if (e->nf_n < 40) e->nf_n++;
  if (db > e->nf_recent) e->nf_recent = db;
  else e->nf_recent -= 0.01f; /* 1 dB a second */
  if (e->nf_recent < -24) e->nf_recent = -24;
  if (e->nf_n < 40) return;
  float lo = 1e9f, hi = -1e9f, a = 0, b = 0;
  for (int k = 0; k < 40; k++) {
    float v = e->nf_frame[(e->nf_i + k) % 40]; /* oldest first */
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (k < 20) a += v; else b += v;
  }
  a /= 20, b /= 20;
  float level = 0.5f * (a + b);
  if (hi - lo > 4 || sh_fabsf(b - a) > 1.0f || level > e->nf_recent - 34 || level < -140) return;
  float *f = &e->gate_live[0];
  if (*f < -150) *f = level;
  else *f += (level < *f ? 0.3f : 0.03f) * (level - *f); /* down fast, up slowly */
}

void sh_engine_process(sh_engine *e, const float *in, float *outL, float *outR, int n) {
  if (n > SH_MAX_BLOCK) n = SH_MAX_BLOCK;
  for (int i = 0; i < n; i++) {
    e->in_g += 0.002f * (e->in_g_t - e->in_g);
    float x = op_hp(&e->dc, in[i]) * e->in_g;
    e->inb[i] = x;
    float ax = sh_fabsf(x);
    if (ax > e->nf_pk) e->nf_pk = ax;
    if (++e->nf_pos >= (int)(e->sr * 0.01)) {
      floor_frame(e, e->nf_pk > 1e-9f ? (float)sh_lin2db(e->nf_pk) : -180.f);
      e->nf_pk = 0, e->nf_pos = 0;
    }
    float a = sh_fabsf(in[i]);
    if (a > e->m_inpk) e->m_inpk = a;
    e->m_in2 += (double)in[i] * in[i];
  }
  drop_process(e, e->inb, n);
  if (e->p[SHP_BYPASS] > 0.5f || e->active < 0) {
    for (int i = 0; i < n; i++) outL[i] = outR[i] = e->p[SHP_BYPASS] > 0.5f ? e->inb[i] : 0;
  } else {
    slot_t *s = &e->slot[e->active];
    sh_memcpy(e->bufL, e->inb, sizeof(float) * n);
    run_chain(s, e->bufL, e->bufR, n);
    float g = s->out_gain;
    if (e->xf > 0 && e->prev >= 0) {
      slot_t *p = &e->slot[e->prev];
      sh_memcpy(e->pL, e->inb, sizeof(float) * n);
      run_chain(p, e->pL, e->pR, n);
      for (int i = 0; i < n; i++) {
        float t = e->xf > 0 ? (float)e->xf / e->xf_len : 0;
        if (e->xf > 0) e->xf--;
        float a = sh_sqrtf(1 - t), b = sh_sqrtf(t);
        outL[i] = e->bufL[i] * g * a + e->pL[i] * p->out_gain * b;
        outR[i] = e->bufR[i] * g * a + e->pR[i] * p->out_gain * b;
      }
      if (e->xf <= 0) e->prev = -1;
    } else {
      for (int i = 0; i < n; i++) outL[i] = e->bufL[i] * g, outR[i] = e->bufR[i] * g;
    }
  }
  if (e->active >= 0 && e->p[SHP_BYPASS] <= 0.5f && e->rm_amt > 0.001f) room_process(e, outL, outR, n, e->slot[e->active].bass);
  for (int i = 0; i < n; i++) {
    e->vol_g += 0.002f * (e->vol_g_t - e->vol_g);
    float l = limit(outL[i] * e->vol_g), r = limit(outR[i] * e->vol_g);
    outL[i] = l, outR[i] = r;
    float a = sh_fabsf(l) > sh_fabsf(r) ? sh_fabsf(l) : sh_fabsf(r);
    if (a > e->m_outpk) e->m_outpk = a;
    e->m_out2 += 0.5 * ((double)l * l + (double)r * r);
  }
  e->m_n += n;
  if (e->gate_live[3] > 0.5f) e->gate_open = 1; /* open at some point since the last read */
}

void sh_engine_meters(sh_engine *e, float out[5]) {
  double n = e->m_n ? e->m_n : 1;
  out[0] = (float)sh_sqrt(e->m_in2 / n);
  out[1] = e->m_inpk;
  out[2] = (float)sh_sqrt(e->m_out2 / n);
  out[3] = e->m_outpk;
  out[4] = e->gate_open;
  e->m_in2 = e->m_out2 = 0, e->m_inpk = e->m_outpk = 0, e->m_n = 0, e->gate_open = 0;
}
