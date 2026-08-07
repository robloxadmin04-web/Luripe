//  luripe.js — Luripe obfuscator engine (VM + wrapper), Node module.
//  Synced from the working browser build. Exposes compile(), wrapperBundle(),
//  and needsWrapper() detection. Requires: npm install luaparse
//
//  Usage (programmatic):
//     const { protect } = require("./luripe.js");
//     const out = protect(luaSource, { mode: "auto" });  // "auto" | "vm" | "wrapper"
//
//  "auto" runs the VM path, self-checks it, and falls back to wrapper when the
//  script uses constructs the VM cannot safely virtualize (executor globals,
//  Roblox API, coroutines, etc.) — so a broken build never reaches Roblox.

const luaparse = require("luaparse");

// --- Browser-global stubs so UI-oriented engine code loads cleanly under Node ---
const localStorage = {
  _s: {},
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem(k, v){ this._s[k] = String(v); },
  removeItem(k){ delete this._s[k]; },
};
const window = { __luripeVMDebug: false, localStorage };
const navigator = { clipboard: { writeText(){ return Promise.resolve(); } }, userAgent: "node" };
const document = {
  getElementById: () => ({ textContent:"", className:"", value:"", checked:false, style:{}, classList:{ add(){}, remove(){}, toggle(){} }, addEventListener(){}, appendChild(){}, setAttribute(){} }),
  createElement: () => ({ style:{}, classList:{ add(){}, remove(){} }, addEventListener(){}, appendChild(){}, setAttribute(){} }),
  addEventListener(){}, querySelector: () => null, querySelectorAll: () => [], body: { appendChild(){} },
};

      // Mutating + flattened VM: generated fresh per build.
      function rid(used) {
        let n;
        do { n = "_" + Math.random().toString(36).slice(2, 7); } while (used.has(n));
        used.add(n);
        return n;
      }
      function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; }
        return a;
      }
      
      // The opcodes the compiler emits (must all have handlers).
      
      // Build the VM generator. Returns Lua source as a string given:
      //   names: shared runtime names, H handler table name, ctrl record fields.
      function generateVM(OP, usedNames) {
        // NOTE: the "only-used-opcodes" optimization was REMOVED. It caused a
        // fatal bug: opcode usage detection missed opcodes emitted via spill/
        // prelude/metamethod paths, so the generated VM was missing handlers.
        // When the program hit a missing opcode, the binary-search dispatch
        // routed to the wrong handler and corrupted the stack ("attempt to get
        // length of a number value"). We now ALWAYS emit every handler — a
        // slightly larger VM that is guaranteed correct. `usedNames` is ignored.
        const EFF = OPS.slice();
        // ==== HARDENING TOGGLES (flip to false if a build breaks) ====
        const PER_HANDLER_MUTATION = true;  // layer 2: opaque predicate + rand names per handler
        const HANDLER_BODY_MUTATION = true; // layer 2b: junk math woven inside each handler body
        const ANTI_DEBUG = false;           // layer 1: DISABLED - false-positives on executors (silent halt)
        const NESTED_VM = false;            // layer 5: DISABLED - extra indirection can break scope silently
        const CFG_REDIRECTS = true;         // Luraph v14: opaque-predicate control-flow redirects in dispatch
        const DEBUG_ANTITAMPER = false;     // DISABLED - false-positives on executors: every executor installs a debug hook, so this halted the VM on the first opcode (silent break). Re-enable only with an allowlist for the executor's own hook.
        const VM_DEBUG = window.__luripeVMDebug === true;  // emits warn() beacons inside run() when Verbose is on
        // (layer 3 pure-numeric opcodes + layer 4 multi-round consts are always on)

        const used = new Set(["run","OP","program","CONSTS","checksum"]);
        const N = {
          decodeString: rid(used), decodeNumber: rid(used), checksumOf: rid(used),
          BUILTINS: rid(used), stack: rid(used), sp: rid(used),
          push: rid(used), pop: rid(used), frame: rid(used), upvals: rid(used),
          callStack: rid(used), csTop: rid(used), K: rid(used),
          H: rid(used), ctrl: rid(used), inst: rid(used), op: rid(used), arg: rid(used),
          seed: rid(used), prev: rid(used), chars: rid(used), e: rid(used), ks: rid(used), c: rid(used),
          guard: rid(used), refchar: rid(used), refsub: rid(used),
        };
        const CF = { ip: rid(used), jumped: rid(used), halt: rid(used) };

        const P = N.push, O = N.pop, F = N.frame, S = N.stack, SP = N.sp, CT = N.ctrl;
        const body = {
          PUSH:     P+"(a)",
          LOADK:    P+"("+N.K+"[a])",
          POP:      O+"()",
          ADD:      (Math.random()<0.5 ? "local x="+O+"();local b="+O+"();"+P+"(b+x)" : "local b="+O+"();local x="+O+"();"+P+"(x+b)"),
          SUB:      "local b="+O+"();local x="+O+"();"+P+"(x-b)",
          MUL:      (Math.random()<0.5 ? "local x="+O+"();local b="+O+"();"+P+"(b*x)" : "local b="+O+"();local x="+O+"();"+P+"(x*b)"),
          DIV:      "local b="+O+"();local x="+O+"();"+P+"(x/b)",
          MOD:      "local b="+O+"();local x="+O+"();"+P+"(x%b)",
          PRINT:    "print("+S+"["+SP+"()])",
          DUP:      P+"("+S+"["+SP+"()])",
          STORE:    F+"[a]="+O+"()",
          LOAD:     P+"("+F+"[a])",
          PUSHSTR:  P+"("+N.decodeString+"(a))",
          CONCAT:   "local b="+O+"();local x="+O+"();"+P+"(tostring(x)..tostring(b))",
          LT:       "local b="+O+"();local x="+O+"();"+P+"(x<b and 1 or 0)",
          GT:       "local b="+O+"();local x="+O+"();"+P+"(x>b and 1 or 0)",
          LE:       "local b="+O+"();local x="+O+"();"+P+"(x<=b and 1 or 0)",
          GE:       "local b="+O+"();local x="+O+"();"+P+"(x>=b and 1 or 0)",
          EQ:       (Math.random()<0.5 ? "local x="+O+"();local b="+O+"();"+P+"(b==x and 1 or 0)" : "local b="+O+"();local x="+O+"();"+P+"(x==b and 1 or 0)"),
          NE:       (Math.random()<0.5 ? "local x="+O+"();local b="+O+"();"+P+"(b~=x and 1 or 0)" : "local b="+O+"();local x="+O+"();"+P+"(x~=b and 1 or 0)"),
          NOT:      "local x="+O+"();"+P+"((x==0 or x==false or x==nil) and 1 or 0)",
          TLEN:     "local t="+O+"();"+P+"(#t)",
          NEWTABLE: P+"({})",
          SETTABLE: "local v="+O+"();local k="+O+"();local t="+O+"();t[k]=v",
          GETTABLE: "local k="+O+"();local t="+O+"();"+P+"(t[k])",
          JMP:      CT+"."+CF.ip+"=a;"+CT+"."+CF.jumped+"=true",
          JZ:       "if "+O+"()==0 then "+CT+"."+CF.ip+"=a;"+CT+"."+CF.jumped+"=true end",
          HALT:     CT+"."+CF.halt+"=true",
          BUILTIN:  "local id,ac=a[1],a[2];local args={};for k=ac,1,-1 do args[k]="+O+"() end;"+P+"("+N.BUILTINS+"[id](args))",
          CALL:     "local fa,ac=a[1],a[2];local nf={};for k=ac-1,0,-1 do nf[k]="+O+"() end;"+N.csTop+"="+N.csTop+"+1;"+N.callStack+"["+N.csTop+"]={r="+CT+"."+CF.ip+"+1,f="+F+",u="+N.upvals+"};"+N.frame+"=nf;"+N.upvals+"=nil;"+CT+"."+CF.ip+"=fa;"+CT+"."+CF.jumped+"=true",
          RETURN:   "local rv="+O+"();local cl="+N.callStack+"["+N.csTop+"];"+N.callStack+"["+N.csTop+"]=nil;"+N.csTop+"="+N.csTop+"-1;"+N.frame+"=cl.f;"+N.upvals+"=cl.u;"+P+"(rv);"+CT+"."+CF.ip+"=cl.r;"+CT+"."+CF.jumped+"=true",
          RETURNN:  "local n=a;local vs={};for k=n,1,-1 do vs[k]="+O+"() end;local cl="+N.callStack+"["+N.csTop+"];"+N.callStack+"["+N.csTop+"]=nil;"+N.csTop+"="+N.csTop+"-1;"+N.frame+"=cl.f;"+N.upvals+"=cl.u;for k=1,n do "+P+"(vs[k]) end;"+P+"(n);"+CT+"."+CF.ip+"=cl.r;"+CT+"."+CF.jumped+"=true",
          // Multi-value assign. RETURNN/PCALL push (values..., n) with the count
          // on top, so consume n first, pop that many values, then fill targets
          // left-to-right. Fewer values than targets -> rest stay nil (Lua adjust).
          STOREMULTI:"local sl=a;local n="+O+"();local vs={};for k=n,1,-1 do vs[k]="+O+"() end;for k=1,#sl do "+F+"[sl[k]]=vs[k] end",
          VARARG:   "local st=a;local t={};local n=0;local k=st;while "+F+"[k]~=nil do n=n+1;t[n]="+F+"[k];k=k+1 end;"+P+"(t)",
          NEWCELL:  F+"[a]={v="+O+"()}",
          LOADCELL: "local cl="+F+"[a];"+P+"(type(cl)=='table' and cl.v or cl)",
          STORECELL:"local val="+O+"();local cl="+F+"[a];if cl==nil then cl={v=nil};"+F+"[a]=cl end;cl.v=val",
          LOADUP:   "local u="+N.upvals+" and "+N.upvals+"[a];"+P+"(type(u)=='table' and u.v or u)",
          STOREUP:  "local val="+O+"();local u="+N.upvals+" and "+N.upvals+"[a];if type(u)=='table' then u.v=val end",
          // Closure arg is FLAT: {addr, nc, cap1, cap2, ...}. The number-stream
          // encoder cannot represent a NESTED array, so captures are inlined with
          // a leading count nc. (Fixes "length of a number" from #caps on garbage.)
          CLOSURE:  "local addr=a[1];local nc=a[2];local ups={};for i=1,nc do local c=a[2+i];if c>=0 then ups[i-1]="+F+"[c] else ups[i-1]=("+N.upvals+" and "+N.upvals+"[-c-1]) end end;"+P+"({__cl=true,addr=addr,ups=ups})",
          CALLC:    "local ac=a;local cf={};for k=ac-1,0,-1 do cf[k]="+O+"() end;local clo="+O+"();"+N.csTop+"="+N.csTop+"+1;"+N.callStack+"["+N.csTop+"]={r="+CT+"."+CF.ip+"+1,f="+F+",u="+N.upvals+"};"+F+"=cf;"+N.upvals+"=clo.ups;"+CT+"."+CF.ip+"=clo.addr;"+CT+"."+CF.jumped+"=true",
          GETGLOBAL: "local nm="+N.decodeString+"(a);local _gg=(getgenv and getgenv());local _v=(_gg and _gg[nm]);if _v==nil then _v=((_ENV or (getfenv and getfenv()) or _G) or {})[nm] end;"+P+"(_v)",
          // PARTIAL-VM bridge: publish a VM local into the shared bridge table so a
          // spilled callback (real Lua closure) can read/update it across the boundary.
          BRIDGESET: "local nm="+N.decodeString+"(a);local val="+O+"();local G=(getgenv and getgenv()) or (getfenv and getfenv()) or _G;G.__LRP_BRIDGE=G.__LRP_BRIDGE or {};G.__LRP_BRIDGE[nm]=val",
          SELFCALL:  "local nm="+N.decodeString+"(a[1]);local ac=a[2];local args={};for k=ac,1,-1 do args[k]="+O+"() end;local obj="+O+"();local fn=obj[nm];"+
                     "if type(fn)=='table' and fn.__cl then "+
                       "local cf={};cf[0]=obj;for k=1,ac do cf[k]=args[k] end;"+
                       N.csTop+"="+N.csTop+"+1;"+N.callStack+"["+N.csTop+"]={r="+CT+"."+CF.ip+"+1,f="+F+",u="+N.upvals+"};"+
                       F+"=cf;"+N.upvals+"=fn.ups;"+CT+"."+CF.ip+"=fn.addr;"+CT+"."+CF.jumped+"=true "+
                     "else "+P+"(fn(obj,(table.unpack or unpack)(args,1,ac))) end",
          CALLR:     "local ac=a;local args={};for k=ac,1,-1 do args[k]="+O+"() end;local fn="+O+"();"+
                     "if type(fn)=='table' and fn.__cl then "+
                       "local cf={};for k=1,ac do cf[k-1]=args[k] end;"+
                       N.csTop+"="+N.csTop+"+1;"+N.callStack+"["+N.csTop+"]={r="+CT+"."+CF.ip+"+1,f="+F+",u="+N.upvals+"};"+
                       F+"=cf;"+N.upvals+"=fn.ups;"+CT+"."+CF.ip+"=fn.addr;"+CT+"."+CF.jumped+"=true "+
                     "else "+P+"(fn((table.unpack or unpack)(args,1,ac))) end",
          RCALL:     "local ac=a;local args={};for k=ac,1,-1 do args[k]="+O+"() end;local fn="+O+"();"+
                     "if type(fn)=='table' and fn.__cl then "+
                       "local cf={};for k=1,ac do cf[k-1]=args[k] end;"+
                       N.csTop+"="+N.csTop+"+1;"+N.callStack+"["+N.csTop+"]={r="+CT+"."+CF.ip+"+1,f="+F+",u="+N.upvals+"};"+
                       F+"=cf;"+N.upvals+"=fn.ups;"+CT+"."+CF.ip+"=fn.addr;"+CT+"."+CF.jumped+"=true "+
                     "else fn((table.unpack or unpack)(args,1,ac)) end",
          // Stage 3: real pcall. a = arg count (callee + its args). Pop args and
          // callee, run under Lua pcall, then push results so that the VM's
          // multi-assign (STOREMULTI) unpacks `local ok, res = pcall(...)`.
          // We push res first, then ok, then the count (2), matching RETURNN's
          // (values..., n) convention consumed by STOREMULTI.
          PCALL:     "local ac=a;local args={};for k=ac,1,-1 do args[k]="+O+"() end;local fn="+O+"();" +
                     "local pr={pcall(fn,(table.unpack or unpack)(args,1,ac))};" +
                     "local ok=pr[1] and 1 or 0;local v=pr[2];" +
                     // STOREMULTI pops n, then vs[n..1]=pop(), then frame[sl[k]]=vs[k].
                     // Target: sl[1]=ok, sl[2]=res  =>  vs[1]=ok, vs[2]=res.
                     // pops happen n..1, so first pop -> vs[2], second pop -> vs[1].
                     // Push order (bottom->top): res, ok, n  => pop n=2, pop ok->vs[2]? no.
                     // pop order: k=2 pops top(=ok)->vs[2]; k=1 pops next(=res)->vs[1].
                     // That gives vs[1]=res, vs[2]=ok (WRONG). So push ok first, then res:
                     // stack bottom->top: ok, res, 2. pop2: k=2->res->vs[2]; k=1->ok->vs[1].
                     // => vs[1]=ok, vs[2]=res. Correct.
                     P+"(ok);"+P+"(v);"+P+"(2)",
        };

        const missing = EFF.filter((o) => !(o in body));
        if (missing.length) throw new Error("missing handler bodies: " + missing.join(","));

        // Layer 2: per-handler mutation. Wrap body in an always-true opaque
        // predicate with a dead branch; randomize a junk local per handler.
        function mutate(code) {
          if (!PER_HANDLER_MUTATION) return code;
          // Layer 2b: per-handler BODY mutation (Luraph-style) - weave junk math
          // and a dead never-taken branch INTO the real body, so handler internals
          // differ every build (not just their order). Semantics unchanged.
          let realBody = code;
          if (HANDLER_BODY_MUTATION) {
            const j1 = "_" + Math.random().toString(36).slice(2, 6);
            const j2 = "_" + Math.random().toString(36).slice(2, 6);
            const k1 = ((Math.random()*900)|0)+11;
            const k2 = ((Math.random()*90)|0)+3;
            const pre = "local " + j1 + "=" + k1 + "*" + k1 + ";local " + j2 + "=" + j1 + "%" + k2 + ";";
            const dead = "if " + j1 + "<0 then " + j2 + "=" + j2 + "+1 end ";
            realBody = pre + dead + code;
          }
          // Control-flow flattening per handler (Luraph-style state machine).
          const sv = "_" + Math.random().toString(36).slice(2, 6);
          const done = "_" + Math.random().toString(36).slice(2, 6);
          const jv = "_" + Math.random().toString(36).slice(2, 6);
          const nums3 = [];
          while (nums3.length < 3) { const n = ((Math.random()*900)|0)+10; if (nums3.indexOf(n)<0) nums3.push(n); }
          const sEntry = nums3[0], sReal = nums3[1], sExit = nums3[2];
          const a = ((Math.random()*900)|0)+10;
          return "local " + sv + "=" + sEntry + ";local " + done + "=false;" +
            "while not " + done + " do " +
              "if " + sv + "==" + sEntry + " then local " + jv + "=" + a + "*" + a + ";if " + jv + ">=0 then " + sv + "=" + sReal + " else " + sv + "=" + sExit + " end " +
              "elseif " + sv + "==" + sReal + " then " + realBody + ";" + sv + "=" + sExit + " " +
              "else " + done + "=true end " +
            "end";
        }

        // Layer 3: PURE-NUMERIC handlers. Emit H[<number>]=... using the literal
        // opcode number (from the OP map), so no opcode NAME string ever appears.
        const order = shuffle(EFF.slice());
        const opnum = {}; // name -> literal number for this build
        EFF.forEach((o) => { opnum[o] = OP[o]; });
        const handlerLines = order.map((o) =>
          N.H + "[" + opnum[o] + "]=function(a) " + mutate(body[o]) + " end"
        );
        // Binary-search dispatch tree over the numeric opcodes (IronBrew-style),
        // replacing a flat H[op] lookup. Shuffled leaf order per build.
        const nums = EFF.map((o) => opnum[o]).sort((a,b)=>a-b);
        function bsearch(lo, hi) {
          if (lo > hi) return "error(\"?\")";
          if (lo === hi) return N.H + "[" + nums[lo] + "](" + N.arg + ")";
          const mid = (lo + hi) >> 1;
          return "if " + N.op + "<=" + nums[mid] + " then " + bsearch(lo, mid) +
                 " else " + bsearch(mid+1, hi) + " end";
        }
        const dispatchTree = bsearch(0, nums.length - 1);

        // Layer 1: anti-debug guards (run once before dispatch).
        // Capture trusted refs; if string.char / string.sub were swapped, or if
        // a debug hook is present, corrupt execution silently.
        const antiDebug = ANTI_DEBUG ? (
          "local " + N.refchar + "=string.char;local " + N.refsub + "=string.sub;" +
          "local " + N.guard + "=function() " +
          "if type(" + N.refchar + ")~=\"function\" then return false end " +
          "if type(" + N.refsub + ")~=\"function\" then return false end " +
          "return true end;" +
          "if not " + N.guard + "() then program={{" + opnum.HALT + "}} end;"
        ) : "";

        // Luraph v14 'Use Debug Library' anti-tamper. SAFE by design: only
        // engages when the FULL debug library is present (executors that lack it
        // are unaffected), and on hook detection sets a soft halt flag rather
        // than erroring. Detects sethook-based single-stepping and getinfo
        // probing used by formatting/deobfuscation tools.
        const dbgVar = "_" + Math.random().toString(36).slice(2,7);
        const debugAntiTamper = DEBUG_ANTITAMPER ? (
          "local " + dbgVar + "=false;" +
          "if type(debug)=='table' and type(debug.gethook)=='function' then " +
          "  local ok,h=pcall(debug.gethook);" +
          "  if ok and h~=nil then " + dbgVar + "=true end " + // a hook is installed -> likely stepping/tracing
          "end;"
        ) : "";

        const src =
          "local KEY,OFFSET=0x5A,7\n" +
          "local PRIME,CMASK=167,0xFF\n" +
          "local function " + N.decodeString + "(enc)\n" +
          "  local " + N.seed + "=enc[1];local " + N.prev + "=" + N.seed + ";local " + N.chars + "={}\n" +
          "  for i=2,#enc do\n" +
          "    local " + N.e + "=enc[i]\n" +
          "    local " + N.ks + "=bit32.band(bit32.bxor(bit32.bxor(bit32.bxor(" + N.seed + ",(i-1)*PRIME)," + N.prev + ")," + STR_SALT + "),CMASK)\n" +
          "    local " + N.c + "=bit32.band(bit32.bxor(" + N.e + "," + N.ks + "),CMASK)-OFFSET\n" +
          "    if " + N.c + "<0 then " + N.c + "=" + N.c + "+256 end\n" +
          "    " + N.chars + "[i-1]=string.char(bit32.band(" + N.c + ",CMASK));" + N.prev + "=" + N.e + "\n" +
          "  end\n" +
          "  return table.concat(" + N.chars + ")\n" +
          "end\n" +
          "local function " + N.decodeNumber + "(enc)\n" +
          "  local R2=enc[#enc];local R=enc[#enc-1];local t={enc[1]}\n" +
          "  for i=2,#enc-2 do t[i]=bit32.band(bit32.bxor(bit32.bxor(enc[i],R2),R),0xFF) end\n" +
          "  return tonumber(" + N.decodeString + "(t)) end\n" +
          "local " + N.BUILTINS + "={\n" +
          "  [1]=function(a) return math.floor(a[1]) end,[2]=function(a) return math.ceil(a[1]) end,\n" +
          "  [3]=function(a) return math.abs(a[1]) end,[4]=function(a) return math.max(a[1],a[2]) end,\n" +
          "  [5]=function(a) return math.min(a[1],a[2]) end,[6]=function(a) return string.upper(a[1]) end,\n" +
          "  [7]=function(a) return string.lower(a[1]) end,[8]=function(a) return #a[1] end,\n" +
          "  [9]=function(a) return string.rep(a[1],a[2]) end,[10]=function(a) return tostring(a[1]) end,\n" +
          "  [11]=function(a) return tonumber(a[1]) end,[12]=function(a) table.insert(a[1],a[2]);return 0 end,\n" +
          "  [13]=function(a) return math.sqrt(a[1]) end,[14]=function(a) return math.random(a[1],a[2]) end,\n" +
          "  [15]=function(a) return a[1]^a[2] end,[16]=function(a) return string.sub(a[1],a[2],a[3]) end,\n" +
          "  [17]=function(a) return string.format(a[1],a[2],a[3],a[4]) end,[18]=function(a) return string.reverse(a[1]) end,\n" +
          "  [19]=function(a) return string.byte(a[1],a[2]) end,[20]=function(a) return string.char(a[1]) end,\n" +
          "  [21]=function(a) return table.remove(a[1],a[2]) end,[22]=function(a) return table.concat(a[1],a[2] or \"\") end,\n" +
          "  [23]=function(a) return type(a[1]) end,[24]=function(a) return math.sin(a[1]) end,\n" +
          "  [25]=function(a) return math.cos(a[1]) end,\n" +
          // Stage 4 metatable + raw builtins.
          "  [26]=function(a) return setmetatable(a[1],a[2]) end,\n" +
          "  [27]=function(a) return getmetatable(a[1]) end,\n" +
          "  [28]=function(a) return rawget(a[1],a[2]) end,\n" +
          "  [29]=function(a) rawset(a[1],a[2],a[3]);return a[1] end,\n" +
          "  [30]=function(a) return rawequal(a[1],a[2]) end,\n" +
          "  [31]=function(a) return (rawlen and rawlen(a[1])) or #a[1] end,\n" +
          "  [32]=function(a) return assert(a[1],a[2]) end,\n" +
          "  [33]=function(a) return select(a[1],a[2]) end,\n" +
          "  [34]=function(a) return (table.unpack or unpack)(a[1]) end,\n" +
          "  [35]=function(a) return (table.unpack or unpack)(a[1]) end,\n" +
          "}\n" +
          "local function " + N.checksumOf + "(program)\n" +
          "  local sum=0\n" +
          "  for i=1,#program do\n" +
          "    local ins=program[i]\n" +
          "    sum=(sum+ins[1]*i)%1000003\n" +
          "    if type(ins[2])==\"number\" then sum=(sum+ins[2])%1000003 end\n" +
          "  end\n" +
          "  return sum\n" +
          "end\n" +
          "local function run(program,OP,checksum,CONSTS)\n" +
          "  " + (VM_DEBUG ? "warn(\"[VM] entered run, program len=\"..tostring(#program))\n  " : "") +
          antiDebug + "\n" +
          "  " + debugAntiTamper + "\n" +
          "  " + (VM_DEBUG ? "warn(\"[VM] passed anti-debug\")\n  " : "") +
          "  if checksum~=nil and " + N.checksumOf + "(program)~=checksum then " +
          (VM_DEBUG ? "warn(\"[VM] CHECKSUM MISMATCH got=\"..tostring(" + N.checksumOf + "(program))..\" want=\"..tostring(checksum)) " : "") +
          "error(\"Luripe: tampering detected\") end\n" +
          "  " + (VM_DEBUG ? "warn(\"[VM] passed checksum\")\n  " : "") +
          "  local " + N.K + "={}\n" +
          "  if CONSTS then for i=1,#CONSTS do " + N.K + "[i-1]=" + N.decodeNumber + "(CONSTS[i]) end end\n" +
          "  local " + N.stack + ",sp={},0\n" +
          "  local function " + N.push + "(v) sp=sp+1;" + N.stack + "[sp]=v end\n" +
          "  local function " + N.pop + "() local v=" + N.stack + "[sp];" + N.stack + "[sp]=nil;sp=sp-1;return v end\n" +
          "  local function " + N.sp + "() return sp end\n" +
          "  local " + N.frame + "={}\n" +
          "  local " + N.callStack + "," + N.csTop + "={},0\n" +
          "  local " + N.upvals + "=nil\n" +
          "  local " + N.H + "={}\n" +
          "  local " + N.ctrl + "={" + CF.ip + "=1," + CF.jumped + "=false," + CF.halt + "=false}\n" +
          handlerLines.map((l) => "  " + l).join("\n") + "\n" +
          "  while " + N.ctrl + "." + CF.ip + "<=#program do\n" +
          "    local " + N.inst + "=program[" + N.ctrl + "." + CF.ip + "]\n" +
          "    local " + N.op + "," + N.arg + "=" + N.inst + "[1]," + N.inst + "[2]\n" +
          "    " + N.ctrl + "." + CF.jumped + "=false\n" +
          (CFG_REDIRECTS ? (function(){
            const g1 = "_" + Math.random().toString(36).slice(2,7);
            const flag = "_" + Math.random().toString(36).slice(2,7);
            // TRULY invariant opaque predicate. The previous version used
            // (op*op)>=0, which is NOT invariant: op*op can overflow / become a
            // non-number on some engines, so the else-branch fired and set ip to
            // a garbage value, skipping the real opcode (crash: arithmetic on
            // nil). Now: x==x is true for any real value, and the dead branch is
            // a pure no-op that NEVER touches ip - so a misread cannot skip an op.
            return "    local " + g1 + "=" + N.op + "\n" +
                   "    local " + flag + "=(" + g1 + "==" + g1 + ")\n" +
                   "    if " + flag + " then\n" +
                   "      " + dispatchTree + "\n" +
                   "    else\n" +
                   "      local _decoy=" + g1 + "\n" +
                   "    end\n";
          })() : "    " + dispatchTree + "\n") +
          "    if " + N.ctrl + "." + CF.halt + " then break end\n" +
          (DEBUG_ANTITAMPER ? "    if " + dbgVar + " then break end\n" : "") +
          "    if not " + N.ctrl + "." + CF.jumped + " then " + N.ctrl + "." + CF.ip + "=" + N.ctrl + "." + CF.ip + "+1 end\n" +
          "  end\n" +
          "end\n" +
          "return { run=run, " + N.checksumOf + "=" + N.checksumOf + " }\n";

        // Layer 5: nested wrapper. Wrap the whole VM in an extra scope that only
        // exposes run() through an indirection table, hiding the direct entry.
        let finalSrc = src;
        if (NESTED_VM) {
          const W = rid(used), G = rid(used);
          finalSrc =
            "local " + W + "=(function()\n" + src + "\nend)()\n" +
            "local " + G + "={}\n" +
            G + "[1]=" + W + ".run\n" +
            "local function run(program,OP,checksum,CONSTS) return " + G + "[1](program,OP,checksum,CONSTS) end\n" +
            "return { run=run, " + N.checksumOf + "=" + W + "." + N.checksumOf + " }\n";
        }

        return { src: finalSrc, N, CF, order };
      }


      const OFFSET = 7, PRIME = 167, CMASK = 0xff, HARDENING = true;

      // Module-level so both encodeNumber() and generateVM() can read it.
      const MULTIROUND_CONSTS = true;     // layer 4b: second cipher round on the constant pool
      const DUAL_VM = true;               // layer: first-stage decryptor (mini-VM) unwraps the instruction stream
      const MBA_CONSTS = true;            // layer: encode some int literals as runtime arithmetic (no literal in pool)
      // Per-build global salt mixed into every string keystream. Deepens per-string
      // keys and makes global names (game/getgenv) undecodable without replaying it.
      const STR_SALT = 1 + Math.floor(Math.random() * 250);

      function encodeString(str) {
        const seed = 1 + Math.floor(Math.random() * 254);
        const out = [seed];
        let prev = seed;
        for (let i = 0; i < str.length; i++) {
          const c = str.charCodeAt(i);
          const ks = (seed ^ ((i + 1) * PRIME) ^ prev ^ STR_SALT) & CMASK;
          const e = ((c + OFFSET) & CMASK) ^ ks;
          out.push(e);
          prev = e;
        }
        return out;
      }
      function encodeNumber(n) {
        // Multi-round: rolling-encode a randomized string form of the number,
        // then XOR-fold every byte with a per-constant round key R (trailing).
        // The string form is varied per constant (integer vs padded vs float
        // when exact) so identical numbers do not encode identically. tonumber()
        // reverses all forms, so value is preserved.
        let form = String(n);
        if (Number.isInteger(n)) {
          const pick = (Math.random()*3)|0;
          if (pick === 1) form = " " + n;          // leading space (tonumber trims)
          else if (pick === 2) form = n + ".0";     // float form
        }
        const base = encodeString(form);
        const R = 1 + Math.floor(Math.random() * 254);
        const out = base.map((b, i) => i === 0 ? b : ((b ^ R) & 0xff));
        if (MULTIROUND_CONSTS) {
          // Second cipher round: XOR-fold the already-folded body bytes with a
          // distinct key R2, stored as an extra trailing element. Decoder strips
          // R2 first, then R. Doubles the work to recover a constant statically.
          const R2 = 1 + Math.floor(Math.random() * 254);
          for (let i = 1; i < out.length; i++) out[i] = (out[i] ^ R2) & 0xff;
          out.push(R2); // second-round key (outermost trailing)
        }
        out.push(R); // first-round key (final trailing)
        return out;
      }

      const OPS = [
        "PUSH","ADD","SUB","MUL","PRINT","JMP","JZ","DUP","HALT","STORE",
        "LOAD","DIV","PUSHSTR","POP","LT","GT","LE","GE","EQ","NE","CALL",
        "RETURN","NEWTABLE","SETTABLE","GETTABLE","CONCAT","BUILTIN","TLEN",
        "MOD","RETURNN","STOREMULTI","VARARG","NOT","NEWCELL","LOADCELL",
        "STORECELL","LOADUP","STOREUP","CLOSURE","CALLC","LOADK",
        "GETGLOBAL","SELFCALL","CALLR","RCALL","PCALL","BRIDGESET",
      ];
      function buildOpcodeMap() {
        const nums = [];
        for (let i = 1; i <= OPS.length; i++) nums.push(i);
        for (let i = nums.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [nums[i], nums[j]] = [nums[j], nums[i]];
        }
        const map = {};
        OPS.forEach((name, i) => { map[name] = nums[i]; });
        return map;
      }

      const BUILTIN_IDS = {
        "math.floor": { id: 1, argc: 1 }, "math.ceil": { id: 2, argc: 1 },
        "math.abs": { id: 3, argc: 1 }, "math.max": { id: 4, argc: 2 },
        "math.min": { id: 5, argc: 2 }, "string.upper": { id: 6, argc: 1 },
        "string.lower": { id: 7, argc: 1 }, "string.len": { id: 8, argc: 1 },
        "string.rep": { id: 9, argc: 2 }, tostring: { id: 10, argc: 1 },
        tonumber: { id: 11, argc: 1 }, "table.insert": { id: 12, argc: 2 },
        "math.sqrt": { id: 13, argc: 1 }, "math.random": { id: 14, argc: 2 },
        "math.pow": { id: 15, argc: 2 }, "string.sub": { id: 16, argc: 3 },
        "string.format": { id: 17, argc: 4 }, "string.reverse": { id: 18, argc: 1 },
        "string.byte": { id: 19, argc: 2 }, "string.char": { id: 20, argc: 1 },
        "table.remove": { id: 21, argc: 2 }, "table.concat": { id: 22, argc: 2 },
        type: { id: 23, argc: 1 }, "math.sin": { id: 24, argc: 1 },
        "math.cos": { id: 25, argc: 1 },
        // Stage 4: metatable + raw builtins. Our VM tables are real Lua tables,
        // so once setmetatable is applied, t[k]/t[k]=v/arith honor metamethods
        // automatically. We just need these callable inside the VM.
        setmetatable: { id: 26, argc: 2 }, getmetatable: { id: 27, argc: 1 },
        rawget: { id: 28, argc: 2 }, rawset: { id: 29, argc: 3 },
        rawequal: { id: 30, argc: 2 }, rawlen: { id: 31, argc: 1 }, assert: { id: 32, argc: 2 },
        select: { id: 33, argc: 2 }, unpack: { id: 34, argc: 1 }, "table.unpack": { id: 35, argc: 1 },
      };

      function compile(source) {
        const ROBLOX_PASSTHROUGH = true; // globals/services/runtime calls
        const OP = buildOpcodeMap();
        // ===== Luau -> Lua 5.1 preprocessor (deep-fixed continue) =====
        // luaparse@0.3.1 is Lua 5.1 only. Transform Luau type annotations,
        // compound assignment (+=), and continue BEFORE parsing. The continue
        // rewriter wraps ONE innermost loop per pass then RE-SCANS the fresh
        // string, so nested-loop wraps never desync (fixes the double-'until'
        // bug). A tokenizer skips strings/comments so method colons and string
        // contents are never touched. Block-balance validated on real scripts.
        function __lt(s){ const t=[]; let i=0,n=s.length; const ww=c=>/[A-Za-z0-9_]/.test(c);
          while(i<n){ const c=s[i];
            if(c==='-'&&s[i+1]==='-'){ if(s[i+2]==='['){const m=/^\[(=*)\[/.exec(s.slice(i+2)); if(m){const cl=']'+m[1]+']';const q=s.indexOf(cl,i+2+m[0].length);i=q<0?n:q+cl.length;continue;}} const q=s.indexOf('\n',i); i=q<0?n:q; continue; }
            if(c==='['){const m=/^\[(=*)\[/.exec(s.slice(i)); if(m){const cl=']'+m[1]+']';const q=s.indexOf(cl,i+m[0].length);i=q<0?n:q+cl.length;continue;}}
            if(c==='"'||c==="'"){i++;while(i<n&&s[i]!==c){if(s[i]==='\\')i++;i++;}i++;continue;}
            if(ww(c)&&!/[0-9]/.test(c)){let j=i;while(j<n&&ww(s[j]))j++;t.push({w:s.slice(i,j),i:i,j:j});i=j;continue;}
            i++;
          } return t;
        }
        function __linner(s){ const t=__lt(s); const st=[]; const loops=[]; const cs=[];
          for(let k=0;k<t.length;k++){ const w=t[k].w;
            if(w==="continue")cs.push({i:t[k].i,j:t[k].j});
            if(w==="for"||w==="while")st.push({type:w,doTok:-1});
            else if(w==="if"||w==="function")st.push({type:w});
            else if(w==="do"){const tp=st[st.length-1]; if(tp&&(tp.type==="for"||tp.type==="while")&&tp.doTok===-1)tp.doTok=k; else st.push({type:"do"});}
            else if(w==="repeat")st.push({type:"repeat"});
            else if(w==="until"){for(let z=st.length-1;z>=0;z--){if(st[z].type==="repeat"){st.splice(z,1);break;}}}
            else if(w==="end"){const b=st.pop(); if(b&&(b.type==="for"||b.type==="while")&&b.doTok>=0)loops.push({bodyStart:t[b.doTok].j,bodyEnd:t[k].i});}
          }
          loops.forEach(function(l){l.span=l.bodyEnd-l.bodyStart;});
          let best=null;
          for(const ct of cs){ let owner=null; for(const l of loops){ if(ct.i>l.bodyStart&&ct.i<l.bodyEnd){ if(!owner||l.span<owner.span)owner=l; } } if(owner){ if(!best||owner.span<best.span)best=owner; } }
          return best;
        }
        function __lbreak(body){ const t=__lt(body); const st=[]; const own=[];
          for(let k=0;k<t.length;k++){ const w=t[k].w;
            if(w==="continue"){ if(st.every(function(b){return b.type!=="for"&&b.type!=="while";}))own.push(t[k]); }
            if(w==="for"||w==="while")st.push({type:w,dop:true});
            else if(w==="if"||w==="function")st.push({type:w});
            else if(w==="do"){const tp=st[st.length-1]; if(tp&&(tp.type==="for"||tp.type==="while")&&tp.dop)tp.dop=false; else st.push({type:"do"});}
            else if(w==="repeat")st.push({type:"repeat"});
            else if(w==="until"){for(let z=st.length-1;z>=0;z--){if(st[z].type==="repeat"){st.splice(z,1);break;}}}
            else if(w==="end")st.pop();
          }
          own.sort(function(a,b){return b.i-a.i;});
          let o=body; for(const ct of own){ o=o.slice(0,ct.i)+"break"+o.slice(ct.j); } return o;
        }
        function __lcont(s){ let out=s,g=0;
          while(g++ < 2000){ const l=__linner(out); if(!l)break; let body=out.slice(l.bodyStart,l.bodyEnd); body=__lbreak(body); out=out.slice(0,l.bodyStart)+" repeat"+body+" until true "+out.slice(l.bodyEnd); }
          return out;
        }
        function __lprep(s){ let o=s;
          o=o.replace(/\)\s*:\s*[A-Za-z_][A-Za-z0-9_.]*(\s*<[^>\r\n]*>)?(\s*\??)(\s*\|\s*[A-Za-z_][A-Za-z0-9_.<>{}?]*)*/g,")");
          o=o.replace(/([A-Za-z0-9_\]])\s*:\s*(?!:)([A-Za-z_][A-Za-z0-9_.]*(?:<[^>\r\n]*>)?\??(?:\s*\|\s*[A-Za-z_][A-Za-z0-9_.<>{}?]*)*)(?=\s*[,)=\r\n])/g,"$1");
          o=o.replace(/(^|[\r\n;]|\bthen\b|\bdo\b|\belse\b)(\s*)([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]\r\n]+\])*)\s*(\.\.|[+\-*/%^])=\s*/g,function(m,p,ws,lv,op){return p+ws+lv+" = "+lv+" "+op+" ";});
          o=__lcont(o);
          return o;
        }
        source = __lprep(source);
        const ast = luaparse.parse(source, { ranges: true });
        const SRC = source; // kept for per-function spill (hybrid fallback)
        // Extract the exact original text of an AST node via its char range.
        const nodeSource = (node) => (node && node.range) ? SRC.slice(node.range[0], node.range[1]) : null;
        const bytecode = [];

        const constPool = [];
        const constIndex = new Map();
        const constFor = (value) => {
          if (constIndex.has(value)) return constIndex.get(value);
          const idx = constPool.length;
          constPool.push(encodeNumber(value));
          constIndex.set(value, idx);
          return idx;
        };
        const emitNumber = (value) => emit(OP.LOADK, constFor(value));

        const usedOps = new Set();
        const emit = (op, arg) => {
          usedOps.add(op); // only-used-opcodes: record every emitted opcode
          bytecode.push(arg === undefined ? { op } : { op, arg });
          return bytecode.length - 1;
        };
        const patch = (index, target) => { bytecode[index].arg = target; };
        const here = () => bytecode.length + 1;

        // ===== HYBRID FALLBACK (per-function) =====
        // Instead of failing the whole build when the VM cannot compile a
        // construct, we snapshot compiler state, try to compile a unit, and on
        // failure roll back and emit that ONE unit as a loadstring closure that
        // shares the real global environment. The rest of the script still
        // virtualizes. spilledFns lists {name, src} we embed at bundle time.
        const spilledFns = [];
        let __spillId = 0;
        // ULTIMATE BRIDGE: names any spilled island references become shared via _ENV.
        const registerSpillRefs = (luaSrc) => {
          if (!luaSrc) return;
          // crude identifier scan of the spilled Lua source; over-inclusion is safe
          const idRe = /[A-Za-z_][A-Za-z0-9_]*/g; let mm;
          while ((mm = idRe.exec(luaSrc))) bridgedEver.add(mm[0]);
        };
        const snapshot = () => ({
          bc: bytecode.length,
          scope: Object.assign({}, scope),
          nextSlot, varargSlot,
          fns: Object.assign({}, functions),
          consts: constPool.length,
        });
        const rollback = (snap) => {
          bytecode.length = snap.bc;
          // restore scope object in place (compileExpr closes over `scope`)
          for (const k in scope) delete scope[k];
          Object.assign(scope, snap.scope);
          nextSlot = snap.nextSlot; varargSlot = snap.varargSlot;
          for (const k in functions) delete functions[k];
          Object.assign(functions, snap.fns);
          // drop constants added during the failed attempt (and their index map)
          while (constPool.length > snap.consts) constPool.pop();
          for (const [val, idx] of Array.from(constIndex.entries())) {
            if (idx >= snap.consts) constIndex.delete(val);
          }
        };
        // Emit a named local bound to a spilled closure, then register it so
        // later name/method/qualified calls resolve through the runtime CALLR/
        // SELFCALL path (which already exists in the VM).
        const spillNamed = (qname, luaSrc) => {
          const gsym = '__lrp_spill_' + (__spillId++);
          spilledFns.push({ sym: gsym, src: luaSrc });
          // Store the spilled closure into a local slot AND register it as a
          // closure-backed function so call sites emit CALLC (load slot, call the
          // value) instead of CALL [undefined addr]. Without the closureSlot
          // registration, calling a spilled named fn crashed with "attempt to
          // call a table value".
          if (qname && qname.indexOf('.') === -1 && qname.indexOf(':') === -1) {
            const slot = slotFor(qname);
            emit(OP.GETGLOBAL, encodeString(gsym));
            emit(OP.STORE, slot);
            functions[qname] = { closureSlot: slot };
          }
          // qualified/method names (T.f / T:m) are reached at runtime via the
          // global table itself, so no local binding is required.
          return gsym;
        };

        const functions = {};
        const bridgedEver = new Set(); // names shared with spilled callbacks via __LRP_BRIDGE
        // Stage 2: stack of open loops; each entry collects `break` jumps to
        // patch to the loop's exit address once the loop body is compiled.
        const loopStack = [];
        let scope = {};
        let varargSlot = 0;
        let nextSlot = 0;
        const slotFor = (name) => {
          if (scope[name] === undefined) scope[name] = nextSlot++;
          return scope[name];
        };

        // Collect names that any NESTED function (closure) references. If such a
        // name resolves to a local in the CURRENT scope, that local must live in
        // a shared cell so the closure sees writes. Used to pre-mark cells before
        // emitting the local's STORE. (Part A of the closure-upvalue fix.)
        const namesUsedByNestedFns = (bodyNodes) => {
          const names = new Set();
          const walkFn = (n) => { // collect ALL identifiers inside a nested fn
            (function c(x){ if(!x||typeof x!=="object")return; if(Array.isArray(x)){x.forEach(c);return;}
              if(x.type==="Identifier") names.add(x.name);
              for(const k in x){ if(k==="type")continue; c(x[k]); } })(n);
          };
          (function scan(x){ if(!x||typeof x!=="object")return; if(Array.isArray(x)){x.forEach(scan);return;}
            if((x.type==="FunctionDeclaration"||x.type==="FunctionExpression")){ walkFn(x.body); return; }
            for(const k in x){ if(k==="type")continue; scan(x[k]); } })(bodyNodes);
          return names;
        };

        const CMP = { "<": "LT", ">": "GT", "<=": "LE", ">=": "GE", "==": "EQ", "~=": "NE" };
        const emitJunk = () => {
          if (!HARDENING) return;
          // Pick a stack-neutral inert sequence. Each leaves the stack unchanged and
          // is a sequence of REAL opcodes, so it is counted by the checksum and is
          // indistinguishable from genuine instructions in the stream.
          const pick = (Math.random() * 4) | 0;
          if (pick === 0) { emitNumber(Math.floor(Math.random() * 99999)); emit(OP.POP); }
          else if (pick === 1) { emitNumber(Math.floor(Math.random() * 9999)); emit(OP.DUP); emit(OP.POP); emit(OP.POP); }
          else if (pick === 2) { emitNumber(Math.floor(Math.random() * 999)); emitNumber(Math.floor(Math.random() * 999)); emit(OP.ADD); emit(OP.POP); }
          else { emitNumber(Math.floor(Math.random() * 999)); emitNumber(Math.floor(Math.random() * 999)); emit(OP.POP); emit(OP.POP); }
        };

        function builtinName(node) {
          if (node.type === "MemberExpression" && node.base.type === "Identifier")
            return node.base.name + "." + node.identifier.name;
          if (node.type === "Identifier") return node.name;
          return null;
        }

        // MBA: encode some integer literals as a runtime arithmetic expression so the
        // literal value never appears in the constant pool. Split v into a+b (or a-b)
        // and emit PUSH-based arithmetic. Guarded to safe integer range; falls back to
        // a normal constant load for floats, big numbers, or when the toggle is off.
        const emitMBA = (v) => {
          // MBA only for NON-NEGATIVE integers in a safe range. Negative or float
          // splits could produce constants whose encode/decode edge cases desync
          // arithmetic-heavy expressions (e.g. maxW / 1040), which surfaced as
          // "attempt to index number with number". Guarding this keeps the layer
          // where it is provably safe.
          if (!MBA_CONSTS || !Number.isInteger(v) || v < 0 || v > 100000) { emitNumber(v); return false; }
          const useSub = Math.random() < 0.5;
          if (useSub) {
            const b = Math.floor(Math.random() * 5000) + 1;
            const a = v + b;                 // a - b = v
            emitNumber(a); emitNumber(b); emit(OP.SUB);
          } else {
            const a = Math.floor(Math.random() * (Math.abs(v) + 1000));
            const b = v - a;                 // a + b = v (b may be negative -> still fine)
            emitNumber(a); emitNumber(b); emit(OP.ADD);
          }
          return true;
        };
        function compileExpr(node) {
          if (node.type === "NumericLiteral") {
            if (MBA_CONSTS && Math.random() < 0.6) emitMBA(node.value); else emitNumber(node.value);
          } else if (node.type === "BooleanLiteral") {
            emitNumber(node.value ? 1 : 0);
          } else if (node.type === "NilLiteral") {
            emitNumber(0);
          } else if (node.type === "StringLiteral") {
            let str = node.value;
            if (str === null || str === undefined) str = node.raw.slice(1, -1);
            emit(OP.PUSHSTR, encodeString(str));
          } else if (node.type === "Identifier") {
            if (scope.__upvals && scope.__upvals[node.name] !== undefined) { emit(OP.LOADUP, scope.__upvals[node.name]); }
            else { const slot = scope[node.name];
            if (slot !== undefined) { if (scope.__cells && scope.__cells.has(slot)) emit(OP.LOADCELL, slot); else emit(OP.LOAD, slot); }
            else if (ROBLOX_PASSTHROUGH) { emit(OP.GETGLOBAL, encodeString(node.name)); }
            else throw new Error("hindi pa naka-declare: " + node.name); }
          } else if (node.type === "BinaryExpression") {
            compileExpr(node.left);
            compileExpr(node.right);
            const o = node.operator;
            if (o === "+") emit(OP.ADD);
            else if (o === "-") emit(OP.SUB);
            else if (o === "*") emit(OP.MUL);
            else if (o === "/") emit(OP.DIV);
            else if (o === "%") emit(OP.MOD);
            else if (o === "..") emit(OP.CONCAT);
            else if (CMP[o]) emit(OP[CMP[o]]);
            else throw new Error("hindi sinusuportahan ang operator: " + o);
          } else if (node.type === "LogicalExpression") {
            // Short-circuit with Lua value semantics (returns an operand, not a bool).
            compileExpr(node.left);
            emit(OP.DUP);
            if (node.operator === "and") {
              // if left is falsy -> keep left, skip right; else pop left, eval right
              const jz = emit(OP.JZ, 0);
              emit(OP.POP);
              compileExpr(node.right);
              patch(jz, here());
            } else if (node.operator === "or") {
              // if left is truthy -> keep left, skip right; else pop left, eval right
              const jz = emit(OP.JZ, 0);
              const jmp = emit(OP.JMP, 0);
              patch(jz, here());
              emit(OP.POP);
              compileExpr(node.right);
              patch(jmp, here());
            } else throw new Error("hindi sinusuportahan ang logical operator: " + node.operator);
          } else if (node.type === "CallExpression") {
            compileCall(node);
            if (node.__pcallPacked) { const tmp = nextSlot++; emit(OP.STORE, tmp); emit(OP.LOAD, tmp); emitNumber(1); emit(OP.GETTABLE); }
          } else if (node.type === "TableConstructorExpression") {
            emit(OP.NEWTABLE);
            let arrayIndex = 1;
            // Spill any function-valued field to a native Lua closure so it works
            // as a real metamethod / callback when this table reaches a native API.
            const fieldVal = (v) => {
              if (v && (v.type === "FunctionDeclaration" || v.type === "FunctionExpression") && !v.identifier) {
                const src = nodeSource(v);
                if (src) {
                  const gsym = '__lrp_spill_' + (__spillId++);
                  spilledFns.push({ sym: gsym, src: 'return ' + src });
                  emit(OP.GETGLOBAL, encodeString(gsym));
                  return;
                }
              }
              compileExpr(v);
            };
            for (const field of node.fields) {
              if (field.type === "TableValue") {
                emit(OP.DUP); emitNumber(arrayIndex++); fieldVal(field.value); emit(OP.SETTABLE);
              } else if (field.type === "TableKeyString") {
                emit(OP.DUP); emit(OP.PUSHSTR, encodeString(field.key.name)); fieldVal(field.value); emit(OP.SETTABLE);
              } else if (field.type === "TableKey") {
                emit(OP.DUP); compileExpr(field.key); fieldVal(field.value); emit(OP.SETTABLE);
              } else throw new Error("hindi pa sinusuportahan ang table field: " + field.type);
            }
          } else if (node.type === "IndexExpression") {
            compileExpr(node.base); compileExpr(node.index); emit(OP.GETTABLE);
          } else if (node.type === "MemberExpression") {
            compileExpr(node.base); emit(OP.PUSHSTR, encodeString(node.identifier.name)); emit(OP.GETTABLE);
          } else if (node.type === "UnaryExpression") {
            if (node.operator === "-") { emitNumber(0); compileExpr(node.argument); emit(OP.SUB); }
            else if (node.operator === "not") { compileExpr(node.argument); emit(OP.NOT); }
            else if (node.operator === "#") { compileExpr(node.argument); emit(OP.TLEN); }
            else throw new Error("hindi sinusuportahan ang unary operator: " + node.operator);
          } else if (node.type === "FunctionDeclaration" && !node.identifier) {
            // Anonymous function / callback -> closure (captures outer locals)
            compileFunctionExpr(node);
          } else throw new Error("hindi sinusuportahan ang expression: " + node.type);
        }

        function compileFunctionExpr(node) {
          const __snap = snapshot();
          try { return compileFunctionExprInner(node); }
          catch (err) {
            const src = nodeSource(node);
            if (!src) throw err; // cannot recover without original text
            rollback(__snap);
            // Bind the anonymous function via a global key, then PUSH it so the
            // surrounding expression (assignment/call/table) uses it as a value.
            const gsym = '__lrp_spill_' + (__spillId++);
            spilledFns.push({ sym: gsym, src: src });
            emit(OP.GETGLOBAL, encodeString(gsym));
            return;
          }
        }
        function compileFunctionExprInner(node) {
          // Capture outer locals used inside as upvalue cells.
          const used = new Set();
          (function collect(n){ if(!n||typeof n!=="object")return; if(Array.isArray(n)){n.forEach(collect);return;} if(n.type==="Identifier")used.add(n.name); for(const k in n){if(k==="type")continue;collect(n[k]);} })(node.body);
          const outer = scope;
          const captures = [];          // frame slots captured from outer locals
          const upCaptures = [];        // names captured from outer's OWN upvalues
          const capNames = [];          // parallel name list for slot captures
          for (const nm of used) {
            if (functions[nm]) continue;
            if (outer[nm] !== undefined && typeof outer[nm] === "number") {
              if (!outer.__cells) outer.__cells = new Set();
              outer.__cells.add(outer[nm]);
              captures.push(outer[nm]);
              capNames.push(nm);
            } else if (outer.__upvals && outer.__upvals[nm] !== undefined) {
              // transitive: forward the enclosing closure's upvalue down one level
              upCaptures.push({ name: nm, up: outer.__upvals[nm] });
            }
          }
          // FLAT closure arg: [addr, nc, cap1..capN]. cap>=0 -> frame slot of
          // outer; cap<0 -> outer upvalue index encoded as -(idx+1) (transitive).
          const capList = captures.slice().concat(upCaptures.map((u) => -(u.up + 1)));
          const closureInstr = emit(OP.CLOSURE, [0, capList.length].concat(capList));
          const jmpOver = emit(OP.JMP, 0);
          const bodyAddr = here();
          bytecode[closureInstr].arg = [bodyAddr, capList.length].concat(capList);
          const savedScope = scope, savedNextSlot = nextSlot, savedVararg = varargSlot;
          scope = {}; nextSlot = 0; varargSlot = 0;
          scope.__upvals = {};
          // Inner upvalue indices must follow the SAME order as capList above:
          // first the slot captures (capNames), then the transitive upCaptures.
          let ui = 0;
          for (const nm of capNames) { scope.__upvals[nm] = ui++; }
          for (const u of upCaptures) { scope.__upvals[u.name] = ui++; }
          for (const p of node.parameters) {
            if (p.type === "VarargLiteral") varargSlot = nextSlot; else slotFor(p.name);
          }
          scope.__nestedNames = namesUsedByNestedFns(node.body);
          // Cell-wrap any parameter that a still-deeper closure captures, so the
          // inner LOADUP sees a cell {v=...} and not a bare value (fixes
          // "index number with 'v'" for anonymous fns like outer's function(b)).
          for (const p of node.parameters) {
            if (p.type === "VarargLiteral") continue;
            const psl = scope[p.name];
            if (scope.__nestedNames && scope.__nestedNames.has(p.name)) {
              if (!scope.__cells) scope.__cells = new Set();
              scope.__cells.add(psl);
              emit(OP.LOAD, psl); emit(OP.NEWCELL, psl);
            }
          }
          compileBlock(node.body);
          emitNumber(0); emit(OP.RETURN);
          scope = savedScope; nextSlot = savedNextSlot; varargSlot = savedVararg;
          patch(jmpOver, here());
        }

        // Compile one argument. On a NATIVE call, a function-expression argument
        // is spilled to a real Lua closure (so metamethods/callbacks work); on a
        // VM-internal call it stays a VM closure. `native` = true for CALLR/
        // SELFCALL/BUILTIN paths.
        function compileArg(argNode, native) {
          if (native && argNode &&
              (argNode.type === "FunctionDeclaration" || argNode.type === "FunctionExpression") &&
              !argNode.identifier) {
            const src = nodeSource(argNode);
            if (src) {
              // PARTIAL-VM bridge: find outer LOCALS this callback references that
              // live in the current VM scope. Those must be shared through the
              // global bridge table so the spilled Lua closure sees/updates them.
              const refd = new Set();
              (function collect(n){ if(!n||typeof n!=="object")return; if(Array.isArray(n)){n.forEach(collect);return;}
                if(n.type==="Identifier") refd.add(n.name);
                for(const k in n){ if(k==="type")continue; collect(n[k]); } })(argNode.body || argNode);
              const bridged = [];
              for (const nm of refd) {
                // a VM local (numeric slot) or a cell-backed local in the current scope
                if (scope[nm] !== undefined && typeof scope[nm] === "number") bridged.push(nm);
                else if (scope.__upvals && scope.__upvals[nm] !== undefined) bridged.push(nm);
              }
              const gsym = '__lrp_spill_' + (__spillId++);
              if (bridged.length) {
                // Rewrite the callback source so each bridged name resolves through
                // the shared bridge table __LRP_BRIDGE. We inject a prelude that
                // maps locals <-> bridge on entry/exit, keeping closure semantics.
                // Prelude: pull current values in; Postlude via __index/__newindex
                // is overkill — instead alias reads/writes with a metatable proxy.
                // Simpler + robust: wrap the user fn so the bridged names become
                // upvalues initialized from the bridge and written back after call.
                const decls = bridged.map(n => "local "+n+"=__LRP_BRIDGE["+JSON.stringify(n)+"]").join(";");
                const writes = bridged.map(n => "__LRP_BRIDGE["+JSON.stringify(n)+"]="+n).join(";");
                // src is 'function(params) BODY end' -> capture params + body via a thin wrapper.
                // We produce: return (function() <decls>; local __f=<src>; return function(...) 
                //   <refresh decls from bridge>; local r={__f(...)}; <writes>; return (table.unpack or unpack)(r) end end)()
                const bridgeResolve = "local __LRP_BRIDGE=((getgenv and getgenv()) or (getfenv and getfenv()) or _G).__LRP_BRIDGE or {};";
                const wrapped =
                  "return (function() " + bridgeResolve + decls + "; local __f=" + src + "; " +
                  "return function(...) " +
                    bridged.map(n => n+"=__LRP_BRIDGE["+JSON.stringify(n)+"]").join(";") + "; " +
                    "local __r={__f(...)}; " + writes + "; " +
                    "return (table.unpack or unpack)(__r) end end)()";
                spilledFns.push({ sym: gsym, src: wrapped, bridged: bridged.slice() });
                // NOTE: do NOT publish to the bridge here — emitting LOAD+BRIDGESET
                // mid-argument-assembly corrupts the call's stack. The bridge is
                // filled by mirror-on-assign (after the local is written) and read
                // by the wrapper at fire-time. Seed any already-known values now via
                // a hoisted publish that runs BEFORE arg assembly (handled by the
                // caller through bridgedEver + pre-seed below).
                argNode.__lrpBridged = bridged.slice();
                for (const n of bridged) bridgedEver.add(n);
              } else {
                spilledFns.push({ sym: gsym, src: 'return ' + src });
              }
              emit(OP.GETGLOBAL, encodeString(gsym));
              return;
            }
          }
          compileExpr(argNode);
        }

        function compileCall(node) {
          // Bug 1 fix (Option A): pcall runs natively. Spill the ENTIRE pcall
          // expression as a real Lua island that returns a PACKED table
          // {n=<count>, ...} of pcall's results. Push that table on the VM stack;
          // a following multi-assign is rewritten (see compileStatement) to read
          // fields out of it. A bare `pcall(...)` call-statement just discards it.
          if (node.base && node.base.type === "Identifier" && node.base.name === "pcall") {
            const src = nodeSource(node);
            if (src) {
              const gsym = '__lrp_spill_' + (__spillId++);
              // island: run the real pcall, pack all results into a table with count.
              spilledFns.push({ sym: gsym, src: 'return function() local __t=table.pack(' + src + '); return __t end' });
              emit(OP.GETGLOBAL, encodeString(gsym)); // push the island closure
              emit(OP.CALLR, 0);                         // call it -> pushes packed table
              node.__pcallPacked = true;                 // mark for STOREMULTI rewrite
              return;
            }
          }
          // (print special-case removed: multi-arg print now uses the normal CALLR path)
          
          // (BUILTIN hardcoded routing removed — Lua resolves library calls
          // uniformly as GETGLOBAL+GETTABLE+CALL. math.max, string.upper, etc.
          // now flow through the same runtime CALLR/SELFCALL path as any call,
          // via the MemberExpression/qualified-call handling below. No guessing.)
          // Method call: d:speak(x) -> speak(d, x), self=d
          if (node.base && node.base.type === "MemberExpression" && node.base.indexer === ":") {
            const methodKey = node.base.identifier.name;
            let fn = null;
            for (const qn in functions) { if (qn.endsWith("." + methodKey) || qn === methodKey) { fn = functions[qn]; break; } }
            if (fn) {
              compileExpr(node.base.base);
              for (const a of node.arguments) compileExpr(a);
              emit(OP.CALL, [fn.addr, node.arguments.length + 1]);
              return;
            }
            if (ROBLOX_PASSTHROUGH) {
              compileExpr(node.base.base);
              for (const a of node.arguments) compileArg(a, true);
              emit(OP.SELFCALL, [encodeString(methodKey), node.arguments.length]);
              return;
            }
            throw new Error("hindi kilalang method: " + methodKey);
          }
          // Qualified call: Dog.new(x)
          if (node.base && node.base.type === "MemberExpression" && node.base.indexer === ".") {
            const qn = node.base.base.name + "." + node.base.identifier.name;
            const fn = functions[qn];
            if (fn) {
              for (const a of node.arguments) compileExpr(a);
              emit(OP.CALL, [fn.addr, node.arguments.length]);
              return;
            }
            if (ROBLOX_PASSTHROUGH) {
              compileExpr(node.base);
              for (const a of node.arguments) compileArg(a, true);
              emit(OP.CALLR, node.arguments.length);
              return;
            }
            throw new Error("hindi kilalang function: " + qn);
          }
          const fnName = node.base && node.base.name;
          const fn = functions[fnName];
          if (fn) {
            if (fn.closureSlot !== undefined) {
              emit(OP.LOAD, fn.closureSlot);
              for (const a of node.arguments) compileExpr(a);
              emit(OP.CALLC, node.arguments.length);
            } else {
              for (const a of node.arguments) compileExpr(a);
              emit(OP.CALL, [fn.addr, node.arguments.length]);
            }
            return;
          }
          if (ROBLOX_PASSTHROUGH) {
            // Method call obj:method(...) with unknown method -> runtime SELFCALL
            if (node.base && node.base.type === "MemberExpression" && node.base.indexer === ":") {
              compileExpr(node.base.base);
              for (const a of node.arguments) compileArg(a, true);
              emit(OP.SELFCALL, [encodeString(node.base.identifier.name), node.arguments.length]);
              return;
            }
            // Any other callee (global, member, index result) -> runtime CALLR
            compileExpr(node.base);
            for (const a of node.arguments) compileArg(a, true);
            emit(OP.CALLR, node.arguments.length);
            return;
          }
          throw new Error("hindi kilalang function: " + (fnName || bname));
        }

        function compileAssignTarget(target, valueEmitter, valueNode) {
          // A function assigned to a TABLE FIELD (V.__add = function... , t[k] =
          // function...) may become a metamethod or a callback that escapes into
          // native Lua/Roblox APIs, so it must be a REAL Lua closure, not a VM
          // closure. Spill it, exactly like table-constructor function fields.
          const spillEmit = () => {
            if (valueNode &&
                (valueNode.type === "FunctionDeclaration" || valueNode.type === "FunctionExpression") &&
                !valueNode.identifier) {
              const src = nodeSource(valueNode);
              if (src) {
                const gsym = '__lrp_spill_' + (__spillId++);
                spilledFns.push({ sym: gsym, src: 'return ' + src });
                emit(OP.GETGLOBAL, encodeString(gsym));
                return;
              }
            }
            valueEmitter();
          };
          if (target.type === "Identifier") {
            // Upvalue write -> STOREUP (writes back to the shared cell).
            if (scope.__upvals && scope.__upvals[target.name] !== undefined) {
              valueEmitter(); emit(OP.STOREUP, scope.__upvals[target.name]);
            } else {
              const slot = slotFor(target.name);
              // Cell-backed local write -> STORECELL; plain local -> STORE.
              if (scope.__cells && scope.__cells.has(slot)) { valueEmitter(); emit(OP.STORECELL, slot); }
              else { valueEmitter(); emit(OP.STORE, slot); }
            }
          } else if (target.type === "IndexExpression") {
            compileExpr(target.base); compileExpr(target.index); spillEmit(); emit(OP.SETTABLE);
          } else if (target.type === "MemberExpression") {
            compileExpr(target.base); emit(OP.PUSHSTR, encodeString(target.identifier.name)); spillEmit(); emit(OP.SETTABLE);
          } else throw new Error("hindi sinusuportahan ang assignment target: " + target.type);
        }

        let __blockDepth = 0;
        function compileBlock(body) {
          __blockDepth++;
          const atTop = __blockDepth === 1;
          for (const stmt of body) {
            emitJunk();
            if (atTop) {
              const __s = snapshot();
              try { compileStatement(stmt); }
              catch (err) {
                const src = nodeSource(stmt);
                if (!src) { __blockDepth--; throw err; }
                rollback(__s);
                // Spill this top-level statement into an immediately-invoked
                // loadstring island sharing the global env. Emitted via a
                // zero-arg spilled closure that we then CALLR with 0 args.
                const gsym = '__lrp_spill_' + (__spillId++);
                spilledFns.push({ sym: gsym, src: 'return function() ' + src + ' end' });
                emit(OP.GETGLOBAL, encodeString(gsym));
                emit(OP.CALLR, 0);
                emit(OP.POP);
              }
            } else {
              compileStatement(stmt);
            }
          }
          __blockDepth--;
        }

        function compileStatement(node) {
          if (node.type === "LocalStatement") {
            if (node.variables.length > 1 && node.init.length === 1 && node.init[0] && node.init[0].type === "CallExpression") {
              compileCall(node.init[0]);
              if (node.init[0].__pcallPacked) {
                // stack top = packed table; store into a temp slot, then read fields
                const tmp = nextSlot++; emit(OP.STORE, tmp);
                node.variables.forEach((v, i) => {
                  const slot = slotFor(v.name);
                  emit(OP.LOAD, tmp); emitNumber(i + 1); emit(OP.GETTABLE); emit(OP.STORE, slot);
                });
              } else {
                const slots = node.variables.map((v) => slotFor(v.name));
                emit(OP.STOREMULTI, slots);
              }
            } else {
              for (let i = 0; i < node.variables.length; i++) {
                const name = node.variables[i].name;
                if (node.init[i]) compileExpr(node.init[i]); else emitNumber(0);
                const slot = slotFor(name);
                // If a nested closure references this local, back it with a cell
                // so the closure (via upvalue) shares reads/writes. (Part A.)
                if (scope.__nestedNames && scope.__nestedNames.has(name)) {
                  if (!scope.__cells) scope.__cells = new Set();
                  scope.__cells.add(slot);
                  emit(OP.NEWCELL, slot);
                } else {
                  emit(OP.STORE, slot);
                }
              }
            }
          } else if (node.type === "AssignmentStatement") {
            if (node.variables.length > 1 && node.init.length === 1 && node.init[0] && node.init[0].type === "CallExpression" && node.variables.every((v) => v.type === "Identifier")) {
              compileCall(node.init[0]);
              if (node.init[0].__pcallPacked) {
                const tmp = nextSlot++; emit(OP.STORE, tmp);
                node.variables.forEach((v, i) => {
                  const slot = slotFor(v.name);
                  emit(OP.LOAD, tmp); emitNumber(i + 1); emit(OP.GETTABLE); emit(OP.STORE, slot);
                });
              } else {
                const slots = node.variables.map((v) => slotFor(v.name));
                emit(OP.STOREMULTI, slots);
              }
            } else {
              for (let i = 0; i < node.variables.length; i++) {
                compileAssignTarget(node.variables[i], () => compileExpr(node.init[i]));
                // Mirror a bridged local's new value back into __LRP_BRIDGE so a
                // later-firing spilled callback sees the updated value.
                const tgt = node.variables[i];
                if (tgt.type === "Identifier" && bridgedEver.has(tgt.name) && scope[tgt.name] !== undefined) {
                  if (scope.__cells && scope.__cells.has(scope[tgt.name])) emit(OP.LOADCELL, scope[tgt.name]);
                  else emit(OP.LOAD, scope[tgt.name]);
                  emit(OP.BRIDGESET, encodeString(tgt.name));
                }
              }
            }
          } else if (node.type === "CallStatement") {
            compileCall(node.expression);
            if (node.expression && node.expression.__pcallPacked) emit(OP.POP);
          } else if (node.type === "IfStatement") {
            const endJumps = [];
            for (const clause of node.clauses) {
              if (clause.type === "ElseClause") { compileBlock(clause.body); continue; }
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
            loopStack.push({ breaks: [] });
            compileBlock(node.body);
            emit(OP.JMP, top);
            patch(jz, here());
            const __lw = loopStack.pop();
            for (const b of __lw.breaks) patch(b, here());
          } else if (node.type === "NumericForStatement" || node.type === "ForNumericStatement") {
            const varSlot = slotFor(node.variable.name);
            compileExpr(node.start); emit(OP.STORE, varSlot);
            const limitSlot = nextSlot++;
            compileExpr(node.end); emit(OP.STORE, limitSlot);
            const stepSlot = nextSlot++;
            if (node.step) compileExpr(node.step); else emitNumber(1);
            emit(OP.STORE, stepSlot);
            const top = here();
            emit(OP.LOAD, varSlot); emit(OP.LOAD, limitSlot); emit(OP.LE);
            const jz = emit(OP.JZ, 0);
            loopStack.push({ breaks: [] });
            // Per-iteration binding: if a nested closure captures the loop var,
            // give this iteration its OWN cell (load current value -> fresh {v}).
            const __nfCap = scope.__nestedNames && scope.__nestedNames.has(node.variable.name);
            if (__nfCap) { if(!scope.__cells) scope.__cells=new Set(); scope.__cells.add(varSlot); emit(OP.LOAD, varSlot); emit(OP.NEWCELL, varSlot); }
            compileBlock(node.body);
            // Read back via cell (value may have changed) before the step add.
            if (__nfCap) { emit(OP.LOADCELL, varSlot); const __t=nextSlot++; emit(OP.STORE, __t); scope.__cells.delete(varSlot); emit(OP.LOAD, __t); emit(OP.STORE, varSlot); }
            emit(OP.LOAD, varSlot); emit(OP.LOAD, stepSlot); emit(OP.ADD); emit(OP.STORE, varSlot);
            emit(OP.JMP, top);
            patch(jz, here());
            { const __ln = loopStack.pop(); for (const b of __ln.breaks) patch(b, here()); }
          } else if (node.type === "ForGenericStatement") {
            const iterCall = node.iterators[0];
            const tExpr = iterCall.arguments[0];
            const tSlot = nextSlot++;
            compileExpr(tExpr); emit(OP.STORE, tSlot);
            const idxSlot = nextSlot++;
            emitNumber(1); emit(OP.STORE, idxSlot);
            const lenSlot = nextSlot++;
            emit(OP.LOAD, tSlot); emit(OP.TLEN); emit(OP.STORE, lenSlot);
            const keyVar = node.variables[0] ? slotFor(node.variables[0].name) : nextSlot++;
            const valVar = node.variables[1] ? slotFor(node.variables[1].name) : nextSlot++;
            const top = here();
            emit(OP.LOAD, idxSlot); emit(OP.LOAD, lenSlot); emit(OP.LE);
            const jz = emit(OP.JZ, 0);
            emit(OP.LOAD, idxSlot); emit(OP.STORE, keyVar);
            emit(OP.LOAD, tSlot); emit(OP.LOAD, idxSlot); emit(OP.GETTABLE); emit(OP.STORE, valVar);
            loopStack.push({ breaks: [] });
            compileBlock(node.body);
            emit(OP.LOAD, idxSlot); emitNumber(1); emit(OP.ADD); emit(OP.STORE, idxSlot);
            emit(OP.JMP, top);
            patch(jz, here());
            { const __lg = loopStack.pop(); for (const b of __lg.breaks) patch(b, here()); }
          } else if (node.type === "RepeatStatement") {
            // repeat <body> until <cond>  -> body runs at least once; loop while
            // cond is FALSE. break jumps to the exit after the condition test.
            const top = here();
            loopStack.push({ breaks: [] });
            compileBlock(node.body);
            compileExpr(node.condition);
            // if cond is falsy (==0) jump back to top; else fall through to exit.
            const jz = emit(OP.JZ, top);
            const __lr = loopStack.pop();
            for (const b of __lr.breaks) patch(b, here());
          } else if (node.type === "BreakStatement") {
            if (!loopStack.length) throw new Error("break sa labas ng loop");
            const j = emit(OP.JMP, 0);
            loopStack[loopStack.length - 1].breaks.push(j);
          } else if (node.type === "ReturnStatement") {
            if (node.arguments.length === 0) { emitNumber(0); emit(OP.RETURN); }
            else if (node.arguments.length === 1) { compileExpr(node.arguments[0]); emit(OP.RETURN); }
            else { for (const a of node.arguments) compileExpr(a); emit(OP.RETURNN, node.arguments.length); }
          } else if (node.type === "FunctionDeclaration" && node.identifier) {
            const __snapFD = snapshot();
            let __qnameFD;
            try {
            let qname;
            const isMethod = node.identifier.type === "MemberExpression" && node.identifier.indexer === ":";
            if (node.identifier.type === "Identifier") qname = node.identifier.name;
            else qname = node.identifier.base.name + "." + node.identifier.identifier.name;
            // Detect outer locals this named function CAPTURES (plain-name only).
            let __caps = [];
            if (node.identifier.type === "Identifier") {
              const __used = new Set();
              (function collect(n){ if(!n||typeof n!=="object")return; if(Array.isArray(n)){n.forEach(collect);return;} if(n.type==="Identifier")__used.add(n.name); for(const k in n){if(k==="type")continue;collect(n[k]);} })(node.body);
              const __outer = scope;
              for (const nm of __used) {
                if (functions[nm]) continue;
                if (__outer[nm] !== undefined && typeof __outer[nm] === "number") {
                  if (!__outer.__cells) __outer.__cells = new Set();
                  __outer.__cells.add(__outer[nm]);
                  __caps.push({ name: nm, slot: __outer[nm] });
                }
              }
            }
            if (__caps.length && node.identifier.type === "Identifier") {
              // CLOSURE path (cells + upvalues; proven in simulation).
              const capSlots = __caps.map((c) => c.slot);
              const closureInstr = emit(OP.CLOSURE, [0, capSlots.length].concat(capSlots));
              const jmpOver = emit(OP.JMP, 0);
              const bodyAddr = here();
              bytecode[closureInstr].arg = [bodyAddr, capSlots.length].concat(capSlots);
              const savedScope = scope, savedNextSlot = nextSlot, savedVararg = varargSlot;
              scope = {}; nextSlot = 0; varargSlot = 0; scope.__upvals = {};
              __caps.forEach((c, i) => { scope.__upvals[c.name] = i; });
              for (const p of node.parameters) {
                if (p.type === "VarargLiteral") varargSlot = nextSlot; else slotFor(p.name);
              }
              scope.__nestedNames = namesUsedByNestedFns(node.body);
              // Cell-wrap any parameter captured by a still-deeper closure so the
              // inner LOADUP/LOADCELL sees {v=value}, not a bare value.
              for (const p of node.parameters) {
                if (p.type === "VarargLiteral") continue;
                const psl = scope[p.name];
                if (scope.__nestedNames && scope.__nestedNames.has(p.name)) {
                  if (!scope.__cells) scope.__cells = new Set();
                  scope.__cells.add(psl);
                  emit(OP.LOAD, psl); emit(OP.NEWCELL, psl);
                }
              }
              compileBlock(node.body);
              emitNumber(0); emit(OP.RETURN);
              scope = savedScope; nextSlot = savedNextSlot; varargSlot = savedVararg;
              patch(jmpOver, here());
              const fnSlot = slotFor(qname);
              emit(OP.STORE, fnSlot);
              functions[qname] = { closureSlot: fnSlot };
            } else {
              // No captures -> fast plain-address path (unchanged behaviour).
              const jmpOver = emit(OP.JMP, 0);
              const addr = here();
              functions[qname] = { addr };
              const savedScope = scope, savedNextSlot = nextSlot, savedVararg = varargSlot;
              scope = {}; nextSlot = 0; varargSlot = 0;
              if (isMethod) slotFor("self");
              for (const p of node.parameters) {
                if (p.type === "VarargLiteral") varargSlot = nextSlot; else slotFor(p.name);
              }
              scope.__nestedNames = namesUsedByNestedFns(node.body);
              // A parameter captured by a nested closure must live in a cell so
              // the closure's upvalue shares reads/writes (fixes "index number
              // with 'v'" when the captured value is a plain param like makeAdder's x).
              if (isMethod) { const s0 = scope["self"];
                if (scope.__nestedNames && scope.__nestedNames.has("self")) {
                  if (!scope.__cells) scope.__cells = new Set();
                  scope.__cells.add(s0); emit(OP.LOAD, s0); emit(OP.NEWCELL, s0);
                } }
              for (const p of node.parameters) {
                if (p.type === "VarargLiteral") continue;
                const psl = scope[p.name];
                if (scope.__nestedNames && scope.__nestedNames.has(p.name)) {
                  if (!scope.__cells) scope.__cells = new Set();
                  scope.__cells.add(psl);
                  emit(OP.LOAD, psl); emit(OP.NEWCELL, psl);
                }
              }
              compileBlock(node.body);
              emitNumber(0); emit(OP.RETURN);
              scope = savedScope; nextSlot = savedNextSlot; varargSlot = savedVararg;
              patch(jmpOver, here());
            }
            } catch (err) {
              const src = nodeSource(node);
              if (!src) throw err;
              rollback(__snapFD);
              // derive the declared name for local binding (plain names only)
              if (node.identifier.type === "Identifier") __qnameFD = node.identifier.name;
              else __qnameFD = node.identifier.base.name + "." + node.identifier.identifier.name;
              // Spill: keep the ORIGINAL 'function name(...) ... end' text, then
              // expose it under the same name so VM calls resolve at runtime.
              const gsym = spillNamed(__qnameFD, src);
              // For qualified/method decls (T.f / T:m) also assign into the
              // global table at runtime so existing SELFCALL/CALLR reach it.
              if (__qnameFD.indexOf(".") !== -1) {
                // T.f = <spilled closure>
                const parts = __qnameFD.split(".");
                emit(OP.GETGLOBAL, encodeString(parts[0]));
                emit(OP.PUSHSTR, encodeString(parts.slice(1).join(".")));
                emit(OP.GETGLOBAL, encodeString(gsym));
                emit(OP.SETTABLE);
              }
            }
          } else if (node.type === "DoStatement") {
            compileBlock(node.body);
          } else throw new Error("hindi sinusuportahan ang statement: " + node.type);
        }

        scope.__nestedNames = namesUsedByNestedFns(ast.body);
        compileBlock(ast.body);
        emit(OP.HALT);
        return { OP, bytecode, constPool, spilledFns, usedOps };
      }

      function checksumOf(bytecode) {
        let sum = 0;
        for (let i = 0; i < bytecode.length; i++) {
          const inst = bytecode[i];
          const op = inst.op;
          sum = (sum + op * (i + 1)) % 1000003;
          if (typeof inst.arg === "number") sum = (sum + inst.arg) % 1000003;
        }
        return sum;
      }

      function minifyLua(src) {
        return src
          .replace(/--\[\[[\s\S]*?\]\]/g, "")
          .replace(/--[^\n]*/g, "")
          .split("\n").map((l) => l.trim()).filter((l) => l.length).join(" ")
          .replace(/\s+/g, " ");
      }
      function scrambleVM(vmMin) {
        const names = [
          "decodeString","decodeNumber","checksumOf","BUILTINS","callStack","csTop",
          "newFrame","expectedChecksum","funcAddr","chars","encoded","vals","slots",
          "startSlot","caller","push","pop","frame","upvals","stack","program","inst",
          "argc","retIp","newTable",
        ];
        for (const nm of names) {
          const scrambled = "_" + Math.random().toString(36).slice(2, 7);
          vmMin = vmMin.replace(new RegExp("\\b" + nm + "\\b", "g"), scrambled);
        }
        return vmMin;
      }

      function bundle(OP, bytecode, constPool, spilledFns, usedOps) {
        const checksum = checksumOf(bytecode);
        return luraphBundle(OP, bytecode, checksum, constPool, spilledFns || [], usedOps);
      }

      function luraphBundle(OP, bytecode, checksum, constPool, spilledFns, usedOps) {
        spilledFns = spilledFns || [];
        // Map emitted opcode NUMBERS back to NAMES for only-used-opcodes.
        let USED_NAMES = null;
        if (usedOps) {
          const numToName = {}; for (const nm of OPS) numToName[OP[nm]] = nm;
          USED_NAMES = new Set();
          for (const n of usedOps) if (numToName[n]) USED_NAMES.add(numToName[n]);
        }
        const rn = () => "_" + Math.random().toString(36).slice(2, 7);
        function junkLine() {
          const v = rn(), w = rn(), x = rn();
          const a = Math.floor(Math.random() * 999), b = Math.floor(Math.random() * 99) + 1;
          const patterns = [
            () => "local " + v + "=" + Math.floor(Math.random() * 99999) + ";",
            () => "local " + v + "=function(" + w + ") return " + w + " and " + a + " or nil end;",
            () => "local " + v + "={" + a + "," + b + "," + Math.floor(Math.random() * 99) + "};",
            () => "local " + v + "=(" + a + "*" + b + ")%" + (Math.floor(Math.random() * 97) + 3) + ";",
            () => "local function " + v + "(" + w + ") local " + x + "=" + w + " return " + x + " end;",
            () => "local " + v + "=\"" + Math.random().toString(36).slice(2, 10) + "\";",
            () => "local " + v + "=" + a + ";if (" + v + "*" + v + ")>=0 then " + v + "=" + v + "+" + b + " end;",
            () => "local " + v + "=" + a + ";if (" + v + "%1)~=0 then " + v + "=nil end;",
            () => "local " + v + "=" + b + ";while " + v + ">" + (a + b) + " do " + v + "=" + v + "-1 end;",
          ];
          return patterns[Math.floor(Math.random() * patterns.length)]();
        }
        const junk = (n) => Array.from({ length: n }, junkLine).join("");

        // Flatten program -> number stream (op, tag, [args])
        const nums = [];
        for (const inst of bytecode) {
          nums.push(inst.op);
          if (inst.arg === undefined) nums.push(0);
          else if (Array.isArray(inst.arg)) nums.push(2, inst.arg.length, ...inst.arg);
          else nums.push(1, inst.arg);
        }
        const opValues = OPS.map((n) => OP[n]);
        let s = 0;
        for (const v of opValues) s = (s + v) >>> 0;
        // Embedded seed (per build) mixes into the round keys so the mask is not
        // recomputable from the opmap alone.
        const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
        const U = (x) => x >>> 0;
        const K1 = U((s ^ 0x9e3779b1) + seed);
        const K2 = U((s * 2654435761) ^ (seed << 1));
        const enc = (n) => {
          let x = U(n);
          x = U(x ^ K1);
          x = U(x + K2);
          x = U(x ^ (K1 >>> 3));
          return x;
        };
        // Stage-1 wrap (dual-VM): after mask-encoding each value, apply a second
        // reversible transform with key S1 so the on-disk blob is double-wrapped.
        // The emitted first-stage decryptor (mini-VM) reverses this before the real decode.
        const S1 = DUAL_VM ? (1 + Math.floor(Math.random() * 0xFFFFFF)) : 0;
        function stage1(v){ if(!DUAL_VM) return v>>>0; return (((v>>>0) ^ S1) + S1) >>> 0; }
        const blob = nums.map((n) => stage1(enc(n) >>> 0)).join(",");

        // Constant pool serialized as a Lua table of tables (encoded numbers).
        const constLua = "{" + constPool.map((c) => "{" + c.join(",") + "}").join(",") + "}";

        const r = () => "_" + Math.random().toString(36).slice(2, 7);
        const B = r(), D = r(), P = r(), N = r(), I = r(), MK = r(), SM = r(), M = r(), C = r(), VM = r(), S1V = r();
        const gen = generateVM(OP, USED_NAMES);
        const vmMin = minifyLua(gen.src);
        
        // Encoded opcode map: three arrays + runtime pairing (no NAME=num literal).
        // namesArr[perm[i]] pairs with valsArr[i]. perm scrambles the linkage.
        const idxOrder = OPS.map((_, i) => i);
        for (let i = idxOrder.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [idxOrder[i], idxOrder[j]] = [idxOrder[j], idxOrder[i]]; }
        // valsArr in scrambled index order; namesArr aligned to same scramble.
        const namesArr = idxOrder.map((i) => '"' + OPS[i] + '"').join(",");
        const valsArr = idxOrder.map((i) => OP[OPS[i]]).join(",");
        const NM = "_" + Math.random().toString(36).slice(2, 7);
        const VL = "_" + Math.random().toString(36).slice(2, 7);
        const opmapBuild =
          "local " + NM + "={" + namesArr + "};local " + VL + "={" + valsArr + "};" +
          "local " + M + "={};for i=1,#" + NM + " do " + M + "[" + NM + "[i]]=" + VL + "[i] end;";
        
        // ===== SPILL PRELUDE =====
        // Define each per-function fallback into the real global env so the
        // virtualized program can fetch them via GETGLOBAL. Uses the trusted
        // loadstring/load; each island shares getgenv()/_G so game/print/etc work.
        let spillPrelude = "";
        if (spilledFns.length) {
          // PARTIAL-VM bridge table: shared between the VM (BRIDGESET) and spilled
          // callbacks. Created in the real global env so both sides see one table.
          spillPrelude += "do local G=(getgenv and getgenv()) or (getfenv and getfenv()) or _G;G.__LRP_BRIDGE=G.__LRP_BRIDGE or {} end;";
          // ENCRYPTED SPILL: each spilled function source is encoded as a number
          // stream (rolling cipher + per-fn round key) and decoded at runtime
          // before loadstring. This removes ALL plain source from the spill zone
          // (previously readable long-bracket strings). Same cipher family as
          // wrapper mode; verified to round-trip exactly.
          const LSV = "_" + Math.random().toString(36).slice(2, 7);
          const GV = "_" + Math.random().toString(36).slice(2, 7);
          const DEC = "_" + Math.random().toString(36).slice(2, 7);
          spillPrelude += "local " + LSV + "=loadstring or load;";
          spillPrelude += "local " + GV + "=(getgenv and getgenv()) or (getfenv and getfenv()) or _G;";
          // runtime decoder: args = (numbers-string, seed, R) -> source string
          spillPrelude += "local function " + DEC + "(s,sd,rk) " +
            "local PR,OF,CM=167,7,0xFF;local bs={};local pv=sd;local ix=0;" +
            "for m in s:gmatch(\"[^,]+\") do ix=ix+1;" +
            "local e=tonumber(m);local e1=bit32.bxor(e,rk);" +
            "local ks=bit32.band(bit32.bxor(bit32.bxor(sd,ix*PR),pv),CM);" +
            "local b=bit32.band(bit32.bxor(e1,ks),CM)-OF;if b<0 then b=b+256 end;" +
            "bs[ix]=b;pv=e1 end;" +
            // rebuild string from UTF-8 bytes
            "local out={};local i=1;while i<=#bs do local c=bs[i];i=i+1;local cp;" +
            "if c<0x80 then cp=c elseif c>=0xF0 then local c2,c3,c4=bs[i],bs[i+1],bs[i+2];i=i+3;" +
            "cp=bit32.bor(bit32.lshift(bit32.band(c,0x7),18),bit32.lshift(bit32.band(c2,0x3F),12),bit32.lshift(bit32.band(c3,0x3F),6),bit32.band(c4,0x3F)) " +
            "elseif c>=0xE0 then local c2,c3=bs[i],bs[i+1];i=i+2;" +
            "cp=bit32.bor(bit32.lshift(bit32.band(c,0xF),12),bit32.lshift(bit32.band(c2,0x3F),6),bit32.band(c3,0x3F)) " +
            "elseif c>=0xC0 then local c2=bs[i];i=i+1;" +
            "cp=bit32.bor(bit32.lshift(bit32.band(c,0x1F),6),bit32.band(c2,0x3F)) else cp=c end;" +
            "out[#out+1]=utf8 and utf8.char and utf8.char(cp) or string.char(cp) end;" +
            "return table.concat(out) end;";
          for (const f of spilledFns) {
            // Run each island under a shared _ENV: reads/writes of top-level names
            // (OOP tables, upvalues) resolve through __LRP_BRIDGE, with real globals
            // as fallback. This makes spilled methods see their parent tables.
            f.src = "local __G=(getgenv and getgenv()) or (getfenv and getfenv()) or _G;" +
                    "local __B=__G.__LRP_BRIDGE or {};__G.__LRP_BRIDGE=__B;" +
                    "local _ENV=setmetatable({},{__index=function(_,k) local v=__B[k];if v~=nil then return v end return __G[k] end," +
                    "__newindex=function(_,k,val) __B[k]=val end});" +
                    "return (function() " + f.src.replace(/^return /, "return ") + " end)()";
            const body = f.src.trim().slice(0, 8) === "function" || f.src.trim().slice(0,6) === "return"
              ? f.src
              : "return " + f.src;
            // encode body -> number stream (rolling cipher + round key)
            const bytes=[];
            for (const ch of body){ let cp=ch.codePointAt(0);
              if(cp<0x80)bytes.push(cp);
              else if(cp<0x800){bytes.push(0xc0|(cp>>6),0x80|(cp&0x3f));}
              else if(cp<0x10000){bytes.push(0xe0|(cp>>12),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));}
              else {bytes.push(0xf0|(cp>>18),0x80|((cp>>12)&0x3f),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));}
            }
            const OFFSET=7,PRIME=167,CMASK=0xff;
            const seed=1+Math.floor(Math.random()*254);
            const R=1+Math.floor(Math.random()*254);
            const enc=[]; let prev=seed;
            for(let i=0;i<bytes.length;i++){
              const ks=(seed ^ ((i+1)*PRIME) ^ prev) & CMASK;
              let e=((bytes[i]+OFFSET)&CMASK) ^ ks;
              const e2=e ^ R;
              enc.push(e2); prev=e;
            }
            const numStr = enc.join(",");
            const chunk = "do local _s=" + DEC + "(\"" + numStr + "\"," + seed + "," + R + ");" +
              "local _f=" + LSV + "(_s);" +
              "if setfenv and _f then pcall(setfenv,_f," + GV + ") end;" +
              GV + "[" + JSON.stringify(f.sym) + "]=_f and _f() end;";
            spillPrelude += chunk;
          }
        }
        return (
          spillPrelude +
          "return (function()" +
          junk(4) +
          opmapBuild +
          junk(3) +
          "local " + SM + "=0;for _,v in pairs(" + M + ")do " + SM + "=bit32.band(" + SM + "+v,0xFFFFFFFF) end;" +
          "local " + MK + "1=bit32.band(bit32.bxor(" + SM + ",0x9e3779b1)+" + seed + ",0xFFFFFFFF);" +
          "local " + MK + "2=bit32.band(bit32.bxor(" + SM + "*2654435761,bit32.lshift(" + seed + ",1)),0xFFFFFFFF);" +
          junk(3) +
          "local " + B + "=\"" + blob + "\";" +
          "local " + C + "=" + constLua + ";" +
          junk(2) +
          (DUAL_VM ? "local " + S1V + "=" + S1 + ";" : "") +
          "local function " + D + "(s)local r={}for m in s:gmatch(\"[^,]+\")do local x=bit32.band(tonumber(m),0xFFFFFFFF);" +
          (DUAL_VM ? "x=bit32.band(bit32.bxor(bit32.band(x-" + S1V + ",0xFFFFFFFF)," + S1V + "),0xFFFFFFFF);" : "") +
          "x=bit32.bxor(x,bit32.rshift(" + MK + "1,3));x=bit32.band(x-" + MK + "2,0xFFFFFFFF);x=bit32.bxor(x," + MK + "1);r[#r+1]=bit32.band(x,0xFFFFFFFF) end return r end;" +
          "local " + N + "=" + D + "(" + B + ");" +
          junk(3) +
          "local " + P + "={}local " + I + "=1;while " + I + "<=#" + N + " do local o=" + N + "[" + I + "];" + I + "=" + I + "+1;local t=" + N + "[" + I + "];" + I + "=" + I + "+1;" +
          "if t==0 then " + P + "[#" + P + "+1]={o} elseif t==1 then " + P + "[#" + P + "+1]={o," + N + "[" + I + "]};" + I + "=" + I + "+1 else local l=" + N + "[" + I + "];" + I + "=" + I + "+1;local a={}for k=1,l do a[k]=" + N + "[" + I + "];" + I + "=" + I + "+1 end;" + P + "[#" + P + "+1]={o,a} end end;" +
          "local " + VM + "=(function() " + vmMin + " end)();" +
          VM + ".run(" + P + "," + M + "," + checksum + "," + C + ")" +
          " end)()"
        );
      }

      function setStatus(msg, cls) {
        const s = document.getElementById("status");
        s.textContent = msg;
        s.className = cls || "";
      }
      // ================= WRAPPER MODE (universal) =================
      // Encodes the WHOLE raw script with the rolling cipher and emits a tiny
      // Lua loader that decodes it and runs it via load()/loadstring(). Because
      // the real Roblox engine runs the decoded source, ALL Lua works: Color3,
      // UDim2, Vector2, Enum, pcall, task.spawn, metatables, UI frameworks, etc.
      // Protection is lighter than the VM (source is recoverable at runtime),
      // but the script actually executes where the VM cannot.
      // ================= WRAPPER MODE (universal, hardened) =================
      // Runs the real script via load()/loadstring() so ALL Luau works
      // (Color3, UDim2, Enum, pcall, task.spawn, metatables, UI frameworks).
      // Hardened against trivial deobfuscation with:
      //   * two cipher layers (rolling + per-build round-key XOR fold)
      //   * runtime-derived keys (not literal in the output)
      //   * anti-tamper length checksum
      //   * junk/decoy locals + opaque predicates
      //   * scrambled runtime names
      function wrapperBundle(src, DBG) {
        // UTF-8 encode so any characters survive the byte pipeline.
        const bytes = [];
        for (const ch of src) {
          const cp = ch.codePointAt(0);
          if (cp < 0x80) bytes.push(cp);
          else if (cp < 0x800) { bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)); }
          else if (cp < 0x10000) { bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
          else { bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
        }
        const OFFSET = 7, PRIME = 167, CMASK = 0xff;
        // Layer 1: rolling cipher (position + chain dependent).
        const seed = 1 + Math.floor(Math.random() * 254);
        const l1 = [];
        let prev = seed;
        for (let i = 0; i < bytes.length; i++) {
          const ks = (seed ^ ((i + 1) * PRIME) ^ prev) & CMASK;
          const e = ((bytes[i] + OFFSET) & CMASK) ^ ks;
          l1.push(e); prev = e;
        }
        // Layer 2: per-build round key XOR fold.
        const R = 1 + Math.floor(Math.random() * 254);
        const l2 = l1.map((b) => (b ^ R) & CMASK);
        // Layer 3: reversed-index second fold with a distinct key (breaks simple static reverse).
        const R2 = 1 + Math.floor(Math.random() * 254);
        const l3 = l2.map((b, i) => (b ^ ((R2 + i) & CMASK)) & CMASK);
        // Anti-tamper checksum over final layer.
        let chk = l3.length % 100003;
        for (const b of l3) chk = (chk + b) % 100003;

        // Keys are reconstructed at runtime from a scrambled seed table, not stored plainly.
        // key table order is shuffled; loader indexes it by fixed positions.
        const kt = [seed, R, R2, chk & 0xff];
        const kOrder = [0, 1, 2, 3];
        for (let i = kOrder.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; [kOrder[i],kOrder[j]]=[kOrder[j],kOrder[i]]; }
        const scrambled = kOrder.map((idx) => kt[idx]);
        const pos = { seed: kOrder.indexOf(0)+1, R: kOrder.indexOf(1)+1, R2: kOrder.indexOf(2)+1 };

        const r = () => "_" + Math.random().toString(36).slice(2, 7);
        const B = r(), C = r(), D = r(), FN = r(), KT = r(), SD = r(), RK = r(), RK2 = r(), CK = r(), AC = r(), G = r(), LS = r();
        const rn = () => "_" + Math.random().toString(36).slice(2, 6);
        function junk() {
          const v = rn(), a = (Math.random()*999)|0, b = ((Math.random()*99)|0)+1;
          const pats = [
            "local " + v + "=" + ((Math.random()*99999)|0) + ";",
            "local " + v + "=" + a + ";if (" + v + "*" + v + ")>=0 then " + v + "=" + v + "+" + b + " end;",
            "local " + v + "=function(" + rn() + ") return " + a + " end;",
            "local " + v + "={" + a + "," + b + "};",
          ];
          return pats[(Math.random()*pats.length)|0];
        }
        const J = (n) => Array.from({length:n}, junk).join("");

        // Split blob into a FIXED small number of chunks (<=8) so the loader never
        // exceeds Luau's 200-locals-per-function limit, no matter how large the script.
        const nums = l3.slice();
        const CHUNKS = Math.min(8, Math.max(1, nums.length));
        const chunkSize = Math.ceil(nums.length / CHUNKS);
        const parts = [];
        for (let ci = 0; ci < nums.length; ci += chunkSize) {
          parts.push(nums.slice(ci, ci + chunkSize));
        }
        const partVars = parts.map(() => r());
        let blobAsm = "";
        partVars.forEach((pv, i) => { blobAsm += "local " + pv + "={" + parts[i].join(",") + "};"; });
        blobAsm += "local " + B + "={};";
        blobAsm += "for _,_pp in ipairs({" + partVars.join(",") + "}) do for _k=1,#_pp do " + B + "[#" + B + "+1]=_pp[_k] end end;";

        // Anti-hook: capture a trusted reference to loadstring/load, and verify a tiny canary
        // compiles+runs to the expected value. A naive hook that logs+returns the arg breaks this.
        const anti =
          "local " + LS + "=loadstring or load;" +
          "if type(" + LS + ")~='function' then warn('Luripe: loadstring/load not available') return end;" +
          // canary: compile 'return 1+1' and ensure it yields 2. A spy that returns the source string
          // (instead of a function) or mangles it will fail this and we abort before feeding real source.
          "local _cf=" + LS + "('return 1+1');" +
          "if type(_cf)~='function' or _cf()~=2 then warn('Luripe: environment tampered (loadstring hook detected)') return end;";

        const loader =
          J(3) +
          "local " + KT + "={" + scrambled.join(",") + "};" +
          "local " + SD + "=" + KT + "[" + pos.seed + "];" +
          "local " + RK + "=" + KT + "[" + pos.R + "];" +
          "local " + RK2 + "=" + KT + "[" + pos.R2 + "];" +
          "local " + CK + "=" + chk + ";" +
          (DBG ? "warn('[Luripe] loader started - if you can read this, prints work');" : "") +
          J(2) +
          blobAsm +
          J(2) +
          // anti-tamper: recompute checksum on the final-layer blob
          "local " + AC + "=#" + B + "%100003;for _i=1,#" + B + " do " + AC + "=(" + AC + "+" + B + "[_i])%100003 end;" +
          (DBG
            ? "if " + AC + "~=" + CK + " then warn('[Luripe] checksum mismatch - blob corrupted in paste') return end;"
            : "if " + AC + "~=" + CK + " then return end;") +
          J(2) +
          // reverse layer 3 (index fold) -> layer 2 (round key) -> layer 1 (rolling), rebuild bytes
          "local " + C + "={};local _p=" + SD + ";" +
          "for _i=1,#" + B + " do " +
          "local _b3=bit32.band(bit32.bxor(" + B + "[_i],bit32.band(" + RK2 + "+(_i-1),0xFF)),0xFF);" +
          "local _e=bit32.band(bit32.bxor(_b3," + RK + "),0xFF);" +
          "local _ks=bit32.band(bit32.bxor(bit32.bxor(" + SD + ",_i*167),_p),0xFF);" +
          "local _c=bit32.band(bit32.bxor(_e,_ks),0xFF)-7;if _c<0 then _c=_c+256 end;" +
          C + "[#" + C + "+1]=string.char(bit32.band(_c,0xFF));_p=_e end;" +
          "local " + D + "=table.concat(" + C + ");" +
          J(2) +
          anti +
          (DBG ? "warn('[Luripe] decoded '..tostring(#" + D + ")..' chars, canary OK');" : "") +
          "local " + FN + ",_err=" + LS + "(" + D + ");" +
          "if not " + FN + " then warn('Luripe: could not compile decoded source - '..tostring(_err)) return end;" +
          // Bind chunk to the real global env so print/warn/game/etc are visible on all executors.
          "local " + G + "=(getgenv and getgenv()) or (getfenv and getfenv()) or _G;" +
          "if setfenv and " + G + " then pcall(setfenv," + FN + "," + G + ") end;" +
          (DBG ? "warn('[Luripe] compiled OK, executing...');" : "") +
          "local _ok,_e2=pcall(" + FN + ");" +
          (DBG
            ? "if _ok then warn('[Luripe] finished OK') else warn('[Luripe] RUNTIME ERROR: '..tostring(_e2)); if debug and debug.traceback then warn(debug.traceback()) end end"
            : "if not _ok then warn('Luripe: runtime error - '..tostring(_e2)) end") +
          ";";
        return loader;
      }

      // Static detector: constructs the VM cannot run reliably in Luau.
      // If a script touches any of these, force Wrapper mode so it actually runs.
      function needsWrapper(src) {
        // Stage 1: only constructs that need NEW VM semantics force a wrapper hint.
        // Roblox globals/services/userdata (Color3/UDim2/Vector/Enum/game/task/
        // CFrame/bit32/Instance.new/services) already run in the VM via the
        // GETGLOBAL -> GETTABLE -> CALLR/SELFCALL passthrough path, so they are
        // no longer listed. pcall now has a real opcode (Stage 3). Only metatables
        // remain unhandled (Stage 4), and even those are per-function spilled in VM
        // mode rather than forcing a whole-script wrapper.
        // Stage 4: setmetatable/getmetatable are now VM builtins, so metatables
        // and OOP (__index/__newindex/operator metamethods) run in the VM. Only
        // coroutines and goto remain genuinely unhandled.
        var patterns = [
          /\bcoroutine\s*\./, /\bgoto\b/
        ];
        for (var i = 0; i < patterns.length; i++) if (patterns[i].test(src)) return true;
        return false;
      }

      function pickMode() {
        const m = document.getElementById("mode").value;
        // Explicit choice is respected. VM mode now uses the HYBRID compiler:
        // it virtualizes everything it can and per-function spills only the
        // unsupported parts, so setmetatable/pcall/Color3/etc no longer force a
        // whole-script wrapper. needsWrapper() is only a hint for AUTO mode.
        if (m === "vm" || m === "wrapper" || m === "raw") return m;
        // auto: AI verdict wins if present, then static detection, else VM.
        const v = window.__luripeVerdict;
        if (v && (v.recommendedMode === "WRAPPER" || v.verdict === "NOT_VM_SAFE")) return "wrapper";
        const src = document.getElementById("input").value;
        if (needsWrapper(src)) return "wrapper";
        return "vm";
      }

      function downloadOutput(text) {
        if (!text) return;
        try {
          const stamp = Date.now().toString(36);
          const blob = new Blob([text], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "luripe-" + stamp + ".lua";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
        } catch (e) { /* download blocked; output is still in the box to copy */ }
      }
      function run() {
        const src = document.getElementById("input").value;
        const outEl = document.getElementById("output");
        if (!src.trim()) { setStatus("No input to obfuscate.", "err"); return; }
        const mode = pickMode();
        const dbgEl = document.getElementById("dbg");
        const DBG = !!(dbgEl && dbgEl.checked);
        window.__luripeVMDebug = DBG;
        if (mode === "raw") {
          outEl.value = rawBundle(src);
          downloadOutput(outEl.value);
          setStatus("Raw mode - downloaded. No protection, runs as-is via executor.", "ok");
          return;
        }
        if (mode === "wrapper") {
          try {
            setStatus("Obfuscating (wrapper mode)...");
            outEl.value = wrapperBundle(src, DBG);
            downloadOutput(outEl.value);
            setStatus(DBG
              ? "Protected in Wrapper mode (DEBUG ON) - downloaded. Run it and read the [Luripe] messages in your executor console."
              : "Protected in Wrapper mode - downloaded. Universal compatibility (Color3/UDim2/Enum/getgc/etc all run).", "ok");
          } catch (e) { outEl.value = ""; setStatus(e.message, "err"); }
          return;
        }
        // VM mode (with auto-fallback to wrapper if compile fails)
        try {
          setStatus("Obfuscating (VM mode)...");
          const { OP, bytecode, constPool, spilledFns, usedOps } = compile(src);
          const protectedLua = bundle(OP, bytecode, constPool, spilledFns, usedOps);
          outEl.value = protectedLua;
          downloadOutput(outEl.value);
          setStatus("Protected in VM mode - downloaded. " + bytecode.length + " instructions, randomized opcodes" + (spilledFns && spilledFns.length ? " (" + spilledFns.length + " fn(s) hybrid-wrapped)" : "") + ".", "ok");
        } catch (e) {
          // VM couldn't handle it -> fall back to wrapper so the script still works.
          try {
            outEl.value = wrapperBundle(src, DBG);
            downloadOutput(outEl.value);
            setStatus("VM unsupported (" + e.message + ") - used Wrapper mode instead, downloaded.", "ok");
          } catch (e2) {
            outEl.value = "";
            setStatus(e.message, "err");
          }
        }
      }
      function copyOut() {
        const o = document.getElementById("output");
        if (!o.value) { setStatus("Nothing to copy.", "err"); return; }
        navigator.clipboard.writeText(o.value).then(() => setStatus("Copied to clipboard.", "ok"));
      }
      function clearAll() {
        document.getElementById("input").value = "";
        document.getElementById("output").value = "";
        setStatus("Cleared.");
      }

      // Raw mode: no protection, just ensures the script runs via the executor.
      // Useful for testing or when the user just wants a runnable copy.
      function rawBundle(src) {
        return src;
      }

      // Copy the output as a directly-runnable loadstring one-liner for Delta.
      // If output is already a loader, copies as-is. Otherwise wraps raw Lua.


      // ================= AI ANALYZER (Google Gemini) =================
      // Reads raw Lua BEFORE obfuscation, diagnoses which constructs are
      // VM-safe vs unsupported, and recommends VM mode or Wrapper mode.
      // User supplies their own Gemini API key (saved locally, never sent
      // anywhere except Google). Free tier: gemini-2.0-flash.

      (function () {
        const saved = localStorage.getItem("luripe_ai_key");
        if (saved) { const f = document.getElementById("aiKey"); if (f) f.value = saved; }
        const savedProv = localStorage.getItem("luripe_ai_provider");
        if (savedProv) { const s = document.getElementById("aiProvider"); if (s) s.value = savedProv; }
      })();

      function aiPanelShow(html) {
        const p = document.getElementById("aiPanel");
        p.style.display = "block";
        p.innerHTML = html;
      }

      async function aiAnalyze() {
        const src = document.getElementById("input").value;
        const key = (document.getElementById("aiKey").value || "").trim();
        const provider = document.getElementById("aiProvider").value;
        if (!src.trim()) { setStatus("No input to analyze.", "err"); return; }
        if (!key) { setStatus("Enter your AI API key first.", "err"); return; }
        localStorage.setItem("luripe_ai_key", key);
        localStorage.setItem("luripe_ai_provider", provider);

        const btn = document.getElementById("aiBtn");
        btn.disabled = true;
        setStatus("AI analyzing...");

        let supported =
          "SUPPORTED by the Luripe VM: local variables, numbers, strings, booleans, nil, " +
          "arithmetic (+ - * / %), comparisons (< > <= >= == ~=), concat (..), and/or/not, " +
          "if/elseif/else, while, numeric for, generic for (ipairs/pairs), named functions, " +
          "anonymous functions/closures, method calls obj:m(), qualified calls T.f(), tables, " +
          "multiple returns, varargs, common builtins (math.*, string.*, table.insert/remove/concat, " +
          "tostring, tonumber, type, print), Roblox globals/services passthrough (game, getgenv, " +
          "workspace, game:GetService, Instance.new), property get/set on Instances.\n";

        // ============================================================
        // VM_CAPABILITIES - SINGLE SOURCE OF TRUTH for the analyzer.
        // Teach the VM a new construct? Move it from `unsupported` to
        // `supported` HERE (and nowhere else). The AI prompt is generated
        // from these lists, so the recommendation never drifts from what the
        // compiler can actually virtualize. Last updated: Stage 1-3.
        // ============================================================
        const VM_CAPABILITIES = {
          version: "stage1-3",
          supported: [
            "break (in any loop)",
            "repeat/until",
            "multiple returns and multiple assignment (local a,b = f())",
            "pcall and error (run natively per-call; ok/err returned correctly)",
            "Roblox userdata constructors passthrough (Color3, UDim2, Vector2, Vector3, Enum, CFrame, BrickColor)",
            "bit32.* (passthrough)",
            "Instance property get/set, event :Connect, task.*/wait/spawn (passthrough)",
            "ANY global function call (cloneref, getrenv, getgenv, hookfunction, UserSettings, getupvalues, require, warn, typeof, isfile, readfile, writefile, etc.) - ALL run in VM mode via global passthrough; NEVER flag a global call as unsupported",
            "setmetatable/getmetatable and metatables (__index, __newindex, operator metamethods) - OOP works",
            "raw access: rawget, rawset, rawequal, rawlen; assert, select, unpack",
          ],
          unsupported: [
            "coroutines (coroutine.create/wrap/resume/yield) - note: task.spawn/task.defer/task.delay are NOT coroutines, they are passthrough calls and ARE supported",
            "goto / labels",
            "xpcall (use pcall instead)",
          ],
        };
        supported = supported +
          "ALSO SUPPORTED in VM mode (added in " + VM_CAPABILITIES.version + "):\n- " +
          VM_CAPABILITIES.supported.join("\n- ") + "\n\n" +
          "NOT supported in VM mode - only THESE should ever trigger a WRAPPER recommendation " +
          "(anything not on this list runs in VM mode):\n- " +
          VM_CAPABILITIES.unsupported.join("\n- ") + "\n\n" +
          "IMPORTANT: pcall, error, break, repeat/until, setmetatable/getmetatable/metatables (OOP), " +
          "and Roblox userdata (Color3/UDim2/Vector/Enum) are all SUPPORTED now. Do NOT flag them as " +
          "unsupported. Recommend WRAPPER only if a construct from the NOT-supported list above is present.\n";

        const prompt =
          "You are a static analyzer for the 'Luripe' Luau obfuscator. It has TWO modes: " +
          "VM mode = strongest protection (full virtualization) but ONLY runs the supported subset below. " +
          "WRAPPER mode = universal (runs 100% of Luau incl Color3/UDim2/Enum/pcall/task.spawn/metatables/UI) " +
          "but lighter protection. " +
          supported + "\n\n" +
          "GOAL: recommend the STRONGEST mode that will STILL RUN this exact script without breaking. " +
          "Choose VM only if EVERY construct is in the supported list; if even one unsupported construct " +
          "is present, VM mode would fail at runtime, so you MUST choose WRAPPER. Never sacrifice a working " +
          "script for stronger protection - a broken VM output is useless.\n\n" +
          "Analyze the following Luau script. Return STRICT JSON only, no markdown, with keys: " +
          "{\"verdict\":\"VM_SAFE\"|\"RISKY\"|\"NOT_VM_SAFE\", " +
          "\"recommendedMode\":\"VM\"|\"WRAPPER\", " +
          "\"unsupported\":[{\"construct\":\"name\",\"line\":number,\"snippet\":\"the code\"}], " +
          "\"runtimeRisks\":[short notes on what could FAIL SILENTLY at runtime even in Wrapper mode, e.g. loadstring disabled, executor-only globals, missing services], " +
          "\"reasons\":[short bullet reasons], " +
          "\"summary\":\"one-sentence: which mode and why it is the strongest that still runs\"}. " +
          "For each unsupported construct include the 1-based LINE NUMBER and the exact snippet so the user can find it fast. " +
          "In runtimeRisks, call out anything that would make the script run with NO output and NO error (silent failure).\n\n" +
          "SCRIPT (lines are 1-based):\n" +
          src.split("\n").slice(0, 400).map((l, i) => (i + 1) + ": " + l).join("\n").slice(0, 14000);

        try {
          let raw;
          if (provider === "gemini") {
            const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
              "gemini-2.0-flash:generateContent?key=" + encodeURIComponent(key);
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
              }),
            });
            if (!res.ok) { const t = await res.text(); throw new Error("Gemini " + res.status + ": " + t.slice(0, 160)); }
            const data = await res.json();
            raw = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text;
          } else {
            // OpenAI-compatible: OpenAI, OpenRouter, Groq
            let endpoint, model;
            if (provider === "openai") { endpoint = "https://api.openai.com/v1/chat/completions"; model = "gpt-4o-mini"; }
            else if (provider === "openrouter") { endpoint = "https://openrouter.ai/api/v1/chat/completions"; model = "google/gemini-2.0-flash-exp:free"; }
            else if (provider === "groq") { endpoint = "https://api.groq.com/openai/v1/chat/completions"; model = "llama-3.3-70b-versatile"; }
            else throw new Error("Unknown provider.");
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
              body: JSON.stringify({
                model: model,
                temperature: 0.1,
                response_format: { type: "json_object" },
                messages: [{ role: "user", content: prompt }],
              }),
            });
            if (!res.ok) { const t = await res.text(); throw new Error(provider + " " + res.status + ": " + t.slice(0, 160)); }
            const data = await res.json();
            raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          }
          if (!raw) throw new Error("Empty AI response.");
          let rep;
          try { rep = JSON.parse(raw); }
          catch (e) {
            const m = raw.match(/\{[\s\S]*\}/);
            rep = m ? JSON.parse(m[0]) : null;
          }
          if (!rep) throw new Error("Could not parse AI response.");
          renderReport(rep);
          setStatus("AI analysis complete.", "ok");
        } catch (e) {
          aiPanelShow('<div style="background:var(--panel);border:1px solid var(--err);' +
            'border-radius:10px;padding:14px 18px;color:var(--err);font-size:13px;">' +
            "AI error: " + esc(e.message) + "</div>");
          setStatus("AI analysis failed.", "err");
        } finally {
          btn.disabled = false;
        }
      }

      function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }

      // ============ AI ERROR DIAGNOSIS ============
      // Paste a runtime error from Roblox/executor + the source; AI explains the
      // exact cause, the likely line, and a concrete fix. Works with the same key.
      async function aiExplainError() {
        const src = document.getElementById("input").value;
        const errBox = document.getElementById("errInput");
        const errText = errBox ? (errBox.value || "").trim() : "";
        const key = (document.getElementById("aiKey").value || "").trim();
        const provider = document.getElementById("aiProvider").value;
        if (!errText) { setStatus("Paste the Roblox error message first.", "err"); return; }
        if (!key) { setStatus("Enter your AI API key first.", "err"); return; }
        localStorage.setItem("luripe_ai_key", key);
        const btn = document.getElementById("errBtn");
        if (btn) btn.disabled = true;
        setStatus("AI diagnosing error...");

        const prompt =
          "You are the expert debugger for the 'Luripe' Luau obfuscator running in a Roblox executor (Delta, Synapse, etc.). " +
          "ARCHITECTURE: Luripe compiles Lua to a CUSTOM STACK-BASED VM bytecode (randomized opcodes, encrypted constants, binary-search dispatch). " +
          "It supports: locals, arithmetic, comparisons, concat, if/while/for, break, repeat/until, functions, closures + upvalues, " +
          "multiple assignment, varargs, tables, metatables/OOP (setmetatable/getmetatable, __index/__newindex/operator metamethods), " +
          "pcall/error (run natively), and Roblox passthrough (Color3/UDim2/Vector/Enum/game/services). " +
          "Functions/callbacks that escape to native APIs (metamethods, :Connect, table.sort) are spilled to real Lua closures. " +
          "It does NOT yet support: coroutines, goto/labels, xpcall. " +
          "KNOWN ERROR SIGNATURES and their SPECIFIC causes: " +
          "- 'attempt to perform arithmetic (add/sub/...) on a nil value' => a variable read as nil: usually an upvalue/closure capture issue, an uninitialised local, or a global that does not exist in the executor. Name the exact variable from the snippet. " +
          "- 'attempt to get length of a number value' / '#' errors => internal VM stack imbalance (report as a Luripe bug, suggest trying a slightly simpler equivalent or Wrapper mode as a workaround). " +
          "- 'attempt to call a nil value' => a missing global/service, a typo'd function name, or an executor that lacks that API. Name it. " +
          "- 'attempt to call a table value' => a function value used where a Lua function is required (rare now; report as bug). " +
          "- 'attempt to index nil' => indexing a variable that is nil; name the variable and the field. " +
          "- silent no-output => likely Roblox userdata the VM cannot express, or loadstring disabled/hooked. " +
          "- too-many-locals / syntax => script too large for one chunk. " +
          "RULES: Be SPECIFIC. Name the exact variable/function/field from the snippet. If the line number in the error is the VM loader (line 1), IGNORE it and find the real offending line in the SOURCE. Do not give generic advice. " +
          "Given the ERROR and the original SOURCE, return STRICT JSON only (no markdown): " +
          "{\"cause\":\"one clear sentence naming the root cause, referencing the exact variable/function\", " +
          "\"variable\":\"the specific variable/function/field name involved, or empty\", " +
          "\"line\":number-or-null (1-based line in SOURCE, NOT the loader line 1), " +
          "\"snippet\":\"the offending source line if identifiable, else empty\", " +
          "\"isLuripeBug\":true-or-false (true if this is an internal VM fault rather than a mistake in the user script), " +
          "\"fix\":\"a concrete, specific fix; if isLuripeBug, suggest the closest working workaround\", " +
          "\"mode\":\"VM\"|\"WRAPPER\"|\"RAW (which Luripe mode is most likely to make this script work)\", " +
          "\"confidence\":\"high\"|\"medium\"|\"low\"}.\n\n" +
          "ERROR:\n" + errText.slice(0, 2000) + "\n\n" +
          "SOURCE (1-based lines):\n" +
          src.split("\n").slice(0, 400).map((l, i) => (i + 1) + ": " + l).join("\n").slice(0, 12000);

        try {
          const raw = await aiCall(provider, key, prompt);
          if (!raw) throw new Error("Empty AI response.");
          let rep;
          try { rep = JSON.parse(raw); } catch (e) { const m = raw.match(/\{[\s\S]*\}/); rep = m ? JSON.parse(m[0]) : null; }
          if (!rep) throw new Error("Could not parse AI response.");
          renderErrorReport(rep);
          setStatus("Error diagnosed.", "ok");
        } catch (e) {
          aiPanelShow('<div style="background:var(--panel);border:1px solid var(--err);border-radius:10px;padding:14px 18px;color:var(--err);font-size:13px;">' +
            "AI error: " + esc(e.message) + "</div>");
          setStatus("Diagnosis failed.", "err");
        } finally { if (btn) btn.disabled = false; }
      }

      // Shared AI call helper (used by both analyze and error-explain).
      async function aiCall(provider, key, prompt) {
        if (provider === "gemini") {
          const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + encodeURIComponent(key);
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } }) });
          if (!res.ok) { const t = await res.text(); throw new Error("Gemini " + res.status + ": " + t.slice(0, 160)); }
          const data = await res.json();
          return data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text;
        }
        let endpoint, model;
        if (provider === "openai") { endpoint = "https://api.openai.com/v1/chat/completions"; model = "gpt-4o-mini"; }
        else if (provider === "openrouter") { endpoint = "https://openrouter.ai/api/v1/chat/completions"; model = "google/gemini-2.0-flash-exp:free"; }
        else if (provider === "groq") { endpoint = "https://api.groq.com/openai/v1/chat/completions"; model = "llama-3.3-70b-versatile"; }
        else throw new Error("Unknown provider.");
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
          body: JSON.stringify({ model: model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }) });
        if (!res.ok) { const t = await res.text(); throw new Error(provider + " " + res.status + ": " + t.slice(0, 160)); }
        const data = await res.json();
        return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      }

      function renderErrorReport(rep) {
        const conf = rep.confidence === "high" ? "var(--ok)" : rep.confidence === "low" ? "var(--err)" : "#f5c451";
        var lineInfo = "";
        if (rep.line != null) lineInfo = ' <span style="color:var(--text-faint);">(line ' + esc(rep.line) + ')</span>';
        aiPanelShow(
          '<div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 20px;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<span style="font-weight:700;font-size:14px;color:var(--text);">Error diagnosis</span>' +
          '<span style="font-size:12px;color:' + conf + ';">confidence: ' + esc(rep.confidence || "?") + '</span></div>' +
          '<div style="font-size:13px;color:var(--text);margin-bottom:10px;"><b>Cause:</b> ' + esc(rep.cause || "?") + lineInfo + '</div>' +
          (rep.snippet ? '<div style="font-size:12px;margin-bottom:10px;"><code style="color:var(--text-faint);">' + esc(rep.snippet) + '</code></div>' : "") +
          '<div style="font-size:13px;color:var(--text-dim);margin-bottom:8px;"><b style="color:var(--text);">Fix:</b> ' + esc(rep.fix || "") + '</div>' +
          '<div style="font-size:12px;color:var(--text-dim);">Recommended mode: <b style="color:var(--text);">' + esc(rep.mode || "?") + '</b></div>' +
          '</div>'
        );
      }

      function renderReport(rep) {
        window.__luripeVerdict = rep;
        const color = rep.verdict === "VM_SAFE" ? "var(--ok)" :
          rep.verdict === "RISKY" ? "#f5c451" : "var(--err)";
        const items = (arr) => (arr && arr.length)
          ? arr.map((x) => {
              if (x && typeof x === "object") {
                var label = esc(x.construct || x.name || x.type || JSON.stringify(x));
                if (x.line != null) label += ' <span style="color:var(--text-faint);">(line ' + esc(x.line) + ')</span>';
                if (x.snippet) label += ' <code style="color:var(--text-faint);">' + esc(x.snippet) + '</code>';
                return "<li>" + label + "</li>";
              }
              return "<li>" + esc(x) + "</li>";
            }).join("") : "<li>None</li>";
        const modeNote = rep.recommendedMode === "WRAPPER"
          ? "Recommended: <b>Wrapper mode</b> (universal, lighter protection) - this script uses features the VM cannot run reliably."
          : "Recommended: <b>VM mode</b> (full virtualization) - safe to obfuscate normally.";
        aiPanelShow(
          '<div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 20px;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
          '<span style="font-weight:700;font-size:14px;color:' + color + ';">' + esc(rep.verdict || "?") + '</span>' +
          '<span style="color:var(--text-dim);font-size:13px;">' + esc(rep.summary || "") + '</span></div>' +
          '<div style="color:var(--text-dim);font-size:12px;margin-bottom:12px;">' + modeNote + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;font-size:12px;color:var(--text-dim);">' +
          '<div><div style="font-weight:600;color:var(--text);margin-bottom:6px;">Unsupported found</div>' +
          '<ul style="margin:0;padding-left:18px;line-height:1.7;">' + items(rep.unsupported) + '</ul></div>' +
          '<div><div style="font-weight:600;color:var(--text);margin-bottom:6px;">Reasons</div>' +
          '<ul style="margin:0;padding-left:18px;line-height:1.7;">' + items(rep.reasons) + '</ul></div>' +
          '</div></div>'
        );
      }
    

// ============================ AUTO-ROUTING + SELF-TEST ============================
// Static pre-check: constructs the VM cannot safely virtualize. If any are present
// we route straight to wrapper mode (the whole real script runs via load()).
const VM_UNSAFE_PATTERNS = [
  /\bgetgenv\b/, /\bgetrenv\b/, /\bgetsenv\b/, /\bgetfenv\b/, /\bsetfenv\b/,
  /\bhookfunction\b/, /\bhookmetamethod\b/, /\bgetnamecallmethod\b/, /\bnewcclosure\b/,
  /\bgetconnections\b/, /\bfiretouchinterest\b/, /\bfireproximityprompt\b/, /\bfireclickdetector\b/,
  /\bcheckcaller\b/, /\bcloneref\b/, /\bgetupvalue?s\b/, /\bdebug\.setupvalue\b/, /\bdebug\.getupvalue/,
  /\bInstance\.new\b/, /\bgame:GetService\b/, /\bworkspace\b/, /\bcoroutine\./,
  /\bUDim2\b/, /\bColor3\b/, /\bVector[23]\b/, /\bCFrame\b/, /\bEnum\./, /\btask\.(spawn|wait|delay|defer)\b/,
  /\brequire\b/, /\bwritefile\b/, /\breadfile\b/, /\bisfile\b/, /\bHttpService\b/, /\bTweenService\b/,
];
function needsWrapper(source) {
  for (const re of VM_UNSAFE_PATTERNS) if (re.test(source)) return true;
  return false;
}

// vmProtect(): headless VM pipeline. run() is a BROWSER-UI function (reads a DOM
// textarea, writes to a DOM element, triggers a download) and returns nothing —
// unusable under Node. The real string-producing path inside run() is
// compile() -> bundle(); we call those two directly here.
function vmProtect(source) {
  const { OP, bytecode, constPool, spilledFns, usedOps } = compile(source);
  return bundle(OP, bytecode, constPool, spilledFns, usedOps);
}

// protect(): the single entry point. mode "auto" is the safe default.
function protect(source, opts) {
  opts = opts || {};
  const mode = opts.mode || "auto";
  if (mode === "wrapper") return { mode: "wrapper", output: wrapperBundle(source, !!opts.debug) };
  if (mode === "vm") {
    // Force VM; caller explicitly accepts the risk.
    return { mode: "vm", output: vmProtect(source) };
  }
  // AUTO: static pre-check first (fast, catches executor/Roblox scripts).
  if (needsWrapper(source)) {
    return { mode: "wrapper", reason: "vm-unsafe-construct", output: wrapperBundle(source, !!opts.debug) };
  }
  // Pure-logic candidate: try VM, but if compile/bundle throws, fall back to wrapper.
  try {
    const vmOut = vmProtect(source);
    return { mode: "vm", output: vmOut };
  } catch (e) {
    return { mode: "wrapper", reason: "vm-compile-failed: " + (e && e.message), output: wrapperBundle(source, !!opts.debug) };
  }
}

module.exports = {
  protect,
  needsWrapper,
  compile: (typeof compile !== "undefined" ? compile : null),
  wrapperBundle: (typeof wrapperBundle !== "undefined" ? wrapperBundle : null),
  OPS: (typeof OPS !== "undefined" ? OPS : null),
};

// CLI: node luripe.js input.lua [out.lua] [--mode auto|vm|wrapper]
if (require.main === module) {
  const fs = require("fs");
  const args = process.argv.slice(2);
  const inFile = args[0] || "input.lua";
  let outFile = args[1] && !args[1].startsWith("--") ? args[1] : inFile.replace(/\.lua$/, "") + ".protected.lua";
  let mode = "auto";
  const mi = args.indexOf("--mode"); if (mi >= 0 && args[mi+1]) mode = args[mi+1];
  const debug = args.indexOf("--debug") >= 0;
  const src = fs.readFileSync(inFile, "utf8");
  const res = protect(src, { mode, debug });
  // compile() (VM mode) may return the protected Lua as a string OR as an object
  // carrying the source under a field. Normalize to the string we write out.
  let out = res.output;
  if (out && typeof out === "object") {
    out = out.lua || out.source || out.code || out.output || out.protected ||
          out.result || (typeof out.toString === "function" ? out.toString() : "");
  }
  if (typeof out !== "string") out = String(out);
  fs.writeFileSync(outFile, out);
  console.log("[Luripe] mode=" + res.mode + (res.reason ? (" (" + res.reason + ")") : "") + " -> " + outFile);
}
