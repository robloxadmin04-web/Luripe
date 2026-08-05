//  compile.js  —  Luripe compiler
//  === STEP 3: dinagdagan ng VARIABLES at multi-line support ===
//
//  Kukuha ng normal na Lua source, ipa-parse gamit ang luaparse,
//  tapos gagawing bytecode na tugma sa vm.lua natin.
//
//  Patakbuhin:  node compile.js
//  Kailangan:   npm install luaparse

const luaparse = require("luaparse");

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
};

// ====== ang source na ico-compile natin ======
// SUBUKAN mo palitan ito ng sarili mong programa!
const source = `
local x = 10
local y = 5
local z = x + y * 2
print(z)
`;

// ====== 1. PARSE: source -> AST ======
const ast = luaparse.parse(source);

// ====== 2. COMPILE: AST -> bytecode ======
const bytecode = [];
function emit(op, arg) {
  bytecode.push(arg === undefined ? { op } : { op, arg });
}

// BAGO: symbol table — pangalan ng variable -> slot number
const scope = {};
let nextSlot = 0;
function slotFor(name) {
  if (scope[name] === undefined) scope[name] = nextSlot++;
  return scope[name];
}

// Ini-compile ang isang EXPRESSION (may resulta na naiiwan sa stack).
function compileExpr(node) {
  if (node.type === "NumericLiteral") {
    emit(OP.PUSH, node.value);
  } else if (node.type === "Identifier") {
    // BAGO: paggamit ng variable
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

// Ini-compile ang isang STATEMENT.
function compileStatement(node) {
  if (node.type === "LocalStatement") {
    // BAGO: local x = ...
    // luaparse: node.variables[] at node.init[]
    for (let i = 0; i < node.variables.length; i++) {
      const name = node.variables[i].name;
      const initExpr = node.init[i];
      if (initExpr)
        compileExpr(initExpr); // i-compute ang value -> stack
      else emit(OP.PUSH, 0); // "local x" na walang value = 0
      emit(OP.STORE, slotFor(name)); // i-store sa slot
    }
  } else if (node.type === "AssignmentStatement") {
    // BAGO: x = ... (existing var)
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

// I-compile ang buong programa (bawat linya).
for (const stmt of ast.body) compileStatement(stmt);
emit(OP.HALT);

// ====== 3. OUTPUT ======
console.log("Source:", source.trim());
console.log("\nVariable slots:", scope);
console.log("\nBytecode (JSON):");
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
};
const luaLines = bytecode.map((i) =>
  i.arg === undefined
    ? `  { OP.${names[i.op]} },`
    : `  { OP.${names[i.op]}, ${i.arg} },`,
);
console.log("\nBytecode (Lua program table):");
console.log("local program = {\n" + luaLines.join("\n") + "\n}");
