--[[
  step4_demo.lua  —  Luripe Step 4: ENCODED STRINGS na
  Self-contained (kasama na ang VM) — pwede sa OneCompiler o lua.

  Ito ang OUTPUT ng compiler para sa programang:
      local name = "Luripe"
      print("hello world")
      print(name)

  PANSININ: sa program table sa ibaba, WALANG makikitang "hello" o "Luripe" —
  puro numero na lang! Pero pag-run, magpi-print pa rin ng tamang string.
  Ito na ang unang tunay na OBFUSCATION.

  Inaasahang output:
      hello world
      Luripe
]]

-- ===== decode config (dapat TUGMA sa compiler) =====
local KEY    = 0x5A
local OFFSET = 7

local OP = {
  PUSH = 1, ADD = 2, SUB = 3, MUL = 4,
  PRINT = 5, JMP = 6, JZ = 7, DUP = 8, HALT = 9,
  STORE = 10, LOAD = 11, DIV = 12, PUSHSTR = 13,
}

local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do
    local b = encoded[i]
    b = b ~ KEY
    b = b - OFFSET
    chars[i] = string.char(b)
  end
  return table.concat(chars)
end

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
    elseif op == OP.PUSHSTR then push(decodeString(arg))
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

-- ===== bytecode galing sa compiler (Step 4) =====
-- slots: name=0
-- Tignan mo: {9,38,35,42,45,54} = "Luripe" naka-encode. Walang readable string!
local program = {
  { OP.PUSHSTR, {9,38,35,42,45,54} },              -- "Luripe"
  { OP.STORE, 0 },                                  -- name = ...
  { OP.PUSHSTR, {53,54,41,41,44,125,36,44,35,41,49} }, -- "hello world"
  { OP.PRINT },                                     -- print("hello world")
  { OP.LOAD, 0 },                                   -- name
  { OP.PRINT },                                     -- print(name)
  { OP.HALT },
}

run(program)
-- Inaasahang output:
--   hello world
--   Luripe
