interface StarterPlayer extends Instance {
	StarterCharacterScripts: StarterCharacterScripts & {
		Animate: LocalScript;
		Health: Script;
	};
	StarterPlayerScripts: StarterPlayerScripts & {
		PlayerModule: ModuleScript;
		RbxCharacterSounds: ModuleScript;
	};
}
