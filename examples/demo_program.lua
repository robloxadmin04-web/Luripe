--[[
  step3_demo.lua  —  Luripe Step 3: patunay na may VARIABLES na
  Self-contained (kasama na ang VM sa loob) — pwede sa OneCompiler o lua.

  Ito ang OUTPUT ng compiler para sa programang:
      local x = 10
      local y = 5
      local z = x + y * 2
      print(z)

  Inaasahang sagot:  10 + (5 * 2) = 20

  Patakbuhin:  lua step3_demo.lua   (o idikit sa OneCompiler)
]]

local OP = {
  PUSH = 1, ADD = 2, SUB = 3, MUL = 4,
  PRINT = 5, JMP = 6, JZ = 7, DUP = 8, HALT = 9,
  STORE = 10, LOAD = 11, DIV = 12,
}

local function run(program)
  local stack, locals, sp, ip = {}, {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  while ip <= #program do
    local inst = program[ip]
    local op, arg = inst[1], inst[2]

    if op == OP.PUSH then push(arg)
    elseif op == OP.ADD then local b = pop(); local a = pop(); push(a + b)
    elseif op == OP.SUB then local b = pop(); local a = pop(); push(a - b)
    elseif op == OP.MUL then local b = pop(); local a = pop(); push(a * b)
    elseif op == OP.DIV then local b = pop(); local a = pop(); push(a / b)
    elseif op == OP.PRINT then print(stack[sp])
    elseif op == OP.DUP then push(stack[sp])
    elseif op == OP.STORE then locals[arg] = pop()
    elseif op == OP.LOAD then push(locals[arg])
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

-- ===== bytecode galing sa compiler (Step 3) =====
-- slots: x=0, y=1, z=2
local program = {
  { OP.PUSH, 10 },   -- x = 10
  { OP.STORE, 0 },
  { OP.PUSH, 5 },    -- y = 5
  { OP.STORE, 1 },
  { OP.LOAD, 0 },    -- x
  { OP.LOAD, 1 },    -- y
  { OP.PUSH, 2 },    -- 2
  { OP.MUL },        -- y * 2
  { OP.ADD },        -- x + (y*2)
  { OP.STORE, 2 },   -- z = ...
  { OP.LOAD, 2 },    -- print(z)
  { OP.PRINT },
  { OP.HALT },
}

run(program)
-- Inaasahang output: 20
