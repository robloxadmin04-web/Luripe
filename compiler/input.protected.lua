-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
local OPMAP = {
  ["PUSH"] = 29,
  ["ADD"] = 32,
  ["SUB"] = 22,
  ["MUL"] = 25,
  ["PRINT"] = 11,
  ["JMP"] = 33,
  ["JZ"] = 23,
  ["DUP"] = 26,
  ["HALT"] = 7,
  ["STORE"] = 24,
  ["LOAD"] = 30,
  ["DIV"] = 3,
  ["PUSHSTR"] = 12,
  ["POP"] = 9,
  ["LT"] = 27,
  ["GT"] = 28,
  ["LE"] = 6,
  ["GE"] = 18,
  ["EQ"] = 1,
  ["NE"] = 21,
  ["CALL"] = 4,
  ["RETURN"] = 5,
  ["NEWTABLE"] = 14,
  ["SETTABLE"] = 20,
  ["GETTABLE"] = 15,
  ["CONCAT"] = 17,
  ["BUILTIN"] = 19,
  ["TLEN"] = 31,
  ["MOD"] = 2,
  ["RETURNN"] = 13,
  ["STOREMULTI"] = 10,
  ["VARARG"] = 8,
  ["NOT"] = 16,
}

local program = {
  { 33, 57 },
  { 29, 3088 },
  { 9 },
  { 30, 0 },
  { 30, 1 },
  { 27 },
  { 23, 14 },
  { 29, 2853 },
  { 9 },
  { 30, 0 },
  { 30, 1 },
  { 13, 2 },
  { 33, 19 },
  { 29, 80581 },
  { 9 },
  { 30, 1 },
  { 30, 0 },
  { 13, 2 },
  { 29, 0 },
  { 5 },
  { 29, 86342 },
  { 9 },
  { 8, 0 },
  { 24, 0 },
  { 29, 68103 },
  { 9 },
  { 29, 0 },
  { 24, 1 },
  { 29, 29501 },
  { 9 },
  { 29, 1 },
  { 24, 2 },
  { 30, 2 },
  { 30, 0 },
  { 31 },
  { 6 },
  { 23, 51 },
  { 29, 37683 },
  { 9 },
  { 30, 1 },
  { 30, 0 },
  { 30, 2 },
  { 15 },
  { 32 },
  { 24, 1 },
  { 30, 2 },
  { 29, 1 },
  { 32 },
  { 24, 2 },
  { 33, 33 },
  { 29, 26674 },
  { 9 },
  { 30, 1 },
  { 5 },
  { 29, 0 },
  { 5 },
  { 29, 43403 },
  { 9 },
  { 29, 8 },
  { 29, 3 },
  { 4, {2,2} },
  { 10, {0,1} },
  { 29, 49578 },
  { 9 },
  { 12, {9,44,36,27,125} },
  { 30, 0 },
  { 17 },
  { 11 },
  { 29, 34589 },
  { 9 },
  { 12, {21,42,52,53,27,125} },
  { 30, 1 },
  { 17 },
  { 11 },
  { 29, 42575 },
  { 9 },
  { 12, {0,38,46,27,125} },
  { 29, 1 },
  { 29, 2 },
  { 29, 3 },
  { 29, 4 },
  { 4, {21,4} },
  { 17 },
  { 11 },
  { 7 },
}
--[[
  vm.lua  —  Luripe: ang runtime virtual machine (Lua-in-Lua)
  === STEP 11: dinagdagan ng GENERIC FOR support (ipairs/pairs) + TLEN ===

  Bago:
    - TLEN   : # ng table (bilang ng elements) -> stack
    - IPAIRS_KEYS : kinukuha ang lahat ng numeric keys ng table (para sa loop)
    - Ang generic for (for k,v in ipairs/pairs) ay ginagawang loop ng compiler
      gamit ang TLEN + GETTABLE.

  Gamitin:  VM.run(program, OPMAP, checksum)
]]

local KEY, OFFSET = 0x5A, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

local BUILTINS = {
  [1]  = function(a) return math.floor(a[1]) end,
  [2]  = function(a) return math.ceil(a[1]) end,
  [3]  = function(a) return math.abs(a[1]) end,
  [4]  = function(a) return math.max(a[1], a[2]) end,
  [5]  = function(a) return math.min(a[1], a[2]) end,
  [6]  = function(a) return string.upper(a[1]) end,
  [7]  = function(a) return string.lower(a[1]) end,
  [8]  = function(a) return #a[1] end,
  [9]  = function(a) return string.rep(a[1], a[2]) end,
  [10] = function(a) return tostring(a[1]) end,
  [11] = function(a) return tonumber(a[1]) end,
  [12] = function(a) table.insert(a[1], a[2]); return 0 end,
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
    elseif op == OP.MOD then local b = pop(); local a = pop(); push(a % b)
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
    elseif op == OP.TLEN then local t = pop(); push(#t)              -- BAGO: #table
    elseif op == OP.NOT then local a = pop(); push((a == 0 or a == false or a == nil) and 1 or 0)  -- BAGO: not x

    elseif op == OP.BUILTIN then
      local id, argc = arg[1], arg[2]
      local args = {}
      for k = argc, 1, -1 do args[k] = pop() end
      push(BUILTINS[id](args))

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

    elseif op == OP.RETURNN then                    -- BAGO: return n values
      local n = arg
      local vals = {}
      for k = n, 1, -1 do vals[k] = pop() end
      local caller = callStack[csTop]
      callStack[csTop] = nil
      csTop = csTop - 1
      frame = caller.frame
      for k = 1, n do push(vals[k]) end
      push(n)                                        -- count sa top
      ip = caller.retIp
      goto continue

    elseif op == OP.STOREMULTI then                 -- BAGO: assign n return values sa slots
      local slots = arg
      local n = pop()
      local vals = {}
      for k = n, 1, -1 do vals[k] = pop() end
      for k = 1, #slots do frame[slots[k]] = vals[k] end

    elseif op == OP.VARARG then                      -- BAGO: {...} -> table ng lahat ng extra args
      local startSlot = arg
      local t = {}
      local n = 0
      local k = startSlot
      while frame[k] ~= nil do n = n + 1; t[n] = frame[k]; k = k + 1 end
      push(t)

    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end



run(program, OPMAP, 579329)
