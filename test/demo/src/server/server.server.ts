/* eslint-disable import/first -- Halt execution if executed in tests */

const testInitiationTime = 1;
// Wait for TestService execution
task.wait(testInitiationTime);

if (_G.__TEST__ ?? false) {
	coroutine.yield();
}

import { setConfig } from "@rbxts/lapis";
import DataStoreServiceMock from "@rbxts/lapis-mockdatastore";
import { ReplicatedStorage, RunService, ServerScriptService } from "@rbxts/services";
import { configureConstant } from "@lisachandra/constant"
import * as constants from "./constants.json"

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

import { Centurion } from "@rbxts/centurion";

import * as sharedSystemsBarrel from "shared/matter/systems/barrel";
import * as serverSystemsBarrel from "./systems/barrel";
import { setupLogger } from "@lisachandra/core/out/logger";
import { bootstrap } from "@lisachandra/platform";
import { builtinPackage } from "@lisachandra/matter/out/systems";
import { configureRuntimeAdapters, getComponent } from "@lisachandra/matter";

const { shared } = ReplicatedStorage.TS;
const { server } = ServerScriptService.TS

import("server/document").expect()

configureRuntimeAdapters({
	playerLifecycle: {
		componentFactory: (player, janitor) => {
			return [
				getComponent("Profile")({ janitor, player }),
			]
		}
	},
	authorize: Promise.promisify((player) => player.UserId === 133370944)
})

setupLogger();
bootstrap({
	mode: _G.__PROD__ ? "production" : "development",
	packages: [builtinPackage],
	modules: {
		server: serverSystemsBarrel,
		shared: sharedSystemsBarrel,
	},
	hotReload: {
		containers: [server.systems, shared.matter.systems],
	},
});

import("@lisachandra/platform/out/centurion").expect()
import("shared/centurion").expect();
import("server/centurion").expect();

Centurion.server().start();
