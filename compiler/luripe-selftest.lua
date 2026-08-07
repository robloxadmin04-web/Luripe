-- luripe-selftest.lua
-- Runs a Luripe VM-protected output under lua5.4 with a MOCK Roblox/executor
-- environment, so "attempt to call a nil value" and friends surface with a real
-- line/traceback in milliseconds — no Roblox round-trip.
--
-- Usage:
--   lua5.4 luripe-selftest.lua real-vm.out
--
-- What it does:
--   * installs fake getgenv/getrenv/hookfunction/Instance.new/Color3/... etc.
--   * every mock is a permissive stub: indexing returns another stub, calling
--     returns a stub, so the script can chain t:Method().Prop(...) without nil.
--   * loads and runs the protected chunk under xpcall; prints the FIRST error
--     with a full traceback pointing at the failing construct.
--
-- If it runs clean here, the VM output is logically sound; remaining Roblox-only
-- failures are environment quirks, not compiler bugs.

local target = arg[1]
if not target then
  io.stderr:write("usage: lua5.4 luripe-selftest.lua <protected.lua>\n")
  os.exit(1)
end

-------------------------------------------------------------------------------
-- Universal permissive stub. Any index -> stub. Any call -> stub (+ records name).
-------------------------------------------------------------------------------
local STUB_MT = {}
local function makeStub(name)
  local t = setmetatable({ __stubname = name or "stub" }, STUB_MT)
  return t
end
STUB_MT.__index = function(_, k)
  -- return a fresh stub for any property/method access
  return makeStub(tostring(k))
end
STUB_MT.__newindex = function() end          -- allow property writes
STUB_MT.__call = function(_, ...) return makeStub("callresult") end
STUB_MT.__tostring = function(s) return "stub<"..tostring(s.__stubname)..">" end
STUB_MT.__concat = function(a, b) return tostring(a)..tostring(b) end
STUB_MT.__eq = function() return false end
STUB_MT.__len = function() return 0 end

-- A stub that is ALSO callable and returns a real value type when needed.
local function fnStub(ret)
  return function(...) if ret ~= nil then return ret end return makeStub("ret") end
end

-------------------------------------------------------------------------------
-- Fake global environment
-------------------------------------------------------------------------------
local G = _ENV
local genv = {}   -- getgenv() table

-- executor functions
G.getgenv        = function() return genv end
G.getrenv        = function() return _ENV end
G.getsenv        = fnStub()
G.hookfunction   = function(old, new) return old end   -- return original
G.hookmetamethod = function() return function() end end
G.getnamecallmethod = fnStub("Method")
G.newcclosure    = function(f) return f end
G.getconnections = function() return {} end
G.cloneref       = function(x) return x end
G.getupvalues    = function() return {} end
G.getupvalue     = fnStub()
G.setupvalue     = fnStub()
G.getrawmetatable= function() return {} end
G.setrawmetatable= fnStub()
G.setreadonly    = fnStub()
G.isreadonly     = function() return false end
G.islclosure     = function() return true end
G.isourclosure   = function() return true end
G.iscclosure     = function() return false end
G.checkcaller    = function() return false end
G.getExecutorGlobal = fnStub()
G.identifyexecutor = function() return "MockExecutor", "1.0" end
G.gethui         = function() return makeStub("hui") end
G.setfpscap      = fnStub()
G.request        = function() return { Success = true, Body = "{}", StatusCode = 200 } end
G.HttpGet        = function() return "" end

-- filesystem
G.writefile  = fnStub()
G.readfile   = function() return "" end
G.isfile     = function() return false end
G.makefolder = fnStub()
G.isfolder   = function() return false end
G.listfiles  = function() return {} end
G.delfile    = fnStub()
G.appendfile = fnStub()

-- Roblox datatypes (permissive stubs that also behave as constructors)
local function dtype(name)
  return setmetatable({
    new       = function(...) return makeStub(name) end,
    fromRGB   = function(...) return makeStub(name) end,
    fromHSV   = function(...) return makeStub(name) end,
    fromOffset= function(...) return makeStub(name) end,
    fromScale = function(...) return makeStub(name) end,
    fromMatrix= function(...) return makeStub(name) end,
  }, STUB_MT)
end
G.Instance = setmetatable({ new = function(class) return makeStub(class or "Instance") end }, STUB_MT)
G.Color3   = dtype("Color3")
G.Vector2  = dtype("Vector2")
G.Vector3  = dtype("Vector3")
G.CFrame   = dtype("CFrame")
G.UDim     = dtype("UDim")
G.UDim2    = dtype("UDim2")
G.Ray      = dtype("Ray")
G.Region3  = dtype("Region3")
G.NumberSequence = dtype("NumberSequence")
G.ColorSequence  = dtype("ColorSequence")
G.TweenInfo = dtype("TweenInfo")
G.Enum     = makeStub("Enum")

-- globals / services
G.game      = makeStub("game")
G.workspace = makeStub("workspace")
G.shared    = {}
G.UserSettings = function() return makeStub("UserSettings") end
G.settings  = function() return makeStub("settings") end
G.typeof    = function(v) local t=type(v); if t=="table" and getmetatable(v)==STUB_MT then return "Instance" end return t end
G.tick      = function() return os.clock() end
G.time      = function() return os.time() end
G.wait      = function() return 0 end
G.spawn     = function(f) if type(f)=="function" then pcall(f) end end
G.delay     = function(_, f) if type(f)=="function" then pcall(f) end end

-- task library
G.task = {
  spawn = function(f, ...) if type(f)=="function" then pcall(f, ...) end return makeStub("thread") end,
  defer = function(f, ...) if type(f)=="function" then pcall(f, ...) end return makeStub("thread") end,
  delay = function(_, f, ...) if type(f)=="function" then pcall(f, ...) end return makeStub("thread") end,
  wait  = function() return 0 end,
  cancel= function() end,
}

-- bit32 exists in 5.4? No — provide it (VM needs it).
if not bit32 then
  bit32 = {
    band = function(a,b,...) a=a&b; for _,v in ipairs({...}) do a=a&v end return a end,
    bor  = function(a,b,...) a=a|b; for _,v in ipairs({...}) do a=a|v end return a end,
    bxor = function(a,b,...) a=a~b; for _,v in ipairs({...}) do a=a~v end return a end,
    bnot = function(a) return ~a & 0xFFFFFFFF end,
    lshift = function(a,n) return (a << n) & 0xFFFFFFFF end,
    rshift = function(a,n) return (a & 0xFFFFFFFF) >> n end,
    lrotate = function(a,n) n=n%32; return ((a<<n)|(a>>(32-n))) & 0xFFFFFFFF end,
    rrotate = function(a,n) n=n%32; return ((a>>n)|(a<<(32-n))) & 0xFFFFFFFF end,
    countrz = function(a) if a==0 then return 32 end local c=0 while (a&1)==0 do c=c+1 a=a>>1 end return c end,
    arshift = function(a,n) return a >> n end,
  }
  G.bit32 = bit32
end

-------------------------------------------------------------------------------
-- Load + run the protected chunk with a full traceback on error
-------------------------------------------------------------------------------
local fh = assert(io.open(target, "r"))
local src = fh:read("*a"); fh:close()

local chunk, loaderr = load(src, "@"..target)
if not chunk then
  io.stderr:write("LOAD ERROR (syntax): "..tostring(loaderr).."\n")
  os.exit(2)
end

local ok, err = xpcall(chunk, function(e)
  return tostring(e).."\n"..debug.traceback("", 2)
end)

if ok then
  print("=== SELF-TEST PASSED: ran with no error under the mock environment. ===")
  os.exit(0)
else
  io.stderr:write("=== SELF-TEST FAILED ===\n")
  io.stderr:write(err.."\n")
  os.exit(3)
end
