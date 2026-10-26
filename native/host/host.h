/* Stagehand audio host: shared between the device backends and the protocol. */
#ifndef SH_HOST_H
#define SH_HOST_H

#include "plat.h"
#include "../dsp/sh_engine.h"

/* ------------------------------------------------------------ SPSC ring -- */
typedef struct {
  float *buf;
  uint32_t cap; /* power of two */
  _Atomic uint32_t w, r;
} ring_t;

int ring_init(ring_t *r, uint32_t cap_pow2);
static inline uint32_t ring_fill(ring_t *r) { return atomic_load_explicit(&r->w, memory_order_acquire) - atomic_load_explicit(&r->r, memory_order_acquire); }
static inline uint32_t ring_space(ring_t *r) { return r->cap - ring_fill(r); }
uint32_t ring_write(ring_t *r, const float *src, uint32_t n);
uint32_t ring_read(ring_t *r, float *dst, uint32_t n);
void ring_drop(ring_t *r, uint32_t n);
void ring_clear(ring_t *r); /* reader side */

/* ------------------------------------------------------- drift resampler -- */
/* Reads `ch` interleaved channels from a ring at a ratio that steers the
 * ring's fill level towards `target` frames. */
typedef struct {
  int ch;
  double frac, base_ratio, adj, integ, avg, in_rate, out_rate;
  float hist[4][2];
  int primed;
  double target, maxadj, tau;
  int underruns;
} drs_t;
/* tau: seconds of smoothing on the fill level; maxadj: largest speed change (0.002 = 0.2%) */
void drs_init(drs_t *d, int ch, double in_rate, double out_rate, double target_frames, double tau, double maxadj);
/* returns 0 if the ring ran dry (output filled with silence) */
int drs_pull(drs_t *d, ring_t *r, float *outL, float *outR, int frames);

/* ------------------------------------------------------- song slipper -- */
/* Keeps a ring's fill on target WITHOUT changing pitch: now and then it
 * skips or repeats a few ms where the waveform matches (WSOLA-style splice
 * with a crossfade). Then a fixed-ratio resampler converts the rate. */
#define SLIPN 32768
#define SLIP_HIST 8192
typedef struct {
  float b[SLIPN * 2];
  int64_t w, rp;
  double avg, target, in_rate, out_rate, ratio, frac;
  int primed, xf, xf_len, cool, since;
  int64_t xf_from, xf_to;
  int splices, underruns;
  float hist[4][2];
} slip_t;
void slip_init(slip_t *s, double in_rate, double out_rate, double target_frames);
int slip_pull(slip_t *s, ring_t *r, float *L, float *R, int frames);

/* ------------------------------------------------------- backend API -- */
typedef struct {
  char id[256];
  char name[256];
  int is_default, rocksmith, channels, rate;
} dev_info;

typedef struct {
  int exclusive;    /* 1: take the devices exclusively */
  int buffer;       /* 0 smallest, 1 small, 2 safe */
  char in_id[256];  /* "" = Rocksmith cable or default */
  char out_id[256]; /* "" = default */
  char fake_in[512];  /* fake backend: WAV to loop as input */
  char fake_out[512]; /* fake backend: WAV to write */
} io_config;

typedef struct {
  int rate, in_rate, in_period, out_period, in_ch, out_ch;
  double in_latency_ms, out_latency_ms;
  char in_name[256], out_name[256];
  char mode[32];
} io_status;

/* Implemented by io_wasapi.c / io_fake.c */
int io_list(dev_info *ins, int *nin, dev_info *outs, int *nout, int max);
int io_start(const io_config *cfg, io_status *st, char *err, int errlen, char *code, int codelen);
void io_stop(void);
const char *io_backend_name(void);

/* Called by backends from their audio threads */
void host_on_capture(const float *mono, int frames); /* at in_rate */
void host_on_render(float *L, float *R, int frames);  /* at rate */
void host_on_lost(const char *why);
void host_set_rates(int in_rate, int out_rate, int in_period, int out_period);

#endif
