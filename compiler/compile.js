//  compile.js  —  Luripe compiler
//  === STEP 8: FUNCTIONS (function decl + calls + return) ===
//
//  Bago:
//    - function foo(a, b) ... return x end
//    - function calls: foo(1, 2)  bilang expression o statement
//    - return statement
//    - Frame-based locals: bawat function may sariling scope/slots.
//    - Functions naka-compile sa itaas; may JMP para laktawan sila papunta sa main.
//
//  Patakbuhin:  node compile.js
//  Kailangan:   npm install luaparse

const luaparse = require("luaparse");

const HARDENING = false; // patay muna para malinaw ang addresses habang natututo

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
  "CALL",
  "RETURN",
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
function double(n)
  return n * 2
end

function add(a, b)
  return a + b
end

print(double(21))
print(add(10, 5))
print(double(add(3, 4)))
`;

const ast = luaparse.parse(source);

// ====== compile ======
const bytecode = [];
function emit(op, arg) {
  bytecode.push(arg === undefined ? { op } : { op, arg });
  return bytecode.length - 1;
}
function patch(index, target) {
  bytecode[index].arg = target;
}
function here() {
  return bytecode.length + 1;
}

// Function registry: pangalan -> { addr, params }
const functions = {};

// Scope stack: bawat function may sariling variable slots.
let scope = {};
let nextSlot = 0;
function pushScope() {
  scope = {};
  nextSlot = 0;
}
function slotFor(name) {
  if (scope[name] === undefined) scope[name] = nextSlot++;
  return scope[name];
}

const CMP = {
  "<": "LT",
  ">": "GT",
  "<=": "LE",
  ">=": "GE",
  "==": "EQ",
  "~=": "NE",
};

function emitJunk() {
  if (!HARDENING) return;
  emit(OP.PUSH, Math.floor(Math.random() * 99999));
  emit(OP.POP);
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
    const o = node.operator;
    if (o === "+") emit(OP.ADD);
    else if (o === "-") emit(OP.SUB);
    else if (o === "*") emit(OP.MUL);
    else if (o === "/") emit(OP.DIV);
    else if (CMP[o]) emit(OP[CMP[o]]);
    else throw new Error("hindi sinusuportahan ang operator: " + o);
  } else if (node.type === "CallExpression") {
    // BAGO: function call na may resulta
    compileCall(node);
  } else {
    throw new Error("hindi sinusuportahan ang expression: " + node.type);
  }
}

function compileCall(node) {
  const fnName = node.base && node.base.name;
  if (fnName === "print") {
    compileExpr(node.arguments[0]);
    emit(OP.PRINT);
    return;
  }
  const fn = functions[fnName];
  if (!fn) throw new Error("hindi pa naka-declare ang function: " + fnName);
  // itulak ang arguments (in order)
  for (const a of node.arguments) compileExpr(a);
  emit(OP.CALL, [fn.addr, node.arguments.length]); // naiiwan ang return value sa stack
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
    compileCall(node.expression);
  } else if (node.type === "ReturnStatement") {
    // BAGO
    if (node.arguments.length) compileExpr(node.arguments[0]);
    else emit(OP.PUSH, 0);
    emit(OP.RETURN);
  } else if (node.type === "IfStatement") {
    const endJumps = [];
    for (const clause of node.clauses) {
      if (clause.type === "ElseClause") {
        compileBlock(clause.body);
      } else {
        compileExpr(clause.condition);
        const jz = emit(OP.JZ, 0);
        compileBlock(clause.body);
        endJumps.push(emit(OP.JMP, 0));
        patch(jz, here());
      }
    }
    const endIf = here();
    for (const j of endJumps) patch(j, endIf);
  } else if (node.type === "WhileStatement") {
    const loopTop = here();
    compileExpr(node.condition);
    const jz = emit(OP.JZ, 0);
    compileBlock(node.body);
    emit(OP.JMP, loopTop);
    patch(jz, here());
  } else {
    throw new Error("hindi sinusuportahan ang statement: " + node.type);
  }
}

// ====== 2-pass: functions muna, tapos main ======
// Pass 1: hanapin ang lahat ng function declarations (para alam ang pangalan bago pa i-call)
const funcNodes = [];
const mainNodes = [];
for (const stmt of ast.body) {
  if (stmt.type === "FunctionDeclaration") funcNodes.push(stmt);
  else mainNodes.push(stmt);
}

// Laktawan ang function bodies papunta sa main
const skipToMain = emit(OP.JMP, 0);

// I-compile ang bawat function
for (const fn of funcNodes) {
  const name = fn.identifier.name;
  functions[name] = { addr: here(), params: fn.parameters.map((p) => p.name) };
  pushScope();
  // ang parameters -> slots 0..n-1 (naka-set na ng CALL sa frame)
  for (const p of fn.parameters) slotFor(p.name);
  compileBlock(fn.body);
  // safety: kung walang return, magbalik ng 0
  emit(OP.PUSH, 0);
  emit(OP.RETURN);
}

// MAIN entry
patch(skipToMain, here());
pushScope();
compileBlock(mainNodes);
emit(OP.HALT);

// ====== output ======
console.log("Source:", source.trim());
console.log(
  "\nFunctions:",
  Object.fromEntries(
    Object.entries(functions).map(([k, v]) => [k, "addr " + v.addr]),
  ),
);
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
