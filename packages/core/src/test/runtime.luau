--!nocheck

local implementations = setmetatable({}, { __mode = "k" })
local mocks = setmetatable({}, { __mode = "v" })

local function mock(jest, key, value)
	local mocked = jest.fn(value).mockName(tostring(key))
	table.insert(mocks, mocked)
	implementations[mocked] = value

	return mocked
end

local TestRuntimeUtils; TestRuntimeUtils = {
	isTesting = _G.__TEST__,

	getModuleByTree = function(root, parts)
		local current = root

		for _, nextPart in parts do
			current = current:WaitForChild(nextPart)
		end

		return current
	end,

	resetTSRuntime = function(clean)
		local tsRuntime

		for key, runtime in _G do
			if typeof(key) == "Instance" and key:IsA("ModuleScript") then
				if not tsRuntime and type(runtime) == "table" and type(runtime.reset) == "function" then
					tsRuntime = runtime
				end

				_G[key] = nil
			end
		end

		if tsRuntime ~= nil then
			tsRuntime.reset()
		end

		if clean then
			for _, instance in game:GetService("Workspace"):GetChildren() do
				if not (instance:IsA("Terrain") or instance:IsA("Camera")) then
					instance:Destroy()
				end
			end
		end

		return tsRuntime
	end,

	createMockInstance = function(instance, mockSelf)
		mockSelf = mockSelf ~= nil and mockSelf or true
		return setmetatable({
			__instance__ = instance,
			__mockSelf__ = mockSelf,
		}, {
			__index = function(self, key)
				local source = rawget(self, "__instance__")
				local exists, value = pcall(function()
					return source[key]
				end)

				local shouldMockSelf = false
				local selfBehavior = rawget(self, "__mockSelf__")
				if type(selfBehavior) == "table" then
					shouldMockSelf = selfBehavior[key] == true
				else
					shouldMockSelf = selfBehavior == true
				end

				if not exists then
					return nil
				end

				if type(value) == "function" and shouldMockSelf then
					return function(_, ...)
						return value(source, ...)
					end
				end

				return value
			end,
		})
	end,

	mockOnRuntime = function(jest, mockInstance)
		local mockInstanceIndex = getmetatable(mockInstance).__index
		mockInstance.__mockValue__ = function()
			return false, nil
		end

		return setmetatable(mockInstance, {
			__index = function(self, key)
				local value = mockInstanceIndex(self, key)
				local useMocked, mockedValue = rawget(self, "__mockValue__")(self, key, value)

				if useMocked ~= true then
					if value ~= nil then
						if type(value) == "function" then
							mockedValue = mock(jest, key, value)
						elseif
							(type(value) == "table" and rawget(value, "__instance__") == nil)
							or type(value) == "userdata"
						then
							mockedValue = TestRuntimeUtils.mockOnRuntime(jest, TestRuntimeUtils.createMockInstance(value))
						else
							mockedValue = value
						end
					else
						mockedValue = nil
					end
				end

				self[key] = mockedValue
				return mockedValue
			end,
		})
	end,

	restoreAllMocks = function()
		for _, mocked in mocks do
			local original = implementations[mocked]
			mocked.mockRestore()
			mocked.mockImplementation(original)
		end
	end,
}

return TestRuntimeUtils
