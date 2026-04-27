import React, { StrictMode } from "@rbxts/react";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { HotReloader } from "@rbxts/rewire";

interface AppModule {
	App: () => React.ReactNode;
}

interface CreateAppHotReloaderOptions {
	/** UI parent instance for rendering (e.g. PlayerGui). */
	target: Instance;

	/** Module container to scan for updates. */
	moduleRoot: Instance;

	/** Entry module name to load on first run. */
	entryModuleName?: string;

	/**
	 * Optional callback used when a non-entry module reloads and the consumer
	 * wants to re-require a fresh app entry module.
	 */
	resolveEntryModule?: () => ModuleScript | undefined;

	/** Wrap rendered output in StrictMode. */
	strictMode?: boolean;
}

interface AppHotReloaderAdapter {
	hotReloader: HotReloader;
	load: (module: ModuleScript) => void;
	render: (app: AppModule) => void;
	start: () => void;
	unload: () => void;
}

/**
 * Creates a reusable app hot-reload adapter for React Roblox UIs.
 */
export function createAppHotReloader({
	entryModuleName = "app",
	moduleRoot,
	resolveEntryModule,
	strictMode = true,
	target,
}: Readonly<CreateAppHotReloaderOptions>): AppHotReloaderAdapter {
	const hotReloader = new HotReloader();

	const state = {
		firstRun: true,
		root: createRoot(new Instance("Folder")),
	};

	const render = (app: AppModule): void => {
		const appPortal = createPortal(<app.App key="App" />, target);
		state.root.render(strictMode ? <StrictMode>{appPortal}</StrictMode> : appPortal);
	};

	const load = (module: ModuleScript): void => {
		if (state.firstRun && module.Name !== entryModuleName) {
			return;
		}

		const [success, loaded] = pcall(require, module) as LuaTuple<[boolean, unknown]>;
		if (!success) {
			error(`Error when hot-reloading module '${module.GetFullName()}'`);
		}

		let app = loaded as AppModule;

		if (module.Name !== entryModuleName && resolveEntryModule !== undefined) {
			const entryModule = resolveEntryModule();
			if (entryModule) {
				app = require(entryModule) as AppModule;
			}
		}

		render(app);
	};

	const unload = (): void => {
		state.root.unmount();
		state.root = createRoot(new Instance("Folder"));
	};

	const start = (): void => {
		hotReloader.scan(moduleRoot, load, unload);
		state.firstRun = false;
	};

	return {
		hotReloader,
		load,
		render,
		start,
		unload,
	};
}
