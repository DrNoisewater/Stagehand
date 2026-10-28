/* Stagehand Setup: the parts that don't need a window (payload, zip, files).
 * Shared by setup.c (Windows) and core_test.c (Linux test build). */
#ifndef SETUP_CORE_H
#define SETUP_CORE_H
#include <stdint.h>
#include "miniz.h"

#define PAYLOAD_MAGIC "SHPAYLD1"

typedef struct {
  void *fh;           /* opaque file handle of our own exe */
  uint64_t zip_ofs;   /* where the zip starts inside the exe */
  uint64_t zip_size;
  uint64_t stub_size; /* the exe without its payload (that's the uninstaller) */
  mz_zip_archive zip;
  int ok;
} Payload;

/* Per prefix ("runtime/", "app/", "vgmstream/"): number of files and bytes once unpacked. */
typedef struct { uint64_t files, bytes; } Part;

/* Progress: called after each chunk; return 0 to cancel. */
typedef int (*progress_fn)(void *ctx, uint64_t done_bytes);

int payload_open(Payload *p, const char *self_path_utf8);
void payload_close(Payload *p);
Part payload_part(Payload *p, const char *prefix);
/* Unpack every entry under `prefix` into dest_dir (UTF-8, no trailing slash), dropping the prefix.
 * Returns 0 on success, else writes a message into err. */
int payload_extract(Payload *p, const char *prefix, const char *dest_dir, progress_fn cb, void *ctx, uint64_t *done, char *err, int errlen);

/* small file helpers (UTF-8 paths) */
int fs_exists(const char *path);
int fs_mkdirs(const char *path);
int fs_rmtree(const char *path);
int fs_rename(const char *from, const char *to);
int fs_write(const char *path, const void *data, size_t n);
int fs_copy_prefix(const char *from, const char *to, uint64_t nbytes); /* first n bytes of a file */
#endif
