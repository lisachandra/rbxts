import type { SystemTemplate, TemplateSystem } from "../pipeline";

export type RuntimeScope = "client" | "server" | "shared";

export interface ReplicationComponentRegistration {
	component: string;
	mode?: "all" | "owner" | "spectator";
	notes?: string;
}

export interface ReplicationComponentBuilder<TSystem = unknown> {
	onClient(key: string, system: TSystem): ReplicationBuilder<TSystem>;
	onServer(key: string, system: TSystem): ReplicationBuilder<TSystem>;
	onShared(key: string, system: TSystem): ReplicationBuilder<TSystem>;
}

export interface ReplicationBuilder<TSystem = unknown> {
	addComponent(component: string, options?: Omit<ReplicationComponentRegistration, "component">): this;
	addSystem(scope: RuntimeScope, component: string, key: string, system: TSystem): this;
	useComponent(
		component: string,
		options?: Omit<ReplicationComponentRegistration, "component">,
	): ReplicationComponentBuilder<TSystem>;
	buildTemplates(name: string): Array<SystemTemplate<TSystem>>;
	getComponents(): Array<ReplicationComponentRegistration>;
}

export type ScopedSystemMap<TSystem> = Partial<
	Record<RuntimeScope, Array<TemplateSystem<TSystem>>>
>;
