import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import React, { StrictMode } from "@rbxts/react";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { HotReloader } from "@rbxts/rewire";
import { Players, ReplicatedStorage, RunService } from "@rbxts/services";

const playerGui = Players.LocalPlayer.WaitForChild<PlayerGui>("PlayerGui");
const { client } = ReplicatedStorage.TS;

type App = typeof import("client/ui/app");

export const appHotReloader = new HotReloader();
export const appData = {
	appFirstRun: true,
	appRoot: createRoot(new Instance("Folder")),
};

/* Renders the app. */
export function renderApp(app: App): void {
	const appPortal = createPortal(<app.App key="App" />, playerGui);
	appData.appRoot.render(
		RunService.IsStudio() ? <StrictMode>{appPortal}</StrictMode> : appPortal,
	);
}

/* Loads and renders the app component, handling hot reloading. */
export function loadApp(module: ModuleScript): void {
	if (appData.appFirstRun && module.Name !== "app") {
		return;
	}

	const debugName = `${module.Parent}.${module.Name}`;
	let [success, app] = pcall(require, module) as LuaTuple<[true, App]>;

	if (!success) {
		throw new Error(
			Log.Error("Error when hot-reloading app: {DebugName} {App}", debugName, app),
		);
	}

	if (module.Name !== "app") {
		const newApp = client.ui.app.Clone();
		newApp.Parent = client.ui;

		app = require(newApp) as App;
	}

	renderApp(app);
}

/* Unmounts the current app root. */
export function unloadApp(): void {
	appData.appRoot.unmount();
	appData.appRoot = createRoot(new Instance("Folder"));
}

/* Starts the app and hot reloader. */
export function startAppHotReloader(): void {
	appHotReloader.scan(client.ui, loadApp, unloadApp);
	appData.appFirstRun = false;
}
