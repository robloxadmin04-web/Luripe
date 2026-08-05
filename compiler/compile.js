//  compile.js  —  Luripe Step 2: ang unang compiler
//
//  Kukuha ng normal na Lua source, ipa-parse gamit ang luaparse,
//  tapos gagawing bytecode na tugma sa vm.lua natin.
//
//  Patakbuhin:  node compile.js
//
//  Kailangan muna:  npm install luaparse

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
};

// ====== ang source na ico-compile natin ======
const source = `print(1 + 2)`;

// ====== 1. PARSE: source -> AST ======
const ast = luaparse.parse(source);
// Kung gusto mong makita ang hugis ng AST, i-uncomment ito:
// console.log(JSON.stringify(ast, null, 2));

// ====== 2. COMPILE: AST node -> bytecode ======
// Ang bytecode ay lista ng { op, arg } — parehong hugis ng ginamit sa vm.lua.
const bytecode = [];
function emit(op, arg) {
  bytecode.push(arg === undefined ? { op } : { op, arg });
}

// Ini-compile ang isang EXPRESSION (may resulta na naiiwan sa stack).
function compileExpr(node) {
  if (node.type === "NumericLiteral") {
    emit(OP.PUSH, node.value);
  } else if (node.type === "BinaryExpression") {
    compileExpr(node.left); // unahin ang kaliwa -> stack
    compileExpr(node.right); // tapos ang kanan  -> stack
    if (node.operator === "+") emit(OP.ADD);
    else if (node.operator === "-") emit(OP.SUB);
    else if (node.operator === "*") emit(OP.MUL);
    else
      throw new Error("hindi pa sinusuportahan ang operator: " + node.operator);
  } else {
    throw new Error("hindi pa sinusuportahan ang expression: " + node.type);
  }
}

// Ini-compile ang isang STATEMENT (isang linya ng aksyon).
function compileStatement(node) {
  if (node.type === "CallStatement") {
    const call = node.expression; // ang tawag mismo, hal. print(...)
    const fnName = call.base && call.base.name;
    if (fnName === "print") {
      // i-compute ang argument -> stack, tapos PRINT
      compileExpr(call.arguments[0]);
      emit(OP.PRINT);
    } else {
      throw new Error("hindi pa sinusuportahan ang function: " + fnName);
    }
  } else {
    throw new Error("hindi pa sinusuportahan ang statement: " + node.type);
  }
}

// I-compile ang bawat statement sa buong programa.
for (const stmt of ast.body) compileStatement(stmt);
emit(OP.HALT);

// ====== 3. OUTPUT: ipakita ang bytecode ======
console.log("Source:", source);
console.log("Bytecode (JSON):");
console.log(JSON.stringify(bytecode));

// Gawing Lua-table text na pwedeng idikit sa isang .lua file para patakbuhin.
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
};
const luaLines = bytecode.map((i) =>
  i.arg === undefined
    ? `  { OP.${names[i.op]} },`
    : `  { OP.${names[i.op]}, ${i.arg} },`,
);
console.log("\nBytecode (Lua program table):");
console.log("local program = {\n" + luaLines.join("\n") + "\n}");
