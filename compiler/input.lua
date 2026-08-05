-- input.lua  —  sample na programa na may LOGIC (if/while)
-- Subukan: node luripe.js input.lua

local i = 1
while i <= 5 do
  print(i)
  i = i + 1
end

local score = 85
if score >= 90 then
  print(1)
elseif score >= 75 then
  print(2)
else
  print(3)
end
