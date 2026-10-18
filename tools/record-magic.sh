#!/usr/bin/env bash
# Record every hero's magic at every level with MAME into work/magic (then run npm run extract).
# usage: tools/record-magic.sh /path/to/rom-dir
set -euo pipefail
ROMDIR="${1:?usage: tools/record-magic.sh <rom directory>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p work/magic
run() { LIBDIR="$HERE/mame" OUT="work/magic/$1-$4.bin" CHAR=$2 CHARKEY=$3 LEVEL=$4 mame goldnaxe -rompath "$ROMDIR" -video none -nothrottle -sound none -autoboot_script "$HERE/mame/magic.lua" >/dev/null 2>&1; }
export -f run; export ROMDIR HERE
( for l in 1 2 3 4; do echo "ax 0 right $l"; done
  for l in 1 2 3 4 5 6; do echo "tyris 1 left $l"; done
  for l in 1 2 3; do echo "gilius 1 right $l"; done ) | xargs -P 8 -L 1 bash -c 'run "$@"' _
