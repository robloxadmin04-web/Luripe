//  compile.js  —  Luripe compiler
//  === STEP 7: COMPARISONS + IF / WHILE (control flow) ===
//
//  Bago:
//    - Comparison operators: <, >, <=, >=, ==, ~=
//    - if ... then ... [else ...] end
//    - while ... do ... end
//    Gumagamit ng JMP/JZ + backpatching para sa jump addresses.
//
//  Patakbuhin:  node compile.js
//  Kailangan:   npm install luaparse

const luaparse = require("luaparse");

const HARDENING = false; // patayin muna ang junk para malinaw ang jump addresses habang natututo

const KEY = 0x5a,
  OFFSET = 7;
function encodeString(str) {
  const out = [];
  for (let i = 0; i < str.length; i++)
    out.push((str.charCodeAt(i) + OFFSET) ^ KEY);
  return out;
}

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
  "LT",
  "GT",
  "LE",
  "GE",
  "EQ",
  "NE",
];
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
local i = 0
while i < 3 do
  print(i)
  i = i + 1
end

local score = 75
if score >= 60 then
  print(1)
else
  print(0)
end
`;

const ast = luaparse.parse(source);

// ====== compile ======
const bytecode = [];
function emit(op, arg) {
  bytecode.push(arg === undefined ? { op } : { op, arg });
  return bytecode.length - 1;
}
// backpatch: itakda ang arg ng isang instruction sa index na 'to (1-based ip target)
function patch(index, target) {
  bytecode[index].arg = target;
}
function here() {
  return bytecode.length + 1;
} // 1-based ip ng SUSUNOD na instruction

const scope = {};
let nextSlot = 0;
function slotFor(name) {
  if (scope[name] === undefined) scope[name] = nextSlot++;
  return scope[name];
}

function emitJunk() {
  if (!HARDENING) return;
  emit(OP.PUSH, Math.floor(Math.random() * 99999));
  emit(OP.POP);
}

const CMP = {
  "<": "LT",
  ">": "GT",
  "<=": "LE",
  ">=": "GE",
  "==": "EQ",
  "~=": "NE",
};

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
    const o = node.operator;
    if (o === "+") emit(OP.ADD);
    else if (o === "-") emit(OP.SUB);
    else if (o === "*") emit(OP.MUL);
    else if (o === "/") emit(OP.DIV);
    else if (CMP[o])
      emit(OP[CMP[o]]); // BAGO: comparisons
    else throw new Error("hindi sinusuportahan ang operator: " + o);
  } else {
    throw new Error("hindi sinusuportahan ang expression: " + node.type);
  }
}

function compileBlock(body) {
  for (const stmt of body) {
    emitJunk();
    compileStatement(stmt);
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
  } else if (node.type === "IfStatement") {
    // BAGO: if / else
    // luaparse: node.clauses = [IfClause, (ElseifClause...), (ElseClause)]
    const endJumps = []; // mga JMP papuntang dulo ng buong if
    for (const clause of node.clauses) {
      if (clause.type === "ElseClause") {
        compileBlock(clause.body);
      } else {
        // IfClause / ElseifClause: may condition
        compileExpr(clause.condition);
        const jz = emit(OP.JZ, 0); // kung false, laktawan ang body na 'to
        compileBlock(clause.body);
        endJumps.push(emit(OP.JMP, 0)); // pagkatapos ng body, tumalon sa dulo
        patch(jz, here()); // ang JZ ay papunta dito (susunod na clause)
      }
    }
    const endIf = here();
    for (const j of endJumps) patch(j, endIf); // lahat ng end-jump -> dulo
  } else if (node.type === "WhileStatement") {
    // BAGO: while
    const loopTop = here(); // simula ng condition
    compileExpr(node.condition);
    const jz = emit(OP.JZ, 0); // kung false, labas
    compileBlock(node.body);
    emit(OP.JMP, loopTop); // balik sa condition
    patch(jz, here()); // JZ -> pagkatapos ng loop
  } else {
    throw new Error("hindi sinusuportahan ang statement: " + node.type);
  }
}

compileBlock(ast.body);
emit(OP.HALT);

// ====== output ======
console.log("Source:", source.trim());
console.log("\nHardening:", HARDENING ? "ON" : "OFF");
console.log("Bilang ng instructions:", bytecode.length);
console.log("\nRANDOM opcode map:");
console.log(JSON.stringify(OP));
console.log("\nBytecode (bare-number Lua table):");
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
