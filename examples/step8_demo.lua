--[[
  step8_demo.lua  —  Luripe Step 8: FUNCTIONS na!
  Self-contained — pwede sa OneCompiler o lua.

  Kaya na ng Luripe ang functions na may parameters at return values!

      function double(n)
        return n * 2
      end

      function add(a, b)
        return a + b
      end

      print(double(21))         -- 42
      print(add(10, 5))         -- 15
      print(double(add(3, 4)))  -- 14 (nested calls)

  Inaasahang output:  42  15  14

  Paano gumagana:
    - Ang mga function bodies ay naka-compile sa itaas; may JMP para
      laktawan sila papunta sa main.
    - CALL: nagta-store ng return address + frame sa call stack, tapos
      lumukso sa function. Ang arguments -> slots 0..n-1 sa bagong frame.
    - RETURN: kinukuha ang return value, ibinabalik ang caller frame,
      babalik sa return address.
]]

local KEY, OFFSET = 0x5A, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

local OPMAP = {
  PUSH=1, ADD=2, SUB=3, MUL=4, PRINT=5, JMP=6, JZ=7, DUP=8, HALT=9,
  STORE=10, LOAD=11, DIV=12, PUSHSTR=13, POP=14, LT=15, GT=16, LE=17,
  GE=18, EQ=19, NE=20, CALL=21, RETURN=22,
}

local function run(program, OP)
  local stack, sp = {}, 0
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  local frame = {}
  local callStack, csTop = {}, 0
  local ip = 1

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
    elseif op == OP.STORE then frame[arg] = pop()
    elseif op == OP.LOAD then push(frame[arg])
    elseif op == OP.PUSHSTR then push(decodeString(arg))
    elseif op == OP.LT then local b = pop(); local a = pop(); push(a <  b and 1 or 0)
    elseif op == OP.GT then local b = pop(); local a = pop(); push(a >  b and 1 or 0)
    elseif op == OP.LE then local b = pop(); local a = pop(); push(a <= b and 1 or 0)
    elseif op == OP.GE then local b = pop(); local a = pop(); push(a >= b and 1 or 0)
    elseif op == OP.EQ then local b = pop(); local a = pop(); push(a == b and 1 or 0)
    elseif op == OP.NE then local b = pop(); local a = pop(); push(a ~= b and 1 or 0)
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.CALL then
      local funcAddr, argc = arg[1], arg[2]
      local newFrame = {}
      for k = argc - 1, 0, -1 do newFrame[k] = pop() end
      csTop = csTop + 1
      callStack[csTop] = { retIp = ip + 1, frame = frame }
      frame = newFrame
      ip = funcAddr
      goto continue
    elseif op == OP.RETURN then
      local rv = pop()
      local caller = callStack[csTop]
      callStack[csTop] = nil
      csTop = csTop - 1
      frame = caller.frame
      push(rv)
      ip = caller.retIp
      goto continue
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

-- ===== bytecode: functions + calls (na-verify na tama ang addresses) =====
-- double @ addr 2, add @ addr 8
local program = {
  { 6, 14 },      -- JMP -> main (ip 14), laktawan ang functions
  -- double(n): return n*2  @ ip 2
  { 11, 0 },      -- LOAD n
  { 1, 2 },       -- PUSH 2
  { 4 },          -- MUL
  { 22 },         -- RETURN
  { 1, 0 },       -- (safety) PUSH 0
  { 22 },         -- RETURN
  -- add(a,b): return a+b  @ ip 8
  { 11, 0 },      -- LOAD a
  { 11, 1 },      -- LOAD b
  { 2 },          -- ADD
  { 22 },         -- RETURN
  { 1, 0 },       -- (safety) PUSH 0
  { 22 },         -- RETURN
  -- main  @ ip 14
  { 1, 21 },      -- PUSH 21
  { 21, {2,1} },  -- CALL double(1 arg)
  { 5 },          -- PRINT -> 42
  { 1, 10 },      -- PUSH 10
  { 1, 5 },       -- PUSH 5
  { 21, {8,2} },  -- CALL add(2 args)
  { 5 },          -- PRINT -> 15
  { 1, 3 },       -- PUSH 3
  { 1, 4 },       -- PUSH 4
  { 21, {8,2} },  -- CALL add(3,4) -> 7
  { 21, {2,1} },  -- CALL double(7) -> 14
  { 5 },          -- PRINT -> 14
  { 9 },          -- HALT
}

run(program, OPMAP)
-- Inaasahang output:
--   42
--   15
--   14
