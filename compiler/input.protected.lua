-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Ang code sa ibaba ay naka-obfuscate: random opcodes, naitagong strings, junk.
local OPMAP = {
  ["PUSH"] = 5,
  ["ADD"] = 11,
  ["SUB"] = 9,
  ["MUL"] = 1,
  ["PRINT"] = 7,
  ["JMP"] = 8,
  ["JZ"] = 10,
  ["DUP"] = 3,
  ["HALT"] = 2,
  ["STORE"] = 4,
  ["LOAD"] = 13,
  ["DIV"] = 12,
  ["PUSHSTR"] = 14,
  ["POP"] = 6,
}

local program = {
  { 5, 32953 },
  { 6 },
  { 14, {8,50,46,38,32,33,50,125,9,38,35,42,45,54} },
  { 4, 0 },
  { 5, 13775 },
  { 6 },
  { 5, 6 },
  { 4, 1 },
  { 5, 66378 },
  { 6 },
  { 5, 88828 },
  { 6 },
  { 5, 7 },
  { 4, 2 },
  { 5, 92621 },
  { 6 },
  { 13, 0 },
  { 7 },
  { 5, 81472 },
  { 6 },
  { 5, 60741 },
  { 6 },
  { 13, 1 },
  { 13, 2 },
  { 1 },
  { 7 },
  { 5, 5443 },
  { 6 },
  { 2 },
}

local KEY, OFFSET = 90, 7
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

local function run(program, OP)
  local stack, locals, sp, ip = {}, {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end
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
    elseif op == OP.STORE then locals[arg] = pop()
    elseif op == OP.LOAD then push(locals[arg])
    elseif op == OP.PUSHSTR then push(decodeString(arg))
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end
    ip = ip + 1
    ::continue::
  end
end

run(program, OPMAP)
