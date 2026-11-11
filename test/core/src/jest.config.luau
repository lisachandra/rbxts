return {
	testMatch = { "**/*.spec" },
	testPathIgnorePatterns = { "/node_modules/", "/dist/", "/out/" },
	mockDataModel = false,
	clearMocks = true,
	setupFiles = { "ReplicatedStorage/TS/rbxts_include/node_modules/@lisachandra/test/setup" },
	testTimeout = 300000,
	displayName = "core",
}
