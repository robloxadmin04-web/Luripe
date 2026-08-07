local orig
orig = hookfunction(print, function(...)
    return orig("hooked:", ...)
end)
print("hello")
