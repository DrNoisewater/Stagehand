#!/bin/bash
# cmp.sh outdir : shoots A:6, C:4, B:6 and builds side-by-side with Rocksmith frames
O=$1; S=/tmp/claude-0/-home-claude/99a0cbba-39e0-5352-b75b-23b554f98193/scratchpad/full
cd /home/claude/hw && timeout 200 node shoot.js $O A:6 C:4 B:6 ${@:2} 2>&1 | grep -v "^shot"
cd $O && ffmpeg -v error -y -i $S/a21.png -i A__6.png -i $S/c60.png -i C__4.png -i $S/b_16.jpg -i B__6.png -filter_complex "[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[3]scale=960:540[d];[4]scale=960:540[e];[5]scale=960:540[f];[a][b][c][d][e][f]xstack=inputs=6:layout=0_0|960_0|0_540|960_540|0_1080|960_1080" cmp.jpg && echo $O/cmp.jpg
