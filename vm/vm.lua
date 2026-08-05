--[[
  vm.lua  —  Luripe: ang runtime virtual machine (Lua-in-Lua)
  === STEP 3: dinagdagan ng VARIABLES (STORE / LOAD) ===

  Ito ang PUSO ng buong obfuscator. Isang maliit na interpreter na
  tumatakbo ng sarili nating "custom instruction set".

  Bago sa Step 3:
    - May "locals" table na tayo — dito nakalagay ang mga variable.
    - STORE  = kunin ang top ng stack, ilagay sa variable slot #n
    - LOAD   = kunin ang variable slot #n, itulak sa stack

  Format ng isang instruction:  { OP, arg }
]]

-- =========================================================
--  ANG INSTRUCTION SET (opcodes)
-- =========================================================
local OP = {
  PUSH  = 1,   -- itulak ang constant sa stack:            { PUSH, value }
  ADD   = 2,   -- top2 -> a + b
  SUB   = 3,   -- top2 -> a - b
  MUL   = 4,   -- top2 -> a * b
  PRINT = 5,   -- i-print ang top (hindi tinatanggal)
  JMP   = 6,   -- lumukso:                                 { JMP, target }
  JZ    = 7,   -- lumukso kung top == 0:                   { JZ, target }
  DUP   = 8,   -- kopyahin ang top
  HALT  = 9,   -- tigil
  STORE = 10,  -- top -> variable slot:                    { STORE, slot }
  LOAD  = 11,  -- variable slot -> stack:                  { LOAD, slot }
  DIV   = 12,  -- top2 -> a / b
}

-- =========================================================
--  ANG VIRTUAL MACHINE
-- =========================================================
local function run(program)
  local stack  = {}
  local locals = {}      -- BAGO: dito nakatago ang mga variable (by slot number)
  local sp = 0
  local ip = 1

  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop()   local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  while ip <= #program do
    local inst = program[ip]
    local op   = inst[1]
    local arg  = inst[2]

    if op == OP.PUSH then
      push(arg)

    elseif op == OP.ADD then
      local b = pop(); local a = pop(); push(a + b)

    elseif op == OP.SUB then
      local b = pop(); local a = pop(); push(a - b)

    elseif op == OP.MUL then
      local b = pop(); local a = pop(); push(a * b)

    elseif op == OP.DIV then
      local b = pop(); local a = pop(); push(a / b)

    elseif op == OP.PRINT then
      print(stack[sp])

    elseif op == OP.DUP then
      push(stack[sp])

    elseif op == OP.STORE then          -- BAGO
      locals[arg] = pop()

    elseif op == OP.LOAD then           -- BAGO
      push(locals[arg])

    elseif op == OP.JMP then
      ip = arg
      goto continue

    elseif op == OP.JZ then
      local top = pop()
      if top == 0 then
        ip = arg
        goto continue
      end

    elseif op == OP.HALT then
      break

    else
      error("hindi kilalang opcode: " .. tostring(op))
    end

    ip = ip + 1
    ::continue::
  end
end

return { OP = OP, run = run }
