-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
local OPMAP = {
  ["PUSH"] = 27,
  ["ADD"] = 8,
  ["SUB"] = 2,
  ["MUL"] = 21,
  ["PRINT"] = 22,
  ["JMP"] = 4,
  ["JZ"] = 20,
  ["DUP"] = 19,
  ["HALT"] = 15,
  ["STORE"] = 1,
  ["LOAD"] = 18,
  ["DIV"] = 3,
  ["PUSHSTR"] = 13,
  ["POP"] = 26,
  ["LT"] = 28,
  ["GT"] = 7,
  ["LE"] = 14,
  ["GE"] = 16,
  ["EQ"] = 6,
  ["NE"] = 17,
  ["CALL"] = 25,
  ["RETURN"] = 11,
  ["NEWTABLE"] = 10,
  ["SETTABLE"] = 29,
  ["GETTABLE"] = 5,
  ["CONCAT"] = 24,
  ["BUILTIN"] = 9,
  ["TLEN"] = 23,
  ["MOD"] = 12,
}

local program = {
  { 4, 10 },
  { 27, 52057 },
  { 26 },
  { 18, 0 },
  { 27, 2 },
  { 21 },
  { 11 },
  { 27, 0 },
  { 11 },
  { 27, 60862 },
  { 26 },
  { 10 },
  { 1, 0 },
  { 27, 17457 },
  { 26 },
  { 18, 0 },
  { 27, 5 },
  { 9, {12,2} },
  { 26 },
  { 27, 26537 },
  { 26 },
  { 18, 0 },
  { 27, 10 },
  { 9, {12,2} },
  { 26 },
  { 27, 75503 },
  { 26 },
  { 18, 0 },
  { 27, 15 },
  { 9, {12,2} },
  { 26 },
  { 27, 99217 },
  { 26 },
  { 27, 0 },
  { 1, 1 },
  { 27, 70848 },
  { 26 },
  { 18, 0 },
  { 1, 2 },
  { 27, 0 },
  { 1, 3 },
  { 18, 3 },
  { 27, 1 },
  { 8 },
  { 1, 3 },
  { 18, 3 },
  { 18, 2 },
  { 23 },
  { 14 },
  { 20, 83 },
  { 18, 3 },
  { 1, 4 },
  { 18, 2 },
  { 18, 3 },
  { 5 },
  { 1, 5 },
  { 27, 93320 },
  { 26 },
  { 18, 5 },
  { 25, {2,1} },
  { 1, 6 },
  { 27, 51243 },
  { 26 },
  { 13, {10,33,54,46,125} },
  { 18, 4 },
  { 13, {27,125} },
  { 18, 5 },
  { 13, {125,110,31,125} },
  { 18, 6 },
  { 24 },
  { 24 },
  { 24 },
  { 24 },
  { 24 },
  { 22 },
  { 27, 28760 },
  { 26 },
  { 18, 1 },
  { 18, 6 },
  { 8 },
  { 1, 1 },
  { 4, 42 },
  { 27, 41220 },
  { 26 },
  { 13, {1,44,33,50,41,125,117,49,44,38,51,41,54,49,106,27,125} },
  { 18, 1 },
  { 24 },
  { 22 },
  { 15 },
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

    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end



run(program, OPMAP, 690006)
