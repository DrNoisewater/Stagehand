/* rs_test: the capture resampler (44.1 kHz device ↔ 48 kHz capture) keeps a sine clean and in time. */
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include "../dsp/sh_nam.c"

int main(void) {
  static rs_t up, dn;
  double fs[3] = {44100, 96000, 32000};
  int fails = 0;
  for (int c = 0; c < 3; c++) {
    double sr = fs[c], mr = 48000;
    rs_init(&up, sr, mr);
    rs_init(&dn, mr, sr);
    int N = (int)sr * 2, B = 128;
    static float x[400000], y[400000], a[9000], b[9000];
    for (int i = 0; i < N; i++) x[i] = (float)(0.5 * sin(2 * M_PI * 1000.0 * i / sr) + 0.3 * sin(2 * M_PI * 7000.0 * i / sr));
    int got = 0;
    for (int o = 0; o < N; o += B) {
      int m = rs_run(&up, x + o, B, a, 9000);
      int k = rs_run(&dn, a, m, b, 9000);
      for (int i = 0; i < k && got < N; i++) y[got++] = b[i];
    }
    /* fit both sines at any phase (the round trip delay needn't be whole samples); what's left is error */
    double e = 0, p = 0;
    double f2[2] = {1000.0, 7000.0};
    int i0 = 4000, i1 = got - 200;
    static double r[400000];
    for (int i = i0; i < i1; i++) r[i] = y[i];
    double gain[2];
    for (int k = 0; k < 2; k++) {
      double s1 = 0, c1 = 0;
      for (int i = i0; i < i1; i++) s1 += r[i] * sin(2 * M_PI * f2[k] * i / sr), c1 += r[i] * cos(2 * M_PI * f2[k] * i / sr);
      s1 *= 2.0 / (i1 - i0), c1 *= 2.0 / (i1 - i0);
      gain[k] = sqrt(s1 * s1 + c1 * c1);
      for (int i = i0; i < i1; i++) r[i] -= s1 * sin(2 * M_PI * f2[k] * i / sr) + c1 * cos(2 * M_PI * f2[k] * i / sr);
    }
    for (int i = i0; i < i1; i++) e += r[i] * r[i], p += (double)y[i] * y[i];
    double snr = 10 * log10(p / (e + 1e-30));
    int best = 0;
    double bc = -1e9;
    for (int d = 0; d < 64; d++) {
      double cc = 0;
      for (int i = 4000; i < 20000; i++) cc += y[i + d] * x[i];
      if (cc > bc) bc = cc, best = d;
    }
    printf("  levels: 1 kHz %.3f (0.5), 7 kHz %.3f (0.3)\n", gain[0], gain[1]);
    printf("%5.0f Hz device: delay %d samples (%.2f ms), %d of %d out, signal/error %.1f dB\n", sr, best, best / sr * 1000, got, N, snr);
    if (snr < 50 || abs(got - N) > 8) fails++;
  }
  printf(fails ? "FAIL\n" : "ok\n");
  return fails;
}
