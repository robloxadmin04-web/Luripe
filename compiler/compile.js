//  compile.js  —  Luripe compiler
//  === STEP 6: HARDENING (junk instructions + opaque predicates) ===
//
//  Bago sa Step 6:
//    - JUNK INSTRUCTIONS: nagsisingit ng walang-kwentang code sa pagitan ng
//      totoong statements. Net effect sa stack = ZERO (PUSH tapos POP agad),
//      kaya tama pa rin ang takbo, pero magulo para sa nagbabasa.
//    - Bagong opcode: POP (tinatanggal ang top ng stack).
//
//  I-toggle: baguhin ang HARDENING para makita ang pagkakaiba.
//
//  Patakbuhin:  node compile.js
//  Kailangan:   npm install luaparse

const luaparse = require("luaparse");

const HARDENING = true; // <- gawing false para makita ang bytecode na walang junk

// ===== string encode config (dapat TUGMA sa VM) =====
const KEY = 0x5a,
  OFFSET = 7;
function encodeString(str) {
  const out = [];
  for (let i = 0; i < str.length; i++)
    out.push((str.charCodeAt(i) + OFFSET) ^ KEY);
  return out;
}

// ===== opcode names (dinagdagan ng POP) =====
const OPS = [
  "PUSH",
  "ADD",
  "SUB",
  "MUL",
  "PRINT",
  "JMP",
  "JZ",
  "DUP",
  "HALT",
  "STORE",
  "LOAD",
  "DIV",
  "PUSHSTR",
  "POP",
];

// ===== random opcode map (iba sa bawat build) =====
function buildOpcodeMap() {
  const nums = [];
  for (let i = 1; i <= OPS.length; i++) nums.push(i);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const map = {};
  OPS.forEach((name, i) => {
    map[name] = nums[i];
  });
  return map;
}
const OP = buildOpcodeMap();

// ====== source ======
const source = `
local name = "Luripe"
local x = 10
local y = 5
print("hello world")
print(name)
print(x + y * 2)
`;

const ast = luaparse.parse(source);

// ====== compile ======
let bytecode = [];
function emit(op, arg) {
  bytecode.push(arg === undefined ? { op } : { op, arg });
}

const scope = {};
let nextSlot = 0;
function slotFor(name) {
  if (scope[name] === undefined) scope[name] = nextSlot++;
  return scope[name];
}

// BAGO: gumawa ng junk na WALANG epekto sa stack (push garbage, pop agad)
function emitJunk() {
  if (!HARDENING) return;
  const count = 1 + Math.floor(Math.random() * 2); // 1-2 junk pairs
  for (let i = 0; i < count; i++) {
    emit(OP.PUSH, Math.floor(Math.random() * 99999));
    emit(OP.POP);
  }
}

function compileExpr(node) {
  if (node.type === "NumericLiteral") {
    emit(OP.PUSH, node.value);
  } else if (node.type === "StringLiteral") {
    let str = node.value;
    if (str === null || str === undefined) str = node.raw.slice(1, -1);
    emit(OP.PUSHSTR, encodeString(str));
  } else if (node.type === "Identifier") {
    const slot = scope[node.name];
    if (slot === undefined)
      throw new Error("hindi pa naka-declare: " + node.name);
    emit(OP.LOAD, slot);
  } else if (node.type === "BinaryExpression") {
    compileExpr(node.left);
    compileExpr(node.right);
    if (node.operator === "+") emit(OP.ADD);
    else if (node.operator === "-") emit(OP.SUB);
    else if (node.operator === "*") emit(OP.MUL);
    else if (node.operator === "/") emit(OP.DIV);
    else throw new Error("hindi sinusuportahan ang operator: " + node.operator);
  } else {
    throw new Error("hindi sinusuportahan ang expression: " + node.type);
  }
}

function compileStatement(node) {
  if (node.type === "LocalStatement") {
    for (let i = 0; i < node.variables.length; i++) {
      const name = node.variables[i].name;
      if (node.init[i]) compileExpr(node.init[i]);
      else emit(OP.PUSH, 0);
      emit(OP.STORE, slotFor(name));
    }
  } else if (node.type === "AssignmentStatement") {
    for (let i = 0; i < node.variables.length; i++) {
      const name = node.variables[i].name;
      compileExpr(node.init[i]);
      emit(OP.STORE, slotFor(name));
    }
  } else if (node.type === "CallStatement") {
    const call = node.expression;
    const fnName = call.base && call.base.name;
    if (fnName === "print") {
      compileExpr(call.arguments[0]);
      emit(OP.PRINT);
    } else {
      throw new Error("hindi sinusuportahan ang function: " + fnName);
    }
  } else {
    throw new Error("hindi sinusuportahan ang statement: " + node.type);
  }
}

// BAGO: magsingit ng junk sa pagitan ng bawat statement
for (const stmt of ast.body) {
  emitJunk();
  compileStatement(stmt);
}
emitJunk();
emit(OP.HALT);

// ====== output ======
console.log("Source:", source.trim());
console.log("\nHardening:", HARDENING ? "ON (may junk)" : "OFF");
console.log("Bilang ng instructions:", bytecode.length);
console.log("\nRANDOM opcode map:");
console.log(JSON.stringify(OP));
console.log(
  "\nBytecode (bare-number Lua table) — may junk, random opcodes, naitagong strings:",
);
const luaLines = bytecode.map((i) => {
  if (i.arg === undefined) return `  { ${i.op} },`;
  if (Array.isArray(i.arg)) return `  { ${i.op}, {${i.arg.join(",")}} },`;
  return `  { ${i.op}, ${i.arg} },`;
});
console.log("local program = {\n" + luaLines.join("\n") + "\n}");
console.log("\nOpcode map para sa VM:");
console.log(
  "local OPMAP = {\n" +
    OPS.map((n) => `  ["${n}"] = ${OP[n]},`).join("\n") +
    "\n}",
);
