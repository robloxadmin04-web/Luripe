--[[
  vm.lua  â€”  Luripe: ang runtime virtual machine (Lua-in-Lua)
  === ROLLING CIPHER + CONSTANT POOL edition ===

  Bago sa bersyon na ito:
    - Rolling string decode: position- at chain-dependent ang keystream.
        ks_i = seed ~ (i * PRIME) ~ prev_encoded
        char = ((e_i ~ ks_i) & 0xFF) - OFFSET ;  prev := e_i
      Ang unang element ng encoded array ay ang per-string SEED.
    - LOADK: numeric constants ay galing sa CONSTS pool (encoded din). Walang
      literal na numero sa bytecode; index na lang ang nakikita.

  Gamitin:  VM.run(program, OPMAP, checksum, CONSTS)
]]

local OFFSET, PRIME, CMASK = 7, 167, 0xFF

local function decodeString(encoded)
  -- encoded[1] = seed ; encoded[2..] = rolling-encrypted bytes
  local seed = encoded[1]
  local prev = seed
  local chars = {}
  for i = 2, #encoded do
    local e = encoded[i]
    local ks = (seed ~ ((i - 1) * PRIME) ~ prev) & CMASK
    local c = ((e ~ ks) & CMASK) - OFFSET
    if c < 0 then c = c + 256 end
    chars[i - 1] = string.char(c & CMASK)
    prev = e
  end
  return table.concat(chars)
end

local function decodeNumber(encoded)
  return tonumber(decodeString(encoded))
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
  [13] = function(a) return math.sqrt(a[1]) end,
  [14] = function(a) return math.random(a[1], a[2]) end,
  [15] = function(a) return a[1] ^ a[2] end,
  [16] = function(a) return string.sub(a[1], a[2], a[3]) end,
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

local function run(program, OP, expectedChecksum, CONSTS)
  if expectedChecksum ~= nil and checksumOf(program) ~= expectedChecksum then
    error("Luripe: tampering detected")
  end

  -- I-decode nang maaga ang buong constant pool (once). Index -> number.
  local K = {}
  if CONSTS then
    for i = 1, #CONSTS do K[i - 1] = decodeNumber(CONSTS[i]) end  -- 0-based index mula sa compiler
  end

  local stack, sp = {}, 0
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  local frame = {}
  local upvals = {}
  local callStack, csTop = {}, 0
  local ip = 1

  while ip <= #program do
    local inst = program[ip]
    local op, arg = inst[1], inst[2]

    if op == OP.PUSH then push(arg)
    elseif op == OP.LOADK then push(K[arg])          -- BAGO: numeric constant mula sa pool
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
    elseif op == OP.TLEN then local t = pop(); push(#t)
    elseif op == OP.NOT then local a = pop(); push((a == 0 or a == false or a == nil) and 1 or 0)

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

    elseif op == OP.RETURNN then
      local n = arg
      local vals = {}
      for k = n, 1, -1 do vals[k] = pop() end
      local caller = callStack[csTop]
      callStack[csTop] = nil
      csTop = csTop - 1
      frame = caller.frame
      for k = 1, n do push(vals[k]) end
      push(n)
      ip = caller.retIp
      goto continue

    elseif op == OP.STOREMULTI then
      local slots = arg
      local n = pop()
      local vals = {}
      for k = n, 1, -1 do vals[k] = pop() end
      for k = 1, #slots do frame[slots[k]] = vals[k] end

    elseif op == OP.VARARG then
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

return { run = run, checksumOf = checksumOf }
