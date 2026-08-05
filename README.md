# Step 2 — Compiler Skeleton

Dito na nagsisimula ang tunay na compiler. Sa halip na manu-manong sulat ng
bytecode (tulad ng ginawa natin sa `demo_program.lua`), kukuha tayo ng
**normal na Lua source** at gagawing bytecode automatically.

## Setup (isang beses lang)

Buksan ang terminal sa `compiler/` folder:

```
cd compiler
npm init -y
npm install luaparse
```

## Patakbuhin

```
node compile.js
```

Kukunin nito ang code sa loob ng `compile.js` (halimbawa: `print(1 + 2)`),
ipa-parse, gagawing bytecode, at ipi-print ang bytecode na tugma sa `vm.lua`.

## Ang daloy

```
"print(1 + 2)"
      |
      v   luaparse
   [ AST ]                 <- tree ng code structure
      |
      v   compile()        <- ang isinulat natin
[ bytecode ]               <- { PUSH 1, PUSH 2, ADD, PRINT, HALT }
      |
      v   (Step 3)
   tumatakbo sa vm.lua -> 3
```

## Ano ang sinusuportahan (sa ngayon)

- Numbers: `42`
- Addition/subtract: `1 + 2`, `10 - 3`
- Multiply: `4 * 5`
- print(): `print(1 + 2)`

Ang layunin ng Step 2 ay MALIIT: patunayan na kaya nating gawing bytecode
ang isang simpleng expression. Palalakihin natin ang sinusuportahan mamaya.
