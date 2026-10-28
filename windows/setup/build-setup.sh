#!/bin/bash
# Builds Stagehand-Setup-<version>.exe: the setup program with everything it installs inside.
#   windows/setup/build-setup.sh <outDir> <electron-win32-x64.zip> <vgmstream-win64.zip> <uv-windows.zip>
# Needs llvm-mingw (scripts/session-setup.sh, fast) or the self-built sysroot (native/toolchain/build-mingw.sh, slow). miniz is vendored.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$(mkdir -p "$1" && cd "$1" && pwd)
EZIP=$2; VZIP=$3; UZIP=$4
TC=${SH_TOOLCHAIN:-/home/claude/tc}
MINIZ=${MINIZ:-$HERE/miniz}  # vendored (MIT)
VER=$(node -p "require('$ROOT/package.json').version")
ELEC=$(node -p "require('$ROOT/package.json').devDependencies.electron.replace(/[^0-9.]/g,'')")
IFS=. read V1 V2 V3 <<< "$VER"
B=$OUT/setup-build
rm -rf "$B"; mkdir -p "$B"
echo '#define MINIZ_EXPORT' > "$B/miniz_export.h"
LM=${SH_LLVM_MINGW:-/home/claude/llvm-mingw}
if [ -x "$LM/bin/x86_64-w64-mingw32-clang" ]; then
  # prebuilt llvm-mingw (scripts/session-setup.sh)
  S=$LM/x86_64-w64-mingw32
  CC="$LM/bin/x86_64-w64-mingw32-clang -D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00"
  WINDRES="$LM/bin/x86_64-w64-mingw32-windres"
  STRIP="$LM/bin/llvm-strip"
else
  S=$TC/sysroot/x86_64-w64-mingw32
  CC="clang --target=x86_64-w64-mingw32 -resource-dir=$TC/res --sysroot=$TC/sysroot -I$S/include -L$S/lib -fuse-ld=lld -rtlib=compiler-rt -unwindlib=none"
  WINDRES="llvm-windres-18 --target=x86_64-w64-mingw32"
  STRIP=llvm-strip
fi
CF="-O2 -Wall -Wno-unused-function -Wno-missing-braces -DMINIZ_NO_ARCHIVE_WRITING_APIS -DMINIZ_NO_STDIO -DMINIZ_NO_TIME -I$B -I$MINIZ -I$HERE"
$WINDRES -I"$S/include" -DSH_V1=$V1 -DSH_V2=$V2 -DSH_V3=$V3 -DSH_VSTR="\\\"$VER\\\"" "$HERE/setup.rc" -O coff -o "$B/setup.res" --preprocessor-arg=-I"$HERE"
$CC $CF -municode -mwindows -static -DSH_VERSION="\"$VER\"" -DSH_ELECTRON="\"$ELEC\"" \
  -o "$B/stub.exe" "$HERE/setup.c" "$HERE/setup_core.c" $MINIZ/miniz.c $MINIZ/miniz_tinfl.c $MINIZ/miniz_tdef.c $MINIZ/miniz_zip.c "$B/setup.res" \
  -lole32 -luuid -lshell32 -lgdi32 -luser32 -ladvapi32 -lshlwapi
$STRIP "$B/stub.exe"
python3 "$HERE/make-payload.py" "$B/stub.exe" "$OUT/Stagehand-Setup-$VER.exe" "$ROOT" "$EZIP" "$VZIP" "$UZIP"
# the stub alone is the uninstaller; keep it for testing
cp "$B/stub.exe" "$OUT/Uninstall Stagehand.exe"
ls -la "$OUT"
