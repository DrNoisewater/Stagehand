#!/bin/bash
set -e
T=x86_64-w64-mingw32
P=/home/claude/tc/sysroot/$T
cd /home/claude/tc
mkdir -p b-hdr b-crt b-rt
cd b-hdr && ../mingw-w64/mingw-w64-headers/configure --host=$T --prefix=$P --with-default-msvcrt=ucrt >/dev/null && make install >/dev/null && cd ..
export CC="clang --target=$T --sysroot=/home/claude/tc/sysroot -I$P/include -fuse-ld=lld"
export AR=llvm-ar RANLIB=llvm-ranlib DLLTOOL=llvm-dlltool
cd b-crt && ../mingw-w64/mingw-w64-crt/configure --host=$T --prefix=$P --with-default-msvcrt=ucrt --disable-lib32 --enable-lib64 CC="$CC" AR=$AR RANLIB=$RANLIB DLLTOOL=$DLLTOOL >/dev/null && make -j$(nproc) >/dev/null 2>&1 && make install >/dev/null && cd ..
# compiler-rt builtins (just the generic C files we may need)
cd b-rt
B=/home/claude/tc/llvm-project/compiler-rt/lib/builtins
for f in $B/*.c $B/x86_64/*.c; do
  n=$(basename $f .c); [ -f "$B/x86_64/$n.S" ] && [ "$f" == "$B/$n.c" ] && continue
  $CC -O2 -c $f -o $n.o 2>/dev/null || true
done
for f in $B/x86_64/*.S; do $CC -c $f -o $(basename $f .S)_s.o 2>/dev/null || true; done
llvm-ar rcs libclang_rt.builtins-x86_64.a *.o
mkdir -p $P/lib && cp libclang_rt.builtins-x86_64.a $P/lib/
echo BUILT
