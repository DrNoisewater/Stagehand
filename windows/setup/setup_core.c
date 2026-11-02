/* Stagehand Setup core: reads the zip appended to our own exe and unpacks it. */
#include "setup_core.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

/* UTF-8 -> wide, with the \\?\ prefix for absolute paths so long paths work. */
static wchar_t *W(const char *s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
  wchar_t *w = (wchar_t *)malloc((n + 8) * sizeof(wchar_t));
  int pre = 0;
  if (s[0] && s[1] == ':' && (s[2] == '\\' || s[2] == '/')) { wcscpy(w, L"\\\\?\\"); pre = 4; }
  MultiByteToWideChar(CP_UTF8, 0, s, -1, w + pre, n);
  for (wchar_t *c = w + pre; *c; c++) if (*c == L'/') *c = L'\\';
  return w;
}
static void *f_open_read(const char *path) {
  wchar_t *w = W(path);
  HANDLE h = CreateFileW(w, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  free(w);
  return h == INVALID_HANDLE_VALUE ? NULL : (void *)h;
}
static uint64_t f_size(void *fh) {
  LARGE_INTEGER li;
  return GetFileSizeEx((HANDLE)fh, &li) ? (uint64_t)li.QuadPart : 0;
}
static size_t f_read_at(void *fh, uint64_t ofs, void *buf, size_t n) {
  OVERLAPPED ov;
  memset(&ov, 0, sizeof ov);
  ov.Offset = (DWORD)ofs;
  ov.OffsetHigh = (DWORD)(ofs >> 32);
  size_t got = 0;
  while (got < n) {
    DWORD chunk = (DWORD)((n - got) > (1u << 30) ? (1u << 30) : (n - got)), r = 0;
    if (!ReadFile((HANDLE)fh, (char *)buf + got, chunk, &r, &ov) || r == 0) break;
    got += r;
    uint64_t next = ofs + got;
    ov.Offset = (DWORD)next;
    ov.OffsetHigh = (DWORD)(next >> 32);
  }
  return got;
}
static void f_close(void *fh) { if (fh) CloseHandle((HANDLE)fh); }

typedef HANDLE OUTF;
static OUTF out_open(const char *path) {
  wchar_t *w = W(path);
  HANDLE h = CreateFileW(w, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  free(w);
  return h;
}
static int out_ok(OUTF h) { return h != INVALID_HANDLE_VALUE; }
static int out_write(OUTF h, const void *b, size_t n) {
  DWORD w = 0;
  return WriteFile(h, b, (DWORD)n, &w, NULL) && w == n;
}
static void out_close(OUTF h) { CloseHandle(h); }

int fs_exists(const char *path) {
  wchar_t *w = W(path);
  DWORD a = GetFileAttributesW(w);
  free(w);
  return a != INVALID_FILE_ATTRIBUTES;
}
static int mkdir1(const char *path) {
  wchar_t *w = W(path);
  BOOL ok = CreateDirectoryW(w, NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
  free(w);
  return ok;
}
int fs_rename(const char *from, const char *to) {
  wchar_t *a = W(from), *b = W(to);
  BOOL ok = FALSE;
  /* antivirus scanners briefly hold new files; try for a few seconds */
  for (int i = 0; i < 25 && !(ok = MoveFileExW(a, b, MOVEFILE_REPLACE_EXISTING)); i++) Sleep(200);
  free(a);
  free(b);
  return ok;
}
static int rm_w(const wchar_t *dir) {
  size_t n = wcslen(dir);
  wchar_t *pat = (wchar_t *)malloc((n + 4) * sizeof(wchar_t));
  wcscpy(pat, dir);
  wcscat(pat, L"\\*");
  WIN32_FIND_DATAW fd;
  HANDLE f = FindFirstFileW(pat, &fd);
  free(pat);
  int ok = 1;
  if (f != INVALID_HANDLE_VALUE) {
    do {
      if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
      size_t m = n + wcslen(fd.cFileName) + 2;
      wchar_t *p = (wchar_t *)malloc(m * sizeof(wchar_t));
      wcscpy(p, dir);
      wcscat(p, L"\\");
      wcscat(p, fd.cFileName);
      if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) ok &= rm_w(p);
      else {
        SetFileAttributesW(p, FILE_ATTRIBUTE_NORMAL);
        if (!DeleteFileW(p)) ok = 0;
      }
      free(p);
    } while (FindNextFileW(f, &fd));
    FindClose(f);
  }
  if (!RemoveDirectoryW(dir)) ok = 0;
  return ok;
}
int fs_rmtree(const char *path) {
  if (!fs_exists(path)) return 1;
  wchar_t *w = W(path);
  DWORD a = GetFileAttributesW(w);
  int ok;
  if (a & FILE_ATTRIBUTE_DIRECTORY) ok = rm_w(w);
  else {
    SetFileAttributesW(w, FILE_ATTRIBUTE_NORMAL);
    ok = DeleteFileW(w);
  }
  free(w);
  return ok;
}
#else /* POSIX, for the Linux test build */
#include <sys/stat.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
static void *f_open_read(const char *path) { return fopen(path, "rb"); }
static uint64_t f_size(void *fh) {
  FILE *f = (FILE *)fh;
  fseeko(f, 0, SEEK_END);
  return (uint64_t)ftello(f);
}
static size_t f_read_at(void *fh, uint64_t ofs, void *buf, size_t n) {
  FILE *f = (FILE *)fh;
  if (fseeko(f, (off_t)ofs, SEEK_SET)) return 0;
  return fread(buf, 1, n, f);
}
static void f_close(void *fh) { if (fh) fclose((FILE *)fh); }
typedef FILE *OUTF;
static OUTF out_open(const char *path) { return fopen(path, "wb"); }
static int out_ok(OUTF h) { return h != NULL; }
static int out_write(OUTF h, const void *b, size_t n) { return fwrite(b, 1, n, h) == n; }
static void out_close(OUTF h) { fclose(h); }
int fs_exists(const char *path) { struct stat st; return stat(path, &st) == 0; }
static int mkdir1(const char *path) { return mkdir(path, 0755) == 0 || errno == EEXIST; }
int fs_rename(const char *from, const char *to) { return rename(from, to) == 0; }
int fs_rmtree(const char *path) {
  struct stat st;
  if (lstat(path, &st)) return 1;
  if (!S_ISDIR(st.st_mode)) return unlink(path) == 0;
  DIR *d = opendir(path);
  int ok = 1;
  if (d) {
    struct dirent *e;
    while ((e = readdir(d))) {
      if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
      char *p = malloc(strlen(path) + strlen(e->d_name) + 2);
      sprintf(p, "%s/%s", path, e->d_name);
      ok &= fs_rmtree(p);
      free(p);
    }
    closedir(d);
  }
  return ok && rmdir(path) == 0;
}
#endif

int fs_mkdirs(const char *path) {
  char *p = strdup(path);
  size_t n = strlen(p);
  int ok = 1;
  /* skip a drive or the \\?\ prefix */
  size_t start = (n > 2 && p[1] == ':') ? 3 : 1;
  for (size_t i = start; i <= n && ok; i++) {
    if (p[i] == '/' || p[i] == '\\' || p[i] == 0) {
      char c = p[i];
      p[i] = 0;
      if (i > 0 && !fs_exists(p)) ok = mkdir1(p);
      p[i] = c;
    }
  }
  free(p);
  return ok;
}

int fs_write(const char *path, const void *data, size_t n) {
  OUTF f = out_open(path);
  if (!out_ok(f)) return 0;
  int ok = out_write(f, data, n);
  out_close(f);
  return ok;
}

int fs_copy_prefix(const char *from, const char *to, uint64_t nbytes) {
  void *in = f_open_read(from);
  if (!in) return 0;
  OUTF out = out_open(to);
  if (!out_ok(out)) { f_close(in); return 0; }
  char *buf = malloc(1 << 20);
  uint64_t done = 0;
  int ok = 1;
  while (done < nbytes && ok) {
    size_t want = (nbytes - done) > (1 << 20) ? (1 << 20) : (size_t)(nbytes - done);
    size_t got = f_read_at(in, done, buf, want);
    if (got == 0) { ok = 0; break; }
    ok = out_write(out, buf, got);
    done += got;
  }
  free(buf);
  out_close(out);
  f_close(in);
  return ok;
}

/* ------------------------------------------------------------ payload -- */
static size_t zip_read(void *opaque, mz_uint64 ofs, void *buf, size_t n) {
  Payload *p = (Payload *)opaque;
  if (ofs >= p->zip_size) return 0;
  if (ofs + n > p->zip_size) n = (size_t)(p->zip_size - ofs);
  return f_read_at(p->fh, p->zip_ofs + ofs, buf, n);
}

static uint64_t rd64(const unsigned char *b) {
  uint64_t v = 0;
  for (int i = 7; i >= 0; i--) v = (v << 8) | b[i];
  return v;
}

int payload_open(Payload *p, const char *self) {
  memset(p, 0, sizeof *p);
  p->fh = f_open_read(self);
  if (!p->fh) return 0;
  uint64_t size = f_size(p->fh);
  unsigned char tr[24];
  if (size < 24 || f_read_at(p->fh, size - 24, tr, 24) != 24 || memcmp(tr, PAYLOAD_MAGIC, 8)) {
    p->stub_size = size; /* no payload: this copy is the uninstaller */
    return 0;
  }
  p->zip_ofs = rd64(tr + 8);
  p->zip_size = rd64(tr + 16);
  p->stub_size = p->zip_ofs;
  if (p->zip_ofs + p->zip_size + 24 != size) return 0;
  mz_zip_zero_struct(&p->zip);
  p->zip.m_pRead = zip_read;
  p->zip.m_pIO_opaque = p;
  if (!mz_zip_reader_init(&p->zip, p->zip_size, 0)) return 0;
  p->ok = 1;
  return 1;
}

int zipfile_open(Payload *p, const char *path) {
  memset(p, 0, sizeof *p);
  p->fh = f_open_read(path);
  if (!p->fh) return 0;
  p->zip_ofs = 0;
  p->zip_size = f_size(p->fh);
  mz_zip_zero_struct(&p->zip);
  p->zip.m_pRead = zip_read;
  p->zip.m_pIO_opaque = p;
  if (!mz_zip_reader_init(&p->zip, p->zip_size, 0)) {
    f_close(p->fh);
    p->fh = NULL;
    return 0;
  }
  p->ok = 1;
  return 1;
}

void payload_close(Payload *p) {
  if (p->ok) mz_zip_reader_end(&p->zip);
  f_close(p->fh);
  p->fh = NULL;
  p->ok = 0;
}

Part payload_part(Payload *p, const char *prefix) {
  Part r = {0, 0};
  if (!p->ok) return r;
  size_t pl = strlen(prefix);
  mz_uint n = mz_zip_reader_get_num_files(&p->zip);
  for (mz_uint i = 0; i < n; i++) {
    mz_zip_archive_file_stat st;
    if (!mz_zip_reader_file_stat(&p->zip, i, &st) || st.m_is_directory) continue;
    if (strncmp(st.m_filename, prefix, pl)) continue;
    r.files++;
    r.bytes += st.m_uncomp_size;
  }
  return r;
}

typedef struct {
  OUTF f;
  int ok;
  progress_fn cb;
  void *ctx;
  uint64_t *done;
  int cancelled;
} Sink;

static size_t sink_write(void *opaque, mz_uint64 ofs, const void *buf, size_t n) {
  Sink *s = (Sink *)opaque;
  (void)ofs;
  if (!s->ok) return 0;
  if (!out_write(s->f, buf, n)) { s->ok = 0; return 0; }
  *s->done += n;
  if (s->cb && !s->cb(s->ctx, *s->done)) { s->cancelled = 1; return 0; }
  return n;
}

int payload_extract(Payload *p, const char *prefix, const char *dest, progress_fn cb, void *ctx, uint64_t *done, char *err, int errlen) {
  if (!p->ok) { snprintf(err, errlen, "The installer is incomplete. Download it again."); return 1; }
  size_t pl = strlen(prefix);
  mz_uint n = mz_zip_reader_get_num_files(&p->zip);
  if (!fs_mkdirs(dest)) { snprintf(err, errlen, "Couldn't create the folder %s", dest); return 1; }
  char *path = malloc(8192);
  int rc = 0;
  for (mz_uint i = 0; i < n && !rc; i++) {
    mz_zip_archive_file_stat st;
    if (!mz_zip_reader_file_stat(&p->zip, i, &st)) continue;
    const char *name = st.m_filename;
    if (strncmp(name, prefix, pl)) continue;
    const char *rel = name + pl;
    if (!*rel) continue;
    /* never write outside dest */
    if (strstr(rel, "..") || rel[0] == '/' || rel[0] == '\\' || strchr(rel, ':')) continue;
    snprintf(path, 8192, "%s/%s", dest, rel);
#ifdef _WIN32
    for (char *c = path; *c; c++) if (*c == '/') *c = '\\';
#endif
    size_t L = strlen(path);
    if (st.m_is_directory || (L && (path[L - 1] == '/' || path[L - 1] == '\\'))) {
      if (!fs_mkdirs(path)) { snprintf(err, errlen, "Couldn't create %s", path); rc = 1; }
      continue;
    }
    char *slash = strrchr(path, '/');
#ifdef _WIN32
    char *bs = strrchr(path, '\\');
    if (!slash || (bs && bs > slash)) slash = bs;
#endif
    if (slash) {
      *slash = 0;
      int ok = fs_mkdirs(path);
      *slash =
#ifdef _WIN32
          '\\';
#else
          '/';
#endif
      if (!ok) { snprintf(err, errlen, "Couldn't create the folder for %s", path); rc = 1; break; }
    }
    Sink s = {out_open(path), 1, cb, ctx, done, 0};
    if (!out_ok(s.f)) {
      snprintf(err, errlen, "Couldn't write %s. Is Stagehand still open, or is the disk full?", path);
      rc = 1;
      break;
    }
    mz_bool ok = mz_zip_reader_extract_to_callback(&p->zip, i, sink_write, &s, 0);
    out_close(s.f);
    if (s.cancelled) { snprintf(err, errlen, "Cancelled"); rc = 2; }
    else if (!ok || !s.ok) { snprintf(err, errlen, "Couldn't unpack %s (the disk may be full, or the download is damaged)", rel); rc = 1; }
  }
  free(path);
  return rc;
}
