-- Record sound commands: boots into service mode (quiet), then sends each command the way the
-- game does (through 0xffecfc, which the 8751 MCU forwards to the sound board) and logs the
-- time it was sent. Env: CMDS (hex list), LEN (seconds per command), OUT (log file), STOP (hex)
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local LEN = tonumber(os.getenv("LEN") or "4")
local STOP = tonumber(os.getenv("STOP") or "0", 16)
local CMDS = {}
for c in string.gmatch(os.getenv("CMDS") or "", "%x+") do CMDS[#CMDS + 1] = tonumber(c, 16) end
local f = io.open(os.getenv("OUT"), "w")
local svc = manager.machine.ioport.ports[":SERVICE"].fields["Service Mode"]
-- the 8751 MCU passes 0xffecfc on to the sound board; queue writes one per frame
local pending = {}
local function queue(c) pending[#pending + 1] = c end
local frame, idx, nextt = 0, 0, nil
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 60 then svc:set_value(1) end
  if frame == 70 then svc:set_value(0) end
  if #pending > 0 then sp:write_u8(0xfe0007, table.remove(pending, 1)) end
  if frame < 600 then return end
  local t = manager.machine.time:as_double()
  if not nextt then nextt = t end
  if t >= nextt then
    idx = idx + 1
    if idx > #CMDS then f:close(); manager.machine:exit(); return end
    if STOP ~= 0 then queue(STOP) end
    queue(CMDS[idx])
    -- commands 0x26..0x40 set the volume (the game fades music in up to 0x40)
    queue(0x40)
    f:write(string.format("%d %.6f\n", CMDS[idx], t)); f:flush()
    nextt = t + LEN
  end
end)
