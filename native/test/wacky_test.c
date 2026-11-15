/* The wacky pedals on their own (no amp, no engine loudness match): made-up guitar and bass
 * playing at 44.1, 48 and 96 kHz. Checks the effect's own level against the dry sound, peaks,
 * no offset (DC), finite output, silence after the notes, Blend 0 = the input bit for bit, and
 * the time it takes. Prints one line per pedal and kind; exits 1 on a failure. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "../dsp/sh_dsp.h"

static int bad = 0;
static void check(int c, const char *what, const char *name, const char *kind, int sr, double v) {
  if (!c) {
    printf("FAIL %s on %s at %d Hz: %s (%.3f)\n", name, kind, sr, what, v);
    bad++;
  }
}

/* a plucked string, the same at every sample rate: harmonics that fade, the top ones first */
static void pluck(float *y, int len, int at, double hz, float amp, double dur, int sr) {
  int m = (int)(dur * sr);
  for (int k = 1; k <= 30 && k * hz < 8000; k++) {
    double ph = k * 2.399, a = amp * 0.6 / k * fabs(sin(k * 0.6)); /* picked a fifth of the way along */
    for (int i = 0; i < m && at + i < len; i++) {
      double t = (double)i / sr;
      double fade = i > m - sr / 200 ? (double)(m - i) / (sr / 200) : 1.0;
      y[at + i] += (float)(a * exp(-t * (0.8 + 0.35 * k)) * sin(6.283185307 * k * hz * t + ph) * fade);
    }
  }
}

/* one pedal over the whole input; knobs: up to 3 names and values (0..100) */
static void run(const char *key, int nk, const char *const *names, const float *vals, int bass, int sr, const float *in, float *out, int len) {
  static uint8_t mem[8 << 20];
  sh_arena a = {mem, sizeof mem, 0, 0};
  sh_gear g;
  sh_memset(&g, 0, sizeof g);
  for (int i = 0; key[i]; i++) g.key[i] = key[i];
  g.slot = SLOT_PRE;
  g.nk = nk;
  for (int k = 0; k < nk; k++) {
    for (int i = 0; names[k][i]; i++) g.k[k].name[i] = names[k][i];
    g.k[k].v = vals[k], g.k[k].lo = 0, g.k[k].hi = 100;
  }
  sh_block b;
  sh_memset(&b, 0, sizeof b);
  if (!wacky_build(&b, &g, &a, sr, bass)) {
    printf("FAIL %s did not build\n", key);
    exit(1);
  }
  for (int o = 0; o < len; o += 256) {
    int n = len - o < 256 ? len - o : 256;
    for (int j = 0; j < n; j++) out[o + j] = in[o + j];
    b.process(&b, out + o, NULL, n);
  }
}

static double rms(const float *y, int a, int b) {
  double s = 0;
  for (int i = a; i < b; i++) s += (double)y[i] * y[i];
  return sqrt(s / (b - a > 0 ? b - a : 1));
}

int main(void) {
  const char *keys[4] = {"Pedal_Quack", "Pedal_Croak", "Pedal_Caterwaul", "Pedal_Blorp"};
  const char *knobs[4][2] = {{"beak", "wobble"}, {"throat", "hop"}, {"meow", "hiss"}, {"vowel", "orbit"}};
  const double gtr[10] = {82.41, 98, 110, 123.5, 146.8, 164.8, 196, 246.9, 329.6, 196};
  const double bas[8] = {41.2, 49, 55, 61.7, 73.4, 82.4, 98, 55};
  const int rates[3] = {44100, 48000, 96000};
  for (int k = 0; k < 4; k++)
    for (int bass = 0; bass < 2; bass++) {
      double lv[3];
      double cpu = 0;
      for (int r = 0; r < 3; r++) {
        int sr = rates[r];
        int nn = bass ? 8 : 10;
        double gap = bass ? 0.42 : 0.36;
        int len = (int)((nn * gap + 2.0) * sr);
        float *in = calloc(len, sizeof(float)), *out = calloc(len, sizeof(float)), *wet = calloc(len, sizeof(float));
        for (int i = 0; i < nn; i++) pluck(in, len, (int)(i * gap * sr), bass ? bas[i] : gtr[i], 0.12f, i == nn - 1 ? 1.4 : gap * 0.95, sr);
        const char *kind = bass ? "bass" : "guitar";
        /* Blend 0 is the input, bit for bit */
        const char *bl[1] = {"blend"};
        const float v0[1] = {0}, v1[1] = {100};
        run(keys[k], 1, bl, v0, bass, sr, in, out, len);
        int same = 1;
        for (int i = 0; i < len; i++)
          if (out[i] != in[i]) same = 0;
        check(same, "Blend 0 is not the dry sound", keys[k], kind, sr, 0);
        clock_t t0 = clock();
        run(keys[k], 1, bl, v1, bass, sr, in, wet, len);
        cpu = (double)(clock() - t0) / CLOCKS_PER_SEC / ((double)len / sr) * 100;
        double ri = rms(in, 0, len), rw = rms(wet, 0, len), pk = 0, pi = 0, sum = 0;
        int fin = 1;
        for (int i = 0; i < len; i++) {
          if (!isfinite(wet[i])) fin = 0;
          if (fabs(wet[i]) > pk) pk = fabs(wet[i]);
          if (fabs(in[i]) > pi) pi = fabs(in[i]);
          sum += wet[i];
        }
        lv[r] = 20 * log10(rw / ri);
        double dc = fabs(sum / len) / rw;
        double tail = 20 * log10(rms(wet, len - sr / 5, len) + 1e-12);
        check(fin, "output is not finite", keys[k], kind, sr, 0);
        check(fabs(lv[r]) < 4, "the effect's level is off from the dry sound (dB)", keys[k], kind, sr, lv[r]);
        check(pk < 4 * pi, "peaks far above the input (times the input peak)", keys[k], kind, sr, pk / pi);
        check(dc < 0.01, "offset (DC) in the output (share of the level)", keys[k], kind, sr, dc);
        check(tail < -80, "not quiet after the last note (dB)", keys[k], kind, sr, tail);
        /* each of the other two knobs at both ends: the level stays sensible */
        if (r == 1)
          for (int kn = 0; kn < 2; kn++)
            for (int end = 0; end < 2; end++) {
              const char *nm[2] = {"blend", knobs[k][kn]};
              const float vv[2] = {100, end ? 100.f : 0.f};
              run(keys[k], 2, nm, vv, bass, sr, in, out, len);
              double l = 20 * log10(rms(out, 0, len) / ri);
              char what[96];
              snprintf(what, sizeof what, "level with %s at %d is off from the dry sound (dB)", knobs[k][kn], end ? 100 : 0);
              check(fabs(l) < 6, what, keys[k], kind, sr, l);
              printf("  %s %s %s %3d: %+5.1f dB\n", keys[k], kind, knobs[k][kn], end ? 100 : 0, l);
            }
        if (r == 1)
          printf("%-16s %-6s level %+5.1f dB against dry, peak %.2fx the input's, DC %.4f%%, tail %4.0f dB, %.2f%% of one core\n", keys[k], kind, lv[r], pk / pi,
                 dc * 100, tail, cpu);
        free(in), free(out), free(wet);
      }
      double spread = fmax(fmax(lv[0], lv[1]), lv[2]) - fmin(fmin(lv[0], lv[1]), lv[2]);
      check(spread < 1.5, "level differs between 44.1, 48 and 96 kHz (dB)", keys[k], bass ? "bass" : "guitar", 0, spread);
    }
  if (bad) {
    printf("%d failed\n", bad);
    return 1;
  }
  printf("wacky pedals on their own: level, peaks, DC, silence, Blend 0 and every rate PASS\n");
  return 0;
}
