import type { SystemTemplate, TemplateSystem } from "../pipeline";

import type {
	ReplicationBuilder,
	ReplicationComponentBuilder,
	ReplicationComponentRegistration,
	RuntimeScope,
	ScopedSystemMap,
} from "./types";

function createEmptyScopedSystems<TSystem>(): ScopedSystemMap<TSystem> {
	return {
		client: [],
		server: [],
		shared: [],
	};
}

export function createReplicationBuilder<TSystem = unknown>(): ReplicationBuilder<TSystem> {
	const components = new Array<ReplicationComponentRegistration>();
	const systemsByScope = createEmptyScopedSystems<TSystem>();

	const registerSystem = (
		scope: RuntimeScope,
		component: string,
		key: string,
		system: TSystem,
	): void => {
		const scoped = systemsByScope[scope] ?? [];
		scoped.push({ key, system });
		systemsByScope[scope] = scoped;
	};

	const createComponentBuilder = (component: string): ReplicationComponentBuilder<TSystem> => {
		return {
			onClient(key: string, system: TSystem) {
				registerSystem("client", component, key, system);
				return builder;
			},
			onServer(key: string, system: TSystem) {
				registerSystem("server", component, key, system);
				return builder;
			},
			onShared(key: string, system: TSystem) {
				registerSystem("shared", component, key, system);
				return builder;
			},
		};
	};

	const builder: ReplicationBuilder<TSystem> = {
		addComponent(component, options) {
			const entry: ReplicationComponentRegistration = {
				component,
				mode: options?.mode ?? "all",
			};

			if (options?.notes !== undefined) {
				entry.notes = options.notes;
			}

			components.push(entry);
			return this;
		},

		addSystem(scope: RuntimeScope, component: string, key: string, system: TSystem) {
			registerSystem(scope, component, key, system);
			return this;
		},

		useComponent(component, options) {
			this.addComponent(component, options);
			return createComponentBuilder(component);
		},

		buildTemplates(name: string): Array<SystemTemplate<TSystem>> {
			const templates = new Array<SystemTemplate<TSystem>>();

			const make = (scope: RuntimeScope): void => {
				const systems = systemsByScope[scope] as Array<TemplateSystem<TSystem>>;
				if (!systems || systems.size() === 0) {
					return;
				}

				templates.push({
					name: `${name}.${scope}`,
					systems,
				});
			};

			make("shared");
			make("server");
			make("client");

			return templates;
		},

		getComponents() {
			return [...components];
		},
	};

	return builder;
}
