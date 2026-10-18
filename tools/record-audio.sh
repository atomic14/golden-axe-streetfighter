#!/usr/bin/env bash
# Record every sound command from the original sound board with MAME (one run per command, in
# parallel), cut them into clips in public/assets/audio and find the music loop points.
# Needs mame, ffmpeg and uv.  usage: tools/record-audio.sh /path/to/rom-dir
set -euo pipefail
ROMDIR="${1:?usage: tools/record-audio.sh <rom directory>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export ROMDIR WORK HERE

# 0x41-0x54 are the voices (the uPD7759's samples: screams, the thieves), 0x81-0xbf sound
# effects, 0xc0-0xcc music (found by sweeping 0x41-0xff; 0x26-0x40 set the volume)
SFX=$(for c in $(seq 65 84) $(seq 129 191); do printf "%02x " $c; done)
MUSIC="c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 ca cb cc"
rec() { # command, seconds
  CMDS=$1 LEN=$2 OUT="$WORK/$1.txt" mame goldnaxe -rompath "$ROMDIR" -video none -nothrottle \
    -wavwrite "$WORK/$1.wav" -autoboot_script "$HERE/mame/sndrec.lua" >/dev/null 2>&1
}
export -f rec
printf "%s\n" $SFX | xargs -P 8 -I{} bash -c 'rec {} 6'
printf "%s\n" $MUSIC | xargs -P 8 -I{} bash -c 'rec {} 180'

rm -f public/assets/audio/audio.json
for c in $SFX; do npx tsx "$HERE/cut-audio.ts" "$WORK/$c.wav" "$WORK/$c.txt" 6; done
for c in $MUSIC; do npx tsx "$HERE/cut-audio.ts" "$WORK/$c.wav" "$WORK/$c.txt" 180 music; done
uv run --with numpy python "$HERE/music-loops.py" public/assets/audio
