//  compile.js  —  Luripe compiler
//  === STEP 4: dinagdagan ng STRING ENCODING (unang obfuscation pass) ===
//
//  Patakbuhin:  node compile.js
//  Kailangan:   npm install luaparse

const luaparse = require("luaparse");

// ===== encode config (dapat TUGMA sa vm.lua) =====
const KEY = 0x5a; // 90 — XOR key
const OFFSET = 7; // idinadagdag sa bawat byte BAGO i-XOR

// I-encode ang string: bawat char -> (code + OFFSET) XOR KEY
// Sa VM, kabaligtaran: (num XOR KEY) - OFFSET -> char
function encodeString(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let b = str.charCodeAt(i);
    b = b + OFFSET;
    b = b ^ KEY;
    out.push(b);
  }
  return out;
}

// ====== ang mga opcode (dapat TUGMA sa vm.lua) ======
const OP = {
  PUSH: 1,
  ADD: 2,
  SUB: 3,
  MUL: 4,
  PRINT: 5,
  JMP: 6,
  JZ: 7,
  DUP: 8,
  HALT: 9,
  STORE: 10,
  LOAD: 11,
  DIV: 12,
  PUSHSTR: 13,
};

// ====== ang source na ico-compile natin ======
const source = `
local name = "Luripe"
print("hello world")
print(name)
`;

// ====== 1. PARSE ======
const ast = luaparse.parse(source);

// ====== 2. COMPILE ======
const bytecode = [];
function emit(op, arg) {
  bytecode.push(arg === undefined ? { op } : { op, arg });
}

const scope = {};
let nextSlot = 0;
function slotFor(name) {
  if (scope[name] === undefined) scope[name] = nextSlot++;
  return scope[name];
}

function compileExpr(node) {
  if (node.type === "NumericLiteral") {
    emit(OP.PUSH, node.value);
  } else if (node.type === "StringLiteral") {
    // BAGO: string -> encoded
    // luaparse: bagong version = node.value null, nasa node.raw (may quotes) ang string.
    // Kunin ang value kung meron; kung wala, hanguin sa raw (tanggalin ang quotes).
    let str = node.value;
    if (str === null || str === undefined) {
      str = node.raw.slice(1, -1); // tanggalin ang unang at huling quote
    }
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
    else
      throw new Error("hindi pa sinusuportahan ang operator: " + node.operator);
  } else {
    throw new Error("hindi pa sinusuportahan ang expression: " + node.type);
  }
}

function compileStatement(node) {
  if (node.type === "LocalStatement") {
    for (let i = 0; i < node.variables.length; i++) {
      const name = node.variables[i].name;
      const initExpr = node.init[i];
      if (initExpr) compileExpr(initExpr);
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
      throw new Error("hindi pa sinusuportahan ang function: " + fnName);
    }
  } else {
    throw new Error("hindi pa sinusuportahan ang statement: " + node.type);
  }
}

for (const stmt of ast.body) compileStatement(stmt);
emit(OP.HALT);

// ====== 3. OUTPUT ======
console.log("Source:", source.trim());
console.log("\nVariable slots:", scope);
console.log("\nBytecode (JSON) — pansinin: WALANG readable na string!");
console.log(JSON.stringify(bytecode));

const names = {
  1: "PUSH",
  2: "ADD",
  3: "SUB",
  4: "MUL",
  5: "PRINT",
  6: "JMP",
  7: "JZ",
  8: "DUP",
  9: "HALT",
  10: "STORE",
  11: "LOAD",
  12: "DIV",
  13: "PUSHSTR",
};
const luaLines = bytecode.map((i) => {
  if (i.arg === undefined) return `  { OP.${names[i.op]} },`;
  if (Array.isArray(i.arg))
    return `  { OP.${names[i.op]}, {${i.arg.join(",")}} },`;
  return `  { OP.${names[i.op]}, ${i.arg} },`;
});
console.log("\nBytecode (Lua program table):");
console.log("local program = {\n" + luaLines.join("\n") + "\n}");
