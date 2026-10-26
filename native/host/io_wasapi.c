/*
 * Windows backend: WASAPI, event driven.
 *  - exclusive mode: the cable and the speakers/headphones are opened
 *    directly at the smallest buffer the drivers allow (what Rocksmith does);
 *  - shared mode: low-latency shared streams (IAudioClient3) so other apps
 *    keep playing.
 * One thread per device, both "Pro Audio" priority. The render thread runs
 * the amp and mixes the song.
 */
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <avrt.h>
#include <mmreg.h>
#include <stdio.h>
#include <string.h>
#include "host.h"

DEFINE_GUID(SH_SUBTYPE_PCM, 0x00000001, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);
DEFINE_GUID(SH_SUBTYPE_FLOAT, 0x00000003, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);

#ifndef AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
#define AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM 0x80000000
#endif
#ifndef AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
#define AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY 0x08000000
#endif

typedef struct {
  IMMDevice *dev;
  IAudioClient *ac;
  IAudioClient3 *ac3;
  IAudioCaptureClient *cap;
  IAudioRenderClient *ren;
  HANDLE ev;
  WAVEFORMATEXTENSIBLE fmt;
  int isfloat, bits, valid, ch, rate, block;
  UINT32 buf_frames;
  int period;
  int exclusive;
  double latency_ms;
  wchar_t name[256];
} side_t;

static struct {
  side_t in, out;
  HANDLE th_in, th_out;
  volatile LONG run;
  int com;
} W;

const char *io_backend_name(void) { return "wasapi"; }

static void com_init(void) {
  if (!W.com) {
    HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    W.com = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
  }
}

static void wide_to_utf8(const wchar_t *w, char *o, int cap) {
  if (!WideCharToMultiByte(CP_UTF8, 0, w, -1, o, cap, NULL, NULL)) o[0] = 0;
}

static int is_rocksmith(const char *name) {
  char l[256];
  int i = 0;
  for (; name[i] && i < 255; i++) l[i] = (char)((name[i] >= 'A' && name[i] <= 'Z') ? name[i] + 32 : name[i]);
  l[i] = 0;
  return strstr(l, "rocksmith") || strstr(l, "real tone") || strstr(l, "realtone") || strstr(l, "guitar adapter");
}

static void dev_name(IMMDevice *d, wchar_t *out, int cap) {
  IPropertyStore *ps = NULL;
  out[0] = 0;
  if (SUCCEEDED(IMMDevice_OpenPropertyStore(d, STGM_READ, &ps))) {
    PROPVARIANT v;
    PropVariantInit(&v);
    if (SUCCEEDED(IPropertyStore_GetValue(ps, &PKEY_Device_FriendlyName, &v)) && v.vt == VT_LPWSTR) {
      wcsncpy(out, v.pwszVal, cap - 1);
      out[cap - 1] = 0;
    }
    PropVariantClear(&v);
    IPropertyStore_Release(ps);
  }
}

static IMMDeviceEnumerator *enumerator(void) {
  com_init();
  IMMDeviceEnumerator *e = NULL;
  CoCreateInstance(&CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, &IID_IMMDeviceEnumerator, (void **)&e);
  return e;
}

static void default_id(IMMDeviceEnumerator *e, EDataFlow flow, char *out, int cap) {
  IMMDevice *d = NULL;
  out[0] = 0;
  if (SUCCEEDED(IMMDeviceEnumerator_GetDefaultAudioEndpoint(e, flow, eConsole, &d))) {
    LPWSTR id = NULL;
    if (SUCCEEDED(IMMDevice_GetId(d, &id))) {
      wide_to_utf8(id, out, cap);
      CoTaskMemFree(id);
    }
    IMMDevice_Release(d);
  }
}

int io_list(dev_info *ins, int *nin, dev_info *outs, int *nout, int max) {
  *nin = *nout = 0;
  IMMDeviceEnumerator *e = enumerator();
  if (!e) return 0;
  for (int k = 0; k < 2; k++) {
    EDataFlow flow = k ? eRender : eCapture;
    dev_info *list = k ? outs : ins;
    int *n = k ? nout : nin;
    char def[256];
    default_id(e, flow, def, sizeof def);
    IMMDeviceCollection *col = NULL;
    if (FAILED(IMMDeviceEnumerator_EnumAudioEndpoints(e, flow, DEVICE_STATE_ACTIVE, &col))) continue;
    UINT count = 0;
    IMMDeviceCollection_GetCount(col, &count);
    for (UINT i = 0; i < count && *n < max; i++) {
      IMMDevice *d = NULL;
      if (FAILED(IMMDeviceCollection_Item(col, i, &d))) continue;
      dev_info *di = &list[*n];
      memset(di, 0, sizeof *di);
      LPWSTR id = NULL;
      if (SUCCEEDED(IMMDevice_GetId(d, &id))) {
        wide_to_utf8(id, di->id, sizeof di->id);
        CoTaskMemFree(id);
      }
      wchar_t nm[256];
      dev_name(d, nm, 256);
      wide_to_utf8(nm, di->name, sizeof di->name);
      di->is_default = !strcmp(di->id, def);
      di->rocksmith = is_rocksmith(di->name);
      IAudioClient *ac = NULL;
      if (SUCCEEDED(IMMDevice_Activate(d, &IID_IAudioClient, CLSCTX_ALL, NULL, (void **)&ac))) {
        WAVEFORMATEX *mix = NULL;
        if (SUCCEEDED(IAudioClient_GetMixFormat(ac, &mix))) {
          di->rate = (int)mix->nSamplesPerSec, di->channels = mix->nChannels;
          CoTaskMemFree(mix);
        }
        IAudioClient_Release(ac);
      }
      (*n)++;
      IMMDevice_Release(d);
    }
    IMMDeviceCollection_Release(col);
  }
  IMMDeviceEnumerator_Release(e);
  return 1;
}

/* ------------------------------------------------------------ formats -- */
static void make_fmt(WAVEFORMATEXTENSIBLE *f, int rate, int ch, int isfloat, int bits, int valid) {
  memset(f, 0, sizeof *f);
  f->Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  f->Format.nChannels = (WORD)ch;
  f->Format.nSamplesPerSec = (DWORD)rate;
  f->Format.wBitsPerSample = (WORD)bits;
  f->Format.nBlockAlign = (WORD)(ch * bits / 8);
  f->Format.nAvgBytesPerSec = (DWORD)(rate * f->Format.nBlockAlign);
  f->Format.cbSize = 22;
  f->Samples.wValidBitsPerSample = (WORD)valid;
  f->dwChannelMask = ch == 1 ? SPEAKER_FRONT_CENTER : ch == 2 ? (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT) : 0;
  f->SubFormat = isfloat ? SH_SUBTYPE_FLOAT : SH_SUBTYPE_PCM;
}

static void fmt_from(side_t *s, const WAVEFORMATEX *w) {
  if (w->wFormatTag == WAVE_FORMAT_EXTENSIBLE && w->cbSize >= 22) {
    memcpy(&s->fmt, w, sizeof(WAVEFORMATEXTENSIBLE));
    s->isfloat = IsEqualGUID(&s->fmt.SubFormat, &SH_SUBTYPE_FLOAT);
    s->valid = s->fmt.Samples.wValidBitsPerSample ? s->fmt.Samples.wValidBitsPerSample : w->wBitsPerSample;
  } else {
    make_fmt(&s->fmt, (int)w->nSamplesPerSec, w->nChannels, w->wFormatTag == WAVE_FORMAT_IEEE_FLOAT, w->wBitsPerSample, w->wBitsPerSample);
    s->isfloat = w->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
    s->valid = w->wBitsPerSample;
  }
  s->bits = w->wBitsPerSample;
  s->ch = w->nChannels;
  s->rate = (int)w->nSamplesPerSec;
  s->block = w->nBlockAlign;
}

static inline float sample_in(const side_t *s, const BYTE *p) {
  switch (s->bits) {
    case 16: return (float)(*(const int16_t *)p) / 32768.f;
    case 24: return (float)(int32_t)((uint32_t)p[0] << 8 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 24) / 2147483648.f;
    case 32: return s->isfloat ? *(const float *)p : (float)(*(const int32_t *)p) / 2147483648.f;
  }
  return 0;
}
static inline void sample_out(const side_t *s, BYTE *p, float v) {
  if (v > 1) v = 1;
  if (v < -1) v = -1;
  switch (s->bits) {
    case 16: *(int16_t *)p = (int16_t)(v * 32767.f); break;
    case 24: {
      int32_t i = (int32_t)(v * 8388607.f);
      p[0] = (BYTE)i, p[1] = (BYTE)(i >> 8), p[2] = (BYTE)(i >> 16);
      break;
    }
    case 32:
      if (s->isfloat) *(float *)p = v;
      else *(int32_t *)p = (int32_t)(v * 2147483392.f);
      break;
  }
}

/* --------------------------------------------------------------- open -- */
static void side_release(side_t *s) {
  if (s->cap) IAudioCaptureClient_Release(s->cap);
  if (s->ren) IAudioRenderClient_Release(s->ren);
  if (s->ac3) IAudioClient3_Release(s->ac3);
  if (s->ac) IAudioClient_Release(s->ac);
  if (s->dev) IMMDevice_Release(s->dev);
  if (s->ev) CloseHandle(s->ev);
  memset(s, 0, sizeof *s);
}

static const char *hr_code(HRESULT hr) {
  if (hr == AUDCLNT_E_DEVICE_IN_USE) return "busy";
  if (hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED) return "notallowed";
  if (hr == AUDCLNT_E_UNSUPPORTED_FORMAT) return "format";
  if (hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == E_NOTFOUND) return "notfound";
  if (hr == AUDCLNT_E_CPUUSAGE_EXCEEDED) return "cpu";
  return "device";
}

static HRESULT find_exclusive_fmt(side_t *s, int capture, int prefer_rate, const WAVEFORMATEX *mix) {
  int rates[5] = {prefer_rate, (int)mix->nSamplesPerSec, 48000, 44100, 96000};
  int chs_cap[3] = {1, 2, mix->nChannels}, chs_ren[2] = {2, mix->nChannels};
  int *chs = capture ? chs_cap : chs_ren, nch = capture ? 3 : 2;
  struct {
    int f, b, v;
  } kinds[5] = {{1, 32, 32}, {0, 32, 24}, {0, 24, 24}, {0, 32, 32}, {0, 16, 16}};
  if (capture) kinds[0] = (typeof(kinds[0])){0, 16, 16}, kinds[4] = (typeof(kinds[0])){1, 32, 32}; /* cable is 16-bit */
  for (int r = 0; r < 5; r++) {
    if (rates[r] <= 0) continue;
    for (int c = 0; c < nch; c++) {
      for (int k = 0; k < 5; k++) {
        WAVEFORMATEXTENSIBLE f;
        make_fmt(&f, rates[r], chs[c], kinds[k].f, kinds[k].b, kinds[k].v);
        if (IAudioClient_IsFormatSupported(s->ac, AUDCLNT_SHAREMODE_EXCLUSIVE, (WAVEFORMATEX *)&f, NULL) == S_OK) {
          fmt_from(s, (WAVEFORMATEX *)&f);
          return S_OK;
        }
      }
    }
  }
  return AUDCLNT_E_UNSUPPORTED_FORMAT;
}

static HRESULT open_side(side_t *s, IMMDeviceEnumerator *e, const char *id_utf8, int capture, int exclusive, int buffer, int prefer_rate) {
  HRESULT hr;
  EDataFlow flow = capture ? eCapture : eRender;
  if (id_utf8 && id_utf8[0]) {
    wchar_t wid[512];
    MultiByteToWideChar(CP_UTF8, 0, id_utf8, -1, wid, 512);
    hr = IMMDeviceEnumerator_GetDevice(e, wid, &s->dev);
  } else {
    hr = IMMDeviceEnumerator_GetDefaultAudioEndpoint(e, flow, eConsole, &s->dev);
  }
  if (FAILED(hr)) return hr;
  dev_name(s->dev, s->name, 256);
  hr = IMMDevice_Activate(s->dev, &IID_IAudioClient, CLSCTX_ALL, NULL, (void **)&s->ac);
  if (FAILED(hr)) return hr;
  WAVEFORMATEX *mix = NULL;
  hr = IAudioClient_GetMixFormat(s->ac, &mix);
  if (FAILED(hr)) return hr;
  s->ev = CreateEventW(NULL, FALSE, FALSE, NULL);
  s->exclusive = exclusive;
  if (exclusive) {
    hr = find_exclusive_fmt(s, capture, prefer_rate, mix);
    if (FAILED(hr)) {
      CoTaskMemFree(mix);
      return hr;
    }
    REFERENCE_TIME def = 0, mn = 0;
    IAudioClient_GetDevicePeriod(s->ac, &def, &mn);
    REFERENCE_TIME per = buffer == 0 ? mn : buffer == 1 ? (mn > 30000 ? mn : 30000) : (def > 100000 ? def : 100000);
    if (per < mn) per = mn;
    hr = IAudioClient_Initialize(s->ac, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, per, per, (WAVEFORMATEX *)&s->fmt, NULL);
    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
      UINT32 frames = 0;
      IAudioClient_GetBufferSize(s->ac, &frames);
      per = (REFERENCE_TIME)(10000.0 * 1000 / s->rate * frames + 0.5);
      IAudioClient_Release(s->ac);
      s->ac = NULL;
      hr = IMMDevice_Activate(s->dev, &IID_IAudioClient, CLSCTX_ALL, NULL, (void **)&s->ac);
      if (SUCCEEDED(hr)) hr = IAudioClient_Initialize(s->ac, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, per, per, (WAVEFORMATEX *)&s->fmt, NULL);
    }
  } else {
    fmt_from(s, mix);
    hr = E_FAIL;
    if (SUCCEEDED(IMMDevice_Activate(s->dev, &IID_IAudioClient3, CLSCTX_ALL, NULL, (void **)&s->ac3))) {
      UINT32 def = 0, fund = 0, mn = 0, mx = 0;
      if (SUCCEEDED(IAudioClient3_GetSharedModeEnginePeriod(s->ac3, mix, &def, &fund, &mn, &mx))) {
        UINT32 per = buffer == 0 ? mn : buffer == 1 ? (mn * 2 < def ? mn * 2 : def) : def;
        if (fund) per = (per + fund - 1) / fund * fund;
        if (per < mn) per = mn;
        if (per > mx) per = mx;
        hr = IAudioClient3_InitializeSharedAudioStream(s->ac3, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, per, mix, NULL);
      }
      if (SUCCEEDED(hr)) {
        IAudioClient_Release(s->ac);
        IAudioClient3_QueryInterface(s->ac3, &IID_IAudioClient, (void **)&s->ac);
      } else {
        IAudioClient3_Release(s->ac3);
        s->ac3 = NULL;
      }
    }
    if (FAILED(hr)) hr = IAudioClient_Initialize(s->ac, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 0, 0, mix, NULL);
  }
  CoTaskMemFree(mix);
  if (FAILED(hr)) return hr;
  hr = IAudioClient_SetEventHandle(s->ac, s->ev);
  if (FAILED(hr)) return hr;
  IAudioClient_GetBufferSize(s->ac, &s->buf_frames);
  if (capture) hr = IAudioClient_GetService(s->ac, &IID_IAudioCaptureClient, (void **)&s->cap);
  else hr = IAudioClient_GetService(s->ac, &IID_IAudioRenderClient, (void **)&s->ren);
  if (FAILED(hr)) return hr;
  REFERENCE_TIME lat = 0;
  if (SUCCEEDED(IAudioClient_GetStreamLatency(s->ac, &lat))) s->latency_ms = lat / 10000.0;
  if (s->exclusive) s->period = (int)s->buf_frames;
  else {
    REFERENCE_TIME def = 0, mn = 0;
    IAudioClient_GetDevicePeriod(s->ac, &def, &mn);
    s->period = (int)(def * s->rate / 10000000);
    if (s->ac3) {
      WAVEFORMATEX *cur = NULL;
      UINT32 frames = 0;
      if (SUCCEEDED(IAudioClient3_GetCurrentSharedModeEnginePeriod(s->ac3, &cur, &frames))) {
        s->period = (int)frames;
        CoTaskMemFree(cur);
      }
    }
    if (s->period <= 0) s->period = (int)s->buf_frames / 2;
  }
  return S_OK;
}

/* ------------------------------------------------------------ threads -- */
static DWORD WINAPI capture_thread(void *arg) {
  (void)arg;
  CoInitializeEx(NULL, COINIT_MULTITHREADED);
  DWORD idx = 0;
  HANDLE mm = AvSetMmThreadCharacteristicsW(L"Pro Audio", &idx);
  side_t *s = &W.in;
  static float mono[16384];
  while (W.run) {
    DWORD w = WaitForSingleObject(s->ev, 200);
    if (!W.run) break;
    if (w != WAIT_OBJECT_0) continue;
    UINT32 pk = 0;
    HRESULT hr;
    while ((hr = IAudioCaptureClient_GetNextPacketSize(s->cap, &pk)) == S_OK && pk) {
      BYTE *data = NULL;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = IAudioCaptureClient_GetBuffer(s->cap, &data, &frames, &flags, NULL, NULL);
      if (FAILED(hr)) break;
      if (frames > 16384) frames = 16384;
      int bps = s->bits / 8;
      for (UINT32 i = 0; i < frames; i++) mono[i] = (flags & AUDCLNT_BUFFERFLAGS_SILENT) ? 0.f : sample_in(s, data + i * s->block + 0 * bps);
      IAudioCaptureClient_ReleaseBuffer(s->cap, frames);
      host_on_capture(mono, (int)frames);
    }
    if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
      host_on_lost("Your guitar input was unplugged.");
      break;
    }
  }
  if (mm) AvRevertMmThreadCharacteristics(mm);
  CoUninitialize();
  return 0;
}

static DWORD WINAPI render_thread(void *arg) {
  (void)arg;
  CoInitializeEx(NULL, COINIT_MULTITHREADED);
  DWORD idx = 0;
  HANDLE mm = AvSetMmThreadCharacteristicsW(L"Pro Audio", &idx);
  side_t *s = &W.out;
  static float L[16384], R[16384];
  int bps = s->bits / 8;
  while (W.run) {
    DWORD w = WaitForSingleObject(s->ev, 200);
    if (!W.run) break;
    if (w != WAIT_OBJECT_0) continue;
    UINT32 n = s->buf_frames;
    if (!s->exclusive) {
      UINT32 pad = 0;
      if (FAILED(IAudioClient_GetCurrentPadding(s->ac, &pad))) break;
      n = s->buf_frames - pad;
    }
    if (!n) continue;
    if (n > 16384) n = 16384;
    BYTE *data = NULL;
    HRESULT hr = IAudioRenderClient_GetBuffer(s->ren, n, &data);
    if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
      host_on_lost("Your speakers or headphones were unplugged.");
      break;
    }
    if (FAILED(hr)) continue;
    host_on_render(L, R, (int)n);
    for (UINT32 i = 0; i < n; i++) {
      BYTE *f = data + i * s->block;
      sample_out(s, f, L[i]);
      if (s->ch > 1) sample_out(s, f + bps, R[i]);
      for (int c = 2; c < s->ch; c++) sample_out(s, f + c * bps, 0);
    }
    IAudioRenderClient_ReleaseBuffer(s->ren, n, 0);
  }
  if (mm) AvRevertMmThreadCharacteristics(mm);
  CoUninitialize();
  return 0;
}

/* ------------------------------------------------------------- control -- */
static void set_err(HRESULT hr, int capture, int exclusive, char *err, int errlen, char *code, int codelen) {
  const char *c = hr_code(hr);
  snprintf(code, codelen, "%s", c);
  const char *what = capture ? "your guitar input" : "your speakers or headphones";
  if (!strcmp(c, "busy"))
    snprintf(err, errlen, "Another program is using %s. Close Rocksmith, your DAW or anything else that uses it, then try again.", what);
  else if (!strcmp(c, "notallowed"))
    snprintf(err, errlen,
             "Windows isn’t letting programs take over %s. In Sound settings, open the device’s properties and turn on “Allow applications to take exclusive control”, or switch Stagehand to shared mode.",
             what);
  else if (!strcmp(c, "format")) snprintf(err, errlen, "%s doesn’t support a format Stagehand can use%s.", capture ? "Your guitar input" : "Your output", exclusive ? " in exclusive mode" : "");
  else if (!strcmp(c, "notfound")) snprintf(err, errlen, "Couldn’t find %s. Is it plugged in?", what);
  else snprintf(err, errlen, "Couldn’t open %s (error 0x%08lx).", what, (unsigned long)hr);
}

int io_start(const io_config *cfg, io_status *st, char *err, int errlen, char *code, int codelen) {
  io_stop();
  IMMDeviceEnumerator *e = enumerator();
  if (!e) {
    snprintf(err, errlen, "Windows audio isn’t available.");
    snprintf(code, codelen, "device");
    return 0;
  }
  /* input: the chosen one, else a Rocksmith cable, else the default */
  char in_id[256];
  snprintf(in_id, sizeof in_id, "%s", cfg->in_id);
  if (!in_id[0]) {
    static dev_info ins[64], outs[64];
    int ni = 0, no = 0;
    io_list(ins, &ni, outs, &no, 64);
    for (int i = 0; i < ni; i++)
      if (ins[i].rocksmith) {
        snprintf(in_id, sizeof in_id, "%s", ins[i].id);
        break;
      }
  }
  HRESULT hr = open_side(&W.in, e, in_id, 1, cfg->exclusive, cfg->buffer, 0);
  if (FAILED(hr)) {
    set_err(hr, 1, cfg->exclusive, err, errlen, code, codelen);
    side_release(&W.in);
    IMMDeviceEnumerator_Release(e);
    return 0;
  }
  hr = open_side(&W.out, e, cfg->out_id, 0, cfg->exclusive, cfg->buffer, W.in.rate);
  if (FAILED(hr)) {
    set_err(hr, 0, cfg->exclusive, err, errlen, code, codelen);
    side_release(&W.in);
    side_release(&W.out);
    IMMDeviceEnumerator_Release(e);
    return 0;
  }
  IMMDeviceEnumerator_Release(e);
  host_set_rates(W.in.rate, W.out.rate, W.in.period, W.out.period);
  st->rate = W.out.rate, st->in_rate = W.in.rate;
  st->in_period = W.in.period, st->out_period = W.out.period;
  st->in_ch = W.in.ch, st->out_ch = W.out.ch;
  /* exclusive: the stream latency is the buffer we already count */
  st->in_latency_ms = W.in.exclusive ? 0 : W.in.latency_ms;
  st->out_latency_ms = W.out.exclusive ? 0 : W.out.latency_ms;
  wide_to_utf8(W.in.name, st->in_name, sizeof st->in_name);
  wide_to_utf8(W.out.name, st->out_name, sizeof st->out_name);
  snprintf(st->mode, sizeof st->mode, "%s", cfg->exclusive ? "exclusive" : (W.out.ac3 ? "shared-low" : "shared"));
  /* prefill the output with silence */
  BYTE *data = NULL;
  UINT32 pre = W.out.buf_frames;
  if (!W.out.exclusive) pre = W.out.buf_frames;
  if (SUCCEEDED(IAudioRenderClient_GetBuffer(W.out.ren, pre, &data))) IAudioRenderClient_ReleaseBuffer(W.out.ren, pre, AUDCLNT_BUFFERFLAGS_SILENT);
  W.run = 1;
  W.th_in = CreateThread(NULL, 0, capture_thread, NULL, 0, NULL);
  W.th_out = CreateThread(NULL, 0, render_thread, NULL, 0, NULL);
  hr = IAudioClient_Start(W.in.ac);
  if (SUCCEEDED(hr)) hr = IAudioClient_Start(W.out.ac);
  if (FAILED(hr)) {
    set_err(hr, 0, cfg->exclusive, err, errlen, code, codelen);
    io_stop();
    return 0;
  }
  return 1;
}

void io_stop(void) {
  if (W.run) {
    W.run = 0;
    if (W.in.ev) SetEvent(W.in.ev);
    if (W.out.ev) SetEvent(W.out.ev);
    if (W.th_in) WaitForSingleObject(W.th_in, 2000), CloseHandle(W.th_in);
    if (W.th_out) WaitForSingleObject(W.th_out, 2000), CloseHandle(W.th_out);
    W.th_in = W.th_out = NULL;
    if (W.in.ac) IAudioClient_Stop(W.in.ac);
    if (W.out.ac) IAudioClient_Stop(W.out.ac);
  }
  side_release(&W.in);
  side_release(&W.out);
}
