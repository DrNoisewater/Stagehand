/*
 * Small self-contained math for the Stagehand DSP core. No libc, so the same
 * code builds natively (Windows/Linux) and for WebAssembly.
 */
#ifndef SH_MATH_H
#define SH_MATH_H

#include <stdint.h>
#include <stddef.h>

#define SH_PI 3.14159265358979323846
#define SH_TAU 6.28318530717958647692
#define SH_LN2 0.69314718055994530942

static inline double sh_fabs(double x) { return __builtin_fabs(x); }
static inline float sh_fabsf(float x) { return __builtin_fabsf(x); }
static inline double sh_sqrt(double x) { return x > 0 ? __builtin_sqrt(x) : 0; }
static inline float sh_sqrtf(float x) { return x > 0 ? __builtin_sqrtf(x) : 0; }
static inline double sh_floor(double x) { return __builtin_floor(x); }
static inline float sh_floorf(float x) { return __builtin_floorf(x); }
static inline double sh_min(double a, double b) { return a < b ? a : b; }
static inline double sh_max(double a, double b) { return a > b ? a : b; }
static inline double sh_clamp(double v, double a, double b) { return v < a ? a : v > b ? b : v; }
static inline float sh_clampf(float v, float a, float b) { return v < a ? a : v > b ? b : v; }

/* e^x, double, ~1e-15 relative */
static inline double sh_exp(double x) {
  if (x > 700) x = 700;
  if (x < -700) return 0;
  double kf = __builtin_floor(x / SH_LN2 + 0.5);
  double r = x - kf * SH_LN2;
  double t = 1, s = 1;
  for (int i = 1; i < 18; i++) {
    t *= r / i;
    s += t;
  }
  int64_t k = (int64_t)kf;
  union { double d; uint64_t u; } v;
  v.u = (uint64_t)(k + 1023) << 52;
  return s * v.d;
}

/* natural log, double */
static inline double sh_log(double x) {
  if (x <= 0) return -1e300;
  union { double d; uint64_t u; } v = { x };
  int e = (int)((v.u >> 52) & 0x7ff) - 1023;
  v.u = (v.u & 0x000fffffffffffffULL) | 0x3ff0000000000000ULL;
  double m = v.d; /* [1,2) */
  if (m > 1.41421356237309504880) {
    m *= 0.5;
    e++;
  }
  double s = (m - 1) / (m + 1), s2 = s * s, t = s, sum = 0;
  for (int i = 1; i < 40; i += 2) {
    sum += t / i;
    t *= s2;
  }
  return 2 * sum + e * SH_LN2;
}

static inline double sh_pow(double b, double e) { return b <= 0 ? 0 : sh_exp(e * sh_log(b)); }
static inline double sh_log10(double x) { return sh_log(x) / 2.30258509299404568402; }
static inline double sh_db2lin(double db) { return sh_exp(db * 0.11512925464970228); }
static inline double sh_lin2db(double l) { return 20 * sh_log10(l < 1e-12 ? 1e-12 : l); }

static inline double sh__sinpoly(double x) {
  double x2 = x * x, t = x, s = x;
  for (int i = 1; i < 12; i++) {
    t *= -x2 / ((2 * i) * (2 * i + 1));
    s += t;
  }
  return s;
}
static inline double sh_sin(double x) {
  double k = __builtin_floor(x / SH_TAU + 0.5);
  x -= k * SH_TAU; /* [-pi, pi] */
  if (x > SH_PI / 2) x = SH_PI - x;
  else if (x < -SH_PI / 2) x = -SH_PI - x;
  return sh__sinpoly(x);
}
static inline double sh_cos(double x) { return sh_sin(x + SH_PI / 2); }
static inline double sh_tan(double x) { return sh_sin(x) / sh_cos(x); }
static inline double sh_atan(double x) {
  /* reduce to |x| <= tan(pi/12) */
  int neg = x < 0;
  if (neg) x = -x;
  int inv = x > 1;
  if (inv) x = 1 / x;
  int sh = x > 0.2679491924311227;
  if (sh) x = (x - 0.5773502691896258) / (1 + 0.5773502691896258 * x);
  double x2 = x * x, t = x, s = x;
  for (int i = 1; i < 20; i++) {
    t *= -x2;
    s += t / (2 * i + 1);
  }
  if (sh) s += SH_PI / 6;
  if (inv) s = SH_PI / 2 - s;
  return neg ? -s : s;
}

/* Fast float versions for audio-rate use. */
static inline float sh_exp2f_fast(float x) {
  if (x < -126.f) return 0.f;
  if (x > 126.f) x = 126.f;
  float fi = __builtin_floorf(x);
  float f = x - fi;
  /* 2^f on [0,1), max rel error ~2e-7 */
  float p = 1.0f + f * (0.693147182f + f * (0.240226507f + f * (0.0555041087f + f * (0.00961812911f + f * (0.00133335581f + f * 0.000154035304f)))));
  union { float f; uint32_t u; } v;
  v.u = (uint32_t)((int32_t)fi + 127) << 23;
  return p * v.f;
}
static inline float sh_expf_fast(float x) { return sh_exp2f_fast(x * 1.44269504f); }
static inline float sh_tanhf(float x) {
  if (x > 9.f) return 1.f;
  if (x < -9.f) return -1.f;
  float e = sh_expf_fast(2.f * x);
  return (e - 1.f) / (e + 1.f);
}
static inline float sh_sinf_fast(float x) { return (float)sh_sin(x); }
/* phase in [0,1) → sine, fast parabolic approximation with refinement */
static inline float sh_sin01(float ph) {
  float x = ph - __builtin_floorf(ph);
  x = x * 2.f - 1.f; /* [-1,1) -> -pi..pi */
  float y = 4.f * x - 4.f * x * sh_fabsf(x);
  y = 0.225f * (y * sh_fabsf(y) - y) + y;
  return -y;
}
static inline float sh_log2f_fast(float x) {
  union { float f; uint32_t u; } v = { x };
  float e = (float)((int)((v.u >> 23) & 255) - 128);
  v.u = (v.u & 0x007fffff) | 0x3f800000;
  float m = v.f;
  return e + (-0.34484843f * m + 2.02466578f) * m - 0.67487759f;
}
static inline float sh_lin2db_fast(float l) { return 6.0206f * sh_log2f_fast(l < 1e-9f ? 1e-9f : l); }
static inline float sh_db2lin_fast(float db) { return sh_exp2f_fast(db * 0.16609640f); }

/* deterministic random */
static inline uint32_t sh_rand(uint32_t *s) {
  *s ^= *s << 13;
  *s ^= *s >> 17;
  *s ^= *s << 5;
  return *s;
}
static inline float sh_randf(uint32_t *s) { return (float)(sh_rand(s) & 0xffffff) / 16777216.f * 2.f - 1.f; }

#endif
