/*
 * Neural Amp Modeler (.nam) inference in plain C (no libc), for real amp
 * captures. Ported from NeuralAmpModelerCore (MIT, Steven Atkinson):
 * LSTM, WaveNet A1 (nano … standard, custom) and A2 (bottleneck, grouped
 * convs, gating/blending, FiLM, head 1x1, post-stack head, condition DSP),
 * slimmable WaveNets (run at full size) and SlimmableContainer (picks a
 * submodel). Checked sample by sample against the reference (native/test/nam_test.c).
 */
#ifndef SH_NAM_H
#define SH_NAM_H

#include "sh_dsp.h"

typedef struct nam_model nam_model;
typedef struct nam_run nam_run;

/* Parses .nam JSON into a compact model inside mem (weights are copied).
 * size_pref: 0 = largest submodel of a container, 1 = smallest.
 * Not real-time safe. Returns NULL and fills err on failure. */
nam_model *nam_load(const char *json, int len, void *mem, size_t bytes, int size_pref, char *err, int errlen);

double nam_model_rate(const nam_model *m);   /* the rate the capture was made at (48000 if unknown) */
float nam_model_loudness(const nam_model *m); /* dB, or 0 if unknown */
int nam_model_prewarm(const nam_model *m);    /* samples of silence that settle the state */
const char *nam_model_kind(const nam_model *m); /* "WaveNet", "LSTM", … */
long nam_model_macs(const nam_model *m);      /* multiply-adds per sample (rough CPU cost) */

/* A running instance (state lives in the arena). */
nam_run *nam_run_new(const nam_model *m, sh_arena *a);
void nam_run_process(nam_run *r, const float *in, float *out, int n); /* mono, any n */
void nam_run_prewarm(nam_run *r);

#endif
