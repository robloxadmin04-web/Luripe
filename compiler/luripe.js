//  luripe.js  —  Luripe AUTO-BUNDLER (FINAL: kompletong feature set)
//
//  Kukuha ng input .lua source at magbubuo ng iisang self-contained protected
//  .lua file. Sinusuportahan: variables, math, strings, if/elseif/else, while,
//  for, functions, tables, string concat (..), built-ins, at anti-tamper.
//
//  Gamitin:
//    node luripe.js input.lua              -> input.protected.lua
//    node luripe.js input.lua out.lua      -> custom output name
//
//  Kailangan:  npm install luaparse

const fs = require("fs");
const luaparse = require("luaparse");

// ================= config =================
const KEY = 0x5a,
  OFFSET = 7;
const HARDENING = true; // junk instructions ON

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
  "TLEN",
  "MOD",
  "RETURNN",
  "STOREMULTI",
  "VARARG",
  "NOT",
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
  // === BAGO ===
  "math.sqrt": { id: 13, argc: 1 },
  "math.random": { id: 14, argc: 2 },
  "math.pow": { id: 15, argc: 2 },
  "string.sub": { id: 16, argc: 3 },
  "string.format": { id: 17, argc: 4 },
  "string.reverse": { id: 18, argc: 1 },
  "string.byte": { id: 19, argc: 2 },
  "string.char": { id: 20, argc: 1 },
  "table.remove": { id: 21, argc: 2 },
  "table.concat": { id: 22, argc: 2 },
  type: { id: 23, argc: 1 },
  "math.sin": { id: 24, argc: 1 },
  "math.cos": { id: 25, argc: 1 },
};

// ================= compiler =================
function compile(source) {
  const OP = buildOpcodeMap();
  const ast = luaparse.parse(source);
  const bytecode = [];
  const emit = (op, arg) => {
    bytecode.push(arg === undefined ? { op } : { op, arg });
    return bytecode.length - 1;
  };
  const patch = (index, target) => {
    bytecode[index].arg = target;
  };
  const here = () => bytecode.length + 1;

  const functions = {};
  let scope = {};
  let nextSlot = 0;
  const pushScope = () => {
    scope = {};
    nextSlot = 0;
  };
  const slotFor = (name) => {
    if (scope[name] === undefined) scope[name] = nextSlot++;
    return scope[name];
  };

  const CMP = {
    "<": "LT",
    ">": "GT",
    "<=": "LE",
    ">=": "GE",
    "==": "EQ",
    "~=": "NE",
  };
  const emitJunk = () => {
    if (HARDENING) {
      emit(OP.PUSH, Math.floor(Math.random() * 99999));
      emit(OP.POP);
    }
  };

  function builtinName(node) {
    if (node.type === "MemberExpression" && node.base.type === "Identifier")
      return node.base.name + "." + node.identifier.name;
    if (node.type === "Identifier") return node.name;
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
      else if (o === "..") emit(OP.CONCAT);
      else if (CMP[o]) emit(OP[CMP[o]]);
      else throw new Error("hindi sinusuportahan ang operator: " + o);
    } else if (node.type === "CallExpression") {
      compileCall(node);
    } else if (node.type === "TableConstructorExpression") {
      // Espesyal: { ... }  -> kolektahin ang varargs (VARARG opcode) direkta
      if (
        node.fields.length === 1 &&
        node.fields[0].type === "TableValue" &&
        node.fields[0].value.type === "VarargLiteral"
      ) {
        emit(OP.VARARG, varargSlot); // varargSlot = simula ng extra args sa frame
        return;
      }
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
        } else
          throw new Error(
            "hindi pa sinusuportahan ang table field: " + field.type,
          );
      }
    } else if (node.type === "IndexExpression") {
      compileExpr(node.base);
      compileExpr(node.index);
      emit(OP.GETTABLE);
    } else if (node.type === "MemberExpression") {
      compileExpr(node.base);
      emit(OP.PUSHSTR, encodeString(node.identifier.name));
      emit(OP.GETTABLE);
    } else if (node.type === "UnaryExpression") {
      // -x, not x, #t
      if (node.operator === "-") {
        emit(OP.PUSH, 0);
        compileExpr(node.argument);
        emit(OP.SUB); // 0 - x
      } else if (node.operator === "not") {
        compileExpr(node.argument);
        emit(OP.NOT);
      } else if (node.operator === "#") {
        compileExpr(node.argument);
        emit(OP.TLEN);
      } else
        throw new Error(
          "hindi sinusuportahan ang unary operator: " + node.operator,
        );
    } else throw new Error("hindi sinusuportahan ang expression: " + node.type);
  }

  function compileCall(node) {
    if (
      node.base &&
      node.base.type === "Identifier" &&
      node.base.name === "print"
    ) {
      compileExpr(node.arguments[0]);
      emit(OP.PRINT);
      return;
    }
    const bname = builtinName(node.base);
    if (bname && BUILTIN_IDS[bname]) {
      const b = BUILTIN_IDS[bname];
      for (const a of node.arguments) compileExpr(a);
      emit(OP.BUILTIN, [b.id, node.arguments.length]);
      return;
    }
    // Method call na may colon: d:speak(x)  ->  speak(d, x), self=d
    // luaparse: node.base = MemberExpression na may indexer ":"
    if (
      node.base &&
      node.base.type === "MemberExpression" &&
      node.base.indexer === ":"
    ) {
      const methodKey = node.base.identifier.name; // "speak"
      // Hanapin ang function na nagtatapos sa ".speak" (hal. "Dog.speak")
      let fn = null;
      for (const qname in functions) {
        if (qname.endsWith("." + methodKey)) {
          fn = functions[qname];
          break;
        }
      }
      if (!fn) throw new Error("hindi kilalang method: " + methodKey);
      compileExpr(node.base.base); // self (ang object)
      for (const a of node.arguments) compileExpr(a); // ibang args
      emit(OP.CALL, [fn.addr, node.arguments.length + 1]); // +1 para sa self
      return;
    }
    // Qualified call: Dog.new(x)  ->  functions["Dog.new"]
    if (
      node.base &&
      node.base.type === "MemberExpression" &&
      node.base.indexer === "."
    ) {
      const qname = node.base.base.name + "." + node.base.identifier.name;
      const fn = functions[qname];
      if (!fn) throw new Error("hindi kilalang function: " + qname);
      for (const a of node.arguments) compileExpr(a);
      emit(OP.CALL, [fn.addr, node.arguments.length]);
      return;
    }
    // Plain call: foo(x)
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
    } else
      throw new Error(
        "hindi sinusuportahan ang assignment target: " + target.type,
      );
  }

  function compileBlock(body) {
    for (const stmt of body) {
      emitJunk();
      compileStatement(stmt);
    }
  }

  function compileStatement(node) {
    if (node.type === "LocalStatement") {
      // Multi-value mula sa isang function call: local a, b = f()  -> STOREMULTI
      if (
        node.variables.length > 1 &&
        node.init.length === 1 &&
        node.init[0] &&
        node.init[0].type === "CallExpression"
      ) {
        compileCall(node.init[0]); // nag-iiwan ng values + count sa stack
        const slots = node.variables.map((v) => slotFor(v.name));
        emit(OP.STOREMULTI, slots);
      } else {
        for (let i = 0; i < node.variables.length; i++) {
          const name = node.variables[i].name;
          if (node.init[i]) compileExpr(node.init[i]);
          else emit(OP.PUSH, 0);
          emit(OP.STORE, slotFor(name));
        }
      }
    } else if (node.type === "AssignmentStatement") {
      // Multi-value: a, b = f()
      if (
        node.variables.length > 1 &&
        node.init.length === 1 &&
        node.init[0] &&
        node.init[0].type === "CallExpression" &&
        node.variables.every((v) => v.type === "Identifier")
      ) {
        compileCall(node.init[0]);
        const slots = node.variables.map((v) => slotFor(v.name));
        emit(OP.STOREMULTI, slots);
      } else {
        for (let i = 0; i < node.variables.length; i++)
          compileAssignTarget(node.variables[i], () =>
            compileExpr(node.init[i]),
          );
      }
    } else if (node.type === "CallStatement") {
      compileCall(node.expression);
      const isPrint =
        node.expression.base && node.expression.base.name === "print";
      if (!isPrint) emit(OP.POP);
    } else if (node.type === "ReturnStatement") {
      // Multiple return: return a, b, c
      if (node.arguments.length > 1) {
        for (const a of node.arguments) compileExpr(a);
        emit(OP.RETURNN, node.arguments.length);
      } else {
        if (node.arguments.length) compileExpr(node.arguments[0]);
        else emit(OP.PUSH, 0);
        emit(OP.RETURN);
      }
    } else if (node.type === "IfStatement") {
      const endJumps = [];
      for (const clause of node.clauses) {
        if (clause.type === "ElseClause") compileBlock(clause.body);
        else {
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
    } else if (node.type === "ForGenericStatement") {
      // for k, v in ipairs(t) do ... end   /   for k, v in pairs(t) do ... end
      // Ginagawa nating index-based loop: idx=0; idx=idx+1; while idx<=#t;
      //   k=idx, v=t[idx].  (ipairs at pairs = pareho ang trato dito para sa array tables)
      const iter = node.iterators[0]; // CallExpression: ipairs(t) / pairs(t)
      if (
        iter.type !== "CallExpression" ||
        !iter.base ||
        (iter.base.name !== "ipairs" && iter.base.name !== "pairs")
      ) {
        throw new Error("suportado lang ang ipairs()/pairs() sa generic for");
      }
      // i-store ang table sa isang hidden slot
      const tblSlot = slotFor("__for_t_" + here());
      compileExpr(iter.arguments[0]);
      emit(OP.STORE, tblSlot);
      // idx hidden slot
      const idxSlot = slotFor("__for_i_" + here());
      emit(OP.PUSH, 0);
      emit(OP.STORE, idxSlot);
      // key/value variables
      const keyVar = node.variables[0] ? slotFor(node.variables[0].name) : null;
      const valVar = node.variables[1] ? slotFor(node.variables[1].name) : null;
      const loopTop = here();
      emit(OP.LOAD, idxSlot);
      emit(OP.PUSH, 1);
      emit(OP.ADD);
      emit(OP.STORE, idxSlot); // idx++
      emit(OP.LOAD, idxSlot);
      emit(OP.LOAD, tblSlot);
      emit(OP.TLEN);
      emit(OP.LE); // idx <= #t
      const jz = emit(OP.JZ, 0);
      if (keyVar !== null) {
        emit(OP.LOAD, idxSlot);
        emit(OP.STORE, keyVar);
      } // k = idx
      if (valVar !== null) {
        emit(OP.LOAD, tblSlot);
        emit(OP.LOAD, idxSlot);
        emit(OP.GETTABLE);
        emit(OP.STORE, valVar);
      } // v = t[idx]
      compileBlock(node.body);
      emit(OP.JMP, loopTop);
      patch(jz, here());
    } else {
      // GRACEFUL: sa halip na mag-crash sa unsupported statement, mag-warning
      // at i-skip ito. Tumatakbo pa rin ang natitirang script.
      console.warn(
        "[Luripe] babala: nilaktawan ang hindi sinusuportahang statement: " +
          node.type,
      );
    }
  }

  // 2-pass: functions muna, tapos main
  const funcNodes = [],
    mainNodes = [];
  // Helper: kunin ang qualified name mula sa function identifier.
  //   foo            -> { name:"foo", isMethod:false }
  //   Dog.new        -> { name:"Dog.new", isMethod:false }
  //   Dog:speak      -> { name:"Dog.speak", isMethod:true }  (may implicit self)
  function funcQualifiedName(id) {
    if (!id) return null;
    if (id.type === "Identifier") return { name: id.name, isMethod: false };
    if (id.type === "MemberExpression") {
      // id.indexer ay "." o ":"
      const base = id.base.name;
      const key = id.identifier.name;
      return { name: base + "." + key, isMethod: id.indexer === ":" };
    }
    return null;
  }
  for (const stmt of ast.body) {
    const q =
      stmt.type === "FunctionDeclaration"
        ? funcQualifiedName(stmt.identifier)
        : null;
    if (q) {
      stmt.__qname = q.name;
      stmt.__isMethod = q.isMethod;
      funcNodes.push(stmt);
    } else mainNodes.push(stmt);
  }
  const skipToMain = emit(OP.JMP, 0);
  for (const fn of funcNodes) {
    functions[fn.__qname] = { addr: here(), isMethod: fn.__isMethod };
    pushScope();
    // Colon-declared method (Dog:speak) may implicit `self` bilang unang param (slot 0)
    if (fn.__isMethod) slotFor("self");
    for (const p of fn.parameters) {
      if (p.type === "VarargLiteral") {
        // function f(...) — ang extra args ay nagsisimula sa susunod na slot.
        varargSlot = nextSlot;
      } else {
        slotFor(p.name);
      }
    }
    compileBlock(fn.body);
    emit(OP.PUSH, 0);
    emit(OP.RETURN);
    varargSlot = 0; // reset pagkatapos ng function
  }
  patch(skipToMain, here());
  pushScope();
  compileBlock(mainNodes);
  emit(OP.HALT);

  return { OP, bytecode };
}

// ================= anti-tamper checksum =================
function checksumOf(bytecode) {
  let sum = 0;
  for (let i = 0; i < bytecode.length; i++) {
    const inst = bytecode[i];
    sum = (sum + inst.op * (i + 1)) % 1000003;
    if (typeof inst.arg === "number") sum = (sum + inst.arg) % 1000003;
  }
  return sum;
}

// ================= bundler =================
function bundle(OP, bytecode) {
  const checksum = checksumOf(bytecode);
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

  // === ISANG SOURCE OF TRUTH: basahin ang vm.lua mismo ===
  // Iwasan ang duplicate na VM. Kunin ang laman ng vm/vm.lua, tanggalin ang
  // header comment at ang `return { ... }` export line (hindi kailangan sa bundle),
  // at gawing bahagi ng protected output.
  const path = require("path");
  const vmPath = path.join(__dirname, "..", "vm", "vm.lua");
  let vmRaw = fs.readFileSync(vmPath, "utf8");
  // tanggalin ang huling `return { ... }` line/s (export para sa require)
  vmRaw = vmRaw.replace(/\nreturn\s*\{[^}]*\}\s*$/m, "\n");
  const vmLua = vmRaw;

  return `-- Protected by Luripe (https://github.com/robloxadmin04-web/Luripe)
-- Naka-obfuscate: random opcodes, naitagong strings, junk, control flow, functions,
-- tables, built-ins, at anti-tamper checksum.
${opmapLua}

${programLua}
${vmLua}

run(program, OPMAP, ${checksum})
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
console.log("  Anti-tamper: naka-ON");
console.log("  Opcodes: random sa build na ito");
