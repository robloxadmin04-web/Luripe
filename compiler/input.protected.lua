-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
local OPMAP = {
  ["PUSH"] = 22,
  ["ADD"] = 12,
  ["SUB"] = 24,
  ["MUL"] = 13,
  ["PRINT"] = 28,
  ["JMP"] = 17,
  ["JZ"] = 29,
  ["DUP"] = 21,
  ["HALT"] = 16,
  ["STORE"] = 8,
  ["LOAD"] = 14,
  ["DIV"] = 27,
  ["PUSHSTR"] = 7,
  ["POP"] = 6,
  ["LT"] = 4,
  ["GT"] = 20,
  ["LE"] = 11,
  ["GE"] = 25,
  ["EQ"] = 2,
  ["NE"] = 15,
  ["CALL"] = 5,
  ["RETURN"] = 18,
  ["NEWTABLE"] = 19,
  ["SETTABLE"] = 9,
  ["GETTABLE"] = 26,
  ["CONCAT"] = 10,
  ["BUILTIN"] = 1,
  ["TLEN"] = 23,
  ["MOD"] = 3,
}

local program = {
  { 17, 10 },
  { 22, 16650 },
  { 6 },
  { 14, 0 },
  { 22, 2 },
  { 13 },
  { 18 },
  { 22, 0 },
  { 18 },
  { 22, 65149 },
  { 6 },
  { 19 },
  { 8, 0 },
  { 22, 31615 },
  { 6 },
  { 14, 0 },
  { 22, 5 },
  { 1, {12,2} },
  { 6 },
  { 22, 34301 },
  { 6 },
  { 14, 0 },
  { 22, 10 },
  { 1, {12,2} },
  { 6 },
  { 22, 28026 },
  { 6 },
  { 14, 0 },
  { 22, 15 },
  { 1, {12,2} },
  { 6 },
  { 22, 52247 },
  { 6 },
  { 22, 0 },
  { 8, 1 },
  { 22, 95955 },
  { 6 },
  { 14, 0 },
  { 8, 2 },
  { 22, 0 },
  { 8, 3 },
  { 14, 3 },
  { 22, 1 },
  { 12 },
  { 8, 3 },
  { 14, 3 },
  { 14, 2 },
  { 23 },
  { 11 },
  { 29, 83 },
  { 14, 3 },
  { 8, 4 },
  { 14, 2 },
  { 14, 3 },
  { 26 },
  { 8, 5 },
  { 22, 82305 },
  { 6 },
  { 14, 5 },
  { 5, {2,1} },
  { 8, 6 },
  { 22, 39490 },
  { 6 },
  { 7, {10,33,54,46,125} },
  { 14, 4 },
  { 7, {27,125} },
  { 14, 5 },
  { 7, {125,110,31,125} },
  { 14, 6 },
  { 10 },
  { 10 },
  { 10 },
  { 10 },
  { 10 },
  { 28 },
  { 22, 39544 },
  { 6 },
  { 14, 1 },
  { 14, 6 },
  { 12 },
  { 8, 1 },
  { 17, 42 },
  { 22, 96442 },
  { 6 },
  { 7, {1,44,33,50,41,125,117,49,44,38,51,41,54,49,106,27,125} },
  { 14, 1 },
  { 10 },
  { 28 },
  { 16 },
}

local KEY, OFFSET = 90, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

local BUILTINS = {
  [1]=function(a) return math.floor(a[1]) end, [2]=function(a) return math.ceil(a[1]) end,
  [3]=function(a) return math.abs(a[1]) end, [4]=function(a) return math.max(a[1],a[2]) end,
  [5]=function(a) return math.min(a[1],a[2]) end, [6]=function(a) return string.upper(a[1]) end,
  [7]=function(a) return string.lower(a[1]) end, [8]=function(a) return #a[1] end,
  [9]=function(a) return string.rep(a[1],a[2]) end, [10]=function(a) return tostring(a[1]) end,
  [11]=function(a) return tonumber(a[1]) end, [12]=function(a) table.insert(a[1],a[2]); return 0 end,
}
local BUILTIN_ARGC = {1,1,1,2,2,1,1,1,2,1,1,2}

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
    elseif op == OP.TLEN then local t = pop(); push(#t)
    elseif op == OP.MOD then local b = pop(); local a = pop(); push(a % b)
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

run(program, OPMAP, 635426)
