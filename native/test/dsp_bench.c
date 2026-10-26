/*
 * DSP bench (Linux): renders a test riff through a tone spec and reports
 * levels, distortion and speed. Optionally writes WAV files.
 *   dsp_bench <spec-file> [in.wav|-] [out.wav] [--sr 48000] [--bass]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include "../dsp/sh_engine.h"

static void write_wav(const char *path, const float *L, const float *R, int n, int sr) {
  FILE *f = fopen(path, "wb");
  if (!f) return;
  int ch = R ? 2 : 1, bytes = n * ch * 2;
  fwrite("RIFF", 1, 4, f);
  int v = 36 + bytes;
  fwrite(&v, 4, 1, f);
  fwrite("WAVEfmt ", 1, 8, f);
  v = 16; fwrite(&v, 4, 1, f);
  short s = 1; fwrite(&s, 2, 1, f);
  s = ch; fwrite(&s, 2, 1, f);
  fwrite(&sr, 4, 1, f);
  v = sr * ch * 2; fwrite(&v, 4, 1, f);
  s = ch * 2; fwrite(&s, 2, 1, f);
  s = 16; fwrite(&s, 2, 1, f);
  fwrite("data", 1, 4, f);
  fwrite(&bytes, 4, 1, f);
  for (int i = 0; i < n; i++) {
    for (int c = 0; c < ch; c++) {
      float x = c ? R[i] : L[i];
      if (x > 1) x = 1;
      if (x < -1) x = -1;
      short q = (short)lrintf(x * 32767);
      fwrite(&q, 2, 1, f);
    }
  }
  fclose(f);
}

/* Karplus-Strong riff: power chords + single notes, Real Tone Cable-ish level */
static float *make_riff(int sr, int *n, int bass) {
  int len = sr * 6;
  float *x = calloc(len, sizeof(float));
  const float gtr[][3] = {{82.41f, 123.47f, 164.81f}, {98.0f, 146.83f, 196.0f}, {110.0f, 164.81f, 220.0f}, {82.41f, 123.47f, 164.81f}};
  unsigned seed = 7;
  for (int c = 0; c < 8; c++) {
    int start = (int)(c * 0.5 * sr);
    int voices = bass ? 1 : 3;
    for (int v = 0; v < voices; v++) {
      float f = bass ? gtr[c % 4][0] / 2 : gtr[c % 4][v];
      int L = (int)(sr / f);
      float *buf = malloc(sizeof(float) * L);
      for (int i = 0; i < L; i++) { seed = seed * 1103515245 + 12345; buf[i] = ((seed >> 8) & 0xffff) / 32768.f - 1.f; }
      int p = 0;
      float lp = 0;
      for (int i = start + v * 300; i < start + sr / 2 && i < len; i++) {
        float y = buf[p];
        int q = (p + 1) % L;
        buf[p] = 0.4975f * (y + buf[q]);
        p = q;
        lp += 0.45f * (y - lp);
        x[i] += lp * (bass ? 0.5f : 0.25f);
      }
      free(buf);
    }
  }
  /* single-note lead line */
  const float lead[] = {329.63f, 392.0f, 440.0f, 493.88f, 587.33f, 493.88f, 440.0f, 392.0f};
  for (int c = 0; c < 8 && !bass; c++) {
    int start = (int)(4.0 * sr + c * 0.25 * sr);
    float f = lead[c];
    int L = (int)(sr / f);
    float *buf = malloc(sizeof(float) * L);
    for (int i = 0; i < L; i++) { seed = seed * 1103515245 + 12345; buf[i] = ((seed >> 8) & 0xffff) / 32768.f - 1.f; }
    int p = 0;
    for (int i = start; i < start + sr / 4 && i < len; i++) {
      float y = buf[p];
      int q = (p + 1) % L;
      buf[p] = 0.498f * (y + buf[q]);
      p = q;
      x[i] += y * 0.18f;
    }
    free(buf);
  }
  *n = len;
  return x;
}

static char *slurp(const char *p) {
  FILE *f = fopen(p, "rb");
  if (!f) return 0;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *b = malloc(n + 1);
  if (fread(b, 1, n, f) != (size_t)n) n = 0;
  b[n] = 0;
  fclose(f);
  return b;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: dsp_bench spec [out.wav] [--bass] [--sr N] [--sine HZ AMP]\n"); return 2; }
  int sr = 48000, bass = 0;
  const char *out = 0;
  float sine_hz = 0, sine_amp = 0;
  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "--bass")) bass = 1;
    else if (!strcmp(argv[i], "--sr")) sr = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--sine")) { sine_hz = atof(argv[++i]); sine_amp = atof(argv[++i]); }
    else out = argv[i];
  }
  char *spec = slurp(argv[1]);
  if (!spec) { fprintf(stderr, "no spec\n"); return 2; }
  size_t need = sh_engine_mem_needed();
  void *mem = malloc(need);
  sh_engine *e = sh_engine_init(mem, need, sr);
  clock_t t0 = clock();
  int ok = sh_engine_build(e, 0, spec);
  double build_ms = (clock() - t0) * 1000.0 / CLOCKS_PER_SEC;
  if (!ok) { fprintf(stderr, "build failed\n"); return 1; }
  sh_engine_select(e, 0);
  int n;
  float *x;
  if (sine_hz > 0) {
    n = sr * 2;
    x = calloc(n, sizeof(float));
    for (int i = 0; i < n; i++) x[i] = sine_amp * sinf(2 * M_PI * sine_hz * i / sr);
  } else x = make_riff(sr, &n, bass);
  float *L = calloc(n, sizeof(float)), *R = calloc(n, sizeof(float));
  t0 = clock();
  for (int off = 0; off < n; off += 128) {
    int m = n - off < 128 ? n - off : 128;
    sh_engine_process(e, x + off, L + off, R + off, m);
  }
  double run_ms = (clock() - t0) * 1000.0 / CLOCKS_PER_SEC;
  double s2 = 0, pk = 0;
  for (int i = sr / 2; i < n; i++) { s2 += L[i] * L[i]; if (fabs(L[i]) > pk) pk = fabs(L[i]); }
  double rms = sqrt(s2 / (n - sr / 2));
  /* THD for sine input: energy outside the fundamental (via Goertzel on harmonics) */
  double thd = -1;
  if (sine_hz > 0) {
    int a = sr / 2, m = sr;
    double tot = 0, fund = 0;
    for (int i = a; i < a + m; i++) tot += L[i] * L[i];
    double c = 0, s = 0;
    for (int i = a; i < a + m; i++) { c += L[i] * cos(2 * M_PI * sine_hz * i / sr); s += L[i] * sin(2 * M_PI * sine_hz * i / sr); }
    fund = 2 * (c * c + s * s) / m;
    thd = sqrt(fmax(0, tot - fund) / fmax(fund, 1e-12));
  }
  printf("{\"amp\":\"%s\",\"build_ms\":%.1f,\"cpu\":%.4f,\"rms_db\":%.1f,\"peak_db\":%.1f,\"thd\":%.3f}\n", sh_engine_describe(e, 0), build_ms,
         run_ms / (n * 1000.0 / sr), 20 * log10(rms + 1e-12), 20 * log10(pk + 1e-12), thd);
  if (out) write_wav(out, L, R, n, sr);
  return 0;
}
