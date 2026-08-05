--[[
  step6_demo.lua  —  Luripe Step 6: HARDENING na (junk instructions)
  Self-contained — pwede sa OneCompiler o lua.

  ANG HULING HARDENING LAYER. Pansinin ang program table sa ibaba:
  may mga "junk" instructions (PUSH garbage tapos POP agad) na nakasingit sa
  totoong code. WALANG epekto sa resulta — pero nagpapagulo sa sinumang
  susubok magbasa ng bytecode.

  Buo na ang proteksyon ngayon:
    - Random opcodes bawat build  (Step 5)
    - Naitagong strings            (Step 4)
    - Junk instructions            (Step 6)  <- BAGO

  Halimbawang programa:
      local x = 10
      local y = 5
      print(x + y * 2)

  Inaasahang output:  20
]]

local KEY, OFFSET = 0x5A, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

-- ===== ANG SUSI: opcode map (kasama na ang POP) =====
local OPMAP = {
  PUSH = 7, POP = 14, STORE = 10, PUSHSTR = 13, PRINT = 8, LOAD = 1,
  ADD = 12, SUB = 6, MUL = 4, DIV = 9, JMP = 3, JZ = 5, DUP = 2, HALT = 11,
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
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

-- ===== bytecode: may JUNK na nakasingit (markadong "junk" sa comment) =====
-- Ang junk = PUSH random tapos POP agad. Net effect = wala. Pero magulo.
local program = {
  { 7, 48213 }, { 14 },        -- JUNK (push 48213, pop)
  { 7, 10 },                    -- PUSH 10
  { 10, 0 },                    -- STORE x
  { 7, 91002 }, { 14 },        -- JUNK
  { 7, 5 },                     -- PUSH 5
  { 10, 1 },                    -- STORE y
  { 7, 33 }, { 14 },           -- JUNK
  { 1, 0 },                     -- LOAD x
  { 1, 1 },                     -- LOAD y
  { 7, 2 },                     -- PUSH 2
  { 4 },                        -- MUL (y*2)
  { 12 },                       -- ADD (x + y*2)
  { 8 },                        -- PRINT
  { 7, 7777 }, { 14 },         -- JUNK
  { 11 },                       -- HALT
}

run(program, OPMAP)
-- Inaasahang output: 20
