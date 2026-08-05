//  luripe.js  —  Luripe AUTO-BUNDLER (ang "totoong" tool)
//
//  Kukuha ng input .lua source, ico-compile, tapos MAGBUBUO ng iisang
//  self-contained protected .lua file na naglalaman ng:
//    - naitagong bytecode (random opcodes, encoded strings, junk)
//    - ang OPMAP (susi para maintindihan ng VM)
//    - ang buong VM interpreter
//  Isang file na lang, handa nang i-share/i-run — tulad ng Luraph.
//
//  Gamitin:
//    node luripe.js input.lua              -> gagawa ng input.protected.lua
//    node luripe.js input.lua out.lua      -> custom output name
//
//  Kailangan:  npm install luaparse

const fs = require("fs");
const path = require("path");
const luaparse = require("luaparse");

// ================= config =================
const KEY = 0x5a,
  OFFSET = 7;
const HARDENING = true;

// ================= string encode =================
function encodeString(str) {
  const out = [];
  for (let i = 0; i < str.length; i++)
    out.push((str.charCodeAt(i) + OFFSET) ^ KEY);
  return out;
}

// ================= opcodes + random map =================
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

// ================= compiler =================
function compile(source) {
  const OP = buildOpcodeMap();
  const ast = luaparse.parse(source);
  const bytecode = [];
  const emit = (op, arg) =>
    bytecode.push(arg === undefined ? { op } : { op, arg });

  const scope = {};
  let nextSlot = 0;
  const slotFor = (name) => {
    if (scope[name] === undefined) scope[name] = nextSlot++;
    return scope[name];
  };

  function emitJunk() {
    if (!HARDENING) return;
    const count = 1 + Math.floor(Math.random() * 2);
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
      else
        throw new Error("hindi sinusuportahan ang operator: " + node.operator);
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

  for (const stmt of ast.body) {
    emitJunk();
    compileStatement(stmt);
  }
  emitJunk();
  emit(OP.HALT);

  return { OP, bytecode };
}

// ================= bundler =================
// Gagawa ng iisang Lua file: OPMAP + program + VM + tawag.
function bundle(OP, bytecode) {
  const opmapLua =
    "local OPMAP = {\n" +
    OPS.map((n) => `  ["${n}"] = ${OP[n]},`).join("\n") +
    "\n}";

  const programLua =
    "local program = {\n" +
    bytecode
      .map((i) => {
        if (i.arg === undefined) return `  { ${i.op} },`;
        if (Array.isArray(i.arg)) return `  { ${i.op}, {${i.arg.join(",")}} },`;
        return `  { ${i.op}, ${i.arg} },`;
      })
      .join("\n") +
    "\n}";

  // Ang VM (naka-embed) — gumagamit ng OPMAP, hindi hardcoded na numbers.
  const vmLua = `
local KEY, OFFSET = ${KEY}, ${OFFSET}
local function decodeString(encoded)
  local chars = {}
  for i = 1, #encoded do chars[i] = string.char((encoded[i] ~ KEY) - OFFSET) end
  return table.concat(chars)
end

local function run(program, OP)
  local stack, locals, sp, ip = {}, {}, 0, 1
  local function push(v) sp = sp + 1; stack[sp] = v end
  local function pop() local v = stack[sp]; stack[sp] = nil; sp = sp - 1; return v end
  while ip <= #program do
    local inst = program[ip]
    local op, arg = inst[1], inst[2]
    if op == OP.PUSH then push(arg)
    elseif op == OP.POP then pop()
    elseif op == OP.ADD then local b = pop(); local a = pop(); push(a + b)
    elseif op == OP.SUB then local b = pop(); local a = pop(); push(a - b)
    elseif op == OP.MUL then local b = pop(); local a = pop(); push(a * b)
    elseif op == OP.DIV then local b = pop(); local a = pop(); push(a / b)
    elseif op == OP.PRINT then print(stack[sp])
    elseif op == OP.DUP then push(stack[sp])
    elseif op == OP.STORE then locals[arg] = pop()
    elseif op == OP.LOAD then push(locals[arg])
    elseif op == OP.PUSHSTR then push(decodeString(arg))
    elseif op == OP.JMP then ip = arg; goto continue
    elseif op == OP.JZ then local top = pop(); if top == 0 then ip = arg; goto continue end
    elseif op == OP.HALT then break
    else error("hindi kilalang opcode: " .. tostring(op)) end
    ip = ip + 1
    ::continue::
  end
end`;

  return `-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Ang code sa ibaba ay naka-obfuscate: random opcodes, naitagong strings, junk.
${opmapLua}

${programLua}
${vmLua}

run(program, OPMAP)
`;
}

// ================= main =================
const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Gamitin: node luripe.js <input.lua> [output.lua]");
  process.exit(1);
}
const outputPath =
  process.argv[3] || inputPath.replace(/\.lua$/i, "") + ".protected.lua";

const source = fs.readFileSync(inputPath, "utf8");
const { OP, bytecode } = compile(source);
const protectedLua = bundle(OP, bytecode);
fs.writeFileSync(outputPath, protectedLua, "utf8");

console.log("[Luripe] Protected!");
console.log("  Input :", inputPath);
console.log("  Output:", outputPath);
console.log("  Instructions:", bytecode.length, HARDENING ? "(may junk)" : "");
console.log("  Opcodes: random sa build na ito");
