//  compile.js  —  Luripe compiler
//  === STEP 9: FOR LOOPS + TABLES ===
//
//  Bago:
//    - for i = start, stop [, step] do ... end   (ginagawang while)
//    - Tables: {}, {1,2,3}, t[k] = v, t[k] read
//    - Bagong opcodes: NEWTABLE, SETTABLE, GETTABLE
//
//  Patakbuhin:  node compile.js
//  Kailangan:   npm install luaparse

const luaparse = require("luaparse");

const HARDENING = false;

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
  "NEWTABLE",
  "SETTABLE",
  "GETTABLE",
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
function square(n)
  return n * n
end

local t = {}
for i = 1, 5 do
  t[i] = square(i)
end

for i = 1, 5 do
  print(t[i])
end
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

const functions = {};
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
    compileCall(node);
  } else if (node.type === "TableConstructorExpression") {
    // BAGO: {} o {1,2,3}
    emit(OP.NEWTABLE);
    let arrayIndex = 1;
    for (const field of node.fields) {
      if (field.type === "TableValue") {
        // {10, 20, 30} -> t[1]=10, t[2]=20, ...
        emit(OP.DUP); // kopya ng table
        emit(OP.PUSH, arrayIndex++); // key
        compileExpr(field.value); // value
        emit(OP.SETTABLE);
      } else if (field.type === "TableKeyString") {
        // {x = 5} -> t["x"]=5
        emit(OP.DUP);
        emit(OP.PUSHSTR, encodeString(field.key.name));
        compileExpr(field.value);
        emit(OP.SETTABLE);
      } else {
        throw new Error(
          "hindi pa sinusuportahan ang table field: " + field.type,
        );
      }
    }
  } else if (node.type === "IndexExpression") {
    // BAGO: t[k]
    compileExpr(node.base);
    compileExpr(node.index);
    emit(OP.GETTABLE);
  } else if (node.type === "MemberExpression") {
    // BAGO: t.x  (parang t["x"])
    compileExpr(node.base);
    emit(OP.PUSHSTR, encodeString(node.identifier.name));
    emit(OP.GETTABLE);
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
  for (const a of node.arguments) compileExpr(a);
  emit(OP.CALL, [fn.addr, node.arguments.length]);
}

// Ini-store ang isang assignment target (variable, t[k], o t.x)
function compileAssignTarget(target, valueEmitter) {
  if (target.type === "Identifier") {
    valueEmitter();
    emit(OP.STORE, slotFor(target.name));
  } else if (target.type === "IndexExpression") {
    // t[k] = v
    compileExpr(target.base);
    compileExpr(target.index);
    valueEmitter();
    emit(OP.SETTABLE);
  } else if (target.type === "MemberExpression") {
    // t.x = v
    compileExpr(target.base);
    emit(OP.PUSHSTR, encodeString(target.identifier.name));
    valueEmitter();
    emit(OP.SETTABLE);
  } else {
    throw new Error(
      "hindi sinusuportahan ang assignment target: " + target.type,
    );
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
      const target = node.variables[i];
      const initExpr = node.init[i];
      compileAssignTarget(target, () => compileExpr(initExpr));
    }
  } else if (node.type === "CallStatement") {
    compileCall(node.expression);
  } else if (node.type === "ReturnStatement") {
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
  } else if (node.type === "ForNumericStatement") {
    // BAGO: for i = a, b [, step]
    const varSlot = slotFor(node.variable.name);
    // i = start
    compileExpr(node.start);
    emit(OP.STORE, varSlot);
    const stepVal = node.step ? null : 1; // kung walang step, default 1
    const loopTop = here();
    // condition: i <= stop
    emit(OP.LOAD, varSlot);
    compileExpr(node.end);
    emit(OP.LE);
    const jz = emit(OP.JZ, 0);
    compileBlock(node.body);
    // i = i + step
    emit(OP.LOAD, varSlot);
    if (node.step) compileExpr(node.step);
    else emit(OP.PUSH, 1);
    emit(OP.ADD);
    emit(OP.STORE, varSlot);
    emit(OP.JMP, loopTop);
    patch(jz, here());
  } else {
    throw new Error("hindi sinusuportahan ang statement: " + node.type);
  }
}

// ====== 2-pass: functions muna, tapos main ======
const funcNodes = [];
const mainNodes = [];
for (const stmt of ast.body) {
  if (stmt.type === "FunctionDeclaration") funcNodes.push(stmt);
  else mainNodes.push(stmt);
}

const skipToMain = emit(OP.JMP, 0);

for (const fn of funcNodes) {
  const name = fn.identifier.name;
  functions[name] = { addr: here(), params: fn.parameters.map((p) => p.name) };
  pushScope();
  for (const p of fn.parameters) slotFor(p.name);
  compileBlock(fn.body);
  emit(OP.PUSH, 0);
  emit(OP.RETURN);
}

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
