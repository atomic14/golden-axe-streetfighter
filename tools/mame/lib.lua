-- Shared helpers for MAME scripts: inputs, memory shares and frame scheduling.
local M = {}
local ports = manager.machine.ioport.ports
local FIELDS = {
  up = {":P1", "P1 Up"}, down = {":P1", "P1 Down"}, left = {":P1", "P1 Left"}, right = {":P1", "P1 Right"},
  attack = {":P1", "P1 Button 1"}, jump = {":P1", "P1 Button 2"}, magic = {":P1", "P1 Button 3"},
  coin = {":SERVICE", "Coin 1"}, start = {":SERVICE", "1 Player Start"},
}
function M.set(name, on)
  local f = FIELDS[name]
  ports[f[1]].fields[f[2]]:set_value(on and 1 or 0)
end
function M.release_all() for k in pairs(FIELDS) do M.set(k, false) end end
M.share = function(name) return manager.machine.memory.shares[":" .. name] end
M.rom = manager.machine.memory.regions[":maincpu"]
M.frame = 0
local tasks = {}
-- at(frame, fn): run fn at an absolute frame
function M.at(f, fn) tasks[#tasks + 1] = {f, fn} end
-- tap(name, frame, len): press a button for len frames
function M.tap(name, f, len) M.at(f, function() M.set(name, true) end); M.at(f + (len or 4), function() M.set(name, false) end) end
local each = {}
function M.every(fn) each[#each + 1] = fn end
emu.register_frame_done(function()
  M.frame = M.frame + 1
  for i = #tasks, 1, -1 do
    if tasks[i][1] == M.frame then local fn = tasks[i][2]; table.remove(tasks, i); fn() end
  end
  for _, fn in ipairs(each) do fn(M.frame) end
end)
function M.snap() manager.machine.video:snapshot() end
function M.exit() manager.machine:exit() end
return M
