--[[
  demo_program.lua  —  isang programa na SULAT sa custom instruction set natin

  Ito ang makikita mo kung "manu-manong" ginawa ang bytecode.
  Sa Step 3 ng roadmap, ang COMPILER na ang gagawa nito automatically
  mula sa normal na Lua source.

  Ang program na ito ay kino-compute:  (5 + 3) * 2   =  16
  tapos ipi-print.

  Patakbuhin:  lua demo_program.lua
]]

-- Hanapin ang vm.lua (nasa parehong folder kapag na-setup mo na ang project).
-- Kung magkasama sila sa isang folder, gamitin: require("vm")
local VM = require("vm")
local OP = VM.OP

-- ===== ANG BYTECODE (lista ng instructions) =====
-- Isipin mo ito bilang isang stack calculator:
--   PUSH 5     -> stack: [5]
--   PUSH 3     -> stack: [5, 3]
--   ADD        -> stack: [8]
--   PUSH 2     -> stack: [8, 2]
--   MUL        -> stack: [16]
--   PRINT      -> ilalabas: 16
--   HALT
local program = {
  { OP.PUSH, 5 },
  { OP.PUSH, 3 },
  { OP.ADD },
  { OP.PUSH, 2 },
  { OP.MUL },
  { OP.PRINT },
  { OP.HALT },
}

VM.run(program)

-- Inaasahang output:
--   16
