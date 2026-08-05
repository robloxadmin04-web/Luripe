-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
local OPMAP = {
  ["PUSH"] = 3,
  ["ADD"] = 12,
  ["SUB"] = 7,
  ["MUL"] = 5,
  ["PRINT"] = 26,
  ["JMP"] = 6,
  ["JZ"] = 16,
  ["DUP"] = 19,
  ["HALT"] = 23,
  ["STORE"] = 28,
  ["LOAD"] = 10,
  ["DIV"] = 9,
  ["PUSHSTR"] = 21,
  ["POP"] = 17,
  ["LT"] = 8,
  ["GT"] = 15,
  ["LE"] = 29,
  ["GE"] = 1,
  ["EQ"] = 14,
  ["NE"] = 22,
  ["CALL"] = 4,
  ["RETURN"] = 27,
  ["NEWTABLE"] = 11,
  ["SETTABLE"] = 20,
  ["GETTABLE"] = 25,
  ["CONCAT"] = 24,
  ["BUILTIN"] = 18,
  ["TLEN"] = 13,
  ["MOD"] = 2,
}

local program = {
  { 6, 28 },
  { 3, 25197 },
  { 17 },
  { 11 },
  { 28, 1 },
  { 3, 32802 },
  { 17 },
  { 10, 1 },
  { 21, {47,50,46,54} },
  { 10, 0 },
  { 20 },
  { 3, 3483 },
  { 17 },
  { 10, 1 },
  { 27 },
  { 3, 0 },
  { 27 },
  { 3, 21651 },
  { 17 },
  { 10, 0 },
  { 21, {47,50,46,54} },
  { 25 },
  { 21, {125,51,50,35,40,32,114} },
  { 24 },
  { 27 },
  { 3, 0 },
  { 27 },
  { 3, 51965 },
  { 17 },
  { 11 },
  { 28, 0 },
  { 3, 95824 },
  { 17 },
  { 21, {3,54,37} },
  { 4, {2,1} },
  { 28, 1 },
  { 3, 22932 },
  { 17 },
  { 21, {19,38,49,49,218} },
  { 4, {2,1} },
  { 28, 2 },
  { 3, 63042 },
  { 17 },
  { 10, 1 },
  { 4, {18,1} },
  { 26 },
  { 3, 6104 },
  { 17 },
  { 10, 2 },
  { 4, {18,1} },
  { 26 },
  { 23 },
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



run(program, OPMAP, 343448)
