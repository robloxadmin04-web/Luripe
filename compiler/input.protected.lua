-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
local OPMAP = {
  ["PUSH"] = 16,
  ["ADD"] = 11,
  ["SUB"] = 17,
  ["MUL"] = 6,
  ["PRINT"] = 26,
  ["JMP"] = 2,
  ["JZ"] = 27,
  ["DUP"] = 15,
  ["HALT"] = 20,
  ["STORE"] = 10,
  ["LOAD"] = 23,
  ["DIV"] = 9,
  ["PUSHSTR"] = 8,
  ["POP"] = 14,
  ["LT"] = 12,
  ["GT"] = 24,
  ["LE"] = 13,
  ["GE"] = 22,
  ["EQ"] = 4,
  ["NE"] = 7,
  ["CALL"] = 18,
  ["RETURN"] = 3,
  ["NEWTABLE"] = 25,
  ["SETTABLE"] = 1,
  ["GETTABLE"] = 5,
  ["CONCAT"] = 19,
  ["BUILTIN"] = 21,
}

local program = {
  { 2, 2 },
  { 16, 94916 },
  { 14 },
  { 16, 1 },
  { 10, 0 },
  { 16, 75905 },
  { 14 },
  { 23, 0 },
  { 16, 5 },
  { 13 },
  { 27, 23 },
  { 16, 22628 },
  { 14 },
  { 23, 0 },
  { 26 },
  { 16, 52828 },
  { 14 },
  { 23, 0 },
  { 16, 1 },
  { 11 },
  { 10, 0 },
  { 2, 8 },
  { 16, 92778 },
  { 14 },
  { 16, 85 },
  { 10, 1 },
  { 16, 11330 },
  { 14 },
  { 23, 1 },
  { 16, 90 },
  { 22 },
  { 27, 38 },
  { 16, 39458 },
  { 14 },
  { 16, 1 },
  { 26 },
  { 2, 51 },
  { 23, 1 },
  { 16, 75 },
  { 22 },
  { 27, 47 },
  { 16, 74297 },
  { 14 },
  { 16, 2 },
  { 26 },
  { 2, 51 },
  { 16, 53155 },
  { 14 },
  { 16, 3 },
  { 26 },
  { 20 },
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

run(program, OPMAP, 540400)
