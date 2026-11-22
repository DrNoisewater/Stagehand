/* Linux check of the installer's payload reader: core_test <setup.exe> <outdir>
 * (4.27: and the art list). Build, from windows/setup (B holds miniz_export.h: #define MINIZ_EXPORT):
 *   cc -DMINIZ_NO_ARCHIVE_WRITING_APIS -DMINIZ_NO_STDIO -DMINIZ_NO_TIME -I$B -Iminiz -I. -o core_test \
 *     core_test.c setup_core.c miniz/miniz.c miniz/miniz_tinfl.c miniz/miniz_tdef.c miniz/miniz_zip.c
 * A Setup to try it on, without building the Windows part: any file as the stub, then
 *   ART_BASE=https://example.invalid/art python3 make-payload.py stub setup.exe ../.. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "setup_core.h"
static int prog(void *c, uint64_t d) { (void)c; (void)d; return 1; }
int main(int argc, char **argv) {
  Payload p;
  if (!payload_open(&p, argv[1])) { printf("no payload (stub %llu)\n", (unsigned long long)p.stub_size); return 1; }
  const char *parts[] = {"runtime/", "app/", "vgmstream/", "uv/"};
  char err[600], dest[4096];
  for (int i = 0; i < 4; i++) {
    Part r = payload_part(&p, parts[i]);
    uint64_t done = 0;
    snprintf(dest, sizeof dest, "%s/%s", argv[2], parts[i]);
    dest[strlen(dest) - 1] = 0;
    int rc = payload_extract(&p, parts[i], dest, prog, NULL, &done, err, sizeof err);
    printf("%-11s %5llu files %8.1f MB  extracted %8.1f MB rc=%d %s\n", parts[i], (unsigned long long)r.files, r.bytes / 1048576.0, done / 1048576.0, rc, rc ? err : "");
  }
  printf("stub %llu\n", (unsigned long long)p.stub_size);
  /* 4.27: the art list (the art itself isn't in the payload) */
  size_t n = 0;
  char *txt = payload_read(&p, "app/art-files.txt", &n);
  ArtList a;
  if (txt && art_parse(txt, &a, err, sizeof err)) {
    printf("art: %d files, %.1f MB from %s (first %s)\n", a.n, a.bytes / 1048576.0, a.base, a.n ? a.f[0].path : "-");
    art_free(&a);
  } else printf("art list: %s\n", txt ? err : "none");
  free(txt);
  /* lists that must be turned down: outside the app folder, a bad hash, no address */
  const char *bad[] = {
    "base https://x/y/\n0000000000000000000000000000000000000000000000000000000000000000 5 ../evil.png\n",
    "base https://x/y/\n0000000000000000000000000000000000000000000000000000000000000000 5 /etc/evil.png\n",
    "base https://x/y/\n0000000000000000000000000000000000000000000000000000000000000000 5 a\\b.png\n",
    "base https://x/y/\n0000000000000000000000000000000000000000000000000000000000000000 5 c:/b.png\n",
    "base https://x/y/\nABCD 5 a.png\n",
    "0000000000000000000000000000000000000000000000000000000000000000 5 a.png\n",
    "base ftp://x/y/\n",
  };
  int fails = 0;
  for (int i = 0; i < (int)(sizeof bad / sizeof *bad); i++)
    if (art_parse(bad[i], &a, err, sizeof err)) printf("BAD LIST ACCEPTED %d\n", i), art_free(&a), fails++;
  if (!art_parse("# note\r\nbase https://x/y/\r\n\r\n00000000000000000000000000000000000000000000000000000000000000ff 12 src/a b.png\n", &a, err, sizeof err) || a.n != 1 || a.f[0].size != 12 || strcmp(a.f[0].path, "src/a"))
    printf("GOOD LIST REFUSED: %s\n", err), fails++;
  else art_free(&a);
  printf("art list checks: %s\n", fails ? "FAILED" : "ok");
  fs_copy_prefix(argv[1], "/tmp/claude-0/uninst.exe", p.stub_size);
  payload_close(&p);
  return fails ? 1 : 0;
}
