//  compile.js  —  Luripe compiler
//  === STEP 10: CONCAT + BUILT-INS + ANTI-TAMPER (huling hakbang) ===
//
//  Bago:
//    - String concatenation:  a .. b
//    - Built-in functions: math.floor, math.max, string.upper, table.insert, atbp.
//    - Anti-tamper checksum: kino-compute at isinasama sa output.
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
  "CONCAT",
  "BUILTIN",
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

// ===== BUILT-IN mapping: "namespace.name" -> {id, argc} (dapat TUGMA sa vm.lua) =====
const BUILTIN_IDS = {
  "math.floor": { id: 1, argc: 1 },
  "math.ceil": { id: 2, argc: 1 },
  "math.abs": { id: 3, argc: 1 },
  "math.max": { id: 4, argc: 2 },
  "math.min": { id: 5, argc: 2 },
  "string.upper": { id: 6, argc: 1 },
  "string.lower": { id: 7, argc: 1 },
  "string.len": { id: 8, argc: 1 },
  "string.rep": { id: 9, argc: 2 },
  tostring: { id: 10, argc: 1 },
  tonumber: { id: 11, argc: 1 },
  "table.insert": { id: 12, argc: 2 },
};

// ====== source ======
const source = `
function grade(score)
  if score >= 90 then
    return "A"
  elseif score >= 75 then
    return "B"
  else
    return "F"
  end
end

local scores = {}
table.insert(scores, 95)
table.insert(scores, 80)
table.insert(scores, 60)

for i = 1, 3 do
  local s = scores[i]
  print("Score " .. s .. " = " .. grade(s))
end

print("Highest: " .. math.max(scores[1], scores[2]))
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

// Kunin ang "math.floor" mula sa MemberExpression base ng isang call
function builtinName(node) {
  if (node.type === "MemberExpression" && node.base.type === "Identifier") {
    return node.base.name + "." + node.identifier.name; // math.floor
  }
  if (node.type === "Identifier") return node.name; // tostring
  return null;
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
    else if (o === "..")
      emit(OP.CONCAT); // BAGO: concatenation
    else if (CMP[o]) emit(OP[CMP[o]]);
    else throw new Error("hindi sinusuportahan ang operator: " + o);
  } else if (node.type === "CallExpression") {
    compileCall(node);
  } else if (node.type === "TableConstructorExpression") {
    emit(OP.NEWTABLE);
    let arrayIndex = 1;
    for (const field of node.fields) {
      if (field.type === "TableValue") {
        emit(OP.DUP);
        emit(OP.PUSH, arrayIndex++);
        compileExpr(field.value);
        emit(OP.SETTABLE);
      } else if (field.type === "TableKeyString") {
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
    compileExpr(node.base);
    compileExpr(node.index);
    emit(OP.GETTABLE);
  } else if (node.type === "MemberExpression") {
    compileExpr(node.base);
    emit(OP.PUSHSTR, encodeString(node.identifier.name));
    emit(OP.GETTABLE);
  } else {
    throw new Error("hindi sinusuportahan ang expression: " + node.type);
  }
}

function compileCall(node) {
  // print(...)
  if (
    node.base &&
    node.base.type === "Identifier" &&
    node.base.name === "print"
  ) {
    compileExpr(node.arguments[0]);
    emit(OP.PRINT);
    return;
  }
  // built-in? (math.floor, string.upper, table.insert, tostring...)
  const bname = builtinName(node.base);
  if (bname && BUILTIN_IDS[bname]) {
    const b = BUILTIN_IDS[bname];
    for (const a of node.arguments) compileExpr(a);
    emit(OP.BUILTIN, [b.id, node.arguments.length]);
    return;
  }
  // user-defined function
  const fnName = node.base && node.base.name;
  const fn = functions[fnName];
  if (!fn) throw new Error("hindi kilalang function: " + (fnName || bname));
  for (const a of node.arguments) compileExpr(a);
  emit(OP.CALL, [fn.addr, node.arguments.length]);
}

function compileAssignTarget(target, valueEmitter) {
  if (target.type === "Identifier") {
    valueEmitter();
    emit(OP.STORE, slotFor(target.name));
  } else if (target.type === "IndexExpression") {
    compileExpr(target.base);
    compileExpr(target.index);
    valueEmitter();
    emit(OP.SETTABLE);
  } else if (target.type === "MemberExpression") {
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
      compileAssignTarget(node.variables[i], () => compileExpr(node.init[i]));
    }
  } else if (node.type === "CallStatement") {
    compileCall(node.expression);
    // kung ang call ay nag-iiwan ng return value na hindi ginagamit (hal. table.insert),
    // tanggalin para malinis ang stack
    const b = builtinName(node.expression.base);
    const isPrint =
      node.expression.base && node.expression.base.name === "print";
    if (!isPrint) emit(OP.POP);
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
    const varSlot = slotFor(node.variable.name);
    compileExpr(node.start);
    emit(OP.STORE, varSlot);
    const loopTop = here();
    emit(OP.LOAD, varSlot);
    compileExpr(node.end);
    emit(OP.LE);
    const jz = emit(OP.JZ, 0);
    compileBlock(node.body);
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

// ====== 2-pass ======
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

// ===== anti-tamper checksum (dapat TUGMA sa vm.lua) =====
function checksumOf(program) {
  let sum = 0;
  for (let i = 0; i < program.length; i++) {
    const inst = program[i];
    sum = (sum + inst.op * (i + 1)) % 1000003;
    if (typeof inst.arg === "number") sum = (sum + inst.arg) % 1000003;
  }
  return sum;
}
const checksum = checksumOf(bytecode);

// ====== output ======
console.log("Source:", source.trim());
console.log(
  "\nFunctions:",
  Object.fromEntries(
    Object.entries(functions).map(([k, v]) => [k, "addr " + v.addr]),
  ),
);
console.log("Bilang ng instructions:", bytecode.length);
console.log("Anti-tamper checksum:", checksum);
console.log("\nRANDOM opcode map:");
console.log(JSON.stringify(OP));
console.log("\nBytecode (bare-number Lua table):");
const luaLines = bytecode.map((i) => {
  if (i.arg === undefined) return `  { ${i.op} },`;
  if (Array.isArray(i.arg)) return `  { ${i.op}, {${i.arg.join(",")}} },`;
  return `  { ${i.op}, ${i.arg} },`;
});
console.log("local program = {\n" + luaLines.join("\n") + "\n}");
console.log("\nOpcode map:");
console.log(
  "local OPMAP = {\n" +
    OPS.map((n) => `  ["${n}"] = ${OP[n]},`).join("\n") +
    "\n}",
);
console.log("\n-- run(program, OPMAP, " + checksum + ")");
