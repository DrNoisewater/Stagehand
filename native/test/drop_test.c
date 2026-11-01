/* Drop check: chords through the pitch drop come out lower by the set amount, with steady level. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "../dsp/sh_engine.h"
static double est(const float *x, int n, int sr, double guess) {
  /* autocorrelation peak near the expected period */
  double P = sr / guess, best = -1e30; int bl = 0;
  for (int l = (int)(P * 0.9); l <= (int)(P * 1.1); l++) { double c = 0; for (int i = 0; i < n - l; i++) c += x[i] * x[i + l]; if (c > best) best = c, bl = l; }
  double a = 0, b = 0, c = 0; for (int i = 0; i < n - bl - 1; i++) { a += x[i] * x[i + bl - 1]; b += x[i] * x[i + bl]; c += x[i] * x[i + bl + 1]; }
  return sr / (bl + 0.5 * (a - c) / (a - 2 * b + c));
}
int main(void) {
  int sr = 48000;
  void *mem = malloc(sh_engine_mem_needed());
  sh_engine *e = sh_engine_init(mem, sh_engine_mem_needed(), sr);
  sh_engine_param(e, SHP_BYPASS, 1);
  sh_engine_param(e, SHP_ROOM, 0);
  int N = sr * 2;
  float *in = malloc(N * 4), *L = malloc(N * 4), *R = malloc(N * 4);
  int fail = 0;
  for (int st = 0; st <= 12; st += (st < 7 ? 1 : 5)) {
    double hz = 220;
    for (int i = 0; i < N; i++) in[i] = 0.3f * sinf(2 * M_PI * hz * i / sr) + 0.15f * sinf(2 * M_PI * hz * 1.5 * i / sr);
    sh_engine_param(e, SHP_DROP, st);
    for (int o = 0; o < N; o += 256) sh_engine_process(e, in + o, L + o, R + o, N-o < 256 ? N-o : 256);
    double f = st ? est(L + sr, sr / 2, sr, hz * pow(2, -st / 12.0)) : hz;
    double want = hz * pow(2, -st / 12.0);
    /* level steadiness in 10 ms windows */
    double mn = 1e9, mx = 0;
    for (int w = sr; w + 960 < N; w += 480) { double a = 0; for (int i = 0; i < 960; i++) a += L[w + i] * L[w + i]; a = sqrt(a / 960); if (a < mn) mn = a; if (a > mx) mx = a; }
    double cents = 1200 * log2(f / want);
    printf("drop %2d: %.2f Hz (want %.2f, %+.1f cents), level %.3f..%.3f (%.1f dB swing)\n", st, f, want, cents, mn, mx, 20 * log10(mx / mn));
    if (fabs(cents) > 5 || 20 * log10(mx / mn) > 4) fail = 1;
  }
  sh_engine_param(e, SHP_DROP, 0);
  printf(fail ? "FAIL\n" : "ok\n");
  return fail;
}
