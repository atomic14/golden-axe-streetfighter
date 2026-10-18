#!/usr/bin/env bash
# Render the original title screen (attract mode, frame 800) into public/assets/title.png.
# usage: tools/record-title.sh /path/to/rom-dir /path/to/goldnaxe.zip-or-dir
set -euo pipefail
ROMDIR="${1:?usage: tools/record-title.sh <rom directory> <rom zip>}"
ROM="${2:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cat > "$WORK/title.lua" <<LUA
package.path = "$HERE/mame/?.lua;" .. package.path
local L = require("dump")
L.every(function(f) if f == 800 then DUMP_FRAME(f); DUMP_CLOSE(); L.exit() end end)
LUA
LIBDIR="$HERE/mame" OUT="$WORK/title.bin" mame goldnaxe -rompath "$ROMDIR" -video none -nothrottle -sound none -autoboot_script "$WORK/title.lua" >/dev/null 2>&1
npx tsx "$HERE/explore/renderdump.ts" "$ROM" "$WORK/title.bin" "$WORK/title" 800
cp "$WORK/title-800.png" public/assets/title.png
