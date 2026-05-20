import ReactGlobals from "@rbxts/react-globals";
import { backend } from "@rbxts/react-devtools-core";
import { Players, ReplicatedStorage, RunService, SoundService, StarterGui, UserInputService } from "@rbxts/services";
import { configureConstant } from "@lisachandra/constant"
import { setupLogger } from "@lisachandra/core/out/logger"
import * as constants from "./constants.json"

const reactMicroProfilerLevel = 10;

// Set global variables for development.
ReactGlobals.__PROFILE__ = RunService.IsStudio();
ReactGlobals.__EXPERIMENTAL__ = RunService.IsStudio();
ReactGlobals.__DEV__ = RunService.IsStudio();
ReactGlobals.__COMPAT_WARNINGS__ = RunService.IsStudio();
_G.__DEV__ = RunService.IsStudio();
_G.__REACT_MICROPROFILER_LEVEL = RunService.IsStudio() ? reactMicroProfilerLevel : undefined;

if (_G.__DEV__) {
	backend.connectToDevtools();
}

configureConstant("src/client/constants.json", constants, { keyCode: Enum.KeyCode.F8, title: "Constants" });
setupLogger();

import { Centurion } from "@rbxts/centurion";
import { CenturionUI } from "@rbxts/centurion-ui";
import Log from "@rbxts/log";
import { bootstrap } from "@lisachandra/platform"
import { createAppHotReloader } from "@lisachandra/ui";

import { catcher } from "@lisachandra/core/out/utils/main";

import * as sharedSystemsBarrel from "shared/matter/systems/barrel";
import * as clientSystemsBarrel from "./systems/barrel";
import { builtinPackage } from "@lisachandra/matter/out/systems";
import { Message, messaging } from "@lisachandra/matter";

for (const coreGui of [
	Enum.CoreGuiType.Chat,
	Enum.CoreGuiType.Health,
	Enum.CoreGuiType.Backpack,
	Enum.CoreGuiType.Captures,
	Enum.CoreGuiType.SelfView,
	Enum.CoreGuiType.EmotesMenu,
	Enum.CoreGuiType.PlayerList,
]) {
	StarterGui.SetCoreGuiEnabled(coreGui, false)
}

// Wait for necessary folders to be loaded in ReplicatedStorage
for (const name of ["Animations", "UI", "VFX", "Models"]) {
	ReplicatedStorage.WaitForChild(name);
}

// Wait for necessary folders to be loaded in SoundService
for (const name of ["Sounds"]) {
	SoundService.WaitForChild(name);
}

// Wait for the server to assign a server entity ID to the player
while (Players.LocalPlayer.GetAttribute("serverEntityId") === undefined) {
	task.wait(1);
}

const heartbeat = task.spawn(() => {
	// Send Loaded packets to the server until the client is fully loaded
	while (true) {
		messaging.server.emit(Message.Loaded);
		task.wait(1);
	}
});

const { client, shared } = ReplicatedStorage.TS;
const { start: startUi } = createAppHotReloader({
	target: Players.LocalPlayer.WaitForChild<PlayerGui>("PlayerGui"),
	moduleRoot: client.ui,
	entryModuleName: "app",
	resolveEntryModule: () => client.ui.app,
	strictMode: true,
});

const { debugger: worldDebugger } = bootstrap({
	mode: _G.__PROD__ ? "production" : "development",
	packages: [builtinPackage],
	modules: {
		client: clientSystemsBarrel,
		shared: sharedSystemsBarrel,
	},
	hotReload: {
		containers: [client.systems, shared.matter.systems],
	},
});

UserInputService.InputBegan.Connect((input) => {
	if (input.KeyCode === Enum.KeyCode.F4) {
		worldDebugger.toggle();
	}
})

// Wait for the client to assign a client entity ID to the player
while (Players.LocalPlayer.GetAttribute("clientEntityId") === undefined) {
	task.wait(1);
}

task.cancel(heartbeat)

startUi();
import("@lisachandra/platform/out/centurion").expect()
import("shared/centurion").expect();

// Start centurion
Centurion.client()
	.start()
	.then(() => {
		CenturionUI.start(Centurion.client(), { activationKeys: [Enum.KeyCode.F2] });
	})
	.catch(catcher);

Log.Info(`PlaceId: ${game.PlaceId}`);
Log.Info(`PlaceVersion: ${game.PlaceVersion}`);
