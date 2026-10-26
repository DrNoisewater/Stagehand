/* Test backend: a clock thread that loops a WAV as "guitar" and optionally
 * records the output, so the whole pipeline can run without sound hardware. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "host.h"

#define FRATE 48000
#define FPER 128

static struct {
  plat_thread th;
  _Atomic int run;
  float *in;
  long in_n, in_pos;
  FILE *out;
  long out_frames;
} F;

const char *io_backend_name(void) { return "fake"; }

int io_list(dev_info *ins, int *nin, dev_info *outs, int *nout, int max) {
  (void)max;
  memset(&ins[0], 0, sizeof ins[0]);
  strcpy(ins[0].id, "fake-cable");
  strcpy(ins[0].name, "Rocksmith Guitar Adapter (test)");
  ins[0].rocksmith = 1, ins[0].is_default = 1, ins[0].rate = FRATE, ins[0].channels = 1;
  memset(&outs[0], 0, sizeof outs[0]);
  strcpy(outs[0].id, "fake-out");
  strcpy(outs[0].name, "Test speakers");
  outs[0].is_default = 1, outs[0].rate = FRATE, outs[0].channels = 2;
  *nin = 1, *nout = 1;
  return 1;
}

static float *load_wav_mono(const char *path, long *n) {
  FILE *f = fopen(path, "rb");
  if (!f) return 0;
  fseek(f, 0, SEEK_END);
  long sz = ftell(f);
  fseek(f, 0, SEEK_SET);
  unsigned char *d = malloc(sz);
  if (fread(d, 1, sz, f) != (size_t)sz) sz = 0;
  fclose(f);
  long p = 12;
  int ch = 1, bits = 16;
  float *o = 0;
  while (p + 8 <= sz) {
    uint32_t csz = d[p + 4] | d[p + 5] << 8 | d[p + 6] << 16 | (uint32_t)d[p + 7] << 24;
    if (!memcmp(d + p, "fmt ", 4)) ch = d[p + 10] | d[p + 11] << 8, bits = d[p + 22] | d[p + 23] << 8;
    if (!memcmp(d + p, "data", 4)) {
      long frames = (long)csz / (ch * bits / 8);
      o = malloc(sizeof(float) * (frames ? frames : 1));
      for (long i = 0; i < frames; i++) {
        unsigned char *s = d + p + 8 + i * ch * (bits / 8);
        if (bits == 16) o[i] = (int16_t)(s[0] | s[1] << 8) / 32768.f;
        else memcpy(&o[i], s, 4);
      }
      *n = frames;
      break;
    }
    p += 8 + csz + (csz & 1);
  }
  free(d);
  return o;
}

static void wav_header(FILE *f, long frames) {
  uint32_t bytes = (uint32_t)(frames * 2 * 4), v;
  uint16_t s;
  fseek(f, 0, SEEK_SET);
  fwrite("RIFF", 1, 4, f);
  v = 36 + bytes, fwrite(&v, 4, 1, f);
  fwrite("WAVEfmt ", 1, 8, f);
  v = 16, fwrite(&v, 4, 1, f);
  s = 3, fwrite(&s, 2, 1, f);
  s = 2, fwrite(&s, 2, 1, f);
  v = FRATE, fwrite(&v, 4, 1, f);
  v = FRATE * 8, fwrite(&v, 4, 1, f);
  s = 8, fwrite(&s, 2, 1, f);
  s = 32, fwrite(&s, 2, 1, f);
  fwrite("data", 1, 4, f);
  fwrite(&bytes, 4, 1, f);
}

static PLAT_THREAD_FN(clock_thread) {
  (void)arg;
  float in[FPER], L[FPER], R[FPER], inter[FPER * 2];
  double next = plat_now();
  while (atomic_load(&F.run)) {
    for (int i = 0; i < FPER; i++) {
      in[i] = F.in && F.in_n ? F.in[F.in_pos] : 0;
      if (F.in && F.in_n && ++F.in_pos >= F.in_n) F.in_pos = 0;
    }
    host_on_capture(in, FPER);
    host_on_render(L, R, FPER);
    if (F.out && F.out_frames < FRATE * 60) {
      for (int i = 0; i < FPER; i++) inter[2 * i] = L[i], inter[2 * i + 1] = R[i];
      fwrite(inter, sizeof(float), FPER * 2, F.out);
      F.out_frames += FPER;
    }
    next += (double)FPER / FRATE;
    double wait = next - plat_now();
    if (wait > 0.0005) plat_sleep_ms((int)(wait * 1000));
    else if (wait < -0.1) next = plat_now();
  }
  PLAT_THREAD_RET;
}

int io_start(const io_config *cfg, io_status *st, char *err, int errlen, char *code, int codelen) {
  (void)err, (void)errlen, (void)code, (void)codelen;
  if (cfg->in_id[0] && strcmp(cfg->in_id, "fake-cable")) {
    snprintf(err, errlen, "That input isn't plugged in.");
    snprintf(code, codelen, "notfound");
    return 0;
  }
  free(F.in);
  F.in = 0, F.in_n = 0, F.in_pos = 0;
  if (cfg->fake_in[0]) F.in = load_wav_mono(cfg->fake_in, &F.in_n);
  F.out = 0, F.out_frames = 0;
  if (cfg->fake_out[0]) {
    F.out = fopen(cfg->fake_out, "wb");
    if (F.out) wav_header(F.out, 0);
  }
  host_set_rates(FRATE, FRATE, FPER, FPER);
  st->rate = st->in_rate = FRATE;
  st->in_period = st->out_period = FPER;
  st->in_ch = 1, st->out_ch = 2;
  strcpy(st->in_name, "Rocksmith Guitar Adapter (test)");
  strcpy(st->out_name, "Test speakers");
  strcpy(st->mode, cfg->exclusive ? "exclusive" : "shared");
  atomic_store(&F.run, 1);
  plat_thread_start(&F.th, clock_thread, 0);
  return 1;
}

void io_stop(void) {
  if (!atomic_load(&F.run)) return;
  atomic_store(&F.run, 0);
  plat_thread_join(F.th);
  if (F.out) {
    wav_header(F.out, F.out_frames);
    fclose(F.out);
    F.out = 0;
  }
}
