#!/bin/bash
# winrun.sh <shotPrefix> <exe> [args...] : runs a Windows exe under Wine on a private X display, screenshots every 3 s
export WINEPREFIX=/root/wine/pfx WINEDEBUG=-all WINEARCH=win64 PATH=/home/claude/dl/wine-10.0-amd64/bin:$PATH
P=$1; shift
Xvfb :77 -screen 0 1280x900x24 -nolisten tcp >/dev/null 2>&1 &
XP=$!
sleep 1
export DISPLAY=:77
wine64 "$@" > /root/wine/run.log 2>&1 &
WP=$!
for i in $(seq 1 ${SHOTS:-6}); do sleep ${EVERY:-3}; import -window root ${P}_$i.png 2>/dev/null; done
