#!/bin/bash
# Builds the Stagehand sound engine:
#   bin/stagehand-audio.exe          Windows helper (WASAPI)       needs the mingw sysroot (toolchain/build-mingw.sh)
#   ../src/renderer/worklets/rig-dsp.wasm   in-app fallback engine
#   build/stagehand-audio-fake       Linux helper with a fake device, for tests
#   build/dsp_bench                  Linux DSP bench
set -e
cd "$(dirname "$0")"
TC=${SH_TOOLCHAIN:-/home/claude/tc}
DSP="dsp/sh_util.c dsp/sh_amp.c dsp/sh_cab.c dsp/sh_fx.c dsp/sh_rev.c dsp/sh_engine.c dsp/sh_nam.c"
mkdir -p build bin
CF="-O3 -ffp-contract=fast -fno-math-errno -Wall -Wno-unused-function"
cc $CF -o build/dsp_bench test/dsp_bench.c $DSP -lm
cc $CF -o build/drop_test test/drop_test.c $DSP -lm
cc $CF -march=x86-64-v2 -o build/nam_test test/nam_test.c $DSP -lm
cc $CF -march=x86-64-v2 -o build/nam_engine_test test/nam_engine_test.c $DSP -lm
cc $CF -o build/rs_test test/rs_test.c $(echo $DSP | sed 's#dsp/sh_nam.c##') -lm
cc $CF -pthread -o build/stagehand-audio-fake host/host.c host/io_fake.c $DSP -lm
clang --target=wasm32 -O3 -msimd128 -nostdlib -fno-builtin -Wl,--no-entry -Wl,--initial-memory=67108864 -Wl,--max-memory=134217728 -Wl,--strip-all \
  -o ../src/renderer/worklets/rig-dsp.wasm $DSP dsp/sh_wasm.c
LM=${SH_LLVM_MINGW:-/home/claude/llvm-mingw}
if [ -x "$LM/bin/x86_64-w64-mingw32-clang" ]; then
  # prebuilt llvm-mingw (scripts/session-setup.sh fetches it in ~15 s)
  "$LM/bin/x86_64-w64-mingw32-clang" $CF -march=x86-64-v2 -mtune=generic -static -Wl,--subsystem,console \
    -o bin/stagehand-audio.exe host/host.c host/io_wasapi.c $DSP -lole32 -luuid -lavrt -lksuser
  "$LM/bin/llvm-strip" bin/stagehand-audio.exe
  echo "built bin/stagehand-audio.exe (llvm-mingw)"
elif [ -d "$TC/sysroot/x86_64-w64-mingw32" ]; then
  S=$TC/sysroot/x86_64-w64-mingw32
  clang --target=x86_64-w64-mingw32 -resource-dir=$TC/res --sysroot=$TC/sysroot -I$S/include -L$S/lib -fuse-ld=lld -rtlib=compiler-rt -unwindlib=none \
    $CF -march=x86-64-v2 -mtune=generic -static -Wl,--subsystem,console \
    -o bin/stagehand-audio.exe host/host.c host/io_wasapi.c $DSP -lole32 -luuid -lavrt -lksuser
  llvm-strip bin/stagehand-audio.exe
  echo "built bin/stagehand-audio.exe"
else
  echo "mingw sysroot missing; skipped the Windows build" >&2
fi
