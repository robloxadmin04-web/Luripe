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

function encodeString(str, idx) {
  // Per-string key: bawat string may sariling random key na naka-embed sa unahan
  // ng encoded array. Format: { key, byte1, byte2, ... }. Walang iisang key
  // na gagana sa lahat — mas mahirap i-dump.
  const key = 1 + Math.floor(Math.random() * 254);
  const out = [key];
  for (let i = 0; i < str.length; i++)
    out.push((str.charCodeAt(i) + OFFSET) ^ key);
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
  "NEWCELL",
  "LOADCELL",
  "STORECELL",
  "LOADUP",
  "STOREUP",
  "CLOSURE",
  "CALLC",
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
  let pendingClosures = [];
  let varargSlot = 0;
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

  // === CLOSURES ===
  // Kolektahin ang lahat ng Identifier na ginamit sa isang function body.
  function collectNames(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) collectNames(n, out);
      return;
    }
    if (node.type === "Identifier") out.add(node.name);
    for (const k in node) {
      if (k === "type" || k === "__qname" || k === "__isMethod") continue;
      collectNames(node[k], out);
    }
  }
  // Ang mga slots na kailangang gawing CELL (kasi na-capture ng closure).
  // scope.__cells = Set ng slot numbers na cell.
  function markCell(name) {
    const slot = slotFor(name);
    if (!scope.__cells) scope.__cells = new Set();
    scope.__cells.add(slot);
    return slot;
  }
  function isCell(name) {
    return (
      scope.__cells &&
      scope[name] !== undefined &&
      scope.__cells.has(scope[name])
    );
  }

  // I-compile ang isang inner function (FunctionExpression) bilang closure.
  // TAMANG MODEL (Lua paper + Crafting Interpreters): i-compile ang body INLINE
  // habang tama pa ang enclosing scope — hindi deferred (na sumisira sa scope timing).
  // May JMP-over para hindi tumakbo ang body bilang inline code.
  function compileFunctionExpr(node) {
    // Alamin kung anong outer-scope names ang ginagamit sa loob
    const used = new Set();
    collectNames(node.body, used);
    const outerScope = scope;
    const captures = []; // { name, outerSlot }
    for (const name of used) {
      // HUWAG i-capture ang named functions — sila ay by-address (CLOSURE [addr]),
      // hindi cells. Ang pag-capture sa kanila ang sanhi ng NEWCELL-bago-CALL bug.
      if (functions[name]) continue;
      if (
        outerScope[name] !== undefined &&
        typeof outerScope[name] === "number"
      ) {
        if (!outerScope.__cells) outerScope.__cells = new Set();
        outerScope.__cells.add(outerScope[name]);
        captures.push({ name, outerSlot: outerScope[name] });
      }
    }
    // Emit CLOSURE na tumutukoy sa body address (isusulat pagkatapos i-compile ang body)
    const closureInstr = emit(OP.CLOSURE, [
      0,
      captures.map((c) => c.outerSlot),
    ]);
    // JMP para laktawan ang inline body
    const jmpOver = emit(OP.JMP, 0);
    const bodyAddr = here();
    bytecode[closureInstr].arg = [bodyAddr, captures.map((c) => c.outerSlot)];

    // I-compile ang body sa BAGONG scope (captures = upvalues by order)
    const savedScope = scope,
      savedNextSlot = nextSlot,
      savedVararg = varargSlot;
    scope = {};
    nextSlot = 0;
    varargSlot = 0;
    scope.__upvals = {};
    captures.forEach((c, i) => {
      scope.__upvals[c.name] = i;
    });
    for (const p of node.parameters) {
      if (p.type === "VarargLiteral") varargSlot = nextSlot;
      else slotFor(p.name);
    }
    compileBlock(node.body);
    emit(OP.PUSH, 0);
    emit(OP.RETURN);
    // ibalik ang enclosing scope
    scope = savedScope;
    nextSlot = savedNextSlot;
    varargSlot = savedVararg;
    patch(jmpOver, here());
  }

  function compileExpr(node) {
    if (node.type === "NumericLiteral") {
      emit(OP.PUSH, node.value);
    } else if (node.type === "StringLiteral") {
      let str = node.value;
      if (str === null || str === undefined) str = node.raw.slice(1, -1);
      emit(OP.PUSHSTR, encodeString(str));
    } else if (node.type === "Identifier") {
      // Upvalue? (na-capture mula sa outer scope ng closure)
      if (scope.__upvals && scope.__upvals[node.name] !== undefined) {
        emit(OP.LOADUP, scope.__upvals[node.name]);
      } else {
        const slot = scope[node.name];
        if (slot === undefined)
          throw new Error("hindi pa naka-declare: " + node.name);
        // Cell? (na-capture ng inner closure) -> LOADCELL
        if (scope.__cells && scope.__cells.has(slot)) emit(OP.LOADCELL, slot);
        else emit(OP.LOAD, slot);
      }
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
    } else if (node.type === "FunctionDeclaration" && !node.identifier) {
      // Anonymous function / closure — HINDI PA sinusuportahan nang matatag.
      // Sa halip na mag-emit ng sirang bytecode, mag-warning at mag-push ng 0.
      console.warn(
        "[Luripe] babala: nilaktawan ang closure (function() ... end) — hindi pa suportado.",
      );
      emit(OP.PUSH, 0);
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
    if (
      node.base &&
      node.base.type === "MemberExpression" &&
      node.base.indexer === ":"
    ) {
      const methodKey = node.base.identifier.name;
      let fn = null;
      for (const qname in functions) {
        if (qname.endsWith("." + methodKey)) {
          fn = functions[qname];
          break;
        }
      }
      if (!fn) throw new Error("hindi kilalang method: " + methodKey);
      compileExpr(node.base.base); // self
      for (const a of node.arguments) compileExpr(a);
      emit(OP.CALL, [fn.addr, node.arguments.length + 1]); // +1 para sa self
      return;
    }
    // Qualified call: Dog.new(x)
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
      // Upvalue? -> STOREUP
      if (scope.__upvals && scope.__upvals[target.name] !== undefined) {
        valueEmitter();
        emit(OP.STOREUP, scope.__upvals[target.name]);
      } else {
        const slot = slotFor(target.name);
        valueEmitter();
        // Cell? (na-capture ng inner closure) -> STORECELL
        if (scope.__cells && scope.__cells.has(slot)) emit(OP.STORECELL, slot);
        else emit(OP.STORE, slot);
      }
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

  // (Ang closures ay ni-compile na INLINE sa compileFunctionExpr — walang deferred pass.)

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

  const path = require("path");
  const vmPath = path.join(__dirname, "..", "vm", "vm.lua");
  let vmRaw = fs.readFileSync(vmPath, "utf8");
  vmRaw = vmRaw.replace(/\nreturn\s*\{[^}]*\}\s*$/m, "\n");
  return luraphBundle(OP, bytecode, vmRaw, checksum);
}

// === LURAPH-STYLE OUTPUT: encoded blob + scrambled names + minified VM ===
function minifyLua(src) {
  src = src
    .replace(/--\[\[[\s\S]*?\]\]/g, "") // block comments
    .replace(/--[^\n]*/g, "") // line comments
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length)
    .join(" ")
    .replace(/\s+/g, " ");
  return src;
}
// Scramble ang VM-internal local names (safe subset — hindi keywords/globals)
function scrambleVM(vmMin) {
  const names = [
    "decodeString",
    "checksumOf",
    "BUILTINS",
    "callStack",
    "csTop",
    "newFrame",
    "expectedChecksum",
    "funcAddr",
    "chars",
    "encoded",
    "vals",
    "slots",
    "startSlot",
    "caller",
    "loopTop",
    "push",
    "pop",
    "frame",
    "upvals",
    "stack",
    "program",
    "inst",
    "arg",
    "argc",
    "retIp",
    "newTable",
  ];
  for (const nm of names) {
    const scrambled = "_" + Math.random().toString(36).slice(2, 7);
    vmMin = vmMin.replace(new RegExp("\\b" + nm + "\\b", "g"), scrambled);
  }
  return vmMin;
}
function luraphBundle(OP, bytecode, vmRaw, checksum) {
  // Decoy junk generator: gumagawa ng fake na Lua statements na walang epekto,
  // pero mukhang mahalaga — para mapagulo ang sinumang magbabasa.
  const rn = () => "_" + Math.random().toString(36).slice(2, 7);
  function junkLine() {
    const v = rn(),
      w = rn(),
      x = rn();
    const a = Math.floor(Math.random() * 999),
      b = Math.floor(Math.random() * 99) + 1;
    const patterns = [
      () => `local ${v}=${Math.floor(Math.random() * 99999)};`,
      () => `local ${v}=function(${w}) return ${w} and ${a} or nil end;`,
      () => `local ${v}={${a},${b},${Math.floor(Math.random() * 99)}};`,
      () => `local ${v}=(${a}*${b})%${Math.floor(Math.random() * 97) + 3};`,
      () => `local function ${v}(${w}) local ${x}=${w} return ${x} end;`,
      () => `local ${v}="${Math.random().toString(36).slice(2, 10)}";`,
      // OPAQUE PREDICATES — kondisyon na laging totoo/mali, mukhang dynamic:
      () => `local ${v}=${a};if (${v}*${v})>=0 then ${v}=${v}+${b} end;`, // laging true
      () => `local ${v}=${a};if (${v}%1)~=0 then ${v}=nil end;`, // laging false (integer)
      () => `local ${v}=${b};while ${v}>${a + b} do ${v}=${v}-1 end;`, // hindi tumatakbo
      () =>
        `local ${v}=function() if (${a}+${b})>${a} then return ${a} end return ${b} end;`, // dead branch
    ];
    return patterns[Math.floor(Math.random() * patterns.length)]();
  }
  const junk = (n) => Array.from({ length: n }, junkLine).join("");
  // 1. Flatten program -> number stream (op, tag, [args])
  const nums = [];
  for (const inst of bytecode) {
    nums.push(inst.op);
    if (inst.arg === undefined) nums.push(0);
    else if (Array.isArray(inst.arg))
      nums.push(2, inst.arg.length, ...inst.arg);
    else nums.push(1, inst.arg);
  }
  // 2. RUNTIME-DERIVED MASK: galing sa sum ng opmap values (hindi hardcoded).
  //    Kailangan i-compute ng attacker mula sa opmap bago ma-decode ang blob.
  const opValues = OPS.map((n) => OP[n]);
  let s = 0;
  for (const v of opValues) s = (s + v) % 97;
  const mask = (s % 64) + 1;
  const blob = nums.map((n) => n ^ mask).join(",");
  // 3. Scrambled var names
  const r = () => "_" + Math.random().toString(36).slice(2, 7);
  const B = r(),
    M = r(),
    D = r(),
    P = r(),
    N = r(),
    I = r(),
    MK = r(),
    SM = r();
  const vmMin = scrambleVM(minifyLua(vmRaw));
  const opmapNamed = "{" + OPS.map((n) => `${n}=${OP[n]}`).join(",") + "}";

  // 4. Buuin ang isang siksik na bloke — na may junk na nakakalat sa pagitan.
  const KV = r(),
    OV = r();
  const vmKeyed = vmMin.replace(
    /local KEY, OFFSET = 0x5A, 7/,
    `local KEY,OFFSET=${KV},${OV}`,
  );
  return (
    `--[[ Protected by Luripe ]] ` +
    junk(4) +
    `local ${M}=${opmapNamed};` +
    junk(3) +
    `local ${SM}=0;for _,v in pairs(${M})do ${SM}=(${SM}+v)%97 end;local ${MK}=(${SM}%64)+1;` +
    `local ${KV}=(45*2);local ${OV}=(14/2);` +
    junk(3) +
    `local ${B}="${blob}";` +
    junk(2) +
    `local function ${D}(s)local r={}for m in s:gmatch("[^,]+")do r[#r+1]=tonumber(m)~${MK} end return r end;` +
    `local ${N}=${D}(${B});` +
    junk(3) +
    `local ${P}={}local ${I}=1;while ${I}<=#${N} do local o=${N}[${I}];${I}=${I}+1;local t=${N}[${I}];${I}=${I}+1;` +
    `if t==0 then ${P}[#${P}+1]={o} elseif t==1 then ${P}[#${P}+1]={o,${N}[${I}]};${I}=${I}+1 else local l=${N}[${I}];${I}=${I}+1;local a={}for k=1,l do a[k]=${N}[${I}];${I}=${I}+1 end;${P}[#${P}+1]={o,a} end end;` +
    vmKeyed +
    ` ` +
    `run(${P},${M},${checksum})`
  );
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
