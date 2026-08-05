--[[
  standalone_demo.lua  —  isang file lang, walang require, walang install setup.
  Pang-test kung gumagana ang VM logic. I-paste sa kahit anong Lua runner
  (lua.org demo, onecompiler.com/lua) o patakbuhin: lua standalone_demo.lua

  Ini-compute:  (5 + 3) * 2 = 16
]]

local OP = {
  PUSH = 1, ADD = 2, SUB = 3, MUL = 4,
  PRINT = 5, JMP = 6, JZ = 7, DUP = 8, HALT = 9,
}

local function run(program)
  local stack, sp, ip = {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  while ip <= #program do
    local inst = program[ip]
    local op, arg = inst[1], inst[2]

    if op == OP.PUSH then push(arg)
    elseif op == OP.ADD then local b = pop(); local a = pop(); push(a + b)
    elseif op == OP.SUB then local b = pop(); local a = pop(); push(a - b)
    elseif op == OP.MUL then local b = pop(); local a = pop(); push(a * b)
    elseif op == OP.PRINT then print(stack[sp])
    elseif op == OP.DUP then push(stack[sp])
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

-- ===== ang bytecode program =====
local program = {
  { OP.PUSH, 5 },
  { OP.PUSH, 3 },
  { OP.ADD },
  { OP.PUSH, 2 },
  { OP.MUL },
  { OP.PRINT },
  { OP.HALT },
}

run(program)
-- Inaasahang output: 16
