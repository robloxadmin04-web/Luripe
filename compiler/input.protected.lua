-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
local OPMAP = {
  ["PUSH"] = 40,
  ["ADD"] = 36,
  ["SUB"] = 18,
  ["MUL"] = 32,
  ["PRINT"] = 15,
  ["JMP"] = 28,
  ["JZ"] = 11,
  ["DUP"] = 16,
  ["HALT"] = 31,
  ["STORE"] = 25,
  ["LOAD"] = 5,
  ["DIV"] = 21,
  ["PUSHSTR"] = 38,
  ["POP"] = 9,
  ["LT"] = 3,
  ["GT"] = 2,
  ["LE"] = 1,
  ["GE"] = 23,
  ["EQ"] = 10,
  ["NE"] = 12,
  ["CALL"] = 20,
  ["RETURN"] = 30,
  ["NEWTABLE"] = 14,
  ["SETTABLE"] = 6,
  ["GETTABLE"] = 29,
  ["CONCAT"] = 27,
  ["BUILTIN"] = 17,
  ["TLEN"] = 37,
  ["MOD"] = 13,
  ["RETURNN"] = 7,
  ["STOREMULTI"] = 33,
  ["VARARG"] = 35,
  ["NOT"] = 22,
  ["NEWCELL"] = 34,
  ["LOADCELL"] = 8,
  ["STORECELL"] = 39,
  ["LOADUP"] = 24,
  ["STOREUP"] = 4,
  ["CLOSURE"] = 26,
  ["CALLC"] = 19,
}

local program = {
  { 28, 29 },
  { 40, 42894 },
  { 9 },
  { 5, 0 },
  { 40, 2 },
  { 32 },
  { 30 },
  { 40, 0 },
  { 30 },
  { 40, 56505 },
  { 9 },
  { 5, 0 },
  { 5, 1 },
  { 3 },
  { 11, 22 },
  { 40, 47647 },
  { 9 },
  { 5, 0 },
  { 5, 1 },
  { 7, 2 },
  { 28, 27 },
  { 40, 6238 },
  { 9 },
  { 5, 1 },
  { 5, 0 },
  { 7, 2 },
  { 40, 0 },
  { 30 },
  { 40, 29291 },
  { 9 },
  { 14 },
  { 25, 0 },
  { 40, 81502 },
  { 9 },
  { 5, 0 },
  { 40, 5 },
  { 17, {12,2} },
  { 9 },
  { 40, 14917 },
  { 9 },
  { 5, 0 },
  { 40, 10 },
  { 17, {12,2} },
  { 9 },
  { 40, 71479 },
  { 9 },
  { 5, 0 },
  { 40, 15 },
  { 17, {12,2} },
  { 9 },
  { 40, 57316 },
  { 9 },
  { 40, 0 },
  { 25, 1 },
  { 40, 39832 },
  { 9 },
  { 5, 0 },
  { 25, 2 },
  { 40, 0 },
  { 25, 3 },
  { 5, 3 },
  { 40, 1 },
  { 36 },
  { 25, 3 },
  { 5, 3 },
  { 5, 2 },
  { 37 },
  { 1 },
  { 11, 102 },
  { 5, 3 },
  { 25, 4 },
  { 5, 2 },
  { 5, 3 },
  { 29 },
  { 25, 5 },
  { 40, 48619 },
  { 9 },
  { 5, 5 },
  { 20, {2,1} },
  { 25, 6 },
  { 40, 68630 },
  { 9 },
  { 38, {10,33,54,46,125} },
  { 5, 4 },
  { 38, {27,125} },
  { 5, 5 },
  { 38, {125,110,31,125} },
  { 5, 6 },
  { 27 },
  { 27 },
  { 27 },
  { 27 },
  { 27 },
  { 15 },
  { 40, 11850 },
  { 9 },
  { 5, 1 },
  { 5, 6 },
  { 36 },
  { 25, 1 },
  { 28, 61 },
  { 40, 19874 },
  { 9 },
  { 38, {1,44,33,50,41,125,117,49,44,38,51,41,54,49,106,27,125} },
  { 5, 1 },
  { 27 },
  { 15 },
  { 40, 32223 },
  { 9 },
  { 40, 8 },
  { 40, 3 },
  { 20, {10,2} },
  { 33, {7,8} },
  { 40, 55131 },
  { 9 },
  { 38, {14,42,47,27,125} },
  { 5, 7 },
  { 38, {125,14,50,37,27,125} },
  { 5, 8 },
  { 27 },
  { 27 },
  { 27 },
  { 15 },
  { 40, 59007 },
  { 9 },
  { 38, {19,42,52,52,54,32,33,125,42,47,125,41,42,32,33,27,125} },
  { 5, 0 },
  { 40, 1 },
  { 29 },
  { 5, 0 },
  { 40, 3 },
  { 29 },
  { 17, {4,2} },
  { 27 },
  { 15 },
  { 31 },
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
  -- === BAGO: mas maraming built-ins ===
  [13] = function(a) return math.sqrt(a[1]) end,
  [14] = function(a) return math.random(a[1], a[2]) end,
  [15] = function(a) return a[1] ^ a[2] end,                     -- math.pow
  [16] = function(a) return string.sub(a[1], a[2], a[3]) end,    -- string.sub
  [17] = function(a) return string.format(a[1], a[2], a[3], a[4]) end,
  [18] = function(a) return string.reverse(a[1]) end,
  [19] = function(a) return string.byte(a[1], a[2]) end,
  [20] = function(a) return string.char(a[1]) end,
  [21] = function(a) return table.remove(a[1], a[2]) end,
  [22] = function(a) return table.concat(a[1], a[2] or "") end,
  [23] = function(a) return type(a[1]) end,
  [24] = function(a) return math.sin(a[1]) end,
  [25] = function(a) return math.cos(a[1]) end,
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
  local upvals = {}          -- BAGO: upvalues ng kasalukuyang closure
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

    elseif op == OP.RETURNN then                    -- return n values
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



run(program, OPMAP, 954343)
