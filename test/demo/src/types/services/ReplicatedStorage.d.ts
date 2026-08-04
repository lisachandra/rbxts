interface ReplicatedStorage extends Instance {
	Animations: Folder;
	Models: Folder;
	Tools: Folder;
	TS: Folder & {
		client: Folder & {
			client: LocalScript;
			constants: ModuleScript;
			systems: Folder;
			ui: Folder & {
				app: ModuleScript;
				hud: Folder;
				notifications: Folder;
				overlays: Folder;
			};
		};
		rbxts_include: Folder & {
			node_modules: Folder;
		};
		shared: Folder & {
			assets: Folder;
			centurion: ModuleScript & {
				types: Folder;
			};
			matter: Folder & {
				components: ModuleScript;
				resources: ModuleScript;
				systems: Folder & {
					barrel: ModuleScript;
				};
			};
		};
	};
	UI: Folder;
	VFX: Folder;
}
