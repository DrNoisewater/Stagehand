/* Focused regression for Drop; includes engine internals to isolate splice gain
 * from the amp/limiter. Compile with the other dsp sources except sh_engine.c. */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "../dsp/sh_engine.c"
static sh_engine *fresh(int sr) {
 void *m=malloc(sh_engine_mem_needed()); assert(m);
 return sh_engine_init(m,sh_engine_mem_needed(),sr);
}
int main(void) {
 for(int rate=0;rate<3;rate++) {
  int sr=rate==0?44100:rate==1?48000:96000;
  sh_engine *e=fresh(sr);
  /* Correlated overlap must not change a constant level, at ANY fade phase. */
  for(int i=0;i<DR_LEN;i++)e->dr_buf[i]=.2f;
  e->dr_w=4000;e->dr_rp[0]=3900;e->dr_rp[1]=3800;
  e->dr_mix=e->dr_mix_t=1;e->dr_ratio=.9438743f;
  e->dr_xf=(int)(DR_XF_MS*sr/1000.0);
  for(int i=0;i<(int)(DR_XF_MS*sr/1000.0);i++) {
   float x=.2f;drop_process(e,&x,1);assert(fabs(x-.2f)<1e-6);
  }
  /* Negative positions at startup must interpolate, never extrapolate. */
  e->dr_buf[DR_LEN-1]=.2f;e->dr_buf[0]=.4f;
  assert(fabs(dr_read(e,-.5)-.3)<1e-6);
  free(e);
  for(int st=0;st<=12;st++) {
   e=fresh(sr);sh_engine_param(e,SHP_DROP,st);
   double ratio=pow(2,-st/12.0);if(st)assert(fabs(e->dr_ratio-ratio)<1e-6);
   float in[256],out[256];
   for(int o=0;o<sr;o+=256) {
    int n=sr-o<256?sr-o:256;
    for(int i=0;i<n;i++)out[i]=in[i]=.2*sin(2*M_PI*82.406889*(o+i)/sr);
    drop_process(e,out,n);
    for(int i=0;i<n;i++){assert(isfinite(out[i]));assert(fabs(out[i])<=.200001);if(!st)assert(out[i]==in[i]);}
   }
   sh_engine_param(e,SHP_DROP,0);
   for(int o=0;o<sr/4;o+=256){for(int i=0;i<256;i++)out[i]=in[i]=.1f;drop_process(e,out,256);}
   assert(e->dr_mix==0);for(int i=0;i<256;i++)assert(out[i]==in[i]);
   free(e);
  }
  printf("%d Hz: unity overlap, startup, semitones 0..12, finite output and exact bypass PASS\n",sr);
 }
}
