interface ReplicatedStorage extends Instance {
	Models: Folder
	TS: Folder & {
		client: Folder & {
			ui: Folder & {
				app: ModuleScript;
				notifications: Folder;
				hud: Folder;
				overlays: Folder;
			};
			client: LocalScript;
			systems: Folder
			constants: ModuleScript;
		};
		shared: Folder & {
			assets: Folder;
			centurion: ModuleScript & {
				types: Folder;
			};
			matter: Folder & {
				resources: ModuleScript;
				components: ModuleScript;
				systems: Folder & {
					barrel: ModuleScript;
				};
			};
		};
		rbxts_include: Folder & {
			node_modules: Folder
		};
	};
	UI: Folder;
	Tools: Folder;
	VFX: Folder;
	Animations: Folder;
}
