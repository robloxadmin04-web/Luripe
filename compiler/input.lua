local Dog = {}

function Dog.new(name)
  local d = {}
  d.name = name
  return d
end

function Dog:speak()
  return self.name .. " barks!"
end

local rex = Dog.new("Rex")
local buddy = Dog.new("Buddy")
print(rex:speak())
print(buddy:speak())
