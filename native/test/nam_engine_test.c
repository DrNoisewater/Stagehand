/* nam_engine_test <model.nam> <sr> [fullrig]: builds a Rocksmith-style tone with the capture in
   the amp slot, renders a strum, checks level, CPU and that the model and modelled amps both build. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <time.h>
#include "../dsp/sh_engine.h"

static const char *SPEC =
  "kind\tguitar\n"
  "gear\tpre\tPedal_TubeScreamer\nk\tGain\t30\t0\t100\nk\tTone\t50\t0\t100\nk\tLevel\t60\t0\t100\n"
  "gear\tamp\tAmp_CA100\nk\tGain\t65\t0\t100\nk\tBass\t50\t0\t100\nk\tMid\t40\t0\t100\nk\tTreble\t60\t0\t100\n"
  "gear\tcab\tCab_CA412_57_Cone\n";

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  double sr = atof(argv[2]);
  int full = argc > 3 ? atoi(argv[3]) : 0;
  FILE *f = fopen(argv[1], "rb");
  fseek(f, 0, SEEK_END);
  long len = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *txt = malloc(len);
  if (fread(txt, 1, len, f) != (size_t)len) return 3;
  fclose(f);
  size_t need = sh_engine_mem_needed();
  void *mem = calloc(1, need);
  sh_engine *e = sh_engine_init(mem, need, sr);
  double t0 = now();
  int ok0 = sh_engine_build(e, 0, SPEC);
  double t1 = now();
  int okn = sh_engine_set_nam(e, 1, txt, (int)len, full, 0.6f, 0);
  if (!okn) printf("set_nam failed: %s\n", sh_engine_nam_error());
  double t2 = now();
  int ok1 = sh_engine_build(e, 1, SPEC);
  double t3 = now();
  printf("sr %.0f: modelled build %s %.0f ms (%s) | capture load %.1f ms, build %s %.0f ms (%s)\n", sr, ok0 ? "ok" : "FAIL", (t1 - t0) * 1e3, sh_engine_describe(e, 0),
         (t2 - t1) * 1e3, ok1 ? "ok" : "FAIL", (t3 - t2) * 1e3, sh_engine_describe(e, 1));
  /* strum: decaying chord with a pickup-ish tilt, peaks ~ -6 dBFS */
  int n = (int)(sr * 4), B = 128;
  float *in = calloc(n, 4), *L = calloc(n, 4), *R = calloc(n, 4);
  double fr[6] = {82.41, 110, 146.83, 196, 246.94, 329.63};
  for (int i = 0; i < n; i++) {
    double t = fmod(i / sr, 1.0), v = 0;
    for (int s = 0; s < 6; s++) v += sin(2 * M_PI * fr[s] * (i / sr)) * exp(-t * 2.5) * 0.08;
    in[i] = (float)v;
  }
  for (int slot = 0; slot < 2; slot++) {
    sh_engine_select(e, slot);
    for (int o = 0; o < (int)(sr * 0.1); o += B) sh_engine_process(e, in, L, R, B); /* crossfade */
    double a = now();
    double acc = 0, pk = 0;
    for (int o = 0; o + B <= n; o += B) {
      sh_engine_process(e, in + o, L + o, R + o, B);
      for (int i = 0; i < B; i++) acc += L[o + i] * L[o + i], pk = fabs(L[o + i]) > pk ? fabs(L[o + i]) : pk;
    }
    double b = now();
    int bad = 0;
    for (int i = 0; i < n; i++) if (!isfinite(L[i])) bad++;
    printf("  slot %d (%s): out rms %.3f peak %.3f, CPU %.1f%% of a core, non-finite %d\n", slot, slot ? "capture" : "modelled", sqrt(acc / n), pk, (b - a) / (n / sr) * 100, bad);
    if (argc > 4) {
      char p[256];
      snprintf(p, sizeof p, "%s_%d.f32", argv[4], slot);
      FILE *o = fopen(p, "wb");
      fwrite(L, 4, n, o);
      fclose(o);
    }
  }
  return 0;
}
