/* WebAssembly glue: fixed exchange buffers and a flat API for the AudioWorklet. */
#include "sh_dsp.h"

void *memset(void *p, int v, size_t n) {
  uint8_t *d = (uint8_t *)p;
  while (n--) *d++ = (uint8_t)v;
  return p;
}
void *memcpy(void *d, const void *s, size_t n) {
  uint8_t *a = (uint8_t *)d;
  const uint8_t *b = (const uint8_t *)s;
  while (n--) *a++ = *b++;
  return d;
}
void *memmove(void *d, const void *s, size_t n) {
  uint8_t *a = (uint8_t *)d;
  const uint8_t *b = (const uint8_t *)s;
  if (a < b)
    while (n--) *a++ = *b++;
  else {
    a += n, b += n;
    while (n--) *--a = *--b;
  }
  return d;
}

extern unsigned char __heap_base;
static sh_engine *E;
float g_in[SH_MAX_BLOCK], g_L[SH_MAX_BLOCK], g_R[SH_MAX_BLOCK], g_meter[5], g_ir[8192];
char g_spec[16384];
static char g_nam[4u << 20]; /* .nam text for set_nam */

__attribute__((export_name("buf_in"))) float *buf_in(void) { return g_in; }
__attribute__((export_name("buf_l"))) float *buf_l(void) { return g_L; }
__attribute__((export_name("buf_r"))) float *buf_r(void) { return g_R; }
__attribute__((export_name("buf_meter"))) float *buf_meter(void) { return g_meter; }
__attribute__((export_name("buf_spec"))) char *buf_spec(void) { return g_spec; }
__attribute__((export_name("buf_ir"))) float *buf_ir(void) { return g_ir; }
__attribute__((export_name("mem_needed"))) unsigned mem_needed(void) { return (unsigned)sh_engine_mem_needed() + (unsigned)(uintptr_t)&__heap_base + 65536; }

__attribute__((export_name("init"))) int init(double sr) {
  E = sh_engine_init(&__heap_base, sh_engine_mem_needed() + 32, sr);
  return E != 0;
}
__attribute__((export_name("build"))) int build(int slot) { return sh_engine_build(E, slot, g_spec); }
__attribute__((export_name("set_ir"))) int set_ir(int slot, int len) { return sh_engine_set_ir(E, slot, len > 0 ? g_ir : 0, len); }
__attribute__((export_name("buf_nam"))) char *buf_nam(void) { return g_nam; }
__attribute__((export_name("buf_nam_size"))) unsigned buf_nam_size(void) { return sizeof g_nam; }
/* len 0 clears; returns 1 or 0 (nam_error() points at the reason) */
__attribute__((export_name("set_nam"))) int set_nam(int slot, int len, int full_rig, float gain_ref, float trim_db) {
  return sh_engine_set_nam(E, slot, len > 0 ? g_nam : 0, len, full_rig, gain_ref, trim_db);
}
__attribute__((export_name("nam_error"))) const char *nam_error(void) { return sh_engine_nam_error(); }
__attribute__((export_name("select"))) void select_(int slot) { sh_engine_select(E, slot); }
__attribute__((export_name("selected"))) int selected(void) { return sh_engine_selected(E); }
__attribute__((export_name("param"))) void param(int id, float v) { sh_engine_param(E, id, v); }
__attribute__((export_name("process"))) void process(int n) { sh_engine_process(E, g_in, g_L, g_R, n); }
__attribute__((export_name("meters"))) void meters(void) { sh_engine_meters(E, g_meter); }
