local function stats(nums)
  local total = 0
  local biggest = nums[1]
  for i = 1, #nums do
    total = total + nums[i]
    biggest = math.max(biggest, nums[i])
  end
  return total, biggest
end

local data = {}
table.insert(data, 4)
table.insert(data, 9)
table.insert(data, 2)

local sum, max = stats(data)
print(string.format("Sum=%d Max=%d", sum, max))
print("Sqrt of sum: " .. math.floor(math.sqrt(sum)))
