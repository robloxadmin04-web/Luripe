--[[
  step9_demo.lua  —  Luripe Step 9: FOR LOOPS + TABLES na!
  Self-contained — pwede sa OneCompiler o lua.

  Pinagsama: functions + for loops + tables.

      function square(n)
        return n * n
      end

      local t = {}
      for i = 1, 5 do
        t[i] = square(i)
      end

      for i = 1, 5 do
        print(t[i])
      end

  Inaasahang output:  1  4  9  16  25

  Bago:
    - for i = a, b do ... end  -> ginagawang while ng compiler
    - Tables: NEWTABLE (gumawa), SETTABLE (t[k]=v), GETTABLE (t[k])
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
  GE=18, EQ=19, NE=20, CALL=21, RETURN=22, NEWTABLE=23, SETTABLE=24, GETTABLE=25,
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
    elseif op == OP.NEWTABLE then push({})
    elseif op == OP.SETTABLE then local v = pop(); local k = pop(); local t = pop(); t[k] = v
    elseif op == OP.GETTABLE then local k = pop(); local t = pop(); push(t[k])
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

-- ===== bytecode (na-verify na tama): square @ addr 2 =====
local program = {
  { 6, 8 },       -- JMP -> main
  -- square(n): return n*n  @ ip 2
  { 11, 0 }, { 11, 0 }, { 4 }, { 22 },
  { 1, 0 }, { 22 },
  -- main @ ip 8
  { 23 }, { 10, 0 },              -- t = {}
  -- for i=1,5 do t[i]=square(i) end
  { 1, 1 }, { 10, 1 },           -- i = 1
  { 11, 1 }, { 1, 5 }, { 17 }, { 7, 26 },   -- while i<=5
  { 11, 0 }, { 11, 1 },          -- t, i
  { 11, 1 }, { 21, {2,1} },      -- square(i)
  { 24 },                        -- t[i] = ...
  { 11, 1 }, { 1, 1 }, { 2 }, { 10, 1 },   -- i = i+1
  { 6, 12 },                     -- loop
  -- for i=1,5 do print(t[i]) end
  { 1, 1 }, { 10, 1 },           -- i = 1
  { 11, 1 }, { 1, 5 }, { 17 }, { 7, 41 },   -- while i<=5
  { 11, 0 }, { 11, 1 }, { 25 }, { 5 },      -- print(t[i])
  { 11, 1 }, { 1, 1 }, { 2 }, { 10, 1 },    -- i = i+1
  { 6, 28 },                     -- loop
  { 9 },                         -- HALT
}

run(program, OPMAP)
-- Inaasahang output:
--   1
--   4
--   9
--   16
--   25
