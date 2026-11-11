-- Scaffold the container folders a Rojo project declares as `<Service>.rbxm` bundles for ree's and
-- rur's `--snapshot-dir`.
--
-- The emulator/UI lanes stage only `$path` mounts, so containers declared as pure `$className`
-- folders (`ReplicatedStorage.Models.Items`, `SoundService.Sounds`, …) never exist in the stage and
-- modules that index them at require time fail. Bundles serialised here fill that gap offline — no
-- Studio place required, which is what a fresh checkout has.
--
-- A bundle already on disk (for example one exported from a tester place by
-- `exportUiTemplates.luau`) wins: its children are merged in and only the missing ones are added.
--
-- Usage: lune run scripts/luau/scaffoldContainers.luau <project.json> <outDir>
local roblox = require("@lune/roblox")
local process = require("@lune/process")
local fs = require("@lune/fs")
local serde = require("@lune/serde")

local projectPath = process.args[1]
assert(
	type(projectPath) == "string" and fs.isFile(projectPath),
	"usage: scaffoldContainers.luau <project.json> <outDir>"
)
local outDir = process.args[2]
assert(type(outDir) == "string", "usage: scaffoldContainers.luau <project.json> <outDir>")

local project = serde.decode("json", fs.readFile(projectPath))
local tree = project.tree
assert(type(tree) == "table", `{projectPath} has no tree`)

-- Luau has no `string.startsWith`; Rojo marks its directives with a `$` prefix.
local function isDirective(key)
	return string.sub(key, 1, 1) == "$"
end

-- Trees that declare a `$path` are mounted by the staging step itself; only literal folders need
-- scaffolding.
local function isContainer(node)
	return type(node) == "table" and node["$className"] == "Folder" and node["$path"] == nil
end

-- A folder whose subtree carries `$path` mounts is a mount parent (`ReplicatedStorage.TS`): the
-- stage builds it to hold the mounts, so scaffolding an empty twin would shadow the real one.
local function containsMount(node)
	if type(node) ~= "table" then
		return false
	end
	if node["$path"] ~= nil then
		return true
	end
	for key, child in pairs(node) do
		if not isDirective(key) and containsMount(child) then
			return true
		end
	end
	return false
end

-- Builds the Folder subtree a Rojo node declares, returning a root with no parent.
local function buildContainer(name, node)
	local folder = roblox.Instance.new("Folder")
	folder.Name = name
	for childName, childNode in pairs(node) do
		if not isDirective(childName) and isContainer(childNode) and not containsMount(childNode) then
			local child = buildContainer(childName, childNode)
			child.Parent = folder
		end
	end
	return folder
end

local function findChild(parent, name)
	for _, child in parent:GetChildren() do
		if child.Name == name then
			return child
		end
	end
	return nil
end

-- Existing content wins; scaffolding only adds containers that are absent. `Models` exported from a
-- place therefore keeps its real children while a missing `Models.Items` still gets seeded.
local function mergeInto(target, template)
	for _, child in template:GetChildren() do
		local existing = findChild(target, child.Name)
		if existing == nil then
			child.Parent = target
		else
			mergeInto(existing, child)
		end
	end
end

fs.writeDir(outDir)

local written = 0
for serviceName, serviceNode in pairs(tree) do
	if isDirective(serviceName) or type(serviceNode) ~= "table" then
		continue
	end

	local containers = {}
	for childName, childNode in pairs(serviceNode) do
		if not isDirective(childName) and isContainer(childNode) and not containsMount(childNode) then
			table.insert(containers, { name = childName, node = childNode })
		end
	end
	if #containers == 0 then
		continue
	end

	table.sort(containers, function(a, b)
		return a.name < b.name
	end)

	local path = `{outDir}/{serviceName}.rbxm`
	local existingRoots = {}
	if fs.isFile(path) then
		existingRoots = roblox.deserializeModel(fs.readFile(path))
	end

	local roots = {}
	for _, root in existingRoots do
		table.insert(roots, root)
	end

	for _, container in containers do
		local template = buildContainer(container.name, container.node)
		local existing = nil
		for _, root in roots do
			if root.Name == container.name then
				existing = root
				break
			end
		end
		if existing == nil then
			table.insert(roots, template)
		else
			mergeInto(existing, template)
		end
	end

	fs.writeFile(path, roblox.serializeModel(roots))
	written += 1
	print(`  scaffolded {serviceName}.rbxm ({#roots} container(s)) -> {path}`)
end

if written == 0 then
	print(`  no container folders declared in {projectPath}; nothing scaffolded`)
end
