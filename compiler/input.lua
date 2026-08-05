local function minmax(a, b)
  if a < b then
    return a, b
  else
    return b, a
  end
end

local function sum(...)
  local t = {...}
  local total = 0
  for i = 1, #t do
    total = total + t[i]
  end
  return total
end

local lo, hi = minmax(8, 3)
print("Low: " .. lo)
print("High: " .. hi)
print("Sum: " .. sum(1, 2, 3, 4))
