-- upstream: https://github.com/matter-ecs/matter/blob/25e74bfd8cc06279f61677e03ba9ff816764078b/lib/debugger/formatTable.luau

local stringColor = "#dcdcaa"
local numberColor = "#b0c4de"
local keywordColor = "#c586c0"

function colorize(value, color)
	if type(value) == "number" then
		value = string.format("%.1f", value)
	end

	return `<font color="{color}">{value}</font>`
end

function colorizeMany(color, ...)
	local values = { ... }

	for i, value in ipairs(values) do
		values[i] = colorize(value, color)
	end

	return table.unpack(values)
end

function wrap(name, value)
	return `{colorize(name, keywordColor)}({value})`
end

function commaSeparate(dots, ...)
	local str = table.concat({ ... }, ", ")

	if dots then
		str ..= ", .."
	end

	return str
end

local formatMode = {
	short = "Short",
	long = "Long",
}
local function formatTable(object, mode, _padLength, _depth)
	mode = mode or formatMode.short
	_padLength = _padLength or 0
	_depth = _depth or 1

	local max = if mode == formatMode.short then 7 else 1000

	local str = ""

	if mode == formatMode.short or _depth > 1 then
		str ..= "{"
	end

	local values = {}

	for key, value in pairs(object) do
		table.insert(values, {
			key = key,
			value = value,
		})
	end

	table.sort(values, function(a, b)
		return tostring(a.key) < tostring(b.key)
	end)

	local count = 0
	for _, entry in values do
		local key = entry.key
		local value = entry.value

		local part = ""

		if count > 0 then
			part ..= ", "
		end

		if mode == formatMode.long and (if count == 0 then _depth > 1 else true) then
			part ..= `\n{string.rep("  ", _depth - 1)}`
		end

		count += 1
		if type(key) == "string" then
			part ..= key .. (if mode == formatMode.short then "=" else " = ")
		elseif type(key) == "table" then
			if mode == formatMode.short then
				part ..= "[{..}]="
			else
				part ..= "["
				part ..= formatTable(key, formatMode.short, #str + #part + _padLength, _depth + 1)
				part ..= "] = "
			end
		end

		local luaType = type(value)
		local robloxType = typeof(value)

		local valueStr = tostring(value)

		if luaType == "string" then
			part ..= colorize(`"{value:sub(1, max)}"`, stringColor)
		elseif luaType == "number" then
			part ..= colorize(valueStr, numberColor)
		elseif luaType == "boolean" then
			part ..= colorize(valueStr, keywordColor)
		elseif luaType == "table" then
			if mode == formatMode.short then
				part ..= "{..}"
			else
				part ..= formatTable(value, formatMode.long, #str + #part + _padLength, _depth + 1)
			end
		elseif mode == formatMode.long and (luaType == "userdata" or luaType == "vector") then
			if robloxType == "CFrame" then
				local x, y, z = value:components()
				local separated = commaSeparate(true, colorizeMany(numberColor, x, y, z))
				part ..= wrap("CFrame", separated)
			elseif robloxType == "Vector3" then
				local separated = commaSeparate(false, colorizeMany(numberColor, value.X, value.Y, value.Z))
				part ..= wrap("Vector3", separated)
			elseif robloxType == "Vector2" then
				local separated = commaSeparate(false, colorizeMany(numberColor, value.X, value.Y))
				part ..= wrap("Vector2", separated)
			else
				part ..= wrap(robloxType, valueStr)
			end
		else
			part ..= valueStr:sub(1, max)
		end

		if mode == formatMode.short and #str + #part + _padLength > 30 then
			if count > 1 then
				str ..= ", "
			end

			str ..= ".."

			break
		else
			str ..= part
		end

		if mode == formatMode.short and #part + _padLength > 30 then
			part ..= ", .."
			break
		end
	end

	if mode == formatMode.long and _depth > 1 and #values > 0 then
		str ..= `\n{string.rep("  ", _depth - 2)}`
	end

	if mode == formatMode.short or _depth > 1 then
		str ..= "}"
	end

	return str
end

return {
	formatTable = formatTable,
	formatMode = formatMode,
}
