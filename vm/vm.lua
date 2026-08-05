--[[
  vm.lua  —  Luripe: ang runtime virtual machine (Lua-in-Lua)
  === STEP 4: dinagdagan ng ENCODED STRINGS ===

  Bago sa Step 4:
    - PUSHSTR = kunin ang naka-encode na string (lista ng numero) sa arg,
      i-decode sa runtime (XOR + offset), tapos itulak sa stack bilang string.
    - Ang KEY at OFFSET ay dapat TUGMA sa compiler.

  Bakit ito obfuscation? Sa output file, walang makikitang "hello" — puro
  numero na lang na walang kabuluhan hangga't hindi mo alam ang decode logic.

  Format ng instruction:  { OP, arg }
]]

-- ===== decode config (dapat TUGMA sa compile.js) =====
local KEY    = 0x5A   -- 90 sa decimal — ang XOR key
local OFFSET = 7      -- idinadagdag sa bawat byte bago i-XOR sa compiler

-- =========================================================
--  ANG INSTRUCTION SET (opcodes)
-- =========================================================
local OP = {
  PUSH    = 1,
  ADD     = 2,
  SUB     = 3,
  MUL     = 4,
  PRINT   = 5,
  JMP     = 6,
  JZ      = 7,
  DUP     = 8,
  HALT    = 9,
  STORE   = 10,
  LOAD    = 11,
  DIV     = 12,
  PUSHSTR = 13,  -- BAGO: { PUSHSTR, {enc1, enc2, ...} } -> decoded string sa stack
}

-- I-decode ang isang lista ng numero pabalik sa string.
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do
    local b = encoded[i]
    b = b ~ KEY          -- alisin ang XOR (~ ay bitwise XOR sa Lua 5.3+/Luau)
    b = b - OFFSET       -- alisin ang offset
    chars[i] = string.char(b)
  end
  return table.concat(chars)
end

-- =========================================================
--  ANG VIRTUAL MACHINE
-- =========================================================
local function run(program)
  local stack, locals, sp, ip = {}, {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  while ip <= #program do
    local inst = program[ip]
    local op, arg = inst[1], inst[2]

    if op == OP.PUSH then push(arg)
    elseif op == OP.ADD then local b = pop(); local a = pop(); push(a + b)
    elseif op == OP.SUB then local b = pop(); local a = pop(); push(a - b)
    elseif op == OP.MUL then local b = pop(); local a = pop(); push(a * b)
    elseif op == OP.DIV then local b = pop(); local a = pop(); push(a / b)
    elseif op == OP.PRINT then print(stack[sp])
    elseif op == OP.DUP then push(stack[sp])
    elseif op == OP.STORE then locals[arg] = pop()
    elseif op == OP.LOAD then push(locals[arg])
    elseif op == OP.PUSHSTR then push(decodeString(arg))   -- BAGO
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end

    ip = ip + 1
    ::continue::
  end
end

return { OP = OP, run = run }
