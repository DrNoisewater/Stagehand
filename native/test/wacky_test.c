/* The Lab's pedals on their own (no amp, no engine loudness match): made-up guitar and bass
 * playing at 44.1, 48 and 96 kHz in blocks of 16 and 1024 samples, with each footswitch held
 * through the middle. Checks every sample is a number, peaks stay sane, no offset (DC), silence
 * after the notes, the same sound whatever the block size, and prints the time each pedal takes
 * (share of one core) and how late its effect comes out (measured on a click). Exits 1 on a
 * failure. The sound itself is checked in test/wacky-pedals.cjs. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "../dsp/sh_dsp.h"

static int bad = 0;
static void check(int c, const char *what, const char *name, const char *kind, int sr, double v) {
  if (!c) {
    printf("FAIL %s on %s at %d Hz: %s (%.4f)\n", name, kind, sr, what, v);
    bad++;
  }
}

static void pluck(float *y, int len, int at, double hz, float amp, double dur, int sr) {
  int m = (int)(dur * sr);
  for (int k = 1; k <= 30 && k * hz < 8000; k++) {
    double ph = k * 2.399, a = amp * 0.6 / k * fabs(sin(k * 0.6));
    for (int i = 0; i < m && at + i < len; i++) {
      double t = (double)i / sr;
      double fade = i > m - sr / 200 ? (double)(m - i) / (sr / 200) : 1.0;
      y[at + i] += (float)(a * exp(-t * (0.8 + 0.35 * k)) * sin(6.283185307 * k * hz * t + ph) * fade);
    }
  }
}

typedef struct {
  const char *key;
  int bit;
} pedal;
static const pedal PEDALS[14] = {{"Pedal_Quack", 1}, {"Pedal_Croak", 2}, {"Pedal_Caterwaul", 3}, {"Pedal_Blorp", 4}, {"Pedal_Gobble", 5}, {"Pedal_Slug", 6}, {"Pedal_Boing", 7},
                                 {"Pedal_Gremlin", 8}, {"Pedal_Invader", 9}, {"Pedal_Confetti", 10}, {"Pedal_Blender", 11}, {"Pedal_Fossil", 12}, {"Pedal_Charmer", 13}, {"Pedal_Haunt", 14}};

/* one pedal (its own defaults, Mix 100) over the whole input in blocks of `bs`; footswitch held from h0 to h1 (samples) */
static double run(const pedal *p, int bass, int sr, const float *in, float *out, int len, int bs, int h0, int h1, float mixv) {
  static uint8_t mem[8 << 20];
  sh_arena a = {mem, sizeof mem, 0, 0};
  sh_gear g;
  sh_memset(&g, 0, sizeof g);
  strcpy(g.key, p->key);
  g.slot = SLOT_PRE;
  g.nk = 1;
  strcpy(g.k[0].name, "mix");
  g.k[0].v = mixv, g.k[0].lo = 0, g.k[0].hi = 100;
  float live[SHP_COUNT] = {0};
  sh_block b;
  sh_memset(&b, 0, sizeof b);
  if (!wacky_build(&b, &g, &a, sr, bass, live)) {
    printf("FAIL %s did not build\n", p->key);
    exit(1);
  }
  clock_t t0 = clock();
  for (int o = 0; o < len; o += bs) {
    int n = len - o < bs ? len - o : bs;
    int held = o >= h0 && o < h1;
    live[SHP_WK_HOLD] = held ? (float)(1 << p->bit) : 0.f;
    live[SHP_WK_LEVER] = held ? 0.7f : 0.f;
    for (int j = 0; j < n; j++) out[o + j] = in[o + j];
    b.in0 = in + o;
    b.process(&b, out + o, NULL, n);
  }
  return (double)(clock() - t0) / CLOCKS_PER_SEC;
}

int main(void) {
  const double gtr[10] = {82.41, 98, 110, 123.5, 146.8, 164.8, 196, 246.9, 329.6, 196};
  const double bas[8] = {41.2, 49, 55, 61.7, 73.4, 82.4, 98, 55};
  const int rates[3] = {44100, 48000, 96000};
  printf("%-10s %-6s %8s %8s %8s %8s\n", "pedal", "kind", "cpu48k%", "cpu96k%", "peak", "late ms");
  for (int k = 0; k < 14; k++)
    for (int bass = 0; bass < 2; bass++) {
      const pedal *p = &PEDALS[k];
      double cpu[3] = {0}, pk = 0, late = -1;
      const char *kind = bass ? "bass" : "guitar";
      for (int r = 0; r < 3; r++) {
        int sr = rates[r];
        int nn = bass ? 8 : 10;
        double gap = bass ? 0.42 : 0.36;
        int len = (int)((nn * gap + 5.0) * sr);
        float *in = calloc(len, sizeof(float)), *out = calloc(len, sizeof(float)), *out2 = calloc(len, sizeof(float));
        for (int i = 0; i < nn; i++) pluck(in, len, (int)(i * gap * sr), bass ? bas[i] : gtr[i], 0.12f, i == nn - 1 ? 1.4 : gap * 0.95, sr);
        int h0 = (int)(1.0 * sr), h1 = (int)(2.2 * sr);
        double secs = run(p, bass, sr, in, out, len, 1024, h0, h1, 100);
        run(p, bass, sr, in, out2, len, 16, h0, h1, 100);
        cpu[r] = secs / ((double)len / sr) * 100;
        double ipk = 0, opk = 0, dc = 0, md = 0;
        int fin = 1;
        for (int i = 0; i < len; i++) {
          if (!isfinite(out[i])) fin = 0;
          if (fabs(in[i]) > ipk) ipk = fabs(in[i]);
          if (fabs(out[i]) > opk) opk = fabs(out[i]);
          dc += out[i];
          /* the same whatever the block size (footswitch edges land on the nearest block, so only before them) */
          if (i < h0 && fabs(out[i] - out2[i]) > md) md = fabs(out[i] - out2[i]);
        }
        double tail = 0;
        for (int i = len - sr / 2; i < len; i++) tail += out[i] * out[i];
        tail = sqrt(tail / (sr / 2));
        check(fin, "every sample a number", p->key, kind, sr, 0);
        check(opk < 4 * ipk, "peaks sane", p->key, kind, sr, opk / ipk);
        check(fabs(dc / len) < 2e-4, "no offset", p->key, kind, sr, dc / len);
        check(tail < 1e-4, "quiet at the end", p->key, kind, sr, tail);
        check(md < 1e-5, "same at any block size", p->key, kind, sr, md);
        if (sr == 48000) pk = opk / ipk;
        /* how late: when the sound of a pick first comes through (a quarter of its loudest), against
           the pick itself. A swell (Slug) or a held-back slice (Blender) is late by nature. */
        if (sr == 48000) {
          int cl = sr;
          float *c = calloc(cl, sizeof(float)), *co = calloc(cl, sizeof(float));
          pluck(c, cl, sr / 10, bass ? 55 : 110, 0.3f, 0.5, sr);
          run(p, bass, sr, c, co, cl, 128, cl, cl, 100);
          double e1 = 0, e2 = 0, m1 = 0, m2 = 0, a1 = 1.0 - exp(-1.0 / (0.001 * sr));
          float *E1 = calloc(cl, sizeof(float)), *E2 = calloc(cl, sizeof(float));
          for (int i = 0; i < cl; i++) {
            e1 += a1 * (c[i] * c[i] - e1), e2 += a1 * (co[i] * co[i] - e2);
            E1[i] = (float)e1, E2[i] = (float)e2;
            if (e1 > m1) m1 = e1;
            if (e2 > m2) m2 = e2;
          }
          int t1 = 0, t2 = 0;
          while (t1 < cl && E1[t1] < 0.0625 * m1) t1++;
          while (t2 < cl && E2[t2] < 0.0625 * m2) t2++;
          late = (t2 - t1) * 1000.0 / sr;
          free(c), free(co), free(E1), free(E2);
        }
        free(in), free(out), free(out2);
      }
      printf("%-10s %-6s %8.2f %8.2f %8.2f %8.1f\n", p->key + 6, kind, cpu[1], cpu[2], pk, late);
    }
  printf(bad ? "%d failed\n" : "all passed\n", bad);
  return bad ? 1 : 0;
}
