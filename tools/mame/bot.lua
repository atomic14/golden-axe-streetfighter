-- Bot that plays Golden Axe with health and lives pinned, fighting the nearest enemy and
-- otherwise walking right. Env: LIBDIR, OUT (dump file, optional), STEP (dump every N frames),
-- SNAP (snapshot every N frames), FRAMES (stop after), CHAR (0..2 presses of right at select).
package.path = os.getenv("LIBDIR") .. "/?.lua;" .. package.path
local L = os.getenv("OUT") and require("dump") or require("lib")
local cpu = manager.machine.devices[":maincpu"]
local sp = cpu.spaces["program"]
local STEP = tonumber(os.getenv("STEP") or "4")
-- DUMPFROM / DUMPTO: only dump this frame range
local DUMP_FROM = tonumber(os.getenv("DUMPFROM") or "0")
local DUMP_TO = tonumber(os.getenv("DUMPTO") or "99999999")
local SNAP = tonumber(os.getenv("SNAP") or "0")
local FRAMES = tonumber(os.getenv("FRAMES") or "60000")
local CHAR = tonumber(os.getenv("CHAR") or "0")
local MAPS = os.getenv("MAPS") ~= nil
local w16 = function(a) return sp:read_u16(a) end
local r8 = function(a) return sp:read_u8(a) end

L.tap("coin", 300, 6); L.tap("start", 360, 6)
local CHARKEY = os.getenv("CHARKEY") or "right"
for i = 1, CHAR do L.tap(CHARKEY, 560 + i * 20, 6) end
L.tap("attack", 700, 6)

local function sx(x) return ((x - 0x1000 + w16(0xecf8 + 0xff0000) + w16(0xed20 + 0xff0000)) & 0xffff) + 8 end
-- targets the bot has failed to hurt for a while are ignored for a bit
local ignore, chase = {}, { a = nil, since = 0, hp = 0 }
local function enemies(f)
  local me = { x = w16(0xffc010), z = w16(0xffc014) }
  local best, bd = nil, 1e9
  for a = 0xffc400, 0xffdf80, 0x80 do
    if (w16(a) & 0x8000) ~= 0 and sp:read_u32(a + 2) ~= 0xaee2 and r8(a + 0x70) > 0 and (ignore[a] or 0) < f then
      local e = { a = a, x = w16(a + 0x10), z = w16(a + 0x14) }
      local ex = sx(e.x)
      if ex < 8 or ex > 312 then goto skip end
      -- WEAK=1: enemies on screen die from one hit (for capturing levels quickly)
      if os.getenv("WEAK") and r8(a + 0x70) > 1 then sp:write_u8(a + 0x70, 1) end
      local d = math.abs(e.x - me.x) + 2 * math.abs(e.z - me.z)
      if d < bd then bd, best = d, e end
    end
    ::skip::
  end
  return me, best
end

-- height map (tile RAM 0xc000: 64 bytes per 8px column of x, one per 8px of z from 0xf80)
local tileram = manager.machine.memory.shares[":tileram"]
local function hgt(c, r)
  if c < 0 or c > 255 or r < 0 or r > 63 then return 0 end
  return tileram:read_u8(0xc000 + c * 64 + r)
end
-- BFS over cells reachable on foot (height steps of at most 2 = 16px, no walls or drops);
-- returns the first step towards the reachable cell furthest right (within maxc)
local function pathRight(x, z, maxc)
  local c0, r0 = (x - 0x1000) >> 3, (z - 0xf80) >> 3
  local key = function(c, r) return c * 64 + r end
  local prev, q, head = { [key(c0, r0)] = -1 }, { {c0, r0} }, 1
  local best, bestc = nil, c0
  while head <= #q and head < 4000 do
    local c, r = q[head][1], q[head][2]; head = head + 1
    if c > bestc then best, bestc = key(c, r), c end
    local h = hgt(c, r)
    for _, d in ipairs({{1,0},{0,1},{0,-1},{-1,0}}) do
      local nc, nr = c + d[1], r + d[2]
      local nh = hgt(nc, nr)
      -- walk on the level, jump up ledges of up to 64px (the original allows no climbing on foot),
      -- drop down any height but never into a pit
      if nc <= maxc and nh > 0x20 and nh < 0xd0 and (h - nh) <= 8 and not prev[key(nc, nr)] then
        prev[key(nc, nr)] = key(c, r); q[#q + 1] = {nc, nr}
      end
    end
  end
  if not best then return nil end
  -- walk back to the step after the start
  local k = best
  while prev[k] ~= -1 and prev[prev[k]] ~= -1 do k = prev[k] end
  return k // 64, k % 64, c0, r0
end

-- SNDLOG=path: log every sound the game queues (0xffec40 ring) with its caller
local sndlog = os.getenv("SNDLOG") and io.open(os.getenv("SNDLOG"), "w")
if sndlog then
  -- taps are dropped whenever the game reprograms its memory mapper, so reinstall regularly
  local function install()
    if SNDTAP then SNDTAP:remove() end
    SNDTAP = sp:install_write_tap(0, 0xffffff, "sndq", function(off, data, mask)
      if off < 0xffec40 or off > 0xffec5f then return end
      local v = (mask & 0xff00) ~= 0 and (data >> 8) or (data & 0xff)
      local ret = sp:read_u32(cpu.state["SP"].value & 0xffffff)
      sndlog:write(string.format("%d %d %x %02x %x %x\n", L.frame, r8(0xffed4a), w16(0xffed32), v, ret, cpu.state["A6"].value & 0xffff))
      sndlog:flush()
    end)
  end
  L.every(function(f) if f % 600 == 0 then install() end end)
end

-- ZLOG=path: log music commands as the sound CPU receives them (port 0xc0)
local zlog = os.getenv("ZLOG") and io.open(os.getenv("ZLOG"), "w")
if zlog then
  local zs = manager.machine.devices[":soundcpu"].spaces["io"]
  local last = -1
  ZTAP = zs:install_read_tap(0xc0, 0xff, "latch", function(off, data, mask)
    if data ~= last and data >= 0x80 then
      zlog:write(string.format("%d %d %x %02x %d\n", L.frame, r8(0xffed4a), w16(0xffed32), data, r8(0xffed5b)))
      zlog:flush()
    end
    last = data
    return data
  end)
end

local hold = {}
local function press(set)
  for _, k in ipairs({"up", "down", "left", "right", "attack", "jump"}) do L.set(k, set[k] or false) end
end
local wander = 0
-- the original can lock up in its wall-collision loop (0xc442-0xc4fa) when an object's depth
-- straddles a wall edge; nudge that object (A6) away from the edge when it happens
local stuck, tries = 0, 0
local function unstick(f)
  local pc = cpu.state["PC"].value
  if pc >= 0xc442 and pc <= 0xc4fa then stuck = stuck + 1 else stuck = 0; tries = 0 end
  if stuck >= 20 then
    -- the loop exits once the floor under the object is below its altitude (+0x18),
    -- so lift the object into the air and let it fall back down
    local a6 = cpu.state["A6"].value & 0xffffff
    sp:write_u16(a6 + 0x18, 0x1000)
    print(string.format("unstuck object %x at frame %d", a6, f))
    stuck = 0
  end
end
local lastArea, saveAt = -1, nil
-- if progress stalls for a long time (e.g. a moat the bot cannot cross), hop the player forward
lastProg, progAt = 0, 0
local function hopIfStuck(f)
  local prog = w16(0xffed32)
  if prog ~= lastProg then lastProg, progAt = prog, f; return end
  if f - progAt < 4800 then return end
  progAt = f - 2400
  local x, z = w16(0xffc02c), w16(0xffc030)
  for dx = 240, 24, -8 do
    for dz = -48, 48, 8 do
      local c, r = (x + dx - 0x1000) >> 3, (z + dz - 0xf80) >> 3
      local h = hgt(c, r)
      if h > 0x20 and h < 0xd0 and hgt(c, r - 1) == h and hgt(c, r + 1) == h and hgt(c + 1, r) == h then
        -- +10/14/18 are redrawn every frame from the base position at +2c/30/34 (and +1c/1e/20)
        local nx, nz, ny = x + dx, z + dz, h * 8 + 0xe00 - 8
        for _, o in ipairs({0x10, 0x1c, 0x2c}) do sp:write_u16(0xffc000 + o, nx) end
        for _, o in ipairs({0x14, 0x1e, 0x30}) do sp:write_u16(0xffc000 + o, nz) end
        for _, o in ipairs({0x18, 0x20, 0x34}) do sp:write_u16(0xffc000 + o, ny) end
        print(string.format("hopped forward at frame %d to %x,%x", f, x + dx, z + dz))
        return
      end
    end
  end
end
-- AREA=n: start in area n (written to 0xffed4a just before the first area loads)
local START_AREA = tonumber(os.getenv("AREA") or "-1")
L.every(function(f)
  if START_AREA >= 0 and f >= 720 and f <= 730 then sp:write_u8(0xffed4a, START_AREA) end
  unstick(f)
  if f > 900 then hopIfStuck(f) end
  if os.getenv("SAVE") and f > 900 then
    -- save a state 10s into each new area (saving mid-transition does not restore cleanly)
    local area = r8(0xffed4a)
    if area ~= lastArea then saveAt = f + 600; lastArea = area end
    if saveAt and f == saveAt and area > 0 then manager.machine:save("area" .. area) end
  end
  if f > 900 then
    if r8(0xffc070) > 0 and r8(0xffc070) < 20 then sp:write_u8(0xffc070, 48) end
    sp:write_u8(0xffe018, 3)
    local me, e = enemies(f)
    local k = {}
    -- progress stalled for 20s (endless waves): ignore enemies for 10s and push on
    if f - progAt > 1200 and (f - progAt) % 1800 < 600 then e = nil end
    if e and e.a ~= chase.a then chase = { a = e.a, since = f, hp = r8(e.a + 0x70) } end
    if e and r8(e.a + 0x70) < chase.hp then chase.since = f; chase.hp = r8(e.a + 0x70) end
    if e and f - chase.since > 900 then ignore[e.a] = f + 1500; chase.a = nil; e = nil end
    if e and math.abs(e.x - me.x) < 400 then
      local dx, dz = e.x - me.x, e.z - me.z
      if dz > 3 then k.down = true elseif dz < -3 then k.up = true end
      if dx > 40 then k.right = true elseif dx < -40 then k.left = true
      elseif math.abs(dx) < 18 then if dx > 0 then k.left = true else k.right = true end end
      if math.abs(dz) <= 6 and math.abs(dx) <= 50 then
        -- face the enemy, then attack
        if (f // 24) % 2 == 0 then if dx > 0 then k.right = true; k.left = false else k.left = true; k.right = false end end
        k.attack = f % 10 < 3
      end
      -- not getting anywhere: try jumping towards it (raised walkways, ledges)
      if f - chase.since > 300 and f % 50 < 4 then k.jump = true end
    else
      wander = wander + 1
      local cam = -((w16(0xffecf8) + w16(0xffed20)) & 0xffff)
      if cam < -0x8000 then cam = cam + 0x10000 end
      local nc, nr, c0, r0 = pathRight(me.x, me.z, ((cam + 300) >> 3))
      if nc and (nc ~= c0 or nr ~= r0) and (wander // 600) % 5 ~= 4 then
        if nc > c0 then k.right = true elseif nc < c0 then k.left = true end
        if nr > r0 then k.down = true elseif nr < r0 then k.up = true end
        if hgt(c0, r0) - hgt(nc, nr) > 1 then k.jump = f % 30 < 3 end
      else
        if (wander // 90) % 6 == 5 then k.left = true else k.right = true end
        if (wander // 240) % 4 == 1 then k.up = true elseif (wander // 240) % 4 == 3 then k.down = true end
      end
      k.attack = f % 60 < 3 -- also advances text / rest scenes
    end
    -- MAPS=1: leave the scenes between areas (no HUD) to play out, and record only them, every frame
    local cut = MAPS and (L.share("textram"):read_u16(0x134) & 0x1ff) ~= 0x53
    if cut then k = {} end
    press(k)
    if MAPS then
      if cut and DUMP_FRAME then DUMP_FRAME(f) end
      goto done
    end
  end
  if L.frame % STEP == 0 and DUMP_FRAME and f >= DUMP_FROM and f <= DUMP_TO then DUMP_FRAME(f) end
  ::done::
  if SNAP > 0 and f % SNAP == 0 then L.snap() end
  if f >= FRAMES then if DUMP_CLOSE then DUMP_CLOSE() end L.exit() end
end)
