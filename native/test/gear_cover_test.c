/*
 * 4.5.x: does every piece of gear (and every knob) actually change the sound?
 * Reads specs from stdin separated by lines "@@ <label>", renders the same test riff
 * through each and prints the RMS difference (dB) against the first spec ("@@ base").
 * Used by test/gear-coverage.test.js.  build: see native/build.sh (gear_cover_test)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "../dsp/sh_engine.h"

#define SR 48000
#define LEN (1024 * 94) /* a whole number of blocks (~2 s) */
static float in[LEN], base[LEN], cur[LEN], outR[LEN], baseR[LEN], curR[LEN];

static void riff(void) {
  unsigned s = 12345;
  double f[6] = {82.4, 110, 146.8, 196, 246.9, 329.6};
  for (int i = 0; i < LEN; i++) in[i] = 0;
  for (int n = 0; n < 6; n++) { /* six notes, then ~0.5 s of just hiss (gates need a gap) */
    int start = n * SR / 4;
    double hz = f[(n * 3) % 6] * (n & 4 ? 2 : 1);
    int P = (int)(SR / hz);
    float buf[2048];
    for (int k = 0; k < P; k++) s = s * 1664525u + 1013904223u, buf[k] = ((s >> 9) / 4194304.f - 1) * 0.3f;
    for (int i = 0; i < SR / 3 && start + i < LEN; i++) {
      int k = i % P, k2 = (i + 1) % P;
      float y = buf[k];
      buf[k] = 0.996f * 0.5f * (buf[k] + buf[k2]);
      in[start + i] += y;
    }
  }
  /* a little hiss (about -50 dB), so gates and noise-dependent controls have something to act on */
  for (int i = 0; i < LEN; i++) s = s * 1664525u + 1013904223u, in[i] += ((s >> 9) / 4194304.f - 1) * 0.003f;
}

static void *g_mem;
static size_t g_need;
static int render(sh_engine *e, int slot, const char *spec, float *out, float *outr) {
  /* a fresh engine for every render, so nothing (reverb tails, LFO phase) carries over */
  memset(g_mem, 0, g_need);
  e = sh_engine_init(g_mem, g_need, SR);
  if (!sh_engine_build(e, slot, spec)) return 0;
  sh_engine_select(e, slot);
  static float tmp[LEN];
  /* settle the crossfade, then render */
  for (int i = 0; i < SR / 4; i += 512) sh_engine_process(e, in, tmp, outR, 512);
  for (int i = 0; i < LEN; i += 1024) sh_engine_process(e, in + i, out + i, outr + i, 1024);
  return 1;
}

int main(void) {
  riff();
  size_t need = sh_engine_mem_needed();
  void *mem = calloc(1, need);
  g_mem = mem, g_need = need;
  sh_engine *e = sh_engine_init(mem, need, SR);
  static char buf[1 << 20];
  size_t len = fread(buf, 1, sizeof buf - 1, stdin);
  buf[len] = 0;
  char *p = buf;
  int have_base = 0, slot = 0;
  /* warm-up: the engine fills some tables on first use; render once so every measured render is alike */
  render(e, 0, "kind\tguitar\ngear\tamp\tAmp_TW22\n", cur, curR);
  while (p && *p) {
    if (strncmp(p, "@@ ", 3)) { p = strchr(p, '\n'); if (p) p++; continue; }
    char *eol = strchr(p, '\n');
    if (!eol) break;
    *eol = 0;
    char *label = p + 3;
    char *body = eol + 1;
    char *next = strstr(body, "\n@@ ");
    if (next) next[0] = 0;
    float *o = have_base ? cur : base;
    float *orr = have_base ? curR : baseR;
    slot = 0;
    int ok = render(e, slot, body, o, orr);
    if (getenv("GC_DEBUG")) { double r = 0; for (int i = 0; i < LEN; i++) r += o[i] * o[i]; fprintf(stderr, "%s slot %d rms %.6f body[%zu]\n", label, slot, sqrt(r / LEN), strlen(body)); }
    if (!have_base) { have_base = 1; printf("%s\t%d\t0\n", label, ok); }
    else {
      double d = 0, b = 0;
      for (int i = 0; i < LEN; i++) d += (cur[i] - base[i]) * (cur[i] - base[i]) + (curR[i] - baseR[i]) * (curR[i] - baseR[i]), b += base[i] * base[i] + baseR[i] * baseR[i] + 1e-12;
      printf("%s\t%d\t%.1f\n", label, ok, 10 * log10(d / b + 1e-12));
    }
    fflush(stdout);
    p = next ? next + 1 : NULL;
  }
  return 0;
}
