interface ServerScriptService extends Instance {
	TS: Folder & {
		server: Folder & {
			centurion: ModuleScript & {
				commands: Folder;
			};
			constants: ModuleScript;
			server: Script;
			systems: Folder;
		};
	};
}
