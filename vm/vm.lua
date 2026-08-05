--[[
  vm.lua  —  Luripe: ang runtime virtual machine (Lua-in-Lua)

  Ito ang PUSO ng buong obfuscator. Isang maliit na interpreter na
  tumatakbo ng sarili nating "custom instruction set".

  Paano ito gumagana:
    - May LISTA tayo ng instructions (ang "program" / bytecode).
    - May STACK tayo — dito nakalagay ang mga values habang nag-compute.
    - May instruction pointer (ip) — kung anong instruction ang susunod.
    - Isang while-loop (ang "dispatch loop") ang bumabasa ng bawat
      instruction at ginagawa ang tamang aksyon.

  Sa totoong Luraph: ang mga opcode number na ito ay RANDOMIZED sa bawat
  build, at ang bytecode ay naka-encode. Pero pareho ang KONSEPTO nito.

  Format ng isang instruction:  { OP, arg }
]]

-- =========================================================
--  ANG INSTRUCTION SET (opcodes)
--  Sa Step 5 ng roadmap, sisimulan mong i-randomize ang mga numerong ito.
-- =========================================================
local OP = {
  PUSH  = 1,   -- itulak ang isang constant sa stack:     { PUSH, value }
  ADD   = 2,   -- kunin ang top 2, idagdag, ibalik ang sum
  SUB   = 3,   -- kunin ang top 2, ibawas
  MUL   = 4,   -- kunin ang top 2, i-multiply
  PRINT = 5,   -- i-print ang top ng stack (hindi tinatanggal)
  JMP   = 6,   -- lumukso sa index:                       { JMP, target }
  JZ    = 7,   -- lumukso kung ang top == 0:              { JZ, target }
  DUP   = 8,   -- kopyahin ang top ng stack
  HALT  = 9,   -- tigil
}

-- =========================================================
--  ANG VIRTUAL MACHINE
-- =========================================================
local function run(program)
  local stack = {}
  local sp = 0            -- stack pointer (ilan ang laman)
  local ip = 1           -- instruction pointer (nasaan tayo)

  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop()   local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end

  -- ANG DISPATCH LOOP — bawat ikot = isang instruction
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

    elseif op == OP.PRINT then
      print(stack[sp])

    elseif op == OP.DUP then
      push(stack[sp])

    elseif op == OP.JMP then
      ip = arg
      goto continue          -- laktawan ang ip = ip + 1

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

-- I-export para magamit ng ibang file
return { OP = OP, run = run }
