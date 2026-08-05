# Luripe

A custom Lua/Luau virtual-machine obfuscator — like Luraph.

Luripe takes readable Lua source code and turns it into a protected script:
the original code is compiled down to a **custom, randomized instruction set**
and shipped alongside a tiny **virtual machine** that only understands _that_
instruction set. An attacker can't just run a standard decompiler on it, because
the opcodes don't match any known Lua VM.

---

## The big picture

```
[ your source .lua ]
        |
        v
  +-------------------------------------------+
  |  COMPILER  (Node / TypeScript)            |
  |   1. parse   -> AST                       |
  |   2. compile -> instructions              |
  |   3. remap   -> custom randomized opcodes |
  |   4. encode  -> strings & constants       |
  |   5. serialize the bytecode blob          |
  +-------------------------------------------+
        |
        v
  +-------------------------------------------+
  |  OUTPUT .lua  (ships to Roblox/FiveM/etc) |
  |   - encoded bytecode blob                 |
  |   - a VM that decodes + runs it           |
  +-------------------------------------------+
```

---

## Project layout

```
Luripe/
├─ README.md            <- this file
├─ ROADMAP.md           <- build order, step by step
├─ vm/
│   └─ vm.lua           <- the runtime interpreter (Lua-in-Lua VM)
├─ compiler/            <- (later) the AST -> bytecode compiler in Node
│   └─ .gitkeep
└─ examples/
    └─ demo_program.lua <- a hand-written program in our custom instruction set
```

## Start here

Read `ROADMAP.md`, then open `vm/vm.lua`. Run the demo with:

```
lua examples/demo_program.lua
```

(You need `lua` installed, or paste it into a Luau/Roblox executor.)
