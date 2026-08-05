# Luripe — Build Roadmap

Gawin mo ito **step by step**. Huwag mong lalaktawan — bawat hakbang ay
pundasyon ng susunod. Ang bawat milestone ay may malinaw na "tapos na" test.

---

## Step 1 — Intindihin ang VM ✅ (nandito na)

Basahin ang `vm/vm.lua`. Ito ang **puso** ng buong project.
Ito ay isang maliit na interpreter na tumatakbo ng sarili nating "instruction set".

**Test:** `lua examples/demo_program.lua` → dapat mag-print ng `55` (10th Fibonacci... o sum, tingnan mo).

**Ano ang matututunan mo:** paano tumatakbo ang bytecode — stack, registers,
instruction pointer, dispatch loop. Kapag naintindihan mo ito, naintindihan mo
ang 70% ng isang VM obfuscator.

---

## Step 2 — Compiler skeleton (Node + luaparse)

Gumawa ng `compiler/` sa Node.js:

```
cd compiler
npm init -y
npm install luaparse
```

Layunin: kunin ang isang maliit na Lua file → i-parse → i-print ang AST.

**Test:** ma-print mo ang AST ng `print("hi")` bilang JSON.

---

## Step 3 — AST → sariling instructions

Isalin ang mga simpleng AST node (numbers, +, -, print, variables)
patungo sa mga instruction na naiintindihan ng `vm.lua`.

**Test:** i-compile ang `print(1 + 2)` → tatakbo sa VM → mag-print ng `3`.

---

## Step 4 — String / constant encoding

Ang pinakamadaling "obfuscation pass". Sa halip na nakalantad na strings,
i-encode (hal. XOR + base offset) at i-decode sa loob ng VM sa runtime.

**Test:** wala nang readable string sa output file, pero tama pa rin ang takbo.

---

## Step 5 — Opcode remapping (dito na "totoong" VM obfuscator)

Sa BAWAT build, i-shuffle ang numero ng bawat opcode. Kaya't ang parehong
program ay iba't ibang bytecode sa bawat compile. Walang generic decompiler
ang makakabasa nito.

**Test:** i-compile ang parehong file ng 2 beses → magkaiba ang bytecode,
pareho ang output.

---

## Step 6 — Advanced hardening (huli, opsyonal)

- Control-flow flattening (gawing isang malaking `while+switch` ang logic)
- Junk instructions (dead code na walang epekto)
- Opaque predicates (kondisyong laging totoo pero mukhang komplikado)

---

## Tips

- **Huwag magmadali sa Step 5-6.** Marami nang tumigil sa Step 1 kasi
  gusto agad ang "encryption". Ang engine muna (VM) ang pinaka-mahalaga.
- I-commit mo sa Git ang bawat working step para may balikan ka.
- I-test palagi na TAMA pa rin ang output — madaling masira ang logic sa obfuscation.
