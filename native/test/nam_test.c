/* nam_test <model.nam> <in.f32> <out.f32> [block] [small]: renders a file through sh_nam and times it */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "../dsp/sh_nam.h"

int main(int argc, char **argv) {
  if (argc < 4) return 2;
  int block = argc > 4 ? atoi(argv[4]) : 128, small = argc > 5 ? atoi(argv[5]) : 0;
  FILE *f = fopen(argv[1], "rb");
  if (!f) return 3;
  fseek(f, 0, SEEK_END);
  long len = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *txt = malloc(len);
  if (fread(txt, 1, len, f) != (size_t)len) return 4;
  fclose(f);
  size_t mb = 2u << 20;
  void *mem = calloc(1, mb);
  char err[200];
  struct timespec t0, t1;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  nam_model *m = nam_load(txt, (int)len, mem, mb, small, err, sizeof err);
  clock_gettime(CLOCK_MONOTONIC, &t1);
  if (!m) {
    fprintf(stderr, "load failed: %s\n", err);
    return 5;
  }
  double load_ms = (t1.tv_sec - t0.tv_sec) * 1e3 + (t1.tv_nsec - t0.tv_nsec) / 1e6;
  size_t ab = 16u << 20;
  sh_arena a = {calloc(1, ab), ab, 0, 0};
  nam_run *r = nam_run_new(m, &a);
  if (!r) {
    fprintf(stderr, "no run state\n");
    return 6;
  }
  nam_run_prewarm(r);
  f = fopen(argv[2], "rb");
  fseek(f, 0, SEEK_END);
  long n = ftell(f) / 4;
  fseek(f, 0, SEEK_SET);
  float *in = malloc(n * 4), *out = malloc(n * 4);
  if (fread(in, 4, n, f) != (size_t)n) return 7;
  fclose(f);
  clock_gettime(CLOCK_MONOTONIC, &t0);
  for (long o = 0; o < n; o += block) {
    int k = n - o < block ? (int)(n - o) : block;
    nam_run_process(r, in + o, out + o, k);
  }
  clock_gettime(CLOCK_MONOTONIC, &t1);
  double ms = (t1.tv_sec - t0.tv_sec) * 1e3 + (t1.tv_nsec - t0.tv_nsec) / 1e6;
  double sr = nam_model_rate(m);
  printf("%s: %s, %ld MACs/sample, prewarm %d, load %.1f ms, model %zu KB, state %zu KB, CPU %.1f%% of one core at %.0f Hz\n", argv[1], nam_model_kind(m), nam_model_macs(m), nam_model_prewarm(m), load_ms, (size_t)0, a.used / 1024, ms / 1e3 / (n / sr) * 100, sr);
  f = fopen(argv[3], "wb");
  fwrite(out, 4, n, f);
  fclose(f);
  return 0;
}
