-- input.lua  —  Luripe stable test (walang closures)
-- Gumagamit ng: local function, tables, table.insert, generic for (ipairs),
-- string concat, built-ins (math.max), multiple return, methods.

local function double(n)
  return n * 2
end

local function minmax(a, b)
  if a < b then
    return a, b
  else
    return b, a
  end
end

local nums = {}
table.insert(nums, 5)
table.insert(nums, 10)
table.insert(nums, 15)

local total = 0
for i, v in ipairs(nums) do
  local d = double(v)
  print("Item " .. i .. ": " .. v .. " -> " .. d)
  total = total + d
end

print("Total (doubled): " .. total)

local lo, hi = minmax(8, 3)
print("Min: " .. lo .. " Max: " .. hi)
print("Biggest in list: " .. math.max(nums[1], nums[3]))
