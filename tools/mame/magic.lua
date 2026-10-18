-- Cast magic at a given level with one character and record what happens.
-- Env: LIBDIR, OUT (dump), CHAR, CHARKEY, LEVEL (potions, written to player 1's count at 0xffe030)
-- Magic only works from a standing hero, so wait (clearing enemies away) until the hero has
-- stood still for a while, then press magic and record 420 frames. Prints the potions left,
-- which shows the cast happened.
package.path = os.getenv("LIBDIR") .. "/?.lua;" .. package.path
local L = require("dump")
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local CHAR = tonumber(os.getenv("CHAR") or "0")
local CHARKEY = os.getenv("CHARKEY") or "right"
local LEVEL = tonumber(os.getenv("LEVEL") or "1")
L.tap("coin", 300, 6); L.tap("start", 360, 6)
for i = 1, CHAR do L.tap(CHARKEY, 560 + i * 20, 6) end
L.tap("attack", 700, 6)
local cast, lastScript, still = nil, 0, 0
L.every(function(f)
  if f > 900 then sp:write_u8(0xffc070, 48) end
  if f > 900 and not cast then
    -- clear enemies away so the cast is not interrupted
    for a = 0xffc400, 0xffdf80, 0x80 do
      if sp:read_u8(a + 0x70) > 0 and sp:read_u32(a + 2) ~= 0xaee2 then sp:write_u16(a, 0); sp:write_u16(a + 0x80, 0) end
    end
    sp:write_u8(0xffe030, LEVEL)
    local s = sp:read_u32(0xffc028)
    if s == lastScript then still = still + 1 else still = 0 end
    lastScript = s
    local idle = s == 0xdfea or s == 0x1192a or s == 0x150ac
    if f > 1990 and idle and still > 30 then cast = f + 4 end
  end
  if cast and f == cast then L.set("magic", true) end
  if cast and f == cast + 4 then L.set("magic", false) end
  if cast and f >= cast - 4 and f <= cast + 420 then DUMP_FRAME(f) end
  if cast and f == cast + 421 then
    print(string.format("cast at %d, level %d, potions left %d", cast, LEVEL, sp:read_u8(0xffe030)))
    DUMP_CLOSE(); L.exit()
  end
end)
