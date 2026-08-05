--[[
  step5_demo.lua  —  Luripe Step 5: OPCODE REMAPPING na
  Self-contained — pwede sa OneCompiler o lua.

  ANG PINAKA-MAHALAGANG HAKBANG. Pansinin ang program table sa ibaba:
  puro numero na lang — WALANG OP.PUSH, walang OP.ADD, walang readable string.
  At sa bawat compile, IBA-IBA ang mga numerong ito (dahil random ang opcode map).

  Para maintindihan pa rin ng VM, kasama ang OPMAP (galing sa compiler).
  Ito ang eksaktong ginagawa ng Luraph: random opcodes bawat build,
  na may kasamang "susi" (map) na naiintindihan lang ng katugmang VM.

  Halimbawang programa:
      local name = "Luripe"
      local x = 10
      local y = 5
      print("hello world")
      print(name)
      print(x + y * 2)

  Inaasahang output:
      hello world
      Luripe
      20
]]

local KEY, OFFSET = 0x5A, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

-- ===== ANG SUSI: opcode map galing sa compiler (iba sa bawat build) =====
-- Palitan mo ito ng OPMAP na lumabas sa `node compile.js`.
-- Ang halimbawang ito ay tugma sa program table sa ibaba.
local OPMAP = {
  PUSH = 3, STORE = 2, PUSHSTR = 1, PRINT = 7, LOAD = 5,
  ADD = 13, SUB = 8, MUL = 4, DIV = 6, JMP = 10, JZ = 12, DUP = 9, HALT = 11,
}

local function run(program, OP)
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

-- ===== bytecode: PURO NUMERO na lang — walang OP.NAMES, walang string! =====
-- (tugma sa OPMAP sa taas: PUSHSTR=1, STORE=2, PUSH=3, MUL=4, LOAD=5, PRINT=7, ADD=13, HALT=11)
local program = {
  { 1, {9,38,35,42,45,54} },              -- PUSHSTR "Luripe"
  { 2, 0 },                                -- STORE name(0)
  { 3, 10 },                               -- PUSH 10
  { 2, 1 },                                -- STORE x(1)
  { 3, 5 },                                -- PUSH 5
  { 2, 2 },                                -- STORE y(2)
  { 1, {53,54,41,41,44,125,36,44,35,41,49} }, -- PUSHSTR "hello world"
  { 7 },                                   -- PRINT
  { 5, 0 },                                -- LOAD name
  { 7 },                                   -- PRINT
  { 5, 1 },                                -- LOAD x
  { 5, 2 },                                -- LOAD y
  { 3, 2 },                                -- PUSH 2
  { 4 },                                   -- MUL (y*2)
  { 13 },                                  -- ADD (x + y*2)
  { 7 },                                   -- PRINT
  { 11 },                                  -- HALT
}

run(program, OPMAP)
-- Inaasahang output:
--   hello world
--   Luripe
--   20
