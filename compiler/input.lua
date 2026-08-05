-- input.lua  —  test na may GENERIC FOR (ipairs) + lahat ng features

local function double(n)
  return n * 2
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
