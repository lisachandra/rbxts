interface Workspace extends Model {
	Caches: Model & {
		Sound: Folder;
	};
	Cars: Folder;
	Maps: Folder;
	Nodes: Folder;
}
