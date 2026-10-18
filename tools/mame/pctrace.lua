-- Log unique PCs (with registers) that write into [LO,HI] during the run; plays a simple bot.
package.path = os.getenv("LIBDIR") .. "/?.lua;" .. package.path
local L = require("lib")
local cpu = manager.machine.devices[":maincpu"]
local sp = cpu.spaces["program"]
local LO, HI = tonumber(os.getenv("LO"), 16), tonumber(os.getenv("HI"), 16)
local MASK = tonumber(os.getenv("MASK") or "0", 16)
local VAL = tonumber(os.getenv("VAL") or "0", 16)
local UNTIL = tonumber(os.getenv("UNTIL") or "3000")
L.tap("coin", 300, 6); L.tap("start", 360, 6); L.tap("attack", 700, 6)
local pcs = {}
L.at(tonumber(os.getenv("AT") or "200"), function()
  TAP = sp:install_write_tap(0, 0xffffff, "t", function(off, data, mask)
    if off < LO or off > HI or (off & MASK) ~= VAL then return end
    local k = cpu.state["PC"].value
    if pcs[k] then return end
    pcs[k] = true
    local r = {}
    for _, n in ipairs({"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6"}) do r[#r+1] = n .. "=" .. string.format("%x", cpu.state[n].value) end
    print(string.format("PC %06x f%d off %x data %04x  %s", k, L.frame, off, data, table.concat(r, " ")))
  end)
end)
L.every(function(f) if f > 900 then L.set("right", true); L.set("attack", f % 20 < 3) end if f == UNTIL then L.exit() end end)
