interface ServerScriptService extends Instance {
	TS: Folder & {
		server: Folder & {
			systems: Folder
			server: Script;
			centurion: ModuleScript & {
				commands: Folder;
			};
			constants: ModuleScript;
		};
	};
}
