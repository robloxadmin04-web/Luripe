--[[
  step7_demo.lua  —  Luripe Step 7: CONTROL FLOW na (if / while + comparisons)
  Self-contained — pwede sa OneCompiler o lua.

  Kaya na ng Luripe ang tunay na logic! Ang programang ito:

      local i = 0
      while i < 3 do
        print(i)        -- 0, 1, 2
        i = i + 1
      end

      local score = 75
      if score >= 60 then
        print(1)        -- pasado
      else
        print(0)
      end

  Inaasahang output:  0  1  2  1

  Ginagamit ang JMP/JZ para sa jumps, at LT/GE para sa comparisons.
]]

local KEY, OFFSET = 0x5A, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

-- ===== opcode map (kasama na ang comparisons) =====
local OPMAP = {
  PUSH=1, STORE=2, LOAD=3, PRINT=4, ADD=5, SUB=6, MUL=7,
  LT=8, GT=9, GE=10, JMP=11, JZ=12, HALT=13, POP=14, DIV=15,
  LE=16, EQ=17, NE=18, PUSHSTR=19, DUP=20,
}

local function run(program, OP)
  local stack, locals, sp, ip = {}, {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  while ip <= #program do
    local inst = program[ip]
    local op, arg = inst[1], inst[2]

    if op == OP.PUSH then push(arg)
    elseif op == OP.POP then pop()
    elseif op == OP.ADD then local b = pop(); local a = pop(); push(a + b)
    elseif op == OP.SUB then local b = pop(); local a = pop(); push(a - b)
    elseif op == OP.MUL then local b = pop(); local a = pop(); push(a * b)
    elseif op == OP.DIV then local b = pop(); local a = pop(); push(a / b)
    elseif op == OP.PRINT then print(stack[sp])
    elseif op == OP.DUP then push(stack[sp])
    elseif op == OP.STORE then locals[arg] = pop()
    elseif op == OP.LOAD then push(locals[arg])
    elseif op == OP.PUSHSTR then push(decodeString(arg))
    elseif op == OP.LT then local b = pop(); local a = pop(); push(a <  b and 1 or 0)
    elseif op == OP.GT then local b = pop(); local a = pop(); push(a >  b and 1 or 0)
    elseif op == OP.LE then local b = pop(); local a = pop(); push(a <= b and 1 or 0)
    elseif op == OP.GE then local b = pop(); local a = pop(); push(a >= b and 1 or 0)
    elseif op == OP.EQ then local b = pop(); local a = pop(); push(a == b and 1 or 0)
    elseif op == OP.NE then local b = pop(); local a = pop(); push(a ~= b and 1 or 0)
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

-- ===== bytecode: while loop + if/else (na-verify na tama ang jump addresses) =====
local program = {
  { 1, 0 },     -- i = 0
  { 2, 0 },
  -- while i < 3 do  (loopTop = ip 3)
  { 3, 0 },     -- LOAD i
  { 1, 3 },     -- PUSH 3
  { 8 },        -- LT
  { 12, 14 },   -- JZ -> ip 14 (labas ng loop)
  { 3, 0 },     -- LOAD i
  { 4 },        -- PRINT i
  { 3, 0 },     -- i = i + 1
  { 1, 1 },
  { 5 },        -- ADD
  { 2, 0 },     -- STORE i
  { 11, 3 },    -- JMP -> ip 3 (balik sa condition)
  -- score = 75  (ip 14)
  { 1, 75 },
  { 2, 1 },
  -- if score >= 60
  { 3, 1 },     -- LOAD score
  { 1, 60 },    -- PUSH 60
  { 10 },       -- GE
  { 12, 23 },   -- JZ -> ip 23 (else)
  { 1, 1 },     -- print(1)
  { 4 },
  { 11, 25 },   -- JMP -> ip 25 (dulo)
  -- else  (ip 23)
  { 1, 0 },     -- print(0)
  { 4 },
  -- end  (ip 25)
  { 13 },       -- HALT
}

run(program, OPMAP)
-- Inaasahang output:
--   0
--   1
--   2
--   1
