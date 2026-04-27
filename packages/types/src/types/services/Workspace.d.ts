interface Workspace extends Model {
	Map: Folder
	Characters: Folder,
	NPCs: Folder,
	Items: Folder,
	Nodes: Folder,
	Caches: Model & {
		Sound: Folder
	},
}
