-- Record work/video RAM to OUT as per-frame diffs. Per dumped frame:
--   "FRAM" u32 frame, then for each region (workram, sprites, textram, paletteram, tileram):
--   u32 count, count x (u16 word index, u16 value)
package.path = os.getenv("LIBDIR") .. "/?.lua;" .. package.path
local L = require("lib")
local out = io.open(os.getenv("OUT"), "wb")
local REGIONS = {"workram", "sprites", "textram", "paletteram", "tileram"}
local prev = {}
for i, name in ipairs(REGIONS) do prev[i] = {} end
function DUMP_FRAME(f)
  out:write("FRAM", string.pack(">I4", f))
  for i, name in ipairs(REGIONS) do
    local s, p = L.share(name), prev[i]
    local t, n = {}, 0
    for w = 0, s.size // 2 - 1 do
      local v = s:read_u16(w * 2)
      if p[w] ~= v then p[w] = v; n = n + 1; t[n] = string.pack(">I2I2", w, v) end
    end
    out:write(string.pack(">I4", n), table.concat(t))
  end
end
function DUMP_CLOSE() out:close() end
return L
