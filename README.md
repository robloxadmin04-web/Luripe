# Luripe

A Luau/Lua VM obfuscator that runs entirely in the browser — no server, no install.

Luripe takes readable Lua source code and turns it into a protected script: the
original code is compiled down to a **custom, randomized instruction set** and
shipped alongside a tiny **virtual machine** that only understands that
instruction set. An attacker can't just run a standard decompiler on it, because
the opcodes don't match any known Lua VM.

**Live demo:** https://luripe-4izh.onrender.com

---

## The main tool

The real, up-to-date compiler is **`compiler/luripe.js`**. (The older
`compiler/compile.js` is a step-by-step learning version and is kept only for
reference — see the note at the top of that file.)

### Command line

```
cd compiler
npm install luaparse
node luripe.js input.lua            # -> input.protected.lua
node luripe.js input.lua out.lua    # -> custom output name
```

### Web UI

Open `site/index.html` in any browser (or use the live demo). Paste your Luau
script, click **Obfuscate**, copy the output.

---

## How it works

```
[ your source .lua ]
        |
        v
  +-------------------------------------------+
  |  COMPILER  (Node / luaparse)              |
  |   1. parse   -> AST                       |
  |   2. compile -> instructions              |
  |   3. remap   -> custom randomized opcodes |
  |   4. encode  -> strings & constants       |
  |   5. serialize the bytecode blob          |
  +-------------------------------------------+
        |
        v
  +-------------------------------------------+
  |  OUTPUT .lua                              |
  |   - encoded bytecode blob                 |
  |   - a VM that decodes + runs it           |
  +-------------------------------------------+
```

## Supported Lua features

- Variables, arithmetic, string concatenation (`..`)
- `if` / `elseif` / `else`, comparisons
- `while` and numeric `for` loops
- Generic `for ... in ipairs()/pairs()`
- Functions, methods (`obj:method()`), `self`
- Multiple return values, varargs (`...`)
- Tables (`{}`, `t[k]`, `t.x`)
- Unary operators (`-x`, `not x`, `#t`)
- Built-in functions: `math.*`, `string.*`, `table.*`, `tostring`, `tonumber`, `type`

> Not yet supported: closures (`function() ... end` capturing outer locals) are
> gracefully skipped with a warning.

## Obfuscation layers

- Custom VM (virtualization)
- Randomized opcode map per build
- Per-string encryption keys
- Runtime-derived decryption key (not hardcoded)
- Opaque predicates and junk instructions
- Scrambled variable names, minified output
- Anti-tamper checksum

## Project structure

```
Luripe/
├─ compiler/
│   ├─ luripe.js     <- the main tool (compiler + bundler)
│   └─ compile.js    <- legacy step-by-step learning version
├─ vm/vm.lua         <- the runtime virtual machine
├─ site/index.html   <- web UI (deployed to Render)
├─ examples/         <- demo scripts
└─ render.yaml       <- Render static-site config
```

## License

MIT — see [LICENSE](LICENSE).
