/*
 * stagehand-audio: low-latency guitar rig and song player for Stagehand.
 *
 * Talks to Stagehand over stdin/stdout with framed messages:
 *   [u32 type][u32 length][payload]
 *   in:  1 = JSON command, 2 = song audio (f32 stereo interleaved)
 *   out: 1 = JSON event,   3 = guitar input (f32 mono, engine rate)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "host.h"

#define VERSION "1.1.0"

/* ---------------------------------------------------------------- rings -- */
int ring_init(ring_t *r, uint32_t cap) {
  r->buf = (float *)calloc(cap, sizeof(float));
  r->cap = cap;
  atomic_store(&r->w, 0);
  atomic_store(&r->r, 0);
  return r->buf != 0;
}
uint32_t ring_write(ring_t *r, const float *src, uint32_t n) {
  uint32_t w = atomic_load_explicit(&r->w, memory_order_relaxed);
  uint32_t rd = atomic_load_explicit(&r->r, memory_order_acquire);
  uint32_t space = r->cap - (w - rd);
  if (n > space) n = space;
  for (uint32_t i = 0; i < n; i++) r->buf[(w + i) & (r->cap - 1)] = src[i];
  atomic_store_explicit(&r->w, w + n, memory_order_release);
  return n;
}
uint32_t ring_read(ring_t *r, float *dst, uint32_t n) {
  uint32_t rd = atomic_load_explicit(&r->r, memory_order_relaxed);
  uint32_t w = atomic_load_explicit(&r->w, memory_order_acquire);
  uint32_t fill = w - rd;
  if (n > fill) n = fill;
  for (uint32_t i = 0; i < n; i++) dst[i] = r->buf[(rd + i) & (r->cap - 1)];
  atomic_store_explicit(&r->r, rd + n, memory_order_release);
  return n;
}
void ring_drop(ring_t *r, uint32_t n) {
  uint32_t rd = atomic_load_explicit(&r->r, memory_order_relaxed);
  uint32_t fill = atomic_load_explicit(&r->w, memory_order_acquire) - rd;
  if (n > fill) n = fill;
  atomic_store_explicit(&r->r, rd + n, memory_order_release);
}
void ring_clear(ring_t *r) { ring_drop(r, ring_fill(r)); }

/* ------------------------------------------------------- drift resampler -- */
void drs_init(drs_t *d, int ch, double in_rate, double out_rate, double target, double tau, double maxadj) {
  memset(d, 0, sizeof(*d));
  d->ch = ch;
  d->in_rate = in_rate, d->out_rate = out_rate;
  d->base_ratio = in_rate / out_rate;
  d->target = target < 8 ? 8 : target;
  d->tau = tau;
  d->maxadj = maxadj;
}

static inline float hermite(float xm1, float x0, float x1, float x2, float t) {
  float c1 = 0.5f * (x1 - xm1), c2 = xm1 - 2.5f * x0 + 2.f * x1 - 0.5f * x2, c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + x0;
}

int drs_pull(drs_t *d, ring_t *r, float *L, float *R, int frames) {
  int ch = d->ch;
  double fill = (double)ring_fill(r) / ch;
  if (!d->primed) {
    if (fill < d->target) {
      for (int i = 0; i < frames; i++) L[i] = 0, R ? R[i] = 0 : 0;
      return 0;
    }
    d->primed = 1;
    d->frac = 0;
    d->integ = 0;
    d->avg = fill;
    memset(d->hist, 0, sizeof d->hist);
  }
  /* recover from a long stall: drop back to the target */
  if (fill > d->target * 4 + frames + 256) {
    ring_drop(r, (uint32_t)(fill - d->target) * (uint32_t)ch);
    fill = d->target;
    d->avg = fill;
  }
  /* Steer the speed very gently so the fill level sits on the target:
   * a smoothed fill (tau seconds), proportional + slow integral, in seconds
   * of error. Clock drift between devices is ~0.01%, so corrections stay
   * far below anything you could hear as a pitch change. */
  double dt = frames / d->out_rate;
  if (d->avg == 0) d->avg = fill;
  d->avg += (fill - d->avg) * (dt / (d->tau + dt));
  double err = (d->avg - d->target) / d->in_rate; /* seconds */
  d->integ += err * dt * 0.02;
  if (d->integ > d->maxadj) d->integ = d->maxadj;
  if (d->integ < -d->maxadj) d->integ = -d->maxadj;
  double want = 0.15 * err + d->integ;
  if (want > d->maxadj) want = d->maxadj;
  if (want < -d->maxadj) want = -d->maxadj;
  d->adj = want;
  double step = d->base_ratio * (1 + d->adj);
  float fr[2];
  for (int i = 0; i < frames; i++) {
    while (d->frac >= 1.0) {
      d->frac -= 1.0;
      if (ring_read(r, fr, ch) < (uint32_t)ch) {
        d->primed = 0;
        d->underruns++;
        for (; i < frames; i++) L[i] = 0, R ? R[i] = 0 : 0;
        return 0;
      }
      for (int c = 0; c < ch; c++) {
        d->hist[0][c] = d->hist[1][c];
        d->hist[1][c] = d->hist[2][c];
        d->hist[2][c] = d->hist[3][c];
        d->hist[3][c] = fr[c];
      }
    }
    float t = (float)d->frac;
    L[i] = hermite(d->hist[0][0], d->hist[1][0], d->hist[2][0], d->hist[3][0], t);
    if (R) R[i] = ch > 1 ? hermite(d->hist[0][1], d->hist[1][1], d->hist[2][1], d->hist[3][1], t) : L[i];
    d->frac += step;
  }
  return 1;
}

/* ------------------------------------------------------- song slipper -- */
void slip_init(slip_t *s, double in_rate, double out_rate, double target) {
  memset(s, 0, sizeof(*s));
  s->in_rate = in_rate, s->out_rate = out_rate;
  s->ratio = in_rate / out_rate;
  s->target = target;
  s->xf_len = (int)(in_rate * 0.006);
}

static void slip_fetch(slip_t *s, ring_t *r) {
  /* keep SLIP_HIST frames of history behind rp */
  int64_t room = SLIPN - (s->w - (s->rp - SLIP_HIST));
  if (s->rp < SLIP_HIST) room = SLIPN - s->w;
  uint32_t have = ring_fill(r) / 2;
  if (room <= 0 || !have) return;
  if ((int64_t)have > room) have = (uint32_t)room;
  float tmp[2048];
  while (have) {
    uint32_t n = have > 1024 ? 1024 : have;
    n = ring_read(r, tmp, n * 2) / 2;
    if (!n) break;
    for (uint32_t i = 0; i < n; i++) {
      int64_t k = (s->w + i) & (SLIPN - 1);
      s->b[2 * k] = tmp[2 * i], s->b[2 * k + 1] = tmp[2 * i + 1];
    }
    s->w += n;
    have -= n;
  }
}

static inline float slip_at(const slip_t *s, int64_t i, int c) { return s->b[2 * (i & (SLIPN - 1)) + c]; }

/* best splice distance near d (positive = skip ahead, negative = go back) */
static int slip_search(const slip_t *s, int d) {
  int span = (int)(s->in_rate * 0.003), win = 256, best = d;
  double bestc = -1e30;
  for (int k = d - span; k <= d + span; k++) {
    if (d > 0 && k < 32) continue;
    if (d < 0 && k > -32) continue;
    double c = 0, ea = 0, eb = 0;
    for (int i = 0; i < win; i += 2) {
      float a = slip_at(s, s->rp + i, 0) + slip_at(s, s->rp + i, 1);
      float b = slip_at(s, s->rp + k + i, 0) + slip_at(s, s->rp + k + i, 1);
      c += a * b, ea += a * a, eb += b * b;
    }
    double n = c / sqrt(ea * eb + 1e-12);
    if (n > bestc) bestc = n, best = k;
  }
  return best;
}

/* one frame at the input rate */
static int slip_frame(slip_t *s, ring_t *r, float fr[2]) {
  if (s->w - s->rp < 1024) slip_fetch(s, r);
  if (s->w - s->rp < 1 + (s->xf ? s->xf_len : 0)) return 0;
  if (s->xf) {
    int i = s->xf_len - s->xf;
    float t = (i + 0.5f) / s->xf_len;
    float wa = 0.5f + 0.5f * cosf(3.14159265f * t), wb = 1 - wa;
    for (int c = 0; c < 2; c++) fr[c] = slip_at(s, s->xf_from + i, c) * wa + slip_at(s, s->xf_to + i, c) * wb;
    if (--s->xf == 0) s->rp = s->xf_to + s->xf_len;
    return 1;
  }
  fr[0] = slip_at(s, s->rp, 0), fr[1] = slip_at(s, s->rp, 1);
  s->rp++;
  return 1;
}

int slip_pull(slip_t *s, ring_t *r, float *L, float *R, int frames) {
  double fill = ring_fill(r) / 2.0 + (double)(s->w - s->rp);
  if (!s->primed) {
    if (fill < s->target) {
      slip_fetch(s, r);
      for (int i = 0; i < frames; i++) L[i] = R[i] = 0;
      return 0;
    }
    s->primed = 1, s->avg = fill, s->frac = 0, s->cool = (int)s->in_rate;
    memset(s->hist, 0, sizeof s->hist);
  }
  /* smoothed fill, then maybe start a splice */
  double dt = frames / s->out_rate;
  s->avg += (fill - s->avg) * (dt / (0.4 + dt));
  s->cool -= frames;
  if (!s->xf && s->cool <= 0) {
    double err = s->avg - s->target, lim = s->in_rate * 0.008;
    if (err > lim || err < -lim) {
      int d = (int)(err > 0 ? err : -err);
      int dmax = (int)(s->in_rate * 0.03), dmin = (int)(s->in_rate * 0.004);
      if (d > dmax) d = dmax;
      if (d < dmin) d = dmin;
      slip_fetch(s, r);
      int span = (int)(s->in_rate * 0.003);
      int ok = err > 0 ? (s->w - s->rp > d + span + s->xf_len + 256) : (s->rp - (s->w - SLIPN) > d + span + 256 && s->rp > d + span + 256);
      if (ok) {
        int k = slip_search(s, err > 0 ? d : -d);
        s->xf_from = s->rp, s->xf_to = s->rp + k, s->xf = s->xf_len;
        s->splices++;
        s->avg -= k;
        s->cool = (int)(s->in_rate * 0.25);
      }
    }
  }
  /* fixed-ratio resampling (pitch exact) */
  float fr[2];
  for (int i = 0; i < frames; i++) {
    if (s->ratio == 1.0) {
      if (!slip_frame(s, r, fr)) {
        s->primed = 0, s->underruns++;
        for (; i < frames; i++) L[i] = R[i] = 0;
        return 0;
      }
      L[i] = fr[0], R[i] = fr[1];
      continue;
    }
    while (s->frac >= 1.0) {
      s->frac -= 1.0;
      if (!slip_frame(s, r, fr)) {
        s->primed = 0, s->underruns++;
        for (; i < frames; i++) L[i] = R[i] = 0;
        return 0;
      }
      for (int c = 0; c < 2; c++) s->hist[0][c] = s->hist[1][c], s->hist[1][c] = s->hist[2][c], s->hist[2][c] = s->hist[3][c], s->hist[3][c] = fr[c];
    }
    float t = (float)s->frac;
    L[i] = hermite(s->hist[0][0], s->hist[1][0], s->hist[2][0], s->hist[3][0], t);
    R[i] = hermite(s->hist[0][1], s->hist[1][1], s->hist[2][1], s->hist[3][1], t);
    s->frac += s->ratio;
  }
  return 1;
}

/* ----------------------------------------------------------- host state -- */
enum { Q_SELECT = 1, Q_PARAM, Q_SONGCFG, Q_SONGON, Q_RESET_IN };
typedef struct {
  int type, i;
  float v;
} qcmd;
#define QN 512
static qcmd Q[QN];
static _Atomic uint32_t qw, qr;
static void q_push(int type, int i, float v) {
  uint32_t w = atomic_load(&qw);
  if (w - atomic_load(&qr) >= QN) return;
  Q[w % QN] = (qcmd){type, i, v};
  atomic_store(&qw, w + 1);
}

#define SLOTS SH_SLOTS
static struct {
  sh_engine *eng;
  void *mem;
  size_t memsz;
  int rate, in_rate, in_period, out_period;
  ring_t in_ring, song_ring, tap_ring, processed_ring, mix_ring;
  _Atomic int monitor;
  drs_t in_drs;
  slip_t song_slip;
  int song_rate, song_on;
  float song_gain;
  char *spec[SLOTS];
  float *ir[SLOTS];
  int irlen[SLOTS];
  char *nam[SLOTS]; /* real amp capture text per slot */
  int namlen[SLOTS], namfull[SLOTS];
  float namref[SLOTS], namtrim[SLOTS];
  int active;
  _Atomic int running;
  io_status st;
  plat_mutex out_lock;
  float inbuf[SH_MAX_BLOCK], gl[SH_MAX_BLOCK], gr[SH_MAX_BLOCK], sl[SH_MAX_BLOCK], sr_[SH_MAX_BLOCK];
  float params[SHP_COUNT];
  int params_set[SHP_COUNT];
  _Atomic int xruns;
  double song_target, in_target;
  _Atomic int quit;
  _Atomic int lost;
} H;

/* ------------------------------------------------------------- output -- */
static void send_frame(uint32_t type, const void *data, uint32_t len) {
  uint32_t hdr[2] = {type, len};
  plat_lock(&H.out_lock);
  plat_write_out(hdr, 8);
  if (len) plat_write_out(data, len);
  plat_unlock(&H.out_lock);
}
static void send_json(const char *s) { send_frame(1, s, (uint32_t)strlen(s)); }

static void json_str(char *out, size_t cap, const char *s) {
  size_t n = 0;
  if (n < cap - 1) out[n++] = '"';
  for (; *s && n < cap - 8; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') out[n++] = '\\', out[n++] = (char)c;
    else if (c < 0x20) n += (size_t)snprintf(out + n, cap - n, "\\u%04x", c);
    else out[n++] = (char)c;
  }
  out[n++] = '"';
  out[n] = 0;
}

static void send_error(const char *code, const char *msg, const char *ctx) {
  char m[600], c[64], buf[900];
  json_str(m, sizeof m, msg);
  json_str(c, sizeof c, code);
  snprintf(buf, sizeof buf, "{\"ev\":\"error\",\"code\":%s,\"message\":%s,\"during\":\"%s\"}", c, m, ctx);
  send_json(buf);
}

/* --------------------------------------------------------- tiny JSON -- */
static const char *jfind(const char *j, const char *key) {
  char pat[80];
  snprintf(pat, sizeof pat, "\"%s\"", key);
  const char *p = strstr(j, pat);
  if (!p) return 0;
  p += strlen(pat);
  while (*p == ' ' || *p == ':') p++;
  return p;
}
static double jnum(const char *j, const char *key, double def) {
  const char *p = jfind(j, key);
  if (!p) return def;
  if (*p == 't') return 1;
  if (*p == 'f' || *p == 'n') return 0;
  return strtod(p, 0);
}
/* returns malloc'd, unescaped string or NULL */
static char *jstr(const char *j, const char *key) {
  const char *p = jfind(j, key);
  if (!p || *p != '"') return 0;
  p++;
  size_t cap = strlen(p) + 1;
  char *o = (char *)malloc(cap), *q = o;
  while (*p && *p != '"') {
    if (*p == '\\' && p[1]) {
      p++;
      switch (*p) {
        case 'n': *q++ = '\n'; break;
        case 't': *q++ = '\t'; break;
        case 'r': *q++ = '\r'; break;
        case 'b': *q++ = '\b'; break;
        case 'f': *q++ = '\f'; break;
        case 'u': {
          unsigned v = 0;
          for (int k = 1; k <= 4 && p[k]; k++) {
            char c = p[k];
            v = v * 16 + (c >= '0' && c <= '9' ? c - '0' : (c | 32) - 'a' + 10);
          }
          p += 4;
          if (v < 0x80) *q++ = (char)v;
          else if (v < 0x800) *q++ = (char)(0xC0 | (v >> 6)), *q++ = (char)(0x80 | (v & 63));
          else *q++ = (char)(0xE0 | (v >> 12)), *q++ = (char)(0x80 | ((v >> 6) & 63)), *q++ = (char)(0x80 | (v & 63));
          break;
        }
        default: *q++ = *p;
      }
      p++;
    } else *q++ = *p++;
  }
  *q = 0;
  return o;
}

/* ------------------------------------------------------- audio thread -- */
void host_set_rates(int in_rate, int out_rate, int in_period, int out_period) {
  H.in_rate = in_rate, H.rate = out_rate, H.in_period = in_period, H.out_period = out_period;
}

void host_on_capture(const float *mono, int frames) {
  if (!atomic_load(&H.running)) return;
  ring_write(&H.in_ring, mono, (uint32_t)frames);
}

static void drain_queue(void) {
  while (atomic_load(&qr) != atomic_load(&qw)) {
    qcmd c = Q[atomic_load(&qr) % QN];
    atomic_fetch_add(&qr, 1);
    switch (c.type) {
      case Q_SELECT: sh_engine_select(H.eng, c.i); break;
      case Q_PARAM: sh_engine_param(H.eng, c.i, c.v); break;
      case Q_SONGCFG:
        slip_init(&H.song_slip, c.v, H.rate, H.song_target * c.v / H.rate);
        ring_clear(&H.song_ring);
        break;
      case Q_SONGON: H.song_on = c.i; break;
    }
  }
}

/* Guitar + song: clean below -3 dBFS, then a smooth knee instead of a hard clip. */
static inline float soft_clip(float x) {
  const float k = 0.708f;
  float a = x < 0 ? -x : x;
  if (a <= k) return x;
  float u = (a - k) / (0.99f - k);
  float y = k + (0.99f - k) * (u / (1.0f + u));
  return x < 0 ? -y : y;
}

void host_on_render(float *L, float *R, int frames) {
  if (!atomic_load(&H.running) || !H.eng) {
    for (int i = 0; i < frames; i++) L[i] = R[i] = 0;
    return;
  }
  drain_queue();
  int done = 0;
  while (done < frames) {
    int n = frames - done;
    if (n > SH_MAX_BLOCK) n = SH_MAX_BLOCK;
    int ok = drs_pull(&H.in_drs, &H.in_ring, H.inbuf, 0, n);
    if (!ok && H.in_drs.underruns) atomic_store(&H.xruns, H.in_drs.underruns);
    ring_write(&H.tap_ring, H.inbuf, (uint32_t)n);
    sh_engine_process(H.eng, H.inbuf, H.gl, H.gr, n);
    if (H.song_on && H.song_rate) {
      slip_pull(&H.song_slip, &H.song_ring, H.sl, H.sr_, n);
      for (int i = 0; i < n; i++) {
        L[done + i] = soft_clip(H.gl[i] + H.sl[i]);
        R[done + i] = soft_clip(H.gr[i] + H.sr_[i]);
      }
    } else {
      memcpy(L + done, H.gl, sizeof(float) * n);
      memcpy(R + done, H.gr, sizeof(float) * n);
    }
    if (atomic_load(&H.monitor)) {
      float stereo[SH_MAX_BLOCK*2];
      for(int i=0;i<n;i++){stereo[i*2]=H.gl[i];stereo[i*2+1]=H.gr[i];}
      ring_write(&H.processed_ring,stereo,n*2);
      for(int i=0;i<n;i++){stereo[i*2]=L[done+i];stereo[i*2+1]=R[done+i];}
      ring_write(&H.mix_ring,stereo,n*2);
    }
    done += n;
  }
}

void host_on_lost(const char *why) {
  if (atomic_exchange(&H.lost, 1)) return;
  char m[400], b[600];
  json_str(m, sizeof m, why);
  snprintf(b, sizeof b, "{\"ev\":\"lost\",\"message\":%s}", m);
  send_json(b);
}

/* ------------------------------------------------------------ engine -- */
static int engine_ensure(int rate) {
  if (H.eng && H.rate == rate && H.mem) return 1;
  if (!H.mem) {
    H.memsz = sh_engine_mem_needed();
    H.mem = malloc(H.memsz);
    if (!H.mem) return 0;
  }
  H.eng = sh_engine_init(H.mem, H.memsz, rate);
  if (!H.eng) return 0;
  for (int i = 0; i < SHP_COUNT; i++)
    if (H.params_set[i]) sh_engine_param(H.eng, i, H.params[i]);
  for (int s = 0; s < SLOTS; s++) {
    if (H.ir[s]) sh_engine_set_ir(H.eng, s, H.ir[s], H.irlen[s]);
    if (H.nam[s]) sh_engine_set_nam(H.eng, s, H.nam[s], H.namlen[s], H.namfull[s], H.namref[s], H.namtrim[s]);
    if (H.spec[s]) sh_engine_build(H.eng, s, H.spec[s]);
  }
  if (H.active >= 0) sh_engine_select(H.eng, H.active);
  return 1;
}

static void send_started(void) {
  io_status *s = &H.st;
  double rate = H.rate;
  double guitar = (H.in_period * (double)H.rate / (H.in_rate ? H.in_rate : H.rate) + H.in_target + H.out_period) / rate * 1000 + s->in_latency_ms + s->out_latency_ms;
  double song = (H.song_target + H.out_period) / rate * 1000 + s->out_latency_ms;
  char in[600], out[600], b[2000];
  json_str(in, sizeof in, s->in_name);
  json_str(out, sizeof out, s->out_name);
  snprintf(b, sizeof b,
           "{\"ev\":\"started\",\"rate\":%d,\"inRate\":%d,\"inPeriod\":%d,\"outPeriod\":%d,\"latencyMs\":%.2f,\"songLatencyMs\":%.2f,\"inName\":%s,\"outName\":%s,\"mode\":\"%s\",\"backend\":\"%s\"}",
           H.rate, H.in_rate, H.in_period, H.out_period, guitar, song, in, out, s->mode, io_backend_name());
  send_json(b);
}

/* ------------------------------------------------------------ commands -- */
static void read_cfg_str(const char *j, const char *key, char *out, size_t cap) {
  char *s = jstr(j, key);
  out[0] = 0;
  if (s) {
    strncpy(out, s, cap - 1);
    out[cap - 1] = 0;
    free(s);
  }
}

static int load_wav_ir(const char *path, int rate, float **out, int *len, char *err, int errlen);

static void cmd_devices(void) {
  static dev_info ins[64], outs[64];
  int ni = 0, no = 0;
  io_list(ins, &ni, outs, &no, 64);
  size_t cap = 64 * 1024, n = 0;
  char *b = (char *)malloc(cap);
  n += (size_t)snprintf(b + n, cap - n, "{\"ev\":\"devices\",\"backend\":\"%s\",\"inputs\":[", io_backend_name());
  for (int k = 0; k < 2; k++) {
    dev_info *d = k ? outs : ins;
    int c = k ? no : ni;
    if (k) n += (size_t)snprintf(b + n, cap - n, "],\"outputs\":[");
    for (int i = 0; i < c && n < cap - 1200; i++) {
      char id[600], nm[600];
      json_str(id, sizeof id, d[i].id);
      json_str(nm, sizeof nm, d[i].name);
      n += (size_t)snprintf(b + n, cap - n, "%s{\"id\":%s,\"name\":%s,\"default\":%s,\"rocksmith\":%s,\"rate\":%d,\"channels\":%d}", i ? "," : "", id, nm,
                            d[i].is_default ? "true" : "false", d[i].rocksmith ? "true" : "false", d[i].rate, d[i].channels);
    }
  }
  snprintf(b + n, cap - n, "]}");
  send_json(b);
  free(b);
}

static void cmd_start(const char *j) {
  if (atomic_load(&H.running)) io_stop(), atomic_store(&H.running, 0);
  io_config cfg;
  memset(&cfg, 0, sizeof cfg);
  cfg.exclusive = (int)jnum(j, "exclusive", 1);
  cfg.buffer = (int)jnum(j, "buffer", 1);
  read_cfg_str(j, "input", cfg.in_id, sizeof cfg.in_id);
  read_cfg_str(j, "output", cfg.out_id, sizeof cfg.out_id);
  read_cfg_str(j, "fakeIn", cfg.fake_in, sizeof cfg.fake_in);
  read_cfg_str(j, "fakeOut", cfg.fake_out, sizeof cfg.fake_out);
  char err[512] = {0}, code[64] = {0};
  memset(&H.st, 0, sizeof H.st);
  atomic_store(&H.lost, 0);
  /* rings are emptied by the reader side; recreate them while stopped */
  ring_clear(&H.in_ring);
  ring_clear(&H.tap_ring);
  ring_clear(&H.song_ring);
  if (!io_start(&cfg, &H.st, err, sizeof err, code, sizeof code)) {
    send_error(code[0] ? code : "start", err[0] ? err : "Couldn't open the audio devices.", "start");
    return;
  }
  if (!engine_ensure(H.rate)) {
    io_stop();
    send_error("memory", "Not enough memory for the sound engine.", "start");
    return;
  }
  double ip = H.in_period * (double)H.rate / (H.in_rate ? H.in_rate : H.rate);
  H.in_target = ip + (cfg.buffer == 0 ? 0.15 : cfg.buffer == 1 ? 0.4 : 1.0) * H.out_period + 24;
  H.song_target = H.rate * 0.06 + H.out_period;
  drs_init(&H.in_drs, 1, H.in_rate, H.rate, H.in_target, 0.5, 0.001);
  {
    double sr = H.song_rate ? H.song_rate : H.rate;
    slip_init(&H.song_slip, sr, H.rate, H.song_target * sr / H.rate);
  }
  atomic_store(&H.xruns, 0);
  atomic_store(&H.running, 1);
  send_started();
}

static void cmd_build(const char *j) {
  int slot = (int)jnum(j, "slot", -1);
  char *spec = jstr(j, "spec");
  char b[300];
  if (slot < 0 || slot >= SLOTS || !spec) {
    free(spec);
    return;
  }
  free(H.spec[slot]);
  H.spec[slot] = spec;
  int ok = 1;
  const char *amp = "";
  if (H.eng) {
    ok = sh_engine_build(H.eng, slot, spec);
    amp = sh_engine_describe(H.eng, slot);
  }
  char a[120];
  json_str(a, sizeof a, amp);
  snprintf(b, sizeof b, "{\"ev\":\"built\",\"slot\":%d,\"ok\":%s,\"amp\":%s}", slot, ok ? "true" : "false", a);
  send_json(b);
}

static void cmd_ir(const char *j) {
  int slot = (int)jnum(j, "slot", -1);
  char *path = jstr(j, "path");
  if (slot < 0 || slot >= SLOTS) {
    free(path);
    return;
  }
  free(H.ir[slot]);
  H.ir[slot] = 0, H.irlen[slot] = 0;
  char err[300] = {0};
  if (path && path[0]) {
    if (!load_wav_ir(path, H.rate ? H.rate : 48000, &H.ir[slot], &H.irlen[slot], err, sizeof err)) send_error("ir", err, "ir");
  }
  free(path);
  if (H.eng) {
    sh_engine_set_ir(H.eng, slot, H.ir[slot], H.irlen[slot]);
    if (H.spec[slot]) sh_engine_build(H.eng, slot, H.spec[slot]);
  }
}

static char *read_text_file(const char *path, long *len) {
  FILE *f = 0;
#ifdef _WIN32
  wchar_t wp[1024];
  MultiByteToWideChar(CP_UTF8, 0, path, -1, wp, 1024);
  f = _wfopen(wp, L"rb");
#else
  f = fopen(path, "rb");
#endif
  if (!f) return 0;
  fseek(f, 0, SEEK_END);
  long sz = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (sz <= 0 || sz > 32L * 1024 * 1024) {
    fclose(f);
    return 0;
  }
  char *d = (char *)malloc((size_t)sz + 1);
  if (d && fread(d, 1, (size_t)sz, f) != (size_t)sz) free(d), d = 0;
  fclose(f);
  if (d) d[sz] = 0, *len = sz;
  return d;
}

/* {"cmd":"nam","slot":n,"path":"…/x.nam"|"","fullRig":0|1,"gainRef":0..1,"trim":dB} */
static void cmd_nam(const char *j) {
  int slot = (int)jnum(j, "slot", -1);
  char *path = jstr(j, "path");
  if (slot < 0 || slot >= SLOTS) {
    free(path);
    return;
  }
  free(H.nam[slot]);
  H.nam[slot] = 0, H.namlen[slot] = 0;
  H.namfull[slot] = (int)jnum(j, "fullRig", 0) != 0;
  H.namref[slot] = (float)jnum(j, "gainRef", 0.5);
  H.namtrim[slot] = (float)jnum(j, "trim", 0);
  char err[300] = {0};
  int ok = 1;
  if (path && path[0]) {
    long len = 0;
    H.nam[slot] = read_text_file(path, &len);
    H.namlen[slot] = (int)len;
    if (!H.nam[slot]) ok = 0, snprintf(err, sizeof err, "Couldn't open the amp capture file.");
  }
  free(path);
  if (H.eng) {
    if (!sh_engine_set_nam(H.eng, slot, H.nam[slot], H.namlen[slot], H.namfull[slot], H.namref[slot], H.namtrim[slot]) && ok) {
      ok = 0;
      snprintf(err, sizeof err, "%s", sh_engine_nam_error());
    }
    if (!ok && H.nam[slot]) { /* unusable: forget it so the tone falls back to the modelled amp */
      free(H.nam[slot]);
      H.nam[slot] = 0, H.namlen[slot] = 0;
      sh_engine_set_nam(H.eng, slot, 0, 0, 0, 0.5f, 0);
    }
    /* the page builds the slot next (with its new tone) */
  }
  char e2[400], b[600];
  json_str(e2, sizeof e2, err);
  snprintf(b, sizeof b, "{\"ev\":\"nam\",\"slot\":%d,\"ok\":%s,\"error\":%s}", slot, ok ? "true" : "false", e2);
  send_json(b);
}

static void handle_json(const char *j) {
  char *cmd = jstr(j, "cmd");
  if (!cmd) return;
  if (!strcmp(cmd, "hello")) {
    char b[200];
    snprintf(b, sizeof b, "{\"ev\":\"hello\",\"version\":\"%s\",\"backend\":\"%s\"}", VERSION, io_backend_name());
    send_json(b);
  } else if (!strcmp(cmd, "devices")) cmd_devices();
  else if (!strcmp(cmd, "start")) cmd_start(j);
  else if (!strcmp(cmd, "stop")) {
    if (atomic_load(&H.running)) io_stop();
    atomic_store(&H.running, 0);
    send_json("{\"ev\":\"stopped\"}");
  } else if (!strcmp(cmd, "build")) cmd_build(j);
  else if (!strcmp(cmd, "select")) {
    H.active = (int)jnum(j, "slot", 0);
    if (atomic_load(&H.running)) q_push(Q_SELECT, H.active, 0);
    else if (H.eng) sh_engine_select(H.eng, H.active);
  } else if (!strcmp(cmd, "param")) {
    int id = (int)jnum(j, "id", -1);
    float v = (float)jnum(j, "v", 0);
    if (id >= 0 && id < SHP_COUNT) {
      H.params[id] = v, H.params_set[id] = 1;
      if (atomic_load(&H.running)) q_push(Q_PARAM, id, v);
      else if (H.eng) sh_engine_param(H.eng, id, v);
    }
  } else if (!strcmp(cmd, "song")) {
    int rate = (int)jnum(j, "rate", 0);
    int on = (int)jnum(j, "on", 1);
    if (rate && rate != H.song_rate) {
      H.song_rate = rate;
      q_push(Q_SONGCFG, 0, (float)rate);
    }
    q_push(Q_SONGON, on, 0);
  } else if (!strcmp(cmd, "ir")) cmd_ir(j);
  else if (!strcmp(cmd, "nam")) cmd_nam(j);
  else if (!strcmp(cmd, "monitor")) atomic_store(&H.monitor,(int)jnum(j,"on",0));
  else if (!strcmp(cmd, "quit")) atomic_store(&H.quit, 1);
  free(cmd);
}

/* ---------------------------------------------------------------- pump -- */
static PLAT_THREAD_FN(pump_thread) {
  (void)arg;
  static float buf[4096];
  double next_meter = plat_now();
  while (!atomic_load(&H.quit)) {
    plat_sleep_ms(5);
    if (!atomic_load(&H.running)) continue;
    uint32_t n;
    while ((n = ring_fill(&H.tap_ring)) >= 256) {
      if (n > 4096) n = 4096;
      ring_read(&H.tap_ring, buf, n);
      send_frame(3, buf, n * sizeof(float));
    }
    while((n=ring_fill(&H.processed_ring))>=512){if(n>4096)n=4096;ring_read(&H.processed_ring,buf,n);send_frame(4,buf,n*sizeof(float));}
    while((n=ring_fill(&H.mix_ring))>=512){if(n>4096)n=4096;ring_read(&H.mix_ring,buf,n);send_frame(5,buf,n*sizeof(float));}
    double now = plat_now();
    if (now >= next_meter && H.eng) {
      next_meter = now + 0.05;
      float m[5];
      sh_engine_meters(H.eng, m);
      char b[300];
      snprintf(b, sizeof b, "{\"ev\":\"meters\",\"in\":%.5f,\"inPeak\":%.5f,\"out\":%.5f,\"outPeak\":%.5f,\"xruns\":%d,\"songFill\":%.1f,\"songUnderruns\":%d,\"splices\":%d}", m[0], m[1],
               m[2], m[3], atomic_load(&H.xruns), H.rate ? (ring_fill(&H.song_ring) / 2.0 + (double)(H.song_slip.w - H.song_slip.rp)) / H.rate * 1000 : 0, H.song_slip.underruns, H.song_slip.splices);
      send_json(b);
    }
  }
  PLAT_THREAD_RET;
}

/* ------------------------------------------------------------- WAV IR -- */
static int load_wav_ir(const char *path, int rate, float **out, int *len, char *err, int errlen) {
  FILE *f = 0;
#ifdef _WIN32
  wchar_t wp[1024];
  MultiByteToWideChar(CP_UTF8, 0, path, -1, wp, 1024);
  f = _wfopen(wp, L"rb");
#else
  f = fopen(path, "rb");
#endif
  if (!f) {
    snprintf(err, errlen, "Couldn't open the cabinet file.");
    return 0;
  }
  fseek(f, 0, SEEK_END);
  long sz = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (sz <= 44 || sz > 64 * 1024 * 1024) {
    fclose(f);
    snprintf(err, errlen, "That file isn't a usable WAV.");
    return 0;
  }
  unsigned char *d = (unsigned char *)malloc((size_t)sz);
  size_t got = fread(d, 1, (size_t)sz, f);
  fclose(f);
  if ((long)got != sz || memcmp(d, "RIFF", 4) || memcmp(d + 8, "WAVE", 4)) {
    free(d);
    snprintf(err, errlen, "That file isn't a WAV.");
    return 0;
  }
  int fmt = 0, ch = 0, wrate = 0, bits = 0;
  long p = 12;
  unsigned char *data = 0;
  long dlen = 0;
  while (p + 8 <= sz) {
    uint32_t csz = d[p + 4] | d[p + 5] << 8 | d[p + 6] << 16 | (uint32_t)d[p + 7] << 24;
    if (!memcmp(d + p, "fmt ", 4) && p + 24 <= sz) {
      fmt = d[p + 8] | d[p + 9] << 8;
      ch = d[p + 10] | d[p + 11] << 8;
      wrate = d[p + 12] | d[p + 13] << 8 | d[p + 14] << 16 | d[p + 15] << 24;
      bits = d[p + 22] | d[p + 23] << 8;
      if (fmt == 0xFFFE && p + 34 <= sz) fmt = d[p + 32] | d[p + 33] << 8;
    } else if (!memcmp(d + p, "data", 4)) {
      data = d + p + 8;
      dlen = (long)csz;
      if (p + 8 + dlen > sz) dlen = sz - p - 8;
      break;
    }
    p += 8 + csz + (csz & 1);
  }
  int bps = bits / 8;
  if (!data || !ch || !wrate || !bps || !(fmt == 1 || fmt == 3)) {
    free(d);
    snprintf(err, errlen, "That WAV format isn't supported.");
    return 0;
  }
  long frames = dlen / (bps * ch);
  if (frames > wrate) frames = wrate; /* 1 s is plenty */
  float *src = (float *)malloc(sizeof(float) * (size_t)frames);
  for (long i = 0; i < frames; i++) {
    unsigned char *s = data + i * bps * ch;
    float v = 0;
    if (fmt == 3 && bits == 32) memcpy(&v, s, 4);
    else if (bits == 16) v = (int16_t)(s[0] | s[1] << 8) / 32768.f;
    else if (bits == 24) v = (int32_t)((uint32_t)s[0] << 8 | (uint32_t)s[1] << 16 | (uint32_t)s[2] << 24) / 2147483648.f;
    else if (bits == 32) v = (int32_t)((uint32_t)s[0] | (uint32_t)s[1] << 8 | (uint32_t)s[2] << 16 | (uint32_t)s[3] << 24) / 2147483648.f;
    src[i] = v;
  }
  free(d);
  /* resample to the engine rate and trim to 8192 */
  double ratio = (double)wrate / rate;
  int n = (int)(frames / ratio);
  if (n > 8192) n = 8192;
  float *o = (float *)calloc((size_t)n, sizeof(float));
  for (int i = 0; i < n; i++) {
    double x = i * ratio;
    long k = (long)x;
    float t = (float)(x - k);
    float a = src[k], b = k + 1 < frames ? src[k + 1] : 0;
    o[i] = a + (b - a) * t;
  }
  free(src);
  /* normalise peak gain around 1 kHz-ish: scale so the sum of the first ms ~ unity energy */
  double e = 0;
  for (int i = 0; i < n; i++) e += (double)o[i] * o[i];
  double g = e > 0 ? 0.35 / sqrt(e) : 1;
  for (int i = 0; i < n; i++) o[i] = (float)(o[i] * g);
  *out = o, *len = n;
  return 1;
}

/* ---------------------------------------------------------------- main -- */
int main(int argc, char **argv) {
  (void)argc, (void)argv;
#ifdef _WIN32
  SetConsoleOutputCP(CP_UTF8);
#endif
  plat_mutex_init(&H.out_lock);
  ring_init(&H.in_ring, 1 << 15);
  ring_init(&H.tap_ring, 1 << 16);
  ring_init(&H.processed_ring,1<<18);
  ring_init(&H.mix_ring,1<<18);
  ring_init(&H.song_ring, 1 << 17);
  H.active = -1;
  plat_thread pump;
  plat_thread_start(&pump, pump_thread, 0);
  char b[200];
  snprintf(b, sizeof b, "{\"ev\":\"hello\",\"version\":\"%s\",\"backend\":\"%s\"}", VERSION, io_backend_name());
  send_json(b);
  /* reader loop */
  size_t cap = 1 << 20, have = 0;
  unsigned char *buf = (unsigned char *)malloc(cap + 1);
  while (!atomic_load(&H.quit)) {
    long r = plat_read_in(buf + have, cap - have);
    if (r <= 0) break; /* Stagehand went away */
    have += (size_t)r;
    size_t off = 0;
    while (have - off >= 8) {
      uint32_t type, len;
      memcpy(&type, buf + off, 4);
      memcpy(&len, buf + off + 4, 4);
      if (len > (64u << 20)) {
        have = off = 0;
        break;
      }
      if (8 + len > cap) {
        cap = 8 + len + 1024;
        unsigned char *nb = (unsigned char *)malloc(cap + 1);
        memcpy(nb, buf + off, have - off);
        free(buf);
        buf = nb;
        have -= off;
        off = 0;
      }
      if (have - off < 8 + len) break;
      unsigned char *payload = buf + off + 8;
      if (type == 1) {
        char save = (char)payload[len];
        payload[len] = 0;
        handle_json((const char *)payload);
        payload[len] = (unsigned char)save;
      } else if (type == 2 && atomic_load(&H.running)) {
        ring_write(&H.song_ring, (const float *)payload, len / 4);
      }
      off += 8 + len;
    }
    if (off) {
      memmove(buf, buf + off, have - off);
      have -= off;
    }
  }
  atomic_store(&H.quit, 1);
  if (atomic_load(&H.running)) io_stop();
  atomic_store(&H.running, 0);
  plat_thread_join(pump);
  return 0;
}
