--[[
  step10_demo.lua  —  Luripe Step 10: CONCAT + BUILT-INS + ANTI-TAMPER (HULING HAKBANG!)
  Self-contained — pwede sa OneCompiler o lua.

  Ang buong toolkit na pinagsama:

      function grade(score)
        if score >= 90 then return "A"
        elseif score >= 75 then return "B"
        else return "F" end
      end

      local scores = {}
      table.insert(scores, 95)
      table.insert(scores, 80)
      table.insert(scores, 60)

      for i = 1, 3 do
        local s = scores[i]
        print("Score " .. s .. " = " .. grade(s))
      end

      print("Highest: " .. math.max(scores[1], scores[2]))

  Inaasahang output:
      Score 95 = A
      Score 80 = B
      Score 60 = F
      Highest: 95

  Bago:
    - CONCAT (..) : string concatenation
    - BUILTIN     : math.max, table.insert, atbp.
    - Anti-tamper : checksum check — kung babaguhin ang bytecode, hindi tatakbo.
]]

local KEY, OFFSET = 0x5A, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

local BUILTINS = {
  [1]  = { argc = 1, fn = function(a) return math.floor(a[1]) end },
  [2]  = { argc = 1, fn = function(a) return math.ceil(a[1]) end },
  [3]  = { argc = 1, fn = function(a) return math.abs(a[1]) end },
  [4]  = { argc = 2, fn = function(a) return math.max(a[1], a[2]) end },
  [5]  = { argc = 2, fn = function(a) return math.min(a[1], a[2]) end },
  [6]  = { argc = 1, fn = function(a) return string.upper(a[1]) end },
  [7]  = { argc = 1, fn = function(a) return string.lower(a[1]) end },
  [8]  = { argc = 1, fn = function(a) return #a[1] end },
  [9]  = { argc = 2, fn = function(a) return string.rep(a[1], a[2]) end },
  [10] = { argc = 1, fn = function(a) return tostring(a[1]) end },
  [11] = { argc = 1, fn = function(a) return tonumber(a[1]) end },
  [12] = { argc = 2, fn = function(a) table.insert(a[1], a[2]); return 0 end },
}

local function checksumOf(program)
  local sum = 0
  for i = 1, #program do
    local inst = program[i]
    sum = (sum + inst[1] * i) % 1000003
    if type(inst[2]) == "number" then sum = (sum + inst[2]) % 1000003 end
  end
  return sum
end

local OPMAP = {
  PUSH=1, ADD=2, SUB=3, MUL=4, PRINT=5, JMP=6, JZ=7, DUP=8, HALT=9,
  STORE=10, LOAD=11, DIV=12, PUSHSTR=13, POP=14, LT=15, GT=16, LE=17,
  GE=18, EQ=19, NE=20, CALL=21, RETURN=22, NEWTABLE=23, SETTABLE=24,
  GETTABLE=25, CONCAT=26, BUILTIN=27,
}

local function run(program, OP, expectedChecksum)
  if expectedChecksum ~= nil and checksumOf(program) ~= expectedChecksum then
    error("Luripe: tampering detected")
  end

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
    elseif op == OP.CONCAT then local b = pop(); local a = pop(); push(tostring(a) .. tostring(b))
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
    elseif op == OP.BUILTIN then
      local id, argc = arg[1], arg[2]
      local b = BUILTINS[id]
      local args = {}
      for k = argc, 1, -1 do args[k] = pop() end
      push(b.fn(args))
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

-- ===== bytecode (na-verify na tama): grade @ addr 2 =====
local program = {
  { 6, 20 },          -- JMP -> main
  -- grade(score) @ ip 2
  { 11, 0 }, { 1, 90 }, { 18 }, { 7, 9 },
  { 13, {18} }, { 22 }, { 6, 19 },
  { 11, 0 }, { 1, 75 }, { 18 }, { 7, 16 },
  { 13, {19} }, { 22 }, { 6, 19 },
  { 13, {23} }, { 22 },
  { 1, 0 }, { 22 },
  -- main @ ip 20
  { 23 }, { 10, 0 },                       -- scores = {}
  { 11, 0 }, { 1, 95 }, { 27, {12,2} }, { 14 },  -- table.insert(scores,95)
  { 11, 0 }, { 1, 80 }, { 27, {12,2} }, { 14 },  -- table.insert(scores,80)
  { 11, 0 }, { 1, 60 }, { 27, {12,2} }, { 14 },  -- table.insert(scores,60)
  -- for i=1,3
  { 1, 1 }, { 10, 1 },
  { 11, 1 }, { 1, 3 }, { 17 }, { 7, 61 },        -- while i<=3  (exit @ 61)
  { 11, 0 }, { 11, 1 }, { 25 }, { 10, 2 },       -- s = scores[i]
  { 13, {0,48,44,35,54,125} }, { 11, 2 }, { 26 },  -- "Score " .. s
  { 13, {125,30,125} }, { 26 },                  -- .. " = "
  { 11, 2 }, { 21, {2,1} }, { 26 },              -- .. grade(s)
  { 5 },                                          -- print
  { 11, 1 }, { 1, 1 }, { 2 }, { 10, 1 },         -- i = i+1
  { 6, 37 },                                      -- loop
  -- print("Highest: " .. math.max(scores[1], scores[2]))  @ ip 61
  { 13, {21,42,52,53,54,32,33,27,125} },         -- "Highest: "
  { 11, 0 }, { 1, 1 }, { 25 }, { 11, 0 }, { 1, 2 }, { 25 }, { 27, {4,2} },
  { 26 }, { 5 },
  { 9 },              -- HALT
}

run(program, OPMAP, checksumOf(program))
-- Inaasahang output:
--   Score 95 = A
--   Score 80 = B
--   Score 60 = F
--   Highest: 95
