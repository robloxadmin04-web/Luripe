--[[
  run_compiled.lua  —  Luripe Step 2: patakbuhin ang OUTPUT ng compiler

  Ang compile.js ay nag-print ng "Lua program table". Kopyahin mo ang table na
  'yon dito (sa ilalim), tapos patakbuhin ang file na ito para makita ang resulta.

  Ito ang nagpapatunay: normal na Lua source -> compiler -> bytecode -> VM -> resulta.

  Patakbuhin:  lua run_compiled.lua   (mula sa examples/ na katabi ng vm/)
  O sa OneCompiler: idikit ang buong vm.lua sa taas nito (alisin ang require).
]]

-- Hanapin ang VM (mula sa examples/ papuntang vm/vm.lua)
local VM = dofile("../vm/vm.lua")
local OP = VM.OP

-- ====== IDIKIT DITO ang "Lua program table" galing sa compile.js ======
-- Halimbawa: output ng compiler para sa  print(1 + 2)
local program = {
  { OP.PUSH, 1 },
  { OP.PUSH, 2 },
  { OP.ADD },
  { OP.PRINT },
  { OP.HALT },
}

VM.run(program)
-- Inaasahang output: 3
