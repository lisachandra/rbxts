interface Workspace extends Model {
	Maps: Folder,
	Cars: Folder,
	Nodes: Folder,
	Caches: Model & {
		Sound: Folder
	},
}
