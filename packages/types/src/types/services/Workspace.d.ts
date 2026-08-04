interface Workspace extends Model {
	Caches: Model & {
		Sound: Folder;
	};
	Characters: Folder;
	Items: Folder;
	Map: Folder;
	Nodes: Folder;
	NPCs: Folder;
}
