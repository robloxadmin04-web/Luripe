# Luripe - Luau Obfuscator

Client-side Luau/Lua obfuscator with two protection modes and **automatic safe routing**.

## Modes

| Mode | How it runs | Protection | Compatibility |
|------|-------------|------------|---------------|
| **VM** | Compiles the script to custom bytecode run by an in-Lua interpreter | High â€” no recoverable source | Pure-logic scripts only |
| **Wrapper** | Encrypts the whole source, decodes + `load()`s at runtime | Lighter â€” source recoverable at runtime | Universal - all Luau works |

## Auto routing (the safe default)

`protect(source, { mode: "auto" })` decides the mode for you:

1. **Static pre-check** â€” if the script uses constructs the VM cannot safely virtualize
   (executor globals like `getgenv`/`hookfunction`, Roblox API like `Instance.new`/`game:GetService`,
   `coroutine.*`, `task.*`, `require`, filesystem calls), it routes straight to **wrapper mode**.
2. **VM attempt** â€” otherwise it compiles to the VM. If compilation throws, it falls back to wrapper.

This guarantees a broken VM build never reaches Roblox: logic-only scripts get maximum (VM)
protection, everything else gets a build that actually runs.

> **Note on executor / Roblox scripts.** Full-VM protection of scripts that call executor
> functions or the Roblox API (the common case for real scripts) requires the VM to pass those
> calls through to the real environment as encrypted global references â€” the roadmap item below.
> Until that lands, such scripts are auto-routed to wrapper mode.

## Usage

```bash
npm install luaparse
node compiler/luripe.js input.lua                    # -> input.protected.lua (auto mode)
node compiler/luripe.js input.lua out.lua            # custom output name
node compiler/luripe.js input.lua out.lua --mode vm  # force VM
node compiler/luripe.js input.lua out.lua --mode wrapper
```

Programmatic:

```js
const { protect, needsWrapper } = require("./compiler/luripe.js");
const res = protect(luaSource, { mode: "auto" });
// res.mode === "vm" | "wrapper", res.output === protected Lua string
```

## What the VM currently supports

Variables, arithmetic, strings & concat, `if/elseif/else`, `while`, numeric & generic `for`,
`break`, `continue`, compound assignment (`+=`), functions, **closures & upvalues**
(single and nested), **multiple returns**, varargs, tables, metatables/OOP (`setmetatable`,
`__index`, method calls), `pcall`, and common builtins (`math.*`, `string.*`,
`table.insert/remove/concat`, `tostring`, `tonumber`, `type`, `print`).

Verified against tests 1â€“7 and 9 in `examples/`. One known gap: deeply chained nested-closure
calls (`f(a)(b)(c)`) â€” see ROADMAP.

## Layout

```
compiler/luripe.js   the engine (compile + wrapperBundle + protect/auto-routing)
site/index.html      the browser UI (self-contained build)
examples/            test scripts (tests 1â€“9)
vm/                  reference VM notes
```
