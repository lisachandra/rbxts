/* eslint-disable import/first -- Halt execution if executed in tests */

const testInitiationTime = 1;
// Wait for TestService execution
task.wait(testInitiationTime);

if (_G.__TEST__ ?? false) {
	coroutine.yield();
}

import { configureConstant } from "@lisachandra/constant";
import { setConfig } from "@rbxts/lapis";
import DataStoreServiceMock from "@rbxts/lapis-mockdatastore";
import { ReplicatedStorage, RunService, ServerScriptService } from "@rbxts/services";

import * as constants from "./constants.json";

// Set data store service mock when running in studio before other imports
if (RunService.IsStudio()) {
	setConfig({ dataStoreService: new DataStoreServiceMock() });
}

configureConstant("src/server/constants.json", constants);

// Set global variables for development.
_G.__PROFILE__ = RunService.IsStudio();
_G.__EXPERIMENTAL__ = RunService.IsStudio();
_G.__DEV__ = RunService.IsStudio();
_G.__COMPAT_WARNINGS__ = RunService.IsStudio();

import { setupLogger } from "@lisachandra/core/logger";
import { configureRuntimeAdapters } from "@lisachandra/matter";
import { builtinPackage } from "@lisachandra/matter/systems";
import { bootstrap, configureCenturionUsers } from "@lisachandra/platform";
import { Centurion } from "@rbxts/centurion";
import Log from "@rbxts/log";

import * as sharedSystemsBarrel from "shared/matter/systems/barrel";

import * as serverSystemsBarrel from "./systems/barrel";

const { shared } = ReplicatedStorage.TS;
const { server } = ServerScriptService.TS;

import("server/document").expect();

configureRuntimeAdapters({
	authorize: Promise.promisify((player) => player.UserId === 133370944),
});

configureCenturionUsers([133370944]);

setupLogger();
bootstrap({
	hotReload: {
		containers: [server.systems, shared.matter.systems],
	},
	mode: _G.__PROD__ ? "production" : "development",
	modules: {
		server: serverSystemsBarrel,
		shared: sharedSystemsBarrel,
	},
	packages: [builtinPackage],
});

import("@lisachandra/platform/centurion").expect();
import("shared/centurion").expect();
import("server/centurion").expect();

Centurion.server().start();

Log.Info("Server started: @{info}", { PlaceId: game.PlaceId, PlaceVersion: game.PlaceVersion });
