//  luripe.js  â€”  Luripe AUTO-BUNDLER (rolling cipher + constant pool)
//
//  Kukuha ng input .lua source at magbubuo ng iisang self-contained protected
//  .lua file. Sinusuportahan: variables, math, strings, if/elseif/else, while,
//  for, functions, tables, string concat (..), built-ins, at anti-tamper.
//
//  BAGO sa bersyon na ito:
//    * ROLLING STRING CIPHER â€” position- at chain-dependent ang bawat byte,
//      kaya patay na ang static frequency analysis. Format ng bawat string:
//        { seed, e1, e2, ... }  kung saan
//        ks_i = seed XOR (i * PRIME) XOR prev_encoded
//        e_i  = ((char + OFFSET) & 0xFF) XOR ks_i ;  prev := e_i
//    * CONSTANT POOL â€” lahat ng numeric literal ay naka-encode sa isang pool
//      (ganito ring cipher sa decimal string ng number). Sa halip na PUSH n,
//      LOADK <index> na lang ang lalabas sa bytecode. Walliteral na numero.
//
//  Gamitin:
//    node luripe.js input.lua              -> input.protected.lua
//    node luripe.js input.lua out.lua      -> custom output name
//
//  Kailangan:  npm install luaparse

const fs = require("fs");
const luaparse = require("luaparse");

// ================= config =================
const OFFSET = 7;      // additive pre-shift
const PRIME  = 167;    // position multiplier (rolling keystream)
const CMASK  = 0xff;
const HARDENING = true; // junk instructions ON

// Rolling, position + chain dependent na cipher. Bawat string may sariling
// random seed (naka-store bilang unang element). WALANG iisang key na
// magde-decode sa lahat, at magkaka-iba ang encoding kahit paulit-ulit ang char.
function encodeString(str) {
  const seed = 1 + Math.floor(Math.random() * 254); // 1..255
  const out = [seed];
  let prev = seed;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const ks = (seed ^ ((i + 1) * PRIME) ^ prev) & CMASK;
    const e = ((c + OFFSET) & CMASK) ^ ks;
    out.push(e);
    prev = e; // chain sa ENCODED byte
  }
  return out;
}
// Number -> encoded decimal string (parehong cipher). Sinusuportahan ang
// integers, floats, at negative sa pamamagitan ng tostring/tonumber.
function encodeNumber(n) {
  return encodeString(String(n));
}

const OPS = [
  "PUSH", "ADD", "SUB", "MUL", "PRINT", "JMP", "JZ", "DUP", "HALT", "STORE",
  "LOAD", "DIV", "PUSHSTR", "POP", "LT", "GT", "LE", "GE", "EQ", "NE", "CALL",
  "RETURN", "NEWTABLE", "SETTABLE", "GETTABLE", "CONCAT", "BUILTIN", "TLEN",
  "MOD", "RETURNN", "STOREMULTI", "VARARG", "NOT", "NEWCELL", "LOADCELL",
  "STORECELL", "LOADUP", "STOREUP", "CLOSURE", "CALLC",
  "LOADK", // BAGO: kunin ang numeric constant mula sa pool by index
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

  // === CONSTANT POOL ===
  // De-duplicated na numeric constants. Naka-encode gamit ang rolling cipher.
  // Ang bytecode ay LOADK <index> na lang; ang totoong numero ay nasa pool.
  const constPool = [];        // array of encoded-number arrays
  const constIndex = new Map(); // value -> index (para de-dup)
  const constFor = (value) => {
    if (constIndex.has(value)) return constIndex.get(value);
    const idx = constPool.length;
    constPool.push(encodeNumber(value));
    constIndex.set(value, idx);
    return idx;
  };
  // I-emit ang numeric literal bilang LOADK (hindi na PUSH n).
  const emitNumber = (value) => emit(OP.LOADK, constFor(value));

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
      emitNumber(Math.floor(Math.random() * 99999));
      emit(OP.POP);
    }
  };

  function builtinName(node) {
    if (node.type === "MemberExpression" && node.base.type === "Identifier")
      return node.base.name + "." + node.identifier.name;
    if (node.type === "Identifier") return node.name;
    return null;
  }

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

  function compileFunctionExpr(node) {
    const used = new Set();
    collectNames(node.body, used);
    const outerScope = scope;
    const captures = [];
    for (const name of used) {
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
    const closureInstr = emit(OP.CLOSURE, [
      0,
      captures.map((c) => c.outerSlot),
    ]);
    const jmpOver = emit(OP.JMP, 0);
    const bodyAddr = here();
    bytecode[closureInstr].arg = [bodyAddr, captures.map((c) => c.outerSlot)];

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
    emitNumber(0);
    emit(OP.RETURN);
    scope = savedScope;
    nextSlot = savedNextSlot;
    varargSlot = savedVararg;
    patch(jmpOver, here());
  }

  function compileExpr(node) {
    if (node.type === "NumericLiteral") {
      emitNumber(node.value);
    } else if (node.type === "StringLiteral") {
      let str = node.value;
      if (str === null || str === undefined) str = node.raw.slice(1, -1);
      emit(OP.PUSHSTR, encodeString(str));
    } else if (node.type === "Identifier") {
      if (scope.__upvals && scope.__upvals[node.name] !== undefined) {
        emit(OP.LOADUP, scope.__upvals[node.name]);
      } else {
        const slot = scope[node.name];
        if (slot === undefined)
          throw new Error("hindi pa naka-declare: " + node.name);
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
      if (
        node.fields.length === 1 &&
        node.fields[0].type === "TableValue" &&
        node.fields[0].value.type === "VarargLiteral"
      ) {
        emit(OP.VARARG, varargSlot);
        return;
      }
      emit(OP.NEWTABLE);
      let arrayIndex = 1;
      for (const field of node.fields) {
        if (field.type === "TableValue") {
          emit(OP.DUP);
          emitNumber(arrayIndex++);
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
      if (node.operator === "-") {
        emitNumber(0);
        compileExpr(node.argument);
        emit(OP.SUB);
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
      console.warn(
        "[Luripe] babala: nilaktawan ang closure (function() ... end) â€” hindi pa suportado.",
      );
      emitNumber(0);
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
      compileExpr(node.base.base);
      for (const a of node.arguments) compileExpr(a);
      emit(OP.CALL, [fn.addr, node.arguments.length + 1]);
      return;
    }
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
    const fnName = node.base && node.base.name;
    const fn = functions[fnName];
    if (!fn) throw new Error("hindi kilalang function: " + (fnName || bname));
    for (const a of node.arguments) compileExpr(a);
    emit(OP.CALL, [fn.addr, node.arguments.length]);
  }

  function compileAssignTarget(target, valueEmitter) {
    if (target.type === "Identifier") {
      if (scope.__upvals && scope.__upvals[target.name] !== undefined) {
        valueEmitter();
        emit(OP.STOREUP, scope.__upvals[target.name]);
      } else {
        const slot = slotFor(target.name);
        valueEmitter();
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
      if (
        node.variables.length > 1 &&
        node.init.length === 1 &&
        node.init[0] &&
        node.init[0].type === "CallExpression"
      ) {
        compileCall(node.init[0]);
        const slots = node.variables.map((v) => slotFor(v.name));
        emit(OP.STOREMULTI, slots);
      } else {
        for (let i = 0; i < node.variables.length; i++) {
          const name = node.variables[i].name;
          if (node.init[i]) compileExpr(node.init[i]);
          else emitNumber(0);
          emit(OP.STORE, slotFor(name));
        }
      }
    } else if (node.type === "AssignmentStatement") {
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
    } else if (node.type === "IfStatement") {
      const endJumps = [];
      for (const clause of node.clauses) {
        if (clause.type === "ElseClause") {
          compileBlock(clause.body);
          continue;
        }
        compileExpr(clause.condition);
        const jz = emit(OP.JZ, 0);
        compileBlock(clause.body);
        endJumps.push(emit(OP.JMP, 0));
        patch(jz, here());
      }
      for (const j of endJumps) patch(j, here());
    } else if (node.type === "WhileStatement") {
      const top = here();
      compileExpr(node.condition);
      const jz = emit(OP.JZ, 0);
      compileBlock(node.body);
      emit(OP.JMP, top);
      patch(jz, here());
    } else if (node.type === "NumericForStatement") {
      const varSlot = slotFor(node.variable.name);
      compileExpr(node.start);
      emit(OP.STORE, varSlot);
      const limitSlot = nextSlot++;
      compileExpr(node.end);
      emit(OP.STORE, limitSlot);
      const stepSlot = nextSlot++;
      if (node.step) compileExpr(node.step);
      else emitNumber(1);
      emit(OP.STORE, stepSlot);
      const top = here();
      emit(OP.LOAD, varSlot);
      emit(OP.LOAD, limitSlot);
      emit(OP.LE);
      const jz = emit(OP.JZ, 0);
      compileBlock(node.body);
      emit(OP.LOAD, varSlot);
      emit(OP.LOAD, stepSlot);
      emit(OP.ADD);
      emit(OP.STORE, varSlot);
      emit(OP.JMP, top);
      patch(jz, here());
    } else if (node.type === "ForGenericStatement") {
      // for k, v in ipairs(t)  /  for i, x in pairs(t)
      const iterCall = node.iterators[0];
      const tExpr = iterCall.arguments[0];
      const tSlot = nextSlot++;
      compileExpr(tExpr);
      emit(OP.STORE, tSlot);
      const idxSlot = nextSlot++;
      emitNumber(1);
      emit(OP.STORE, idxSlot);
      const lenSlot = nextSlot++;
      emit(OP.LOAD, tSlot);
      emit(OP.TLEN);
      emit(OP.STORE, lenSlot);
      const keyVar = node.variables[0] ? slotFor(node.variables[0].name) : nextSlot++;
      const valVar = node.variables[1] ? slotFor(node.variables[1].name) : nextSlot++;
      const top = here();
      emit(OP.LOAD, idxSlot);
      emit(OP.LOAD, lenSlot);
      emit(OP.LE);
      const jz = emit(OP.JZ, 0);
      emit(OP.LOAD, idxSlot);
      emit(OP.STORE, keyVar);
      emit(OP.LOAD, tSlot);
      emit(OP.LOAD, idxSlot);
      emit(OP.GETTABLE);
      emit(OP.STORE, valVar);
      compileBlock(node.body);
      emit(OP.LOAD, idxSlot);
      emitNumber(1);
      emit(OP.ADD);
      emit(OP.STORE, idxSlot);
      emit(OP.JMP, top);
      patch(jz, here());
    } else if (node.type === "ReturnStatement") {
      if (node.arguments.length === 0) {
        emitNumber(0);
        emit(OP.RETURN);
      } else if (node.arguments.length === 1) {
        compileExpr(node.arguments[0]);
        emit(OP.RETURN);
      } else {
        for (const a of node.arguments) compileExpr(a);
        emit(OP.RETURNN, node.arguments.length);
      }
    } else if (node.type === "FunctionDeclaration" && node.identifier) {
      const jmpOver = emit(OP.JMP, 0);
      const addr = here();
      let qname;
      if (node.identifier.type === "Identifier") qname = node.identifier.name;
      else
        qname =
          node.identifier.base.name + "." + node.identifier.identifier.name;
      functions[qname] = { addr };
      const savedScope = scope,
        savedNextSlot = nextSlot,
        savedVararg = varargSlot;
      scope = {};
      nextSlot = 0;
      varargSlot = 0;
      const isMethod =
        node.identifier.type === "MemberExpression" &&
        node.identifier.indexer === ":";
      if (isMethod) slotFor("self");
      for (const p of node.parameters) {
        if (p.type === "VarargLiteral") varargSlot = nextSlot;
        else slotFor(p.name);
      }
      compileBlock(node.body);
      emitNumber(0);
      emit(OP.RETURN);
      scope = savedScope;
      nextSlot = savedNextSlot;
      varargSlot = savedVararg;
      patch(jmpOver, here());
    } else if (node.type === "DoStatement") {
      compileBlock(node.body);
    } else if (node.type === "BreakStatement") {
      // simpleng break: hindi pa suportado nang buo â€” nilalaktawan
    } else throw new Error("hindi sinusuportahan ang statement: " + node.type);
  }

  // Prepass: kolektahin muna ang lahat ng function declarations para ma-forward-call.
  compileBlock(ast.body);
  emit(OP.HALT);

  return { bytecode, OP, constPool };
}

// ================= serialization =================
function serialize(bytecode, OP, constPool) {
  const program = bytecode.map((ins) =>
    ins.arg === undefined ? [OP[ins.op] || ins.op, null] : [OP[ins.op] || ins.op, ins.arg],
  );
  // Pero ang bytecode ay may op na numeric na (OP mapped) â€” i-map na natin:
  const prog = bytecode.map((ins) => {
    const opnum = ins.op;
    return ins.arg === undefined ? [opnum] : [opnum, ins.arg];
  });
  return prog;
}

function luaValue(v) {
  if (Array.isArray(v)) return "{" + v.map(luaValue).join(",") + "}";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return String(v);
  if (v === null || v === undefined) return "nil";
  return String(v);
}

function checksumOf(program) {
  let sum = 0;
  for (let i = 0; i < program.length; i++) {
    const inst = program[i];
    sum = (sum + inst[0] * (i + 1)) % 1000003;
    if (typeof inst[1] === "number") sum = (sum + inst[1]) % 1000003;
  }
  return sum;
}

// ================= main =================
function protect(source) {
  const { bytecode, OP, constPool } = compile(source);
  const program = bytecode.map((ins) =>
    ins.arg === undefined ? [ins.op] : [ins.op, ins.arg],
  );
  const checksum = checksumOf(program);

  const progLua = "{" + program.map((i) => "{" + i.map(luaValue).join(",") + "}").join(",") + "}";
  const opLua =
    "{" +
    Object.entries(OP)
      .map(([k, v]) => k + "=" + v)
      .join(",") +
    "}";
  const kLua = "{" + constPool.map((c) => "{" + c.join(",") + "}").join(",") + "}";

  return { progLua, opLua, kLua, checksum };
}

if (require.main === module) {
  const inFile = process.argv[2];
  if (!inFile) {
    console.error("Gamitin: node luripe.js input.lua [out.lua]");
    process.exit(1);
  }
  const outFile =
    process.argv[3] || inFile.replace(/\.lua$/, "") + ".protected.lua";
  const source = fs.readFileSync(inFile, "utf8");
  const { progLua, opLua, kLua, checksum } = protect(source);
  const vm = fs.readFileSync(__dirname + "/../vm/vm.lua", "utf8");
  const out =
    vm +
    "\nreturn (function()\n  local VM = { run = run, checksumOf = checksumOf }\n" +
    "  local PROGRAM = " + progLua + "\n" +
    "  local OPMAP = " + opLua + "\n" +
    "  local CONSTS = " + kLua + "\n" +
    "  return VM.run(PROGRAM, OPMAP, " + checksum + ", CONSTS)\nend)()\n";
  fs.writeFileSync(outFile, out);
  console.log("Naisulat: " + outFile);
}

module.exports = { protect, compile, encodeString, encodeNumber };
