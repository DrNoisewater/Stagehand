#!/bin/bash
# One-shot setup for a fresh Claude session (about a minute instead of ~15):
#   bash scripts/session-setup.sh
# Gets: prebuilt llvm-mingw (Windows cross compiler, GitHub release, ~80 MB),
# the Setup payload zips (Electron, vgmstream, uv), and builds the Linux fake
# audio helper the UI tests use. Everything comes from GitHub release assets,
# which the sandbox can reach (npm/PyPI/sourceforge usually can't).
# Afterwards:
#   npm test
#   PLAYWRIGHT=/opt/npm-tools/node_modules/playwright node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
#   node test/hwlook/shoot.js <outDir> B:8:p:h            (highway stills; VENUE=fluid etc.)
#   SETUP_DEPS="$DEPS/electron.zip $DEPS/vgmstream.zip $DEPS/uv.zip" sh scripts/package.sh <outDir>
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEPS=${DEPS:-/home/claude/deps}
LM=${SH_LLVM_MINGW:-/home/claude/llvm-mingw}
LMV=${LLVM_MINGW_VERSION:-20251104}
ELEC=$(node -p "require('$ROOT/package.json').devDependencies.electron.replace(/[^0-9.]/g,'')")
mkdir -p "$DEPS"
get() { [ -s "$2" ] || { echo "downloading $(basename "$2")"; curl -fsSL -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
if [ ! -x "$LM/bin/x86_64-w64-mingw32-clang" ]; then
  get "https://github.com/mstorsjo/llvm-mingw/releases/download/$LMV/llvm-mingw-$LMV-ucrt-ubuntu-22.04-x86_64.tar.xz" "$DEPS/llvm-mingw.tar.xz"
  rm -rf "$LM" "$DEPS/llvm-mingw-$LMV-ucrt-ubuntu-22.04-x86_64"
  tar -xf "$DEPS/llvm-mingw.tar.xz" -C "$DEPS"
  mv "$DEPS/llvm-mingw-$LMV-ucrt-ubuntu-22.04-x86_64" "$LM"
fi
get "https://github.com/electron/electron/releases/download/v$ELEC/electron-v$ELEC-win32-x64.zip" "$DEPS/electron.zip" &
get "https://github.com/vgmstream/vgmstream/releases/latest/download/vgmstream-win64.zip" "$DEPS/vgmstream.zip" &
get "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" "$DEPS/uv.zip" &
# the fake-device audio helper for the UI tests (the shipped .exe is in native/bin; rebuild it
# with native/build.sh only when native/ changes)
cd "$ROOT/native" && mkdir -p build
DSP="dsp/sh_util.c dsp/sh_amp.c dsp/sh_cab.c dsp/sh_fx.c dsp/sh_rev.c dsp/sh_engine.c dsp/sh_nam.c"
cc -O3 -ffp-contract=fast -fno-math-errno -Wno-unused-function -pthread -o build/stagehand-audio-fake host/host.c host/io_fake.c $DSP -lm
wait
"$LM/bin/x86_64-w64-mingw32-clang" --version | head -1
ls -la "$DEPS"/*.zip
echo "SESSION READY (DEPS=$DEPS, llvm-mingw at $LM)"
