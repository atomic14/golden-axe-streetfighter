-- Perform a scripted list of moves with one character and log the player object every frame:
--   frame label anim frame flags x z y facing
-- Env: LIBDIR, OUT, CHAR (number of right presses on the select screen)
package.path = os.getenv("LIBDIR") .. "/?.lua;" .. package.path
local L = require("lib")
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local out = io.open(os.getenv("OUT"), "w")
local CHAR = tonumber(os.getenv("CHAR") or "0")
L.tap("coin", 300, 6); L.tap("start", 360, 6)
local CHARKEY = os.getenv("CHARKEY") or "right"
for i = 1, CHAR do L.tap(CHARKEY, 560 + i * 20, 6) end
L.tap("attack", 700, 6)

-- script: list of {label, frames, keys-function(t)}
local S = {}
local function add(label, n, fn) S[#S + 1] = {label, n, fn} end
local function hold(...) local k = {...}; return function() local r = {}; for _, x in ipairs(k) do r[x] = true end; return r end end
local none = function() return {} end
add("idle", 60, none)
add("walk_r", 90, hold("right"))
add("idle", 30, none)
add("walk_l", 60, hold("left"))
add("walk_u", 40, hold("up"))
add("walk_d", 40, hold("down"))
add("walk_ur", 40, hold("up", "right"))
add("idle", 30, none)
add("run_r", 90, function(t) if t < 4 or t >= 8 then return {right = true} end return {} end)
add("idle", 40, none)
add("run_l", 90, function(t) if t < 4 or t >= 8 then return {left = true} end return {} end)
add("idle", 40, none)
add("attack1", 60, function(t) return {attack = t < 4} end)
add("combo", 120, function(t) return {attack = t % 12 < 4} end)
add("idle", 30, none)
add("jump", 90, function(t) return {jump = t < 4} end)
add("jump_fwd", 90, function(t) return {jump = t < 4, right = true} end)
add("jump_attack", 90, function(t) return {jump = t < 4, attack = t >= 12 and t < 16} end)
add("jump_attack_down", 90, function(t) return {jump = t < 4, attack = t >= 12 and t < 16, down = t >= 10 and t < 20} end)
add("back_attack", 60, function(t) return {jump = t < 4, attack = t < 4} end)
add("idle", 30, none)
add("dash_attack", 80, function(t) return {right = t < 4 or (t >= 8 and t < 40), attack = t >= 30 and t < 34} end)
add("idle", 30, none)
add("dash_jump", 90, function(t) return {left = t < 4 or (t >= 8 and t < 40), jump = t >= 30 and t < 34} end)
add("idle", 30, none)
add("dash_jump_attack", 90, function(t) return {right = t < 4 or (t >= 8 and t < 40), jump = t >= 30 and t < 34, attack = t >= 40 and t < 44} end)
add("idle", 60, none)
add("magic", 300, function(t) return {magic = t < 4} end)
add("idle", 60, none)

local START = 1400
local idx, t0 = 1, START
L.every(function(f)
  -- keep the player alive; enemies at bay
  if f > 900 then sp:write_u8(0xffc070, 48) end
  -- remove enemies so the moves are not interrupted
  if f > 900 then
    for a = 0xffc400, 0xffdf80, 0x80 do
      if sp:read_u8(a + 0x70) > 0 and sp:read_u32(a + 2) ~= 0xaee2 then sp:write_u16(a, 0); sp:write_u16(a + 0x80, 0) end
    end
  end
  if f >= START and idx <= #S then
    local s = S[idx]
    local t = f - t0
    local k = s[3](t)
    for _, n in ipairs({"up", "down", "left", "right", "attack", "jump", "magic"}) do L.set(n, k[n] or false) end
    out:write(string.format("%d %s %x %x %x %d %d %d %d %d\n", f, s[1], sp:read_u32(0xffc028), sp:read_u16(0xffc006), sp:read_u8(0xffc000),
      sp:read_u16(0xffc010), sp:read_u16(0xffc014), sp:read_u16(0xffc018), sp:read_u8(0xffc00c), sp:read_u8(0xffc00b)))
    if t + 1 >= s[2] then idx = idx + 1; t0 = f + 1 end
  end
  if idx > #S then out:close(); L.exit() end
end)
