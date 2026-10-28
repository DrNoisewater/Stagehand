/* Linux check of the installer's payload reader: core_test <setup.exe> <outdir> */
#include <stdio.h>
#include <string.h>
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
  fs_copy_prefix(argv[1], "/tmp/claude-0/uninst.exe", p.stub_size);
  payload_close(&p);
  return 0;
}
