/* Thin platform layer: threads, sleeping, time, stdio pipes. */
#ifndef SH_PLAT_H
#define SH_PLAT_H

#include <stdint.h>
#include <stddef.h>
#include <stdatomic.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
typedef HANDLE plat_thread;
typedef CRITICAL_SECTION plat_mutex;
static inline int plat_thread_start(plat_thread *t, DWORD(WINAPI *fn)(void *), void *arg) {
  *t = CreateThread(NULL, 0, fn, arg, 0, NULL);
  return *t != NULL;
}
#define PLAT_THREAD_FN(name) DWORD WINAPI name(void *arg)
#define PLAT_THREAD_RET return 0
static inline void plat_thread_join(plat_thread t) {
  WaitForSingleObject(t, INFINITE);
  CloseHandle(t);
}
static inline void plat_mutex_init(plat_mutex *m) { InitializeCriticalSection(m); }
static inline void plat_lock(plat_mutex *m) { EnterCriticalSection(m); }
static inline void plat_unlock(plat_mutex *m) { LeaveCriticalSection(m); }
static inline void plat_sleep_ms(int ms) { Sleep(ms); }
static inline double plat_now(void) {
  static LARGE_INTEGER f;
  LARGE_INTEGER c;
  if (!f.QuadPart) QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&c);
  return (double)c.QuadPart / (double)f.QuadPart;
}
static inline long plat_read_in(void *buf, size_t n) {
  DWORD got = 0;
  if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), buf, (DWORD)n, &got, NULL)) return -1;
  return (long)got;
}
static inline int plat_write_out(const void *buf, size_t n) {
  HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
  const char *p = (const char *)buf;
  while (n) {
    DWORD put = 0;
    if (!WriteFile(h, p, (DWORD)n, &put, NULL) || !put) return 0;
    p += put, n -= put;
  }
  return 1;
}
#else
#include <pthread.h>
#include <time.h>
#include <unistd.h>
typedef pthread_t plat_thread;
typedef pthread_mutex_t plat_mutex;
static inline int plat_thread_start(plat_thread *t, void *(*fn)(void *), void *arg) { return pthread_create(t, NULL, fn, arg) == 0; }
#define PLAT_THREAD_FN(name) void *name(void *arg)
#define PLAT_THREAD_RET return 0
static inline void plat_thread_join(plat_thread t) { pthread_join(t, NULL); }
static inline void plat_mutex_init(plat_mutex *m) { pthread_mutex_init(m, NULL); }
static inline void plat_lock(plat_mutex *m) { pthread_mutex_lock(m); }
static inline void plat_unlock(plat_mutex *m) { pthread_mutex_unlock(m); }
static inline void plat_sleep_ms(int ms) {
  struct timespec ts = {ms / 1000, (ms % 1000) * 1000000L};
  nanosleep(&ts, NULL);
}
static inline double plat_now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec * 1e-9;
}
static inline long plat_read_in(void *buf, size_t n) { return (long)read(0, buf, n); }
static inline int plat_write_out(const void *buf, size_t n) {
  const char *p = (const char *)buf;
  while (n) {
    ssize_t w = write(1, p, n);
    if (w <= 0) return 0;
    p += w, n -= (size_t)w;
  }
  return 1;
}
#endif

#endif
