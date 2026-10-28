#!/bin/bash
# cmp.sh video.mp4 videoSecs shot.png out.jpg : video frame on top, ours below
ffmpeg -v error -y -ss $2 -i $1 -frames:v 1 /tmp/claude-0/vf.png
ffmpeg -v error -y -i /tmp/claude-0/vf.png -i $3 -filter_complex "[0]scale=960:540[a];[1]scale=960:540[b];[a][b]vstack" $4
