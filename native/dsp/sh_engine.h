/*
 * Stagehand DSP engine, public API (used by the native host and by WebAssembly).
 */
#ifndef SH_ENGINE_H
#define SH_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#define SH_SLOTS 8
#define SH_MAX_BLOCK 4096

typedef struct sh_engine sh_engine;

/* mem: a caller-provided region (or NULL to let the host allocate). */
size_t sh_engine_mem_needed(void);
sh_engine *sh_engine_init(void *mem, size_t bytes, double sr);

/* Builds a tone into a slot from a gear spec (see sh_spec.c). Returns 1 on success.
 * Not real-time safe; the host builds off the audio thread and then calls
 * sh_engine_select. */
int sh_engine_build(sh_engine *e, int slot, const char *spec);
/* Gives a slot a custom cabinet impulse response (mono floats at the engine rate). */
int sh_engine_set_ir(sh_engine *e, int slot, const float *ir, int len);
/* Puts a real amp capture (.nam file text) in a slot's amp place; json NULL clears it.
 * full_rig: the capture includes the speaker cabinet (no cab is added).
 * gain_ref: the tone gain-knob position (0..1) that plays the capture as made.
 * trim_db: input level correction. Rebuild the slot afterwards. Returns 0 on
 * failure (sh_engine_nam_error says why); never on a slot that is playing. */
int sh_engine_set_nam(sh_engine *e, int slot, const char *json, int len, int full_rig, float gain_ref, float trim_db);
const char *sh_engine_nam_error(void);
void sh_engine_select(sh_engine *e, int slot); /* short crossfade */
int sh_engine_selected(const sh_engine *e);

enum {
  SHP_INPUT = 0, /* 0..1, 0.5 = 0 dB, ±12 dB */
  SHP_VOLUME,    /* 0..1, 0.7 = unity */
  SHP_GAIN,      /* 0..1 amp gain override, <0 = tone's own */
  SHP_BASS,      /* 0..1, 0.5 = as the tone says */
  SHP_MID,
  SHP_TREBLE,
  SHP_FX,        /* 0..1, 0.5 = as the tone says */
  SHP_GATE,      /* dB offset for the noise gate, 0 = auto */
  SHP_BYPASS,    /* 1 = dry input (for testing) */
  SHP_DROP,      /* pitch drop in semitones (0 = off, 1..12; 12 = an octave), like a DigiTech Drop */
  SHP_ROOM,      /* 0..1 stereo room around the cabinet (0.5 = default) */
  SHP_COUNT
};
void sh_engine_param(sh_engine *e, int id, float v);

/* in: mono input. outL/outR: stereo output. n <= SH_MAX_BLOCK */
void sh_engine_process(sh_engine *e, const float *in, float *outL, float *outR, int n);

/* meters since last read: in rms, in peak, out rms, out peak, gate open (0/1) */
void sh_engine_meters(sh_engine *e, float out[5]);

/* name of the amp in a slot (for display), or "" */
const char *sh_engine_describe(sh_engine *e, int slot);

#endif
