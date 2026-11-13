/*
 * Stagehand Setup: installs or updates Stagehand for the current user, no admin needed.
 *
 * 4.0.1: one small file. Stagehand's own files are inside; everything else is
 * downloaded only when your PC doesn't have it yet (the app runtime, the song
 * audio decoder, the stem splitter's tools), each checked against its SHA-256.
 * Downloads retry on their own, carry on from where they stopped (also after
 * closing Setup and running it again), and are kept until they're installed.
 * So the first install takes a while; updates only copy Stagehand's own files.
 *
 * The same program without its payload is the uninstaller.
 *   Stagehand-Setup.exe            install or update (window)
 *   Stagehand-Setup.exe /quiet     install with defaults, no window (exit code 0 = ok)
 *   Stagehand-Setup.exe /update    what Stagehand's own updater runs (4.1.4): starts by itself,
 *                                  closes Stagehand, updates, then opens Stagehand again
 *   Uninstall Stagehand.exe        remove (window); /quiet removes the program, keeps your data
 * For tests only: STAGEHAND_SETUP_MIRROR=http://host:port fetches the downloads
 * from that address (same file names) instead of GitHub.
 */
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <shlobj.h>
#include <objbase.h>
#include <shobjidl.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>
#include <math.h>
#include <winhttp.h>
#include <bcrypt.h>
#include "setup_core.h"
#include "miniz_tinfl.h"

#ifndef SH_VERSION
#define SH_VERSION "0.0.0"
#endif
#ifndef SH_ELECTRON
#define SH_ELECTRON "44.1.0"
#endif
/* what Setup downloads (build-setup.sh fills these in from windows/setup/components.sh) */
#ifndef SH_E_URL
#define SH_E_URL ""
#define SH_E_SHA ""
#define SH_E_SIZE 0
#define SH_V_URL ""
#define SH_V_SHA ""
#define SH_V_SIZE 0
#define SH_U_URL ""
#define SH_U_SHA ""
#define SH_U_SIZE 0
#endif
#ifndef WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY
#define WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY 4
#endif
#ifndef WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3
#define WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3 0x00002000
#endif
#define WSTR2(x) L##x
#define WSTR(x) WSTR2(x)

#define WM_APP_UPDATE (WM_APP + 1)
#define WM_APP_DONE (WM_APP + 2)

/* ------------------------------------------------------------- colours -- */
/* 4.14: the app's own colours: a warm road case, bone-white words, tungsten gold */
#define C_BG RGB(19, 17, 15)
#define C_HEAD RGB(27, 24, 21)
#define C_PANEL RGB(30, 27, 23)
#define C_LINE RGB(61, 56, 50)
#define C_TEXT RGB(239, 230, 211)
#define C_DIM RGB(169, 158, 140)
#define C_GOLD RGB(255, 181, 71)
#define C_GREEN RGB(91, 216, 138)
#define C_BLUE RGB(51, 200, 224)
#define C_RED RGB(229, 83, 60)
#define C_GREY RGB(108, 101, 90)

enum { ST_CHECK, ST_HAVE, ST_WILL, ST_BUSY, ST_DONE, ST_LATER, ST_SKIP, ST_ERR };
enum { R_APP, R_RUNTIME, R_DECODER, R_VCRT, R_STEMS, R_DATA, NROWS };

typedef struct {
  const wchar_t *title;
  wchar_t note[256];
  int state;
  double prog; /* 0..1 while busy */
} Row;

static struct {
  HWND hwnd;
  HINSTANCE inst;
  int uninstall, quiet, dpi;
  wchar_t self[MAX_PATH];
  char self8[MAX_PATH * 3];
  wchar_t dest[MAX_PATH];    /* %LOCALAPPDATA%\Programs\Stagehand */
  wchar_t local[MAX_PATH];   /* %LOCALAPPDATA%\Stagehand */
  wchar_t roaming[MAX_PATH]; /* %APPDATA%\Stagehand */
  wchar_t installed_ver[64];
  Row rows[NROWS];
  int checked;   /* detection finished */
  int running;   /* install/uninstall thread running */
  int finished;  /* 1 ok, 2 failed */
  int need_runtime, need_decoder;
  int desktop;   /* desktop shortcut */
  int del_data;  /* uninstall: also delete your data */
  int stems_found; /* 0 none, 1 Stagehand's own, 2 a Python on this PC */
  int stems_now;   /* set the stem splitter up during this install */
  int stems_busy, stems_skip, autogo, reopen;
  int vcrt_ok;
  volatile LONG cancel; /* closed while downloading: stop (what's downloaded is kept) */
  int downloading;      /* nothing installed yet: safe to close */
  char variant[16]; /* PyTorch build: cu128, cu126 or cpu */
  wchar_t gpu[128];
  HANDLE child;     /* the step running now (so Skip can stop it) */
  RECT b_stems;
  wchar_t last_line[200]; /* the failing step's last words, for the error */
  int app_open;  /* Stagehand is running */
  double total;  /* overall progress 0..1 */
  wchar_t headline[256];
  wchar_t error[512];
  Payload pay;
  int has_payload;
  CRITICAL_SECTION cs;
  HFONT f_title, f_body, f_small, f_icon, f_btn, f_mono, f_sticker;
  int own_fonts; /* the app's fonts loaded from inside Setup */
  int hover; /* button under the mouse */
  RECT b_main, b_alt, b_check;
  int anim;
  HBITMAP art; /* 4.16.3: the header picture, sized for the window */
  int art_w, art_h;
} S;

static int px(int v) { return MulDiv(v, S.dpi, 96); }

static void update(void) {
  if (S.hwnd) PostMessageW(S.hwnd, WM_APP_UPDATE, 0, 0);
}

static void set_row(int r, int state, const wchar_t *fmt, ...) {
  EnterCriticalSection(&S.cs);
  S.rows[r].state = state;
  if (fmt) {
    va_list ap;
    va_start(ap, fmt);
    _vsnwprintf(S.rows[r].note, 255, fmt, ap);
    S.rows[r].note[255] = 0;
    va_end(ap);
  }
  LeaveCriticalSection(&S.cs);
  update();
}

static void to8(const wchar_t *w, char *out, int n) { WideCharToMultiByte(CP_UTF8, 0, w, -1, out, n, NULL, NULL); }

static int wexists(const wchar_t *p) { return GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES; }

static void wjoin(wchar_t *out, const wchar_t *a, const wchar_t *b) {
  _snwprintf(out, MAX_PATH - 1, L"%s\\%s", a, b);
  out[MAX_PATH - 1] = 0;
}

/* --------------------------------------------------------- detection -- */
static int read_text(const wchar_t *path, char *buf, int n) {
  HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  if (h == INVALID_HANDLE_VALUE) return 0;
  DWORD r = 0;
  ReadFile(h, buf, n - 1, &r, NULL);
  CloseHandle(h);
  buf[r] = 0;
  while (r && (buf[r - 1] == '\r' || buf[r - 1] == '\n' || buf[r - 1] == ' ')) buf[--r] = 0;
  return 1;
}

/* Run a program hidden and capture what it prints (up to `ms`). Returns its exit code or -1. */
static int run_capture(const wchar_t *cmdline, char *out, int n, DWORD ms) {
  SECURITY_ATTRIBUTES sa = {sizeof sa, NULL, TRUE};
  HANDLE rd, wr;
  if (!CreatePipe(&rd, &wr, &sa, 0)) return -1;
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
  STARTUPINFOW si;
  memset(&si, 0, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;
  si.hStdOutput = wr;
  si.hStdError = wr;
  si.hStdInput = NULL;
  PROCESS_INFORMATION pi;
  wchar_t *cl = _wcsdup(cmdline);
  BOOL ok = CreateProcessW(NULL, cl, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
  free(cl);
  CloseHandle(wr);
  if (!ok) {
    CloseHandle(rd);
    return -1;
  }
  int got = 0;
  DWORD start = GetTickCount();
  for (;;) {
    DWORD avail = 0;
    if (PeekNamedPipe(rd, NULL, 0, NULL, &avail, NULL) && avail && got < n - 1) {
      DWORD r = 0;
      if (ReadFile(rd, out + got, (DWORD)((n - 1 - got) < (int)avail ? (n - 1 - got) : (int)avail), &r, NULL)) got += r;
      continue;
    }
    if (WaitForSingleObject(pi.hProcess, 50) == WAIT_OBJECT_0) {
      /* drain */
      while (PeekNamedPipe(rd, NULL, 0, NULL, &avail, NULL) && avail && got < n - 1) {
        DWORD r = 0;
        if (!ReadFile(rd, out + got, (DWORD)((n - 1 - got) < (int)avail ? (n - 1 - got) : (int)avail), &r, NULL)) break;
        got += r;
      }
      break;
    }
    if (GetTickCount() - start > ms) {
      TerminateProcess(pi.hProcess, 1);
      break;
    }
  }
  out[got] = 0;
  DWORD code = (DWORD)-1;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  CloseHandle(rd);
  return (int)code;
}

/* A Python on this PC that already has PyTorch and Demucs (the stem splitter's parts). */
static int find_stem_python(wchar_t *what, int n) {
  wchar_t managed[MAX_PATH];
  _snwprintf(managed, MAX_PATH, L"%s\\Engine\\venv\\Scripts\\python.exe", S.local);
  if (wexists(managed)) {
    _snwprintf(what, n, L"Already set up. Stagehand keeps using it");
    return 1;
  }
  const wchar_t *probe = L"-c \"import torch, demucs; print(torch.__version__, torch.cuda.is_available())\"";
  wchar_t cands[4][MAX_PATH + 8];
  int nc = 0;
  wchar_t found[MAX_PATH];
  if (SearchPathW(NULL, L"py.exe", NULL, MAX_PATH, found, NULL)) _snwprintf(cands[nc++], MAX_PATH + 8, L"\"%s\" -3", found);
  if (SearchPathW(NULL, L"python.exe", NULL, MAX_PATH, found, NULL) && !wcsstr(found, L"WindowsApps")) _snwprintf(cands[nc++], MAX_PATH + 8, L"\"%s\"", found);
  for (int i = 0; i < nc; i++) {
    wchar_t cmd[2 * MAX_PATH];
    _snwprintf(cmd, 2 * MAX_PATH, L"%s %s", cands[i], probe);
    char out[512];
    if (run_capture(cmd, out, sizeof out, 25000) == 0 && out[0]) {
      int gpu = strstr(out, "True") != NULL;
      _snwprintf(what, n, L"Found on your PC (PyTorch %.*S%s). Stagehand will use it", (int)strcspn(out, " \r\n"), out, gpu ? L", graphics card ready" : L"");
      return 2;
    }
  }
  return 0;
}

static void gpu_name(wchar_t *out, int n) {
  out[0] = 0;
  DISPLAY_DEVICEW dd;
  for (DWORD i = 0;; i++) {
    memset(&dd, 0, sizeof dd);
    dd.cb = sizeof dd;
    if (!EnumDisplayDevicesW(NULL, i, &dd, 0)) break;
    if (wcsstr(dd.DeviceString, L"NVIDIA")) {
      wcsncpy(out, dd.DeviceString, n - 1);
      out[n - 1] = 0;
      return;
    }
  }
}

static DWORD running_pid(void) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return 0;
  PROCESSENTRY32W pe;
  pe.dwSize = sizeof pe;
  DWORD pid = 0;
  size_t dl = wcslen(S.dest);
  for (BOOL ok = Process32FirstW(snap, &pe); ok; ok = Process32NextW(snap, &pe)) {
    if (_wcsicmp(pe.szExeFile, L"Stagehand.exe")) continue;
    HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
    if (!p) continue;
    wchar_t path[MAX_PATH];
    DWORD len = MAX_PATH;
    if (QueryFullProcessImageNameW(p, 0, path, &len) && !_wcsnicmp(path, S.dest, dl)) pid = pe.th32ProcessID;
    CloseHandle(p);
    if (pid) break;
  }
  CloseHandle(snap);
  return pid;
}

static void kill_by_name(const wchar_t *exe) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return;
  PROCESSENTRY32W pe;
  pe.dwSize = sizeof pe;
  for (BOOL ok = Process32FirstW(snap, &pe); ok; ok = Process32NextW(snap, &pe)) {
    if (_wcsicmp(pe.szExeFile, exe)) continue;
    HANDLE p = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pe.th32ProcessID);
    if (p) {
      TerminateProcess(p, 0);
      WaitForSingleObject(p, 3000);
      CloseHandle(p);
    }
  }
  CloseHandle(snap);
}

static BOOL CALLBACK close_win(HWND w, LPARAM pid) {
  DWORD p = 0;
  GetWindowThreadProcessId(w, &p);
  if (p == (DWORD)pid && IsWindowVisible(w)) PostMessageW(w, WM_CLOSE, 0, 0);
  return TRUE;
}

/* Ask Stagehand to close (like clicking X), wait for it. */
static int close_app(void) {
  DWORD pid = running_pid();
  if (!pid) return 1;
  HANDLE p = OpenProcess(SYNCHRONIZE, FALSE, pid);
  EnumWindows(close_win, (LPARAM)pid);
  DWORD r = p ? WaitForSingleObject(p, 15000) : WAIT_TIMEOUT;
  if (p) CloseHandle(p);
  /* Electron runs helper processes; give them a moment */
  for (int i = 0; i < 20 && running_pid(); i++) Sleep(250);
  return r == WAIT_OBJECT_0 || !running_pid();
}

static void read_installed_version(void) {
  HKEY k;
  S.installed_ver[0] = 0;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Stagehand", 0, KEY_READ, &k) == ERROR_SUCCESS) {
    DWORD n = sizeof S.installed_ver, type = 0;
    if (RegQueryValueExW(k, L"DisplayVersion", NULL, &type, (BYTE *)S.installed_ver, &n) != ERROR_SUCCESS || type != REG_SZ) S.installed_ver[0] = 0;
    RegCloseKey(k);
  }
  wchar_t exe[MAX_PATH];
  wjoin(exe, S.dest, L"Stagehand.exe");
  if (!S.installed_ver[0] && wexists(exe)) wcscpy(S.installed_ver, L"an earlier version");
}

static double mb(uint64_t b) { return b / 1048576.0; }

/* Visual C++ 2015-2022 runtime, x64, new enough for PyTorch 2.x (14.40+) */
static int vcrt_installed(void) {
  HKEY k;
  DWORD inst = 0, bld = 0, n = sizeof(DWORD);
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64", 0, KEY_READ | KEY_WOW64_64KEY, &k) != ERROR_SUCCESS) return 0;
  RegQueryValueExW(k, L"Installed", NULL, NULL, (BYTE *)&inst, &n);
  n = sizeof(DWORD);
  DWORD minor = 0;
  RegQueryValueExW(k, L"Minor", NULL, NULL, (BYTE *)&minor, &n);
  n = sizeof(DWORD);
  RegQueryValueExW(k, L"Bld", NULL, NULL, (BYTE *)&bld, &n);
  RegCloseKey(k);
  return inst == 1 && minor >= 40;
}

static void detect_gpu(void) {
  strcpy(S.variant, "cpu");
  gpu_name(S.gpu, 128);
  if (!S.gpu[0]) return;
  wchar_t smi[MAX_PATH], cmd[MAX_PATH + 64];
  if (!SearchPathW(NULL, L"nvidia-smi.exe", NULL, MAX_PATH, smi, NULL)) {
    GetSystemDirectoryW(smi, MAX_PATH);
    wcscat(smi, L"\\nvidia-smi.exe");
  }
  _snwprintf(cmd, MAX_PATH + 64, L"\"%s\" --query-gpu=compute_cap --format=csv,noheader", smi);
  char out[128] = "";
  double cap = 0;
  if (run_capture(cmd, out, sizeof out, 10000) == 0) cap = atof(out);
  if (cap >= 10) strcpy(S.variant, "cu128");
  else if (cap >= 6.1 || cap == 0) strcpy(S.variant, "cu126"); /* unknown: the GPU build tests itself and falls back */
}

static void stems_note(void) {
  if (S.stems_now)
    set_row(R_STEMS, ST_WILL, S.gpu[0] && strcmp(S.variant, "cpu") ? L"Will install now: downloads about 3 GB, runs on your %s. Click to skip" : L"Will install now: downloads about 1 GB (runs on the processor). Click to skip", S.gpu);
  else set_row(R_STEMS, ST_LATER, L"Skipped. Set it up later in Stagehand when you first split a song. Click to install now");
  if (!S.vcrt_ok) set_row(R_VCRT, S.stems_now ? ST_WILL : ST_SKIP, S.stems_now ? L"Will install with the stem splitter (from Microsoft, about 25 MB)" : L"Only needed for the stem splitter");
}

/* ------------------------------------------- what Setup may download -- */
typedef struct {
  const wchar_t *name;  /* for the screen: "Electron 44.1.0" */
  const char *url;
  const char *sha;      /* lower-case hex SHA-256 */
  uint64_t size;
  const wchar_t *file;  /* name in the Downloads folder (and on a test mirror) */
} Comp;
static const Comp C_ELECTRON = {L"Electron " WSTR(SH_ELECTRON), SH_E_URL, SH_E_SHA, SH_E_SIZE, L"electron-v" WSTR(SH_ELECTRON) L"-win32-x64.zip"};
static const Comp C_DECODER = {L"the song audio decoder", SH_V_URL, SH_V_SHA, SH_V_SIZE, L"vgmstream-win64.zip"};
static const Comp C_UV = {L"the stem splitter's installer", SH_U_URL, SH_U_SHA, SH_U_SIZE, L"uv-x86_64-pc-windows-msvc.zip"};

static void dl_path(const Comp *c, wchar_t *out) {
  _snwprintf(out, MAX_PATH, L"%s\\Downloads\\%s", S.local, c->file);
}

/* SHA-256 of a file, as lower-case hex (Windows' own crypto, no extra code to trust) */
static int sha256_file(const wchar_t *path, char hex[65]) {
  BCRYPT_ALG_HANDLE alg = NULL;
  BCRYPT_HASH_HANDLE hh = NULL;
  int ok = 0;
  HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
  if (f == INVALID_HANDLE_VALUE) return 0;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, NULL, 0) == 0 && BCryptCreateHash(alg, &hh, NULL, 0, NULL, 0, 0) == 0) {
    static unsigned char buf[1 << 20];
    DWORD r = 0;
    ok = 1;
    while (ReadFile(f, buf, sizeof buf, &r, NULL) && r) {
      if (BCryptHashData(hh, buf, r, 0)) { ok = 0; break; }
    }
    unsigned char d[32];
    if (ok && BCryptFinishHash(hh, d, 32, 0) == 0) {
      for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", d[i]);
      hex[64] = 0;
    } else ok = 0;
  }
  if (hh) BCryptDestroyHash(hh);
  if (alg) BCryptCloseAlgorithmProvider(alg, 0);
  CloseHandle(f);
  return ok;
}

static uint64_t file_size(const wchar_t *path) {
  WIN32_FILE_ATTRIBUTE_DATA a;
  if (!GetFileAttributesExW(path, GetFileExInfoStandard, &a)) return 0;
  return ((uint64_t)a.nFileSizeHigh << 32) | a.nFileSizeLow;
}

static DWORD WINAPI detect_thread(void *arg) {
  (void)arg;
  wchar_t path[MAX_PATH];
  /* the app */
  read_installed_version();
  if (S.uninstall) {
    if (S.installed_ver[0] || wexists(S.dest)) set_row(R_APP, ST_WILL, L"Will be removed (%s)", S.installed_ver[0] ? S.installed_ver : L"installed");
    else set_row(R_APP, ST_SKIP, L"Not installed");
    set_row(R_DATA, ST_HAVE, L"Kept: your library, settings, stems, tones and the stem splitter");
  } else {
    Part app = payload_part(&S.pay, "app/");
    if (!S.installed_ver[0]) set_row(R_APP, ST_WILL, L"New install (%.0f MB)", mb(app.bytes));
    else if (!wcscmp(S.installed_ver, WSTR(SH_VERSION))) set_row(R_APP, ST_WILL, L"Version " WSTR(SH_VERSION) L" is installed. Reinstall it");
    else set_row(R_APP, ST_WILL, L"Update from %s", S.installed_ver);

    /* the runtime: reuse the one that's there when it's the same version */
    char ver[64] = "";
    wjoin(path, S.dest, L"electron-version.txt");
    wchar_t exe[MAX_PATH];
    wjoin(exe, S.dest, L"Stagehand.exe");
    read_text(path, ver, sizeof ver);
    if (!strcmp(ver, SH_ELECTRON) && wexists(exe)) {
      S.need_runtime = 0;
      set_row(R_RUNTIME, ST_HAVE, L"Already on your PC (Electron %S). Keeping it", ver);
    } else {
      S.need_runtime = 1;
      wchar_t got[MAX_PATH];
      dl_path(&C_ELECTRON, got);
      const wchar_t *how = file_size(got) == C_ELECTRON.size ? L"already downloaded" : L"one-time download";
      if (ver[0]) set_row(R_RUNTIME, ST_WILL, L"Will update Electron %S to " WSTR(SH_ELECTRON) L" (%.0f MB, %s)", ver, mb(C_ELECTRON.size), how);
      else set_row(R_RUNTIME, ST_WILL, L"Will install Electron " WSTR(SH_ELECTRON) L" (%.0f MB, %s)", mb(C_ELECTRON.size), how);
    }

    /* the song audio decoder */
    wchar_t found[MAX_PATH];
    _snwprintf(path, MAX_PATH, L"%s\\Tools\\vgmstream\\vgmstream-cli.exe", S.local);
    if (wexists(path)) {
      S.need_decoder = 0;
      set_row(R_DECODER, ST_HAVE, L"Already on your PC. Keeping it");
    } else if (SearchPathW(NULL, L"vgmstream-cli.exe", NULL, MAX_PATH, found, NULL)) {
      S.need_decoder = 0;
      set_row(R_DECODER, ST_HAVE, L"Found on your PC. Stagehand will use it");
    } else {
      S.need_decoder = 1;
      set_row(R_DECODER, ST_WILL, L"Will install (%.0f MB download)", mb(C_DECODER.size));
    }

    /* your data */
    _snwprintf(path, MAX_PATH, L"%s\\settings.json", S.roaming);
    if (wexists(S.roaming)) set_row(R_DATA, ST_HAVE, L"Found. Your library, settings, stems and tones stay as they are");
    else set_row(R_DATA, ST_SKIP, L"None yet. Stagehand finds your songs when it opens");

    /* your graphics card decides which PyTorch the stem splitter needs */
    detect_gpu();
    /* the Microsoft C++ runtime (PyTorch needs it on Windows) */
    S.vcrt_ok = vcrt_installed();
    if (S.vcrt_ok) set_row(R_VCRT, ST_HAVE, L"Already on your PC");
    else set_row(R_VCRT, ST_WILL, L"Will install with the stem splitter (from Microsoft, about 25 MB)");
    /* the stem splitter: Python + PyTorch + Demucs */
    set_row(R_STEMS, ST_CHECK, L"Looking for Python, PyTorch and Demucs…");
    wchar_t what[256];
    S.stems_found = find_stem_python(what, 256);
    if (S.stems_found) {
      set_row(R_STEMS, ST_HAVE, L"%s", what);
      if (S.vcrt_ok || S.stems_found) set_row(R_VCRT, S.vcrt_ok ? ST_HAVE : ST_SKIP, S.vcrt_ok ? L"Already on your PC" : L"Not needed: your stem splitter is already working");
    } else {
      S.stems_now = 1;
      stems_note();
    }
  }
  S.app_open = running_pid() != 0;
  S.checked = 1;
  if (S.autogo && !S.quiet) {
    if (!S.uninstall && !S.stems_found) {
      if (!wcsstr(GetCommandLineW(), L"/stems")) S.stems_now = 0;
      stems_note();
    }
    PostMessageW(S.hwnd, WM_KEYDOWN, VK_RETURN, 0);
  }
  update();
  return 0;
}

/* ---------------------------------------------------------- downloads -- */
static int on_progress(void *ctx, uint64_t done);
/* One try at fetching url into `part`, carrying on from what's already there.
   0 = complete, 1 = try again (network), 2 = give up (not found), 3 = cancelled. */
static int http_try(const wchar_t *url, const wchar_t *part, const Comp *c, int row, wchar_t *why, int whyn) {
  URL_COMPONENTSW uc;
  wchar_t host[256], path[2048];
  memset(&uc, 0, sizeof uc);
  uc.dwStructSize = sizeof uc;
  uc.lpszHostName = host;
  uc.dwHostNameLength = 256;
  uc.lpszUrlPath = path;
  uc.dwUrlPathLength = 2048;
  if (!WinHttpCrackUrl(url, 0, 0, &uc)) { _snwprintf(why, whyn, L"bad address"); return 2; }
  int rc = 1;
  HINTERNET ses = WinHttpOpen(L"StagehandSetup/" WSTR(SH_VERSION), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!ses) ses = WinHttpOpen(L"StagehandSetup/" WSTR(SH_VERSION), WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  HINTERNET con = NULL, req = NULL;
  HANDLE out = INVALID_HANDLE_VALUE;
  if (!ses) { _snwprintf(why, whyn, L"no internet access"); return 1; }
  DWORD protos = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
  if (!WinHttpSetOption(ses, WINHTTP_OPTION_SECURE_PROTOCOLS, &protos, sizeof protos)) {
    protos = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
    WinHttpSetOption(ses, WINHTTP_OPTION_SECURE_PROTOCOLS, &protos, sizeof protos);
  }
  /* resolve, connect, send, and up to 60 s without a byte before it counts as stalled */
  WinHttpSetTimeouts(ses, 20000, 20000, 30000, 60000);
  con = WinHttpConnect(ses, host, uc.nPort, 0);
  if (con) req = WinHttpOpenRequest(con, L"GET", path, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
  if (!req) { _snwprintf(why, whyn, L"couldn't reach %s", host); goto done; }
  uint64_t have = file_size(part);
  if (have > c->size) { DeleteFileW(part); have = 0; }
  wchar_t range[64] = L"";
  if (have) _snwprintf(range, 64, L"Range: bytes=%llu-", (unsigned long long)have);
  if (!WinHttpSendRequest(req, have ? range : WINHTTP_NO_ADDITIONAL_HEADERS, have ? (DWORD)-1L : 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(req, NULL)) {
    _snwprintf(why, whyn, L"no answer from %s (error %lu)", host, GetLastError());
    goto done;
  }
  DWORD status = 0, sl = sizeof status;
  WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &sl, WINHTTP_NO_HEADER_INDEX);
  if (status == 416 && have == c->size) { rc = 0; goto done; } /* we already have all of it */
  if (status == 404 || status == 403 || status == 410) { _snwprintf(why, whyn, L"%s isn't there any more (HTTP %lu)", c->file, status); rc = 2; goto done; }
  if (status != 200 && status != 206) { _snwprintf(why, whyn, L"the server said HTTP %lu", status); goto done; }
  if (status == 200) have = 0; /* the server sends it all again: start over */
  out = CreateFileW(part, GENERIC_WRITE, 0, NULL, have ? OPEN_ALWAYS : CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (out == INVALID_HANDLE_VALUE) { _snwprintf(why, whyn, L"couldn't write to the Downloads folder"); rc = 2; goto done; }
  LARGE_INTEGER pos;
  pos.QuadPart = (LONGLONG)have;
  SetFilePointerEx(out, pos, NULL, FILE_BEGIN);
  SetEndOfFile(out);
  static unsigned char buf[1 << 16];
  DWORD t0 = GetTickCount(), lastUi = 0;
  uint64_t got0 = have;
  for (;;) {
    if (S.cancel) { rc = 3; goto done; }
    DWORD avail = 0, r = 0, w = 0;
    if (!WinHttpQueryDataAvailable(req, &avail)) { _snwprintf(why, whyn, L"the connection dropped"); goto done; }
    if (!avail) break;
    if (!WinHttpReadData(req, buf, avail < sizeof buf ? avail : sizeof buf, &r)) { _snwprintf(why, whyn, L"the connection dropped"); goto done; }
    if (!r) break;
    if (!WriteFile(out, buf, r, &w, NULL) || w != r) { _snwprintf(why, whyn, L"couldn't write the download (is the disk full?)"); rc = 2; goto done; }
    have += r;
    DWORD now = GetTickCount();
    if (now - lastUi > 250) {
      lastUi = now;
      double secs = (now - t0) / 1000.0, speed = secs > 0.5 ? (have - got0) / secs : 0;
      set_row(row, ST_BUSY, L"Downloading %s: %.0f of %.0f MB%s%.1f MB/s", c->name, mb(have), mb(c->size), speed > 0 ? L" · " : L"", speed / 1048576.0);
      EnterCriticalSection(&S.cs);
      S.rows[row].prog = c->size ? (double)have / (double)c->size : 0;
      LeaveCriticalSection(&S.cs);
    }
  }
  rc = have == c->size ? 0 : 1;
  if (rc) _snwprintf(why, whyn, L"the download stopped at %.0f of %.0f MB", mb(have), mb(c->size));
done:
  if (out != INVALID_HANDLE_VALUE) CloseHandle(out);
  if (req) WinHttpCloseHandle(req);
  if (con) WinHttpCloseHandle(con);
  WinHttpCloseHandle(ses);
  return rc;
}

/* Gets a component into the Downloads folder, checked; reuses one already there.
   Returns 1 with its path in `out`, or 0 with S.error set. */
static int fetch(const Comp *c, int row, wchar_t *out) {
  wchar_t part[MAX_PATH], url[2048], dir[MAX_PATH], why[300] = L"";
  char hex[65];
  dl_path(c, out);
  _snwprintf(part, MAX_PATH, L"%s.part", out);
  _snwprintf(dir, MAX_PATH, L"%s\\Downloads", S.local);
  SHCreateDirectoryExW(NULL, dir, NULL);
  if (!c->url[0] || !c->size) {
    _snwprintf(S.error, 512, L"This Setup doesn't know where to get %s. Download Stagehand Setup again.", c->name);
    return 0;
  }
  /* already downloaded (an earlier Setup stopped after the download): use it if it checks out */
  if (file_size(out) == c->size && sha256_file(out, hex) && !strcmp(hex, c->sha)) return 1;
  DeleteFileW(out);
  wchar_t mirror[512];
  if (GetEnvironmentVariableW(L"STAGEHAND_SETUP_MIRROR", mirror, 512)) _snwprintf(url, 2048, L"%s/%s", mirror, c->file);
  else MultiByteToWideChar(CP_UTF8, 0, c->url, -1, url, 2048);
  int damaged = 0;
  for (int attempt = 0; attempt < 6; attempt++) {
    if (attempt) {
      /* wait a little longer each time: 2, 4, 8, 15, 15 s */
      DWORD wait = attempt < 4 ? (1000u << attempt) : 15000;
      for (DWORD t = wait / 1000; t > 0 && !S.cancel; t--) {
        set_row(row, ST_BUSY, L"Trying again in %lu s (%s)", t, why);
        Sleep(1000);
      }
    }
    if (S.cancel) return 0;
    int rc = http_try(url, part, c, row, why, 300);
    if (rc == 3) return 0;
    if (rc == 2) break;
    if (rc == 1) continue;
    set_row(row, ST_BUSY, L"Checking %s…", c->name);
    if (sha256_file(part, hex) && !strcmp(hex, c->sha)) {
      DeleteFileW(out);
      if (MoveFileW(part, out)) return 1;
      _snwprintf(why, 300, L"couldn't keep the download");
      break;
    }
    /* damaged: start this one again from nothing, once */
    DeleteFileW(part);
    _snwprintf(why, 300, L"the download was damaged");
    if (damaged++) break;
  }
  _snwprintf(S.error, 512, L"Couldn't download %s: %s. Check your internet connection and run Setup again: it carries on from where it stopped.", c->name, why);
  return 0;
}

/* Unpacks a downloaded zip into dest (made fresh). */
static int unzip_to(const wchar_t *zip, const wchar_t *dest, uint64_t *done) {
  char z8[MAX_PATH * 3], d8[MAX_PATH * 3], err[600];
  Payload p;
  to8(zip, z8, sizeof z8);
  to8(dest, d8, sizeof d8);
  if (!zipfile_open(&p, z8)) {
    _snwprintf(S.error, 512, L"A download couldn't be opened. Run Setup again to fetch it afresh.");
    DeleteFileW(zip);
    return 0;
  }
  int rc = payload_extract(&p, "", d8, on_progress, NULL, done, err, sizeof err);
  payload_close(&p);
  if (rc) MultiByteToWideChar(CP_UTF8, 0, err, -1, S.error, 512);
  return rc == 0;
}

/* ---------------------------------------------------------- installing -- */
typedef struct {
  uint64_t base, total;
  int row;
  uint64_t row_total, row_base;
} Prog;
static Prog P;

static int on_progress(void *ctx, uint64_t done) {
  (void)ctx;
  static DWORD last = 0;
  DWORD now = GetTickCount();
  if (now - last > 40) {
    last = now;
    EnterCriticalSection(&S.cs);
    S.total = P.total ? (double)done / (double)P.total : 0;
    if (P.row_total) S.rows[P.row].prog = (double)(done - P.row_base) / (double)P.row_total;
    LeaveCriticalSection(&S.cs);
    update();
  }
  return 1;
}

static int extract(const char *prefix, const wchar_t *dest, uint64_t *done) {
  char d8[MAX_PATH * 3], err[600];
  to8(dest, d8, sizeof d8);
  int rc = payload_extract(&S.pay, prefix, d8, on_progress, NULL, done, err, sizeof err);
  if (rc) MultiByteToWideChar(CP_UTF8, 0, err, -1, S.error, 512);
  return rc == 0;
}

static int wrmtree(const wchar_t *p) {
  char p8[MAX_PATH * 3];
  to8(p, p8, sizeof p8);
  return fs_rmtree(p8);
}
static int wrename(const wchar_t *a, const wchar_t *b) {
  char a8[MAX_PATH * 3], b8[MAX_PATH * 3];
  to8(a, a8, sizeof a8);
  to8(b, b8, sizeof b8);
  return fs_rename(a8, b8);
}

static int write_utf8(const wchar_t *path, const char *text) {
  char p8[MAX_PATH * 3];
  to8(path, p8, sizeof p8);
  return fs_write(p8, text, strlen(text));
}

static int make_link(const wchar_t *lnk, const wchar_t *target, const wchar_t *args, const wchar_t *dir, const wchar_t *iconPath, const wchar_t *desc) {
  IShellLinkW *sl = NULL;
  if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&sl))) return 0;
  IShellLinkW_SetPath(sl, target);
  if (args) IShellLinkW_SetArguments(sl, args);
  IShellLinkW_SetWorkingDirectory(sl, dir);
  if (iconPath) IShellLinkW_SetIconLocation(sl, iconPath, 0);
  if (desc) IShellLinkW_SetDescription(sl, desc);
  IPersistFile *pf = NULL;
  int ok = 0;
  if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPersistFile, (void **)&pf))) {
    ok = SUCCEEDED(IPersistFile_Save(pf, lnk, TRUE));
    IPersistFile_Release(pf);
  }
  IShellLinkW_Release(sl);
  return ok;
}

static void known(REFKNOWNFOLDERID id, wchar_t *out) {
  PWSTR p = NULL;
  out[0] = 0;
  if (SUCCEEDED(SHGetKnownFolderPath(id, 0, NULL, &p))) {
    wcsncpy(out, p, MAX_PATH - 1);
    out[MAX_PATH - 1] = 0;
    CoTaskMemFree(p);
  }
}

static void reg_set(HKEY k, const wchar_t *name, const wchar_t *v) { RegSetValueExW(k, name, 0, REG_SZ, (const BYTE *)v, (DWORD)((wcslen(v) + 1) * sizeof(wchar_t))); }
static void reg_dw(HKEY k, const wchar_t *name, DWORD v) { RegSetValueExW(k, name, 0, REG_DWORD, (const BYTE *)&v, sizeof v); }

static int fail(const wchar_t *msg) {
  if (msg) wcsncpy(S.error, msg, 511);
  S.finished = 2;
  wcscpy(S.headline, L"Installation stopped");
  update();
  return 0;
}


/* ------------------------------------------------- the stem splitter -- */
/* Run one step hidden, showing its latest output line (and how much is
 * downloaded so far) on the stem splitter's row. Returns the exit code. */
static uint64_t dir_bytes(const wchar_t *dir) {
  wchar_t pat[MAX_PATH];
  _snwprintf(pat, MAX_PATH, L"%s\\*", dir);
  WIN32_FIND_DATAW fd;
  HANDLE f = FindFirstFileW(pat, &fd);
  uint64_t total = 0;
  if (f == INVALID_HANDLE_VALUE) return 0;
  do {
    if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      wchar_t sub[MAX_PATH];
      _snwprintf(sub, MAX_PATH, L"%s\\%s", dir, fd.cFileName);
      total += dir_bytes(sub);
    } else total += ((uint64_t)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
  } while (FindNextFileW(f, &fd));
  FindClose(f);
  return total;
}

static int run_step(const wchar_t *cmdline, const wchar_t *what, const wchar_t *watch_dir, double p0, double p1) {
  SECURITY_ATTRIBUTES sa = {sizeof sa, NULL, TRUE};
  HANDLE rd, wr;
  if (!CreatePipe(&rd, &wr, &sa, 0)) return -1;
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
  STARTUPINFOW si;
  memset(&si, 0, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;
  si.hStdOutput = wr;
  si.hStdError = wr;
  PROCESS_INFORMATION pi;
  wchar_t *cl = _wcsdup(cmdline);
  BOOL ok = CreateProcessW(NULL, cl, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
  free(cl);
  CloseHandle(wr);
  if (!ok) {
    CloseHandle(rd);
    return -1;
  }
  S.child = pi.hProcess;
  uint64_t base = watch_dir ? dir_bytes(watch_dir) : 0;
  DWORD start = GetTickCount(), lastScan = 0;
  char line[512] = "", buf[1024];
  int ll = 0;
  wchar_t last[200] = L"";
  for (;;) {
    DWORD avail = 0, r = 0;
    while (PeekNamedPipe(rd, NULL, 0, NULL, &avail, NULL) && avail) {
      if (!ReadFile(rd, buf, avail < sizeof buf ? avail : sizeof buf, &r, NULL) || !r) break;
      for (DWORD i = 0; i < r; i++) {
        char c = buf[i];
        if (c == '\n' || c == '\r') {
          line[ll] = 0;
          if (ll > 2) {
            MultiByteToWideChar(CP_UTF8, 0, line, -1, last, 200);
            wcsncpy(S.last_line, last, 199);
          }
          ll = 0;
        } else if (ll < (int)sizeof line - 1) line[ll++] = c;
      }
    }
    int done = WaitForSingleObject(pi.hProcess, 150) == WAIT_OBJECT_0;
    DWORD now = GetTickCount();
    if (now - lastScan > 1000 || done) {
      lastScan = now;
      DWORD secs = (now - start) / 1000;
      double got = watch_dir ? mb(dir_bytes(watch_dir) - base) : 0;
      wchar_t extra[64] = L"";
      if (got > 1) _snwprintf(extra, 64, got > 1024 ? L" · %.1f GB downloaded" : L" · %.0f MB downloaded", got > 1024 ? got / 1024 : got);
      set_row(R_STEMS, ST_BUSY, L"%s (%lu:%02lu%s)  %.70s", what, secs / 60, secs % 60, extra, last);
      EnterCriticalSection(&S.cs);
      /* a soft creep inside this step's share, so the bar never sits still */
      double k = 1 - 1.0 / (1 + secs / 60.0);
      S.rows[R_STEMS].prog = p0 + (p1 - p0) * k;
      LeaveCriticalSection(&S.cs);
    }
    if (done) break;
  }
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  S.child = NULL;
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  CloseHandle(rd);
  return S.stems_skip ? -2 : (int)code;
}

static int install_vcrt(void) {
  wchar_t tmp[MAX_PATH], exe[MAX_PATH];
  GetTempPathW(MAX_PATH, tmp);
  _snwprintf(exe, MAX_PATH, L"%sStagehand-vc_redist.x64.exe", tmp);
  set_row(R_VCRT, ST_BUSY, L"Downloading from Microsoft…");
  typedef HRESULT(WINAPI * DL)(void *, LPCWSTR, LPCWSTR, DWORD, void *);
  HMODULE um = LoadLibraryW(L"urlmon.dll");
  DL dl = um ? (DL)(void *)GetProcAddress(um, "URLDownloadToFileW") : NULL;
  if (!dl || FAILED(dl(NULL, L"https://aka.ms/vs/17/release/vc_redist.x64.exe", exe, 0, NULL))) {
    set_row(R_VCRT, ST_ERR, L"Couldn't download it. Check your internet, or get “Visual C++ Redistributable x64” from Microsoft");
    return 0;
  }
  set_row(R_VCRT, ST_BUSY, L"Installing (Windows may ask for permission)…");
  SHELLEXECUTEINFOW ei;
  memset(&ei, 0, sizeof ei);
  ei.cbSize = sizeof ei;
  ei.fMask = SEE_MASK_NOCLOSEPROCESS;
  ei.lpFile = exe;
  ei.lpParameters = L"/install /passive /norestart";
  ei.nShow = SW_SHOWNORMAL;
  DWORD code = 1;
  if (ShellExecuteExW(&ei) && ei.hProcess) {
    WaitForSingleObject(ei.hProcess, INFINITE);
    GetExitCodeProcess(ei.hProcess, &code);
    CloseHandle(ei.hProcess);
  }
  DeleteFileW(exe);
  if (code == 0 || code == 1638 || code == 3010 || vcrt_installed()) {
    S.vcrt_ok = 1;
    set_row(R_VCRT, ST_DONE, code == 3010 ? L"Installed (Windows wants a restart some time)" : L"Installed");
    return 1;
  }
  set_row(R_VCRT, ST_ERR, L"Didn't install (permission refused?). The stem splitter may not start without it");
  return 0;
}

/* Same steps and folders as Stagehand's own setup (Settings › Stems), so the app finds it. */
static void install_stems(void) {
  S.stems_busy = 1;
  S.stems_skip = 0;
  update();
  if (!S.vcrt_ok) install_vcrt();
  wchar_t eng[MAX_PATH], uv[MAX_PATH], venv[MAX_PATH], py[MAX_PATH], cache[MAX_PATH], cmd[2048], tmp[MAX_PATH];
  _snwprintf(eng, MAX_PATH, L"%s\\Engine", S.local);
  _snwprintf(uv, MAX_PATH, L"%s\\uv\\uv.exe", eng);
  _snwprintf(venv, MAX_PATH, L"%s\\venv", eng);
  _snwprintf(py, MAX_PATH, L"%s\\Scripts\\python.exe", venv);
  _snwprintf(cache, MAX_PATH, L"%s\\uv-cache", eng);
  if (!wexists(uv)) {
    wchar_t uvzip[MAX_PATH];
    _snwprintf(tmp, MAX_PATH, L"%s\\uv", eng);
    uint64_t d = 0;
    if (!fetch(&C_UV, R_STEMS, uvzip) || !unzip_to(uvzip, tmp, &d)) {
      set_row(R_STEMS, ST_ERR, L"Couldn't download its installer (%.80s). Set it up later in Stagehand", S.error);
      S.error[0] = 0;
      S.stems_busy = 0;
      return;
    }
  }
  _snwprintf(tmp, MAX_PATH, L"%s\\python", eng);
  SetEnvironmentVariableW(L"UV_PYTHON_INSTALL_DIR", tmp);
  SetEnvironmentVariableW(L"UV_CACHE_DIR", cache);
  SetEnvironmentVariableW(L"UV_LINK_MODE", L"copy");
  SetEnvironmentVariableW(L"UV_NO_CONFIG", L"1");
  SetEnvironmentVariableW(L"UV_PYTHON_PREFERENCE", L"only-managed");
  SetEnvironmentVariableW(L"UV_HTTP_TIMEOUT", L"300");
  _snwprintf(tmp, MAX_PATH, L"%s\\torch", eng);
  SetEnvironmentVariableW(L"TORCH_HOME", tmp);
  SetEnvironmentVariableW(L"PYTHONIOENCODING", L"utf-8");
  SetEnvironmentVariableW(L"PYTHONUNBUFFERED", L"1");
  SetEnvironmentVariableW(L"TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", L"1");
  wchar_t variant[16];
  MultiByteToWideChar(CP_UTF8, 0, S.variant, -1, variant, 16);
  int rc = 0;
  const wchar_t *fail_at = NULL;
  if (!wexists(py)) {
    _snwprintf(cmd, 2048, L"\"%s\" venv \"%s\" --python 3.12", uv, venv);
    if ((rc = run_step(cmd, L"Getting Python 3.12", tmp, 0.0, 0.08))) fail_at = L"Python";
  }
  if (!rc) {
    _snwprintf(cmd, 2048, L"\"%s\" pip install --python \"%s\" torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/%s", uv, py, variant);
    if ((rc = run_step(cmd, wcscmp(variant, L"cpu") ? L"Downloading PyTorch for your graphics card" : L"Downloading PyTorch", cache, 0.08, 0.8))) fail_at = L"PyTorch";
  }
  if (!rc) {
    _snwprintf(cmd, 2048, L"\"%s\" pip install --python \"%s\" demucs==4.0.1 numpy", uv, py);
    if ((rc = run_step(cmd, L"Installing Demucs", cache, 0.8, 0.9))) fail_at = L"Demucs";
  }
  if (!rc) {
    _snwprintf(cmd, 2048, L"\"%s\" -u \"%s\\resources\\app\\engine\\stagehand_stems.py\" --prefetch htdemucs_6s", py, S.dest);
    _snwprintf(tmp, MAX_PATH, L"%s\\torch", eng);
    if ((rc = run_step(cmd, L"Downloading the separation model", tmp, 0.9, 1.0))) fail_at = L"the separation model";
  }
  if (rc == -2) set_row(R_STEMS, ST_LATER, L"Skipped. What's downloaded is kept: Stagehand finishes it when you first split a song");
  else if (rc) set_row(R_STEMS, ST_ERR, L"Couldn't install %s. Stagehand can try again when you split a song. (%.90s)", fail_at ? fail_at : L"it", S.last_line[0] ? S.last_line : L"no details");
  else set_row(R_STEMS, ST_DONE, wcscmp(variant, L"cpu") ? L"Ready. Splits songs on your %s" : L"Ready. Splits songs on the processor", S.gpu);
  S.stems_busy = 0;
  update();
}

static DWORD WINAPI install_thread(void *arg) {
  (void)arg;
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  wchar_t path[MAX_PATH], path2[MAX_PATH];
  wcscpy(S.headline, L"Installing…");
  update();

  /* enough room on the drive? Say so now, not halfway through: the downloads, the new
     copy built next to the old one, and room for the stem splitter's first download */
  {
    Part app0 = payload_part(&S.pay, "app/");
    uint64_t need = app0.bytes + 300ull * 1024 * 1024;
    if (S.need_runtime) need += C_ELECTRON.size * 7 / 2;
    if (S.need_decoder) need += C_DECODER.size * 7 / 2;
    wchar_t at[MAX_PATH];
    wcsncpy(at, S.local, MAX_PATH - 1);
    at[MAX_PATH - 1] = 0;
    while (!wexists(at)) {
      wchar_t *cut = wcsrchr(at, L'\\');
      if (!cut) break;
      *cut = 0;
    }
    ULARGE_INTEGER avail;
    if (GetDiskFreeSpaceExW(at, &avail, NULL, NULL) && avail.QuadPart < need) {
      wchar_t msg[300];
      _snwprintf(msg, 300, L"Not enough free space: Stagehand needs about %llu MB on this drive and %llu MB are free. Free some space, then press Install again.",
                 (unsigned long long)(need >> 20), (unsigned long long)(avail.QuadPart >> 20));
      msg[299] = 0;
      fail(msg);
      CoUninitialize();
      return 0;
    }
  }

  /* 4.0.1: first fetch what this PC doesn't have yet (Stagehand can stay open meanwhile;
     nothing is changed until everything is here and checked) */
  wchar_t rt_zip[MAX_PATH] = L"", dec_zip[MAX_PATH] = L"";
  S.downloading = 1;
  if (S.need_runtime) {
    wcscpy(S.headline, L"Downloading the app runtime (one time only)…");
    update();
    if (!fetch(&C_ELECTRON, R_RUNTIME, rt_zip)) {
      S.downloading = 0;
      set_row(R_RUNTIME, S.cancel ? ST_LATER : ST_ERR, S.cancel ? L"Stopped. What's downloaded is kept for next time" : L"Couldn't download");
      fail(NULL);
      CoUninitialize();
      return 0;
    }
    set_row(R_RUNTIME, ST_BUSY, L"Downloaded and checked");
  }
  if (S.need_decoder) {
    if (fetch(&C_DECODER, R_DECODER, dec_zip)) set_row(R_DECODER, ST_BUSY, L"Downloaded and checked");
    else {
      /* not essential: Stagehand offers it again when you play a song */
      S.need_decoder = 0;
      set_row(R_DECODER, ST_ERR, L"Couldn't download. Stagehand offers it again when you play a song");
      S.error[0] = 0;
      if (S.cancel) {
        S.downloading = 0;
        fail(NULL);
        CoUninitialize();
        return 0;
      }
    }
  }
  S.downloading = 0;
  wcscpy(S.headline, L"Installing…");
  update();

  if (running_pid()) {
    wcscpy(S.headline, L"Closing Stagehand…");
    update();
    if (!close_app()) {
      fail(L"Stagehand is still open. Close it, then press Install again.");
      CoUninitialize();
      return 0;
    }
  }
  /* a sound engine left behind by a crash would keep its files locked */
  kill_by_name(L"stagehand-audio.exe");

  Part rt = {0, 0}, app = payload_part(&S.pay, "app/"), dec = {0, 0};
  if (S.need_runtime) {
    Payload z;
    char z8[MAX_PATH * 3];
    to8(rt_zip, z8, sizeof z8);
    if (zipfile_open(&z, z8)) rt = payload_part(&z, ""), payload_close(&z);
  }
  if (S.need_decoder) {
    Payload z;
    char z8[MAX_PATH * 3];
    to8(dec_zip, z8, sizeof z8);
    if (zipfile_open(&z, z8)) dec = payload_part(&z, ""), payload_close(&z);
  }
  P.total = app.bytes + rt.bytes + dec.bytes;
  uint64_t done = 0;
  wchar_t stage[MAX_PATH], appdir[MAX_PATH], icon[MAX_PATH], uninst[MAX_PATH];
  char uninst8[MAX_PATH * 3];

  if (S.need_runtime) {
    /* build the whole program folder next to the old one, then swap it in */
    _snwprintf(stage, MAX_PATH, L"%s.new", S.dest);
    wrmtree(stage);
    P.row = R_RUNTIME;
    P.row_base = done;
    P.row_total = rt.bytes;
    set_row(R_RUNTIME, ST_BUSY, L"Unpacking Electron " WSTR(SH_ELECTRON) L"…");
    if (!unzip_to(rt_zip, stage, &done)) {
      set_row(R_RUNTIME, ST_ERR, L"Couldn't unpack");
      fail(NULL);
      CoUninitialize();
      return 0;
    }
    wjoin(path, stage, L"electron.exe");
    wjoin(path2, stage, L"Stagehand.exe");
    if (wexists(path) && !wrename(path, path2)) {
      fail(L"Couldn't name the program Stagehand.exe. An antivirus may be holding it: try again in a minute.");
      CoUninitialize();
      return 0;
    }
    wjoin(path, stage, L"resources\\default_app.asar");
    DeleteFileW(path);
    /* only the English language file for Electron's own menus (Stagehand is in English) */
    {
      WIN32_FIND_DATAW fd;
      wchar_t pat[MAX_PATH];
      _snwprintf(pat, MAX_PATH, L"%s\\locales\\*.pak", stage);
      HANDLE fh = FindFirstFileW(pat, &fd);
      if (fh != INVALID_HANDLE_VALUE) {
        do {
          if (_wcsicmp(fd.cFileName, L"en-US.pak")) {
            _snwprintf(path, MAX_PATH, L"%s\\locales\\%s", stage, fd.cFileName);
            DeleteFileW(path);
          }
        } while (FindNextFileW(fh, &fd));
        FindClose(fh);
      }
    }
    set_row(R_RUNTIME, ST_DONE, L"Installed (Electron " WSTR(SH_ELECTRON) L")");
  } else {
    wcscpy(stage, S.dest);
  }

  /* Stagehand itself: into resources\app.new, then swapped in */
  _snwprintf(appdir, MAX_PATH, L"%s\\resources\\app.new", stage);
  wrmtree(appdir);
  P.row = R_APP;
  P.row_base = done;
  P.row_total = app.bytes;
  set_row(R_APP, ST_BUSY, L"Copying Stagehand " WSTR(SH_VERSION) L"…");
  if (!extract("app/", appdir, &done)) {
    set_row(R_APP, ST_ERR, L"Couldn't copy the app files");
    fail(NULL);
    CoUninitialize();
    return 0;
  }
  _snwprintf(path, MAX_PATH, L"%s\\resources\\app", stage);
  _snwprintf(path2, MAX_PATH, L"%s\\resources\\app.old", stage);
  wrmtree(path2);
  if (wexists(path) && !wrename(path, path2)) {
    fail(L"Some Stagehand files are in use. Close Stagehand (and its sound engine), then try again.");
    CoUninitialize();
    return 0;
  }
  if (!wrename(appdir, path)) {
    wrename(path2, path);
    fail(L"Couldn't put the new app files in place. Try again in a minute.");
    CoUninitialize();
    return 0;
  }
  wrmtree(path2);

  /* this program without its payload is the uninstaller */
  wjoin(uninst, stage, L"Uninstall Stagehand.exe");
  to8(uninst, uninst8, sizeof uninst8);
  fs_copy_prefix(S.self8, uninst8, S.pay.stub_size);
  wjoin(path, stage, L"electron-version.txt");
  write_utf8(path, SH_ELECTRON "\n");
  wjoin(path, stage, L"uninstall.ps1");
  DeleteFileW(path); /* the old script-based uninstaller */

  if (S.need_runtime) {
    /* swap the new program folder in */
    _snwprintf(path, MAX_PATH, L"%s.old", S.dest);
    wrmtree(path);
    if (wexists(S.dest) && !wrename(S.dest, path)) {
      fail(L"The old Stagehand folder is in use. Close Stagehand (and any window showing that folder), then try again.");
      CoUninitialize();
      return 0;
    }
    if (!wrename(stage, S.dest)) {
      wrename(path, S.dest);
      fail(L"Couldn't put the new program folder in place. Try again in a minute.");
      CoUninitialize();
      return 0;
    }
    wrmtree(path);
    wjoin(uninst, S.dest, L"Uninstall Stagehand.exe");
  }
  if (S.need_runtime) DeleteFileW(rt_zip); /* installed: the download isn't needed any more */
  set_row(R_APP, ST_DONE, L"Installed (" WSTR(SH_VERSION) L")");

  /* the song audio decoder, where Stagehand looks for it */
  if (S.need_decoder) {
    _snwprintf(path, MAX_PATH, L"%s\\Tools\\vgmstream", S.local);
    P.row = R_DECODER;
    P.row_base = done;
    P.row_total = dec.bytes;
    set_row(R_DECODER, ST_BUSY, L"Unpacking…");
    if (unzip_to(dec_zip, path, &done)) {
      set_row(R_DECODER, ST_DONE, L"Installed");
      DeleteFileW(dec_zip);
    }
    else set_row(R_DECODER, ST_ERR, L"Couldn't install. Stagehand offers it again when you play a song");
  }

  /* shortcuts */
  wchar_t exe[MAX_PATH], programs[MAX_PATH], desktop[MAX_PATH];
  wjoin(exe, S.dest, L"Stagehand.exe");
  _snwprintf(icon, MAX_PATH, L"%s\\resources\\app\\build\\icon.ico", S.dest);
  known(&FOLDERID_Programs, programs);
  known(&FOLDERID_Desktop, desktop);
  if (programs[0]) {
    wjoin(path, programs, L"Stagehand.lnk");
    make_link(path, exe, NULL, S.dest, icon, L"Rocksmith library, player and note highway");
    wjoin(path, programs, L"Uninstall Stagehand.lnk");
    make_link(path, uninst, NULL, S.dest, NULL, L"Remove Stagehand");
  }
  if (desktop[0]) {
    wjoin(path, desktop, L"Stagehand.lnk");
    if (S.desktop) make_link(path, exe, NULL, S.dest, icon, L"Rocksmith library, player and note highway");
    else DeleteFileW(path);
  }

  /* Settings > Apps */
  HKEY k;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Stagehand", 0, NULL, 0, KEY_WRITE, NULL, &k, NULL) == ERROR_SUCCESS) {
    wchar_t cmd[MAX_PATH + 16];
    reg_set(k, L"DisplayName", L"Stagehand");
    reg_set(k, L"DisplayVersion", WSTR(SH_VERSION));
    reg_set(k, L"Publisher", L"Noisewater Labs");
    reg_set(k, L"DisplayIcon", icon);
    reg_set(k, L"InstallLocation", S.dest);
    _snwprintf(cmd, MAX_PATH + 16, L"\"%s\"", uninst);
    reg_set(k, L"UninstallString", cmd);
    _snwprintf(cmd, MAX_PATH + 16, L"\"%s\" /quiet", uninst);
    reg_set(k, L"QuietUninstallString", cmd);
    reg_dw(k, L"NoModify", 1);
    reg_dw(k, L"NoRepair", 1);
    reg_dw(k, L"EstimatedSize", (DWORD)(((rt.bytes ? rt.bytes : 330ull * 1048576) + app.bytes) / 1024));
    RegCloseKey(k);
  }

  S.total = 1;
  if (S.stems_now && !S.stems_found) {
    wcscpy(S.headline, L"Stagehand is installed. Setting up the stem splitter…");
    update();
    install_stems();
  }
  S.finished = 1;
  wcscpy(S.headline, S.installed_ver[0] && wcscmp(S.installed_ver, WSTR(SH_VERSION)) ? L"Stagehand is updated to " WSTR(SH_VERSION) : L"Stagehand is installed");
  update();
  CoUninitialize();
  return 0;
}

static DWORD WINAPI uninstall_thread(void *arg) {
  (void)arg;
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  wchar_t path[MAX_PATH], programs[MAX_PATH], desktop[MAX_PATH];
  wcscpy(S.headline, L"Removing Stagehand…");
  update();
  if (running_pid() && !close_app()) {
    wcscpy(S.error, L"Stagehand is still open. Close it, then try again.");
    S.finished = 2;
    wcscpy(S.headline, L"Couldn't remove Stagehand");
    update();
    CoUninitialize();
    return 0;
  }
  kill_by_name(L"stagehand-audio.exe");
  set_row(R_APP, ST_BUSY, L"Removing…");
  known(&FOLDERID_Programs, programs);
  known(&FOLDERID_Desktop, desktop);
  if (programs[0]) {
    wjoin(path, programs, L"Stagehand.lnk");
    DeleteFileW(path);
    wjoin(path, programs, L"Uninstall Stagehand.lnk");
    DeleteFileW(path);
  }
  if (desktop[0]) {
    wjoin(path, desktop, L"Stagehand.lnk");
    DeleteFileW(path);
  }
  RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Stagehand");
  int ok = wrmtree(S.dest);
  _snwprintf(path, MAX_PATH, L"%s.new", S.dest);
  wrmtree(path);
  _snwprintf(path, MAX_PATH, L"%s.old", S.dest);
  wrmtree(path);
  set_row(R_APP, ok ? ST_DONE : ST_ERR, ok ? L"Removed" : L"Removed, but a few files were in use. Restart your PC and delete %s", S.dest);
  if (S.del_data) {
    set_row(R_DATA, ST_BUSY, L"Deleting…");
    wrmtree(S.local);
    wrmtree(S.roaming);
    set_row(R_DATA, ST_DONE, L"Deleted. Your .psarc song files were not touched");
  } else set_row(R_DATA, ST_HAVE, L"Kept. Reinstall any time and everything is still there");
  S.total = 1;
  S.finished = 1;
  wcscpy(S.headline, L"Stagehand has been removed");
  update();
  CoUninitialize();
  return 0;
}

/* ------------------------------------------------------------- drawing -- */
static void fill(HDC dc, RECT r, COLORREF c) {
  HBRUSH b = CreateSolidBrush(c);
  FillRect(dc, &r, b);
  DeleteObject(b);
}
static void round_rect(HDC dc, RECT r, int rad, COLORREF fillc, COLORREF edge) {
  HBRUSH b = CreateSolidBrush(fillc);
  HPEN p = CreatePen(PS_SOLID, 1, edge);
  HGDIOBJ ob = SelectObject(dc, b), op = SelectObject(dc, p);
  RoundRect(dc, r.left, r.top, r.right, r.bottom, rad, rad);
  SelectObject(dc, ob);
  SelectObject(dc, op);
  DeleteObject(b);
  DeleteObject(p);
}
static void text(HDC dc, HFONT f, COLORREF c, RECT r, const wchar_t *s, UINT fmt) {
  SelectObject(dc, f);
  SetTextColor(dc, c);
  DrawTextW(dc, s, -1, &r, fmt | DT_NOPREFIX);
}

/* A status badge: a coloured disc with a glyph (Segoe MDL2 Assets). */
/* A pen-drawn symbol inside a badge (no icon font needed). */
static void glyph(HDC dc, int cx, int cy, int r, int state, COLORREF ink) {
  HPEN pen = CreatePen(PS_SOLID, px(2) + (r > px(10) ? 1 : 0), ink);
  HGDIOBJ op = SelectObject(dc, pen);
  HGDIOBJ ob = SelectObject(dc, GetStockObject(NULL_BRUSH));
  int k = r * 45 / 100;
  switch (state) {
  case ST_HAVE:
  case ST_DONE: { POINT p[3] = {{cx - k, cy}, {cx - k / 3, cy + k * 2 / 3}, {cx + k, cy - k * 2 / 3}}; Polyline(dc, p, 3); break; }
  case ST_WILL: { POINT a[2] = {{cx, cy - k}, {cx, cy + k}}; POINT h[3] = {{cx - k * 2 / 3, cy + k / 4}, {cx, cy + k}, {cx + k * 2 / 3, cy + k / 4}}; Polyline(dc, a, 2); Polyline(dc, h, 3); break; }
  case ST_BUSY: { int a0 = (S.anim * 12) % 360; double t0 = a0 * 3.14159 / 180; Arc(dc, cx - k, cy - k, cx + k, cy + k, cx + (int)(k * cos(t0)), cy + (int)(k * sin(t0)), cx + (int)(k * cos(t0 + 1.6)), cy + (int)(k * sin(t0 + 1.6))); break; }
  case ST_LATER: { MoveToEx(dc, cx, cy - k / 6, NULL); LineTo(dc, cx, cy + k); MoveToEx(dc, cx, cy - k * 2 / 3, NULL); LineTo(dc, cx, cy - k * 2 / 3 + 1); break; }
  case ST_SKIP: { MoveToEx(dc, cx - k, cy, NULL); LineTo(dc, cx + k, cy); break; }
  case ST_ERR: { MoveToEx(dc, cx - k * 3 / 4, cy - k * 3 / 4, NULL); LineTo(dc, cx + k * 3 / 4, cy + k * 3 / 4); MoveToEx(dc, cx + k * 3 / 4, cy - k * 3 / 4, NULL); LineTo(dc, cx - k * 3 / 4, cy + k * 3 / 4); break; }
  default: { for (int i = -1; i <= 1; i++) { int d = (S.anim / 6 + i + 3) % 3 == 0 ? px(2) : px(1); Ellipse(dc, cx + i * k - d, cy - d, cx + i * k + d, cy + d); } }
  }
  SelectObject(dc, op);
  SelectObject(dc, ob);
  DeleteObject(pen);
}

/* A status badge: a coloured disc with a soft ring and a symbol. */
static void badge(HDC dc, int cx, int cy, int state) {
  int r = px(13);
  COLORREF c = C_GREY;
  switch (state) {
  case ST_HAVE: case ST_DONE: c = C_GREEN; break;
  case ST_WILL: case ST_BUSY: c = C_GOLD; break;
  case ST_LATER: c = C_BLUE; break;
  case ST_ERR: c = C_RED; break;
  default: c = C_GREY;
  }
  RECT gr = {cx - r - px(3), cy - r - px(3), cx + r + px(3), cy + r + px(3)};
  COLORREF glow = RGB((GetRValue(c) + 2 * GetRValue(C_PANEL)) / 3, (GetGValue(c) + 2 * GetGValue(C_PANEL)) / 3, (GetBValue(c) + 2 * GetBValue(C_PANEL)) / 3);
  HBRUSH b = CreateSolidBrush(glow);
  HGDIOBJ ob = SelectObject(dc, b), op = SelectObject(dc, GetStockObject(NULL_PEN));
  if (state == ST_BUSY || state == ST_CHECK) {
    int k = (S.anim % 30);
    int grow = px(3) * (k < 15 ? k : 30 - k) / 15;
    InflateRect(&gr, grow, grow);
  }
  Ellipse(dc, gr.left, gr.top, gr.right, gr.bottom);
  SelectObject(dc, ob);
  DeleteObject(b);
  b = CreateSolidBrush(c);
  SelectObject(dc, b);
  Ellipse(dc, cx - r, cy - r, cx + r, cy + r);
  SelectObject(dc, ob);
  SelectObject(dc, op);
  DeleteObject(b);
  glyph(dc, cx, cy, r, state, RGB(14, 16, 22));
}

static void vgrad(HDC dc, RECT r, COLORREF top, COLORREF bot);
/* 4.16.3: the app's buttons: cream paper for the main one, a dark worn case for the others,
   each with a hard shadow under it */
static void button(HDC dc, RECT r, const wchar_t *label, int primary, int hover, int enabled) {
  RECT s = r;
  OffsetRect(&s, 0, px(2));
  fill(dc, s, RGB(0, 0, 0));
  if (primary && !enabled) {
    round_rect(dc, r, px(3), RGB(70, 63, 52), RGB(90, 82, 68));
    text(dc, S.f_btn, RGB(140, 130, 112), r, label, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    return;
  }
  if (primary && hover) OffsetRect(&r, 0, -px(1));
  RECT in = r;
  InflateRect(&in, -1, -1);
  if (primary) {
    fill(dc, r, RGB(138, 125, 99));
    vgrad(dc, in, hover ? RGB(246, 238, 218) : RGB(236, 226, 203), hover ? RGB(226, 214, 186) : RGB(214, 201, 170));
    RECT hi = {in.left, in.top, in.right, in.top + 1};
    fill(dc, hi, RGB(250, 246, 236));
  } else {
    fill(dc, r, hover ? RGB(106, 95, 82) : RGB(61, 54, 48));
    vgrad(dc, in, hover ? RGB(46, 41, 36) : RGB(38, 34, 30), hover ? RGB(32, 28, 24) : RGB(26, 23, 20));
  }
  text(dc, S.f_btn, primary ? RGB(29, 24, 20) : C_TEXT, r, label, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
}

/* ------------------------------------------------------------ the header (4.16.3) --
   A picture cut from the app's own page banner (make-art.js / make-art.py): the kraft-paper flyer, the
   poster type, the highlighter, a character, on the rehearsal-room wall. Packed as premultiplied BGRA,
   zlib; unpacked here and resized once for the window's size (an area average, so text stays crisp). */
static HBITMAP art_make(int id, int ow, int oh) {
  HRSRC r = FindResourceW(S.inst, MAKEINTRESOURCEW(id), RT_RCDATA);
  if (!r) return NULL;
  HGLOBAL g = LoadResource(S.inst, r);
  const unsigned char *d = g ? (const unsigned char *)LockResource(g) : NULL;
  DWORD n = SizeofResource(S.inst, r);
  if (!d || n < 12 || memcmp(d, "SHI1", 4)) return NULL;
  int iw = d[4] | d[5] << 8 | d[6] << 16 | d[7] << 24;
  int ih = d[8] | d[9] << 8 | d[10] << 16 | d[11] << 24;
  size_t got = 0;
  unsigned char *src = (unsigned char *)tinfl_decompress_mem_to_heap(d + 12, n - 12, &got, TINFL_FLAG_PARSE_ZLIB_HEADER);
  if (!src || got != (size_t)iw * ih * 4 || ow < 1 || oh < 1) {
    free(src);
    return NULL;
  }
  BITMAPINFO bi;
  memset(&bi, 0, sizeof bi);
  bi.bmiHeader.biSize = sizeof bi.bmiHeader;
  bi.bmiHeader.biWidth = ow;
  bi.bmiHeader.biHeight = -oh; /* top-down */
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;
  unsigned char *dst = NULL;
  HBITMAP bmp = CreateDIBSection(NULL, &bi, DIB_RGB_COLORS, (void **)&dst, NULL, 0);
  if (!bmp || !dst) {
    free(src);
    return NULL;
  }
  /* each output pixel is the average of the source area it covers (fractions at the edges) */
  double sx = (double)iw / ow, sy = (double)ih / oh;
  for (int y = 0; y < oh; y++) {
    double y0 = y * sy, y1 = y0 + (sy < 1 ? 1 : sy);
    if (y1 > ih) y1 = ih;
    for (int x = 0; x < ow; x++) {
      double x0 = x * sx, x1 = x0 + (sx < 1 ? 1 : sx);
      if (x1 > iw) x1 = iw;
      double acc[4] = {0, 0, 0, 0}, wsum = 0;
      for (int yy = (int)y0; yy < (int)ceil(y1); yy++) {
        double wy = (yy + 1 < y1 ? yy + 1 : y1) - (yy > y0 ? yy : y0);
        if (wy <= 0) continue;
        const unsigned char *row = src + (size_t)yy * iw * 4;
        for (int xx = (int)x0; xx < (int)ceil(x1); xx++) {
          double wx = (xx + 1 < x1 ? xx + 1 : x1) - (xx > x0 ? xx : x0);
          if (wx <= 0) continue;
          double wgt = wx * wy;
          const unsigned char *p = row + xx * 4;
          acc[0] += p[0] * wgt;
          acc[1] += p[1] * wgt;
          acc[2] += p[2] * wgt;
          acc[3] += p[3] * wgt;
          wsum += wgt;
        }
      }
      unsigned char *q = dst + ((size_t)y * ow + x) * 4;
      for (int k = 0; k < 4; k++) q[k] = (unsigned char)(wsum > 0 ? acc[k] / wsum + 0.5 : 0);
    }
  }
  free(src);
  return bmp;
}
static void draw_art(HDC dc, int x, int y, int w, int h) {
  if (!S.art || S.art_w != w || S.art_h != h) {
    if (S.art) DeleteObject(S.art);
    S.art = art_make(S.uninstall ? 21 : 20, w, h);
    S.art_w = w;
    S.art_h = h;
  }
  if (!S.art) return;
  HDC m = CreateCompatibleDC(dc);
  HGDIOBJ o = SelectObject(m, S.art);
  BLENDFUNCTION bf = {AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  AlphaBlend(dc, x, y, w, h, m, 0, 0, w, h, bf);
  SelectObject(m, o);
  DeleteDC(m);
}
/* the rehearsal-room wall behind everything: dark bricks, as on the app's pages */
static void draw_wall(HDC dc, RECT cr) {
  fill(dc, cr, RGB(14, 13, 14));
  int bw = px(88), bh = px(42), gw = px(92), gh = px(46);
  static const COLORREF shade[3] = {RGB(23, 21, 23), RGB(20, 18, 20), RGB(22, 20, 22)};
  HGDIOBJ op = SelectObject(dc, GetStockObject(NULL_PEN));
  for (int row = 0, y = px(2); y < cr.bottom; row++, y += gh) {
    int off = (row & 1) ? -gw / 2 : 0;
    for (int col = 0, x = off + px(2); x < cr.right; col++, x += gw) {
      HBRUSH b = CreateSolidBrush(shade[(row + col) % 3]);
      HGDIOBJ ob = SelectObject(dc, b);
      RoundRect(dc, x, y, x + bw, y + bh, px(4), px(4));
      SelectObject(dc, ob);
      DeleteObject(b);
    }
  }
  SelectObject(dc, op);
}
/* a vertical two-colour fill (the app's buttons) */
static void vgrad(HDC dc, RECT r, COLORREF top, COLORREF bot) {
  TRIVERTEX v[2] = {{r.left, r.top, (COLOR16)(GetRValue(top) << 8), (COLOR16)(GetGValue(top) << 8), (COLOR16)(GetBValue(top) << 8), 0xff00},
                    {r.right, r.bottom, (COLOR16)(GetRValue(bot) << 8), (COLOR16)(GetGValue(bot) << 8), (COLOR16)(GetBValue(bot) << 8), 0xff00}};
  GRADIENT_RECT gr = {0, 1};
  GradientFill(dc, v, 2, &gr, 1, GRADIENT_FILL_RECT_V);
}
/* something drawn turned a little (a sticker, a strip of tape): turn the page, draw, turn it back */
static void tilt(HDC dc, double deg, int cx, int cy) {
  SetGraphicsMode(dc, GM_ADVANCED);
  double a = deg * 3.14159265 / 180;
  XFORM x = {(FLOAT)cos(a), (FLOAT)sin(a), (FLOAT)-sin(a), (FLOAT)cos(a), 0, 0};
  x.eDx = (FLOAT)(cx - cx * x.eM11 - cy * x.eM21);
  x.eDy = (FLOAT)(cy - cx * x.eM12 - cy * x.eM22);
  SetWorldTransform(dc, &x);
}
static void untilt(HDC dc) {
  ModifyWorldTransform(dc, NULL, MWT_IDENTITY);
}
/* a turned rectangle (w×h around cx,cy), filled: drawn as a polygon so it turns everywhere */
static void tilted_rect(HDC dc, int cx, int cy, int w, int h, double deg, COLORREF c) {
  double a = deg * 3.14159265 / 180, ca = cos(a), sa = sin(a);
  double hx = w / 2.0, hy = h / 2.0;
  double pts[4][2] = {{-hx, -hy}, {hx, -hy}, {hx, hy}, {-hx, hy}};
  POINT p[4];
  for (int i = 0; i < 4; i++) {
    p[i].x = (LONG)lround(cx + pts[i][0] * ca - pts[i][1] * sa);
    p[i].y = (LONG)lround(cy + pts[i][0] * sa + pts[i][1] * ca);
  }
  HBRUSH b = CreateSolidBrush(c);
  HGDIOBJ ob = SelectObject(dc, b), op = SelectObject(dc, GetStockObject(NULL_PEN));
  Polygon(dc, p, 4);
  SelectObject(dc, ob);
  SelectObject(dc, op);
  DeleteObject(b);
}

static const wchar_t *main_label(void) {
  if (S.finished == 1) return S.uninstall ? L"Close" : L"Open Stagehand";
  if (S.finished == 2) return S.uninstall ? L"Try again" : L"Try again";
  if (S.uninstall) return L"Uninstall";
  if (S.app_open) return L"Close Stagehand and install";
  return S.installed_ver[0] ? L"Update" : L"Install";
}

static void paint(HDC dc, RECT cr) {
  int W = cr.right, H = cr.bottom;
  fill(dc, cr, C_BG);
  SetBkMode(dc, TRANSPARENT);
  int m = px(28);
  /* 4.16.3: the app's rehearsal-room look: the wall, and the page banner cut from the app itself */
  draw_wall(dc, cr);
  int hh = px(172);
  draw_art(dc, 0, 0, W, hh);
  RECT r = {m, 0, W - m, 0};
  if (!S.uninstall) {
    /* the version on a sticker slapped on the wall beside the flyer (what you have -> what this installs) */
    wchar_t vp[96];
    if (S.checked && S.installed_ver[0])
      _snwprintf(vp, 96, wcscmp(S.installed_ver, WSTR(SH_VERSION)) ? L"%s  \x2192  " WSTR(SH_VERSION) : L"%s INSTALLED", S.installed_ver);
    else
      _snwprintf(vp, 96, L"V" WSTR(SH_VERSION));
    SelectObject(dc, S.f_sticker);
    SIZE sz;
    GetTextExtentPoint32W(dc, vp, (int)wcslen(vp), &sz);
    int cx = px(500), cy = px(54);
    int sw = sz.cx + px(36), sh2 = px(40);
    tilted_rect(dc, cx + px(3), cy + px(4), sw, sh2, -3, RGB(0, 0, 0));
    tilted_rect(dc, cx, cy, sw, sh2, -3, RGB(233, 223, 200));
    tilted_rect(dc, cx, cy, sw - px(5), sh2 - px(5), -3, RGB(21, 19, 17));
    tilt(dc, -3, cx, cy);
    RECT pr = {cx - sw / 2, cy - sh2 / 2, cx + sw / 2, cy + sh2 / 2};
    text(dc, S.f_sticker, RGB(236, 228, 210), pr, vp, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    untilt(dc);
  }
  r.top = hh + px(12);
  r.bottom = hh + px(36);
  EnterCriticalSection(&S.cs);
  const wchar_t *sub = S.headline[0] ? S.headline : (S.checked ? (S.uninstall ? L"Here’s what will happen" : L"Here’s what’s already on your PC, and what gets installed") : L"Checking your PC…");
  text(dc, S.f_body, S.finished == 2 ? C_RED : S.finished == 1 ? C_GREEN : C_DIM, r, sub, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

  /* rows */
  static const int order_install[] = {R_APP, R_RUNTIME, R_DECODER, R_VCRT, R_STEMS, R_DATA};
  static const int order_uninstall[] = {R_APP, R_DATA};
  const int *order = S.uninstall ? order_uninstall : order_install;
  int nr = S.uninstall ? 2 : 6;
  int y = hh + px(44), rh = px(54);
  RECT panel = {m, y, W - m, y + rh * nr + px(8)};
  {
    RECT ps = panel;
    OffsetRect(&ps, px(3), px(4));
    fill(dc, ps, RGB(0, 0, 0)); /* the hard shadow the app's cards have */
  }
  round_rect(dc, panel, px(4), RGB(26, 23, 20), RGB(47, 42, 37));
  {
    /* a strip of masking tape holding the card to the wall */
    int tx = panel.left + px(10), ty = panel.top + px(12);
    tilted_rect(dc, tx, ty, px(58), px(18), -38, RGB(214, 205, 182));
  }
  for (int i = 0; i < nr; i++) {
    Row *row = &S.rows[order[i]];
    int ry = y + px(4) + i * rh;
    if (i) {
      /* a dashed rule between rows, like the app's menu */
      HPEN dp = CreatePen(PS_DOT, 1, C_LINE);
      HGDIOBJ op = SelectObject(dc, dp);
      SetBkMode(dc, TRANSPARENT);
      MoveToEx(dc, m + px(16), ry, NULL);
      LineTo(dc, W - m - px(16), ry);
      SelectObject(dc, op);
      DeleteObject(dp);
    }
    badge(dc, m + px(34), ry + rh / 2, row->state);
    if (order[i] == R_STEMS) S.b_stems = (RECT){m, ry, W - m, ry + rh};
    RECT t = {m + px(62), ry + px(7), W - m - px(16), ry + px(29)};
    text(dc, S.f_body, C_TEXT, t, row->title, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
    t.top = ry + px(28);
    t.bottom = ry + rh - px(6);
    COLORREF nc = row->state == ST_HAVE || row->state == ST_DONE ? RGB(150, 214, 170) : row->state == ST_ERR ? C_RED : row->state == ST_LATER ? RGB(150, 225, 238) : C_DIM;
    text(dc, S.f_small, nc, t, row->note, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
    if (row->state == ST_BUSY) {
      RECT bar = {m + px(62), ry + rh - px(7), W - m - px(16), ry + rh - px(4)};
      fill(dc, bar, C_LINE);
      double p = row->prog < 0 ? 0 : row->prog > 1 ? 1 : row->prog;
      bar.right = bar.left + (LONG)((bar.right - bar.left) * p);
      fill(dc, bar, C_GOLD);
    }
  }
  y = panel.bottom + px(16);

  /* overall progress, or the error */
  if (S.running || S.finished == 1) {
    RECT bar = {m, y, W - m, y + px(8)};
    round_rect(dc, bar, px(2), C_LINE, C_LINE);
    double p = S.total < 0 ? 0 : S.total > 1 ? 1 : S.total;
    if (p > 0.004) {
      bar.right = bar.left + (LONG)((bar.right - bar.left) * p);
      if (bar.right - bar.left < px(8)) bar.right = bar.left + px(8);
      round_rect(dc, bar, px(2), S.finished == 1 ? C_GREEN : C_GOLD, S.finished == 1 ? C_GREEN : C_GOLD);
    }
  } else if (S.finished == 2 && S.error[0]) {
    RECT er = {m, y - px(4), W - m, y + px(34)};
    text(dc, S.f_small, C_RED, er, S.error, DT_LEFT | DT_WORDBREAK);
  }
  LeaveCriticalSection(&S.cs);

  /* bottom: option checkbox on the left, buttons on the right */
  int by = H - px(68), bh = px(42);
  int bw = px(S.app_open && !S.finished ? 250 : 170);
  S.b_main = (RECT){W - m - bw, by, W - m, by + bh};
  button(dc, S.b_main, main_label(), 1, S.hover == 1, S.checked && !S.running);
  S.b_alt = (RECT){S.b_main.left - px(12) - px(110), by, S.b_main.left - px(12), by + bh};
  if (S.running && S.stems_busy) button(dc, S.b_alt, L"Skip", 0, S.hover == 2, 1);
  else if (!S.running && S.finished != 1) button(dc, S.b_alt, L"Cancel", 0, S.hover == 2, 1);
  else if (S.finished == 1 && !S.uninstall) button(dc, S.b_alt, L"Close", 0, S.hover == 2, 1);
  else S.b_alt = (RECT){0, 0, 0, 0};
  if (!S.running && !S.finished) {
    int on = S.uninstall ? S.del_data : S.desktop;
    S.b_check = (RECT){m, by + px(8), m + px(300), by + bh - px(8)};
    RECT box = {m, by + bh / 2 - px(10), m + px(20), by + bh / 2 + px(10)};
    round_rect(dc, box, px(3), on ? (S.uninstall ? C_RED : RGB(228, 216, 188)) : RGB(26, 23, 20), on ? (S.uninstall ? C_RED : RGB(138, 125, 99)) : C_DIM);
    if (on) glyph(dc, (box.left + box.right) / 2, (box.top + box.bottom) / 2, px(11), ST_DONE, RGB(12, 14, 20));
    RECT lt = {m + px(30), by, m + px(330), by + bh};
    text(dc, S.f_body, S.hover == 3 ? C_TEXT : C_DIM, lt, S.uninstall ? L"Also delete my library data and stems" : L"Desktop shortcut", DT_LEFT | DT_VCENTER | DT_SINGLELINE);
  } else S.b_check = (RECT){0, 0, 0, 0};
}

/* ------------------------------------------------------------- actions -- */
static void start_work(void) {
  if (S.running || !S.checked) return;
  S.running = 1;
  S.finished = 0;
  S.error[0] = 0;
  S.total = 0;
  CreateThread(NULL, 0, S.uninstall ? uninstall_thread : install_thread, NULL, 0, NULL);
  SetTimer(S.hwnd, 1, 33, NULL);
}

static void launch_app(void) {
  wchar_t exe[MAX_PATH];
  wjoin(exe, S.dest, L"Stagehand.exe");
  ShellExecuteW(NULL, L"open", exe, NULL, S.dest, SW_SHOWNORMAL);
}

static void on_main(void) {
  if (S.running || !S.checked) return;
  if (S.finished == 1) {
    if (!S.uninstall) launch_app();
    DestroyWindow(S.hwnd);
    return;
  }
  start_work();
}

static int hit(RECT r, int x, int y) { return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }

static LRESULT CALLBACK wndproc(HWND w, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
  case WM_PAINT: {
    PAINTSTRUCT ps;
    HDC dc = BeginPaint(w, &ps);
    RECT cr;
    GetClientRect(w, &cr);
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, cr.right, cr.bottom);
    HGDIOBJ old = SelectObject(mem, bmp);
    paint(mem, cr);
    BitBlt(dc, 0, 0, cr.right, cr.bottom, mem, 0, 0, SRCCOPY);
    SelectObject(mem, old);
    DeleteObject(bmp);
    DeleteDC(mem);
    EndPaint(w, &ps);
    return 0;
  }
  case WM_ERASEBKGND:
    return 1;
  case WM_APP_UPDATE:
    if (S.finished && S.running) {
      S.running = 0;
      KillTimer(w, 1);
      /* updated from inside Stagehand: show "updated" for a moment, then open it again */
      if (S.finished == 1 && S.reopen && !S.uninstall) SetTimer(w, 2, 1500, NULL);
    }
    if (!S.checked || S.running) SetTimer(w, 1, 33, NULL);
    else KillTimer(w, 1);
    InvalidateRect(w, NULL, FALSE);
    return 0;
  case WM_TIMER:
    if (wp == 2) {
      KillTimer(w, 2);
      launch_app();
      DestroyWindow(w);
      return 0;
    }
    S.anim++;
    InvalidateRect(w, NULL, FALSE);
    return 0;
  case WM_MOUSEMOVE: {
    int x = GET_X_LPARAM(lp), y = GET_Y_LPARAM(lp);
    int hv = hit(S.b_main, x, y) ? 1 : hit(S.b_alt, x, y) ? 2 : hit(S.b_check, x, y) ? 3 : (!S.uninstall && S.checked && !S.running && !S.finished && !S.stems_found && hit(S.b_stems, x, y)) ? 4 : 0;
    if (hv != S.hover) {
      S.hover = hv;
      InvalidateRect(w, NULL, FALSE);
    }
    TRACKMOUSEEVENT t = {sizeof t, TME_LEAVE, w, 0};
    TrackMouseEvent(&t);
    SetCursor(LoadCursorW(NULL, hv ? IDC_HAND : IDC_ARROW));
    return 0;
  }
  case WM_MOUSELEAVE:
    S.hover = 0;
    InvalidateRect(w, NULL, FALSE);
    return 0;
  case WM_SETCURSOR:
    if (LOWORD(lp) == HTCLIENT && S.hover) {
      SetCursor(LoadCursorW(NULL, IDC_HAND));
      return TRUE;
    }
    break;
  case WM_LBUTTONUP: {
    int x = GET_X_LPARAM(lp), y = GET_Y_LPARAM(lp);
    if (hit(S.b_main, x, y)) on_main();
    else if (hit(S.b_alt, x, y) && S.running && S.stems_busy) {
      S.stems_skip = 1;
      if (S.child) TerminateProcess(S.child, 1);
    } else if (hit(S.b_alt, x, y) && !S.running) DestroyWindow(w);
    else if (!S.uninstall && S.checked && !S.running && !S.finished && !S.stems_found && hit(S.b_stems, x, y)) {
      S.stems_now = !S.stems_now;
      stems_note();
    }
    else if (hit(S.b_check, x, y) && !S.running && !S.finished) {
      if (S.uninstall) {
        S.del_data = !S.del_data;
        set_row(R_DATA, S.del_data ? ST_WILL : ST_HAVE, S.del_data ? L"Will be deleted: library data, settings, stems, tones, the stem splitter. Your .psarc files stay" : L"Kept: your library, settings, stems, tones and the stem splitter");
        if (S.del_data) S.rows[R_DATA].state = ST_ERR;
      } else S.desktop = !S.desktop;
      InvalidateRect(w, NULL, FALSE);
    }
    return 0;
  }
  case WM_KEYDOWN:
    if (wp == VK_RETURN) on_main();
    else if (wp == VK_ESCAPE && !S.running) DestroyWindow(w);
    return 0;
  case WM_CLOSE:
    if (S.running && S.downloading) {
      /* nothing is installed yet: stopping is safe, and what's downloaded is kept */
      if (MessageBoxW(w, L"Stop downloading? What's downloaded so far is kept: run Setup again and it carries on from there.", L"Stagehand Setup", MB_YESNO | MB_ICONQUESTION) != IDYES) return 0;
      InterlockedExchange(&S.cancel, 1);
      DestroyWindow(w);
      return 0;
    }
    if (S.running) return 0; /* never leave a half-copied install */
    DestroyWindow(w);
    return 0;
  case WM_DPICHANGED: {
    S.dpi = HIWORD(wp);
    RECT *nr = (RECT *)lp;
    SetWindowPos(w, NULL, nr->left, nr->top, nr->right - nr->left, nr->bottom - nr->top, SWP_NOZORDER);
    return 0;
  }
  case WM_DESTROY:
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(w, msg, wp, lp);
}

static HFONT font(const wchar_t *face, int size, int weight) {
  return CreateFontW(-px(size), 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, face);
}

/* 4.14: the app's own fonts ride inside Setup (fonts/, made by make-fonts.py) */
static int load_font(int id) {
  HRSRC r = FindResourceW(S.inst, MAKEINTRESOURCEW(id), RT_RCDATA);
  if (!r) return 0;
  HGLOBAL g = LoadResource(S.inst, r);
  void *data = g ? LockResource(g) : NULL;
  DWORD n = 0;
  return data && AddFontMemResourceEx(data, SizeofResource(S.inst, r), NULL, &n) && n;
}

static void make_fonts(void) {
  S.own_fonts = load_font(10) && load_font(11) && load_font(12) && load_font(13);
  if (S.own_fonts) {
    S.f_title = font(L"SH Display", 38, 900);
    S.f_body = font(L"SH Text", 15, 600);
    S.f_small = font(L"SH Text", 13, 600);
    S.f_btn = font(L"SH Text Bold", 14, 800);
    S.f_mono = font(L"SH Mono", 11, FW_BOLD);
    S.f_sticker = font(L"SH Mono", 15, FW_BOLD);
  } else {
    S.f_title = font(L"Segoe UI Black", 30, FW_BLACK);
    S.f_body = font(L"Segoe UI", 15, FW_SEMIBOLD);
    S.f_small = font(L"Segoe UI", 13, FW_NORMAL);
    S.f_btn = font(L"Segoe UI", 14, FW_BOLD);
    S.f_mono = font(L"Consolas", 11, FW_BOLD);
    S.f_sticker = font(L"Consolas", 15, FW_BOLD);
  }
  /* Segoe Fluent Icons (Windows 11) or Segoe MDL2 Assets (Windows 10) */
  S.f_icon = font(L"Segoe MDL2 Assets", 13, FW_NORMAL);
}

/* Run the uninstaller from Temp so it can delete the program folder it lives in. */
static int relaunch_from_temp(void) {
  wchar_t tmp[MAX_PATH], copy[MAX_PATH];
  GetTempPathW(MAX_PATH, tmp);
  _snwprintf(copy, MAX_PATH, L"%sStagehand-uninstall-%lu.exe", tmp, GetCurrentProcessId());
  if (!CopyFileW(S.self, copy, FALSE)) return 0;
  wchar_t args[64];
  _snwprintf(args, 64, L"/uninstall /temp%s", S.quiet ? L" /quiet" : L"");
  SHELLEXECUTEINFOW ei;
  memset(&ei, 0, sizeof ei);
  ei.cbSize = sizeof ei;
  ei.lpFile = copy;
  ei.lpParameters = args;
  ei.nShow = SW_SHOWNORMAL;
  return ShellExecuteExW(&ei);
}

static void delete_self_later(void) {
  wchar_t cmd[MAX_PATH * 2];
  _snwprintf(cmd, MAX_PATH * 2, L"cmd.exe /c ping 127.0.0.1 -n 3 > nul & del /f /q \"%s\"", S.self);
  STARTUPINFOW si;
  memset(&si, 0, sizeof si);
  si.cb = sizeof si;
  PROCESS_INFORMATION pi;
  if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
  }
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
  (void)prev;
  (void)show;
  memset(&S, 0, sizeof S);
  S.inst = inst;
  S.desktop = 1;
  InitializeCriticalSection(&S.cs);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  GetModuleFileNameW(NULL, S.self, MAX_PATH);
  to8(S.self, S.self8, sizeof S.self8);
  wchar_t la[MAX_PATH], ad[MAX_PATH];
  GetEnvironmentVariableW(L"LOCALAPPDATA", la, MAX_PATH);
  GetEnvironmentVariableW(L"APPDATA", ad, MAX_PATH);
  _snwprintf(S.dest, MAX_PATH, L"%s\\Programs\\Stagehand", la);
  _snwprintf(S.local, MAX_PATH, L"%s\\Stagehand", la);
  _snwprintf(S.roaming, MAX_PATH, L"%s\\Stagehand", ad);

  S.quiet = wcsstr(cmd, L"/quiet") || wcsstr(cmd, L"/S") != NULL;
  int quiet_stems = wcsstr(cmd, L"/stems") != NULL;
  S.autogo = wcsstr(cmd, L"/go") != NULL;
  S.reopen = wcsstr(cmd, L"/update") != NULL;
  if (S.reopen) S.autogo = 1;
  int from_temp = wcsstr(cmd, L"/temp") != NULL;
  S.has_payload = payload_open(&S.pay, S.self8);
  const wchar_t *base = wcsrchr(S.self, L'\\');
  S.uninstall = wcsstr(cmd, L"/uninstall") || (!S.has_payload && base && (wcsstr(base, L"ninstall") || wcsstr(base, L"NINSTALL")));
  if (!S.uninstall && !S.has_payload) {
    MessageBoxW(NULL, L"This installer is incomplete or damaged. Download Stagehand Setup again.", L"Stagehand Setup", MB_ICONERROR);
    return 1;
  }
  if (S.uninstall && !from_temp && !_wcsnicmp(S.self, S.dest, wcslen(S.dest))) {
    if (relaunch_from_temp()) return 0;
  }

  S.rows[R_APP].title = L"Stagehand";
  S.rows[R_RUNTIME].title = L"App runtime";
  S.rows[R_DECODER].title = L"Song audio decoder";
  S.rows[R_STEMS].title = L"Stem splitter (Python, PyTorch, Demucs)";
  S.rows[R_VCRT].title = L"Microsoft Visual C++ runtime";
  S.rows[R_DATA].title = S.uninstall ? L"Your library data" : L"Your library and settings";
  for (int i = 0; i < NROWS; i++) {
    S.rows[i].state = ST_CHECK;
    wcscpy(S.rows[i].note, L"Checking…");
  }

  if (S.quiet) {
    detect_thread(NULL);
    S.stems_now = quiet_stems;
    if (S.uninstall) uninstall_thread(NULL);
    else install_thread(NULL);
    if (from_temp) delete_self_later();
    return S.finished == 1 ? 0 : 1;
  }

  S.dpi = GetDpiForSystem();
  make_fonts();
  WNDCLASSEXW wc;
  memset(&wc, 0, sizeof wc);
  wc.cbSize = sizeof wc;
  wc.lpfnWndProc = wndproc;
  wc.hInstance = inst;
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  wc.lpszClassName = L"StagehandSetup";
  RegisterClassExW(&wc);
  int ww = px(700), wh = px(S.uninstall ? 440 : 680); /* fits a 768-pixel-tall laptop screen */
  RECT wr = {0, 0, ww, wh};
  DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
  AdjustWindowRectExForDpi(&wr, style, FALSE, 0, S.dpi);
  int sx = (GetSystemMetrics(SM_CXSCREEN) - (wr.right - wr.left)) / 2;
  int sy = (GetSystemMetrics(SM_CYSCREEN) - (wr.bottom - wr.top)) / 2;
  S.hwnd = CreateWindowExW(0, wc.lpszClassName, S.uninstall ? L"Remove Stagehand" : L"Stagehand Setup", style, sx, sy, wr.right - wr.left, wr.bottom - wr.top, NULL, NULL, inst, NULL);
  /* dark title bar on Windows 10 2004+ / 11 */
  BOOL dark = TRUE;
  typedef HRESULT(WINAPI * DwmSet)(HWND, DWORD, LPCVOID, DWORD);
  HMODULE dwm = LoadLibraryW(L"dwmapi.dll");
  if (dwm) {
    DwmSet f = (DwmSet)(void *)GetProcAddress(dwm, "DwmSetWindowAttribute");
    if (f) f(S.hwnd, 20, &dark, sizeof dark);
  }
  ShowWindow(S.hwnd, SW_SHOWNORMAL);
  UpdateWindow(S.hwnd);
  CreateThread(NULL, 0, detect_thread, NULL, 0, NULL);
  SetTimer(S.hwnd, 1, 33, NULL);

  MSG m;
  while (GetMessageW(&m, NULL, 0, 0) > 0) {
    TranslateMessage(&m);
    DispatchMessageW(&m);
  }
  payload_close(&S.pay);
  if (from_temp) delete_self_later();
  return 0;
}
