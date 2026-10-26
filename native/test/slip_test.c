/* Song drift corrector: producer clock off by -2%..+2% with lumpy delivery;
 * checks pitch stays exact, no dropouts, and the buffer holds its target. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "../host/host.h"

int main(void) {
  double offsets[] = {-0.02, -0.0027, 0.0, 0.003, 0.02};
  int fails = 0;
  for (int t = 0; t < 5; t++) {
    for (int songrate = 44100; songrate <= 48000; songrate += 3900) {
      ring_t r;
      ring_init(&r, 1 << 17);
      static slip_t s;
      double out_rate = 48000, target = 0.06 * songrate;
      slip_init(&s, songrate, out_rate, target);
      double prod_rate = songrate * (1 + offsets[t]); /* frames per real second */
      double phase = 0, pending = 0;
      long produced = 0;
      int secs = 40, block = 128;
      float L[128], R[128];
      double last_sign = 0; long zc = 0, zc_start = 0; double t0 = 0, tz0 = -1, tz1 = 0;
      double fillmin = 1e9, fillmax = 0;
      unsigned seed = 1;
      long nblocks = (long)(secs * out_rate / block);
      for (long b = 0; b < nblocks; b++) {
        double now = (double)b * block / out_rate;
        /* producer delivers in lumps of 512 frames with up to 25 ms jitter */
        pending += prod_rate * block / out_rate;
        seed = seed * 1103515245 + 12345;
        int lump = (seed >> 16) % 8 == 0;
        while (pending >= 512 && (lump || pending > 1800)) {
          float buf[1024];
          for (int i = 0; i < 512; i++) {
            float v = 0.3f * (float)sin(phase);
            phase += 2 * M_PI * 440.0 / songrate;
            buf[2 * i] = buf[2 * i + 1] = v;
          }
          ring_write(&r, buf, 1024);
          pending -= 512;
          produced += 512;
        }
        slip_pull(&s, &r, L, R, block);
        double fill = ring_fill(&r) / 2.0 + (double)(s.w - s.rp);
        if (now > 5) { if (fill < fillmin) fillmin = fill; if (fill > fillmax) fillmax = fill; }
        for (int i = 0; i < block; i++) {
          double tt = now + i / out_rate;
          if (tt < 5) { last_sign = L[i]; continue; }
          if (last_sign < 0 && L[i] >= 0) {
            /* linear-interpolated crossing time */
            double frac = last_sign / (last_sign - L[i]);
            double tc = tt - (1 - frac) / out_rate;
            if (tz0 < 0) tz0 = tc; else zc++, tz1 = tc;
          }
          last_sign = L[i];
        }
        (void)t0; (void)zc_start;
      }
      /* pitch must stay the content's (440 Hz) whatever the producer's clock
       * does; a resampler would bend it to 440 * (1 + offset) instead */
      double hz = zc / (tz1 - tz0);
      double expect = 440.0;
      int ok = s.underruns <= 1 && fabs(hz - expect) < 0.05 && fillmin > 0.01 * songrate && fillmax < 0.12 * songrate;
      if (!ok) fails++;
      printf("%s clock %+5.2f%% song %d Hz: pitch %.3f Hz (want %.0f), splices %d, underruns %d, fill %.0f..%.0f ms\n", ok ? "ok  " : "FAIL",
             offsets[t] * 100, songrate, hz, expect, s.splices, s.underruns, fillmin / songrate * 1000, fillmax / songrate * 1000);
    }
  }
  return fails ? 1 : 0;
}
