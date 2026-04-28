import type { PipelineBuilder, PipelineExtension, SystemTemplate, TemplateSystem, } from "./types";

function ensureUniqueKeys<TSystem>(systems: ReadonlyArray<TemplateSystem<TSystem>>, owner: string): void {
	const seen = new Set<string>();
	for (const { key } of systems) {
		if (seen.has(key)) {
			error(`Duplicate system key '${key}' in '${owner}'`);
		}

		seen.add(key);
	}
}

export function createPipeline<TSystem>(): PipelineBuilder<TSystem> {
	const templates = new Map<string, SystemTemplate<TSystem>>();
	const extensions = new Array<PipelineExtension<TSystem>>();
	const overrides = new Map<string, TSystem>();

	const resolveTemplateOrder = (): Array<SystemTemplate<TSystem>> => {
		const resolved = new Array<SystemTemplate<TSystem>>();
		const visiting = new Set<string>();
		const visited = new Set<string>();

		const visit = (name: string): void => {
			if (visited.has(name)) {
				return;
			}

			if (visiting.has(name)) {
				error(`Cyclic template dependency detected at '${name}'`);
			}

			const template = templates.get(name);
			if (!template) {
				error(`Missing template dependency '${name}'`);
			}

			visiting.add(name);
			for (const dependency of template.dependencies ?? []) {
				visit(dependency);
			}

			visiting.delete(name);
			visited.add(name);
			resolved.push(template);
		};

		for (const [name] of templates) {
			visit(name);
		}

		return resolved;
	};

	return {
		use(templateOrExtension) {
			if ("dependencies" in templateOrExtension || "provides" in templateOrExtension) {
				const template = templateOrExtension as SystemTemplate<TSystem>;
				if (templates.has(template.name)) {
					error(`Template '${template.name}' is already registered`);
				}

				ensureUniqueKeys(template.systems, template.name);
				templates.set(template.name, template);
				return this;
			}

			const extension = templateOrExtension as PipelineExtension<TSystem>;
			ensureUniqueKeys(extension.systems, extension.name);
			extensions.push(extension);
			return this;
		},

		override(systemKey, nextSystem) {
			overrides.set(systemKey, nextSystem);
			return this;
		},

		build() {
			const ordered = resolveTemplateOrder();
			const allSystems = new Array<TemplateSystem<TSystem>>();

			for (const template of ordered) {
				for (const entry of template.systems) {
					allSystems.push({
						key: entry.key,
						system: overrides.get(entry.key) ?? entry.system,
					});
				}
			}

			for (const extension of extensions) {
				for (const entry of extension.systems) {
					allSystems.push({
						key: entry.key,
						system: overrides.get(entry.key) ?? entry.system,
					});
				}
			}

			const definedKeys = new Set<string>(allSystems.map((entry) => entry.key));
			for (const [key] of overrides) {
				if (!definedKeys.has(key)) {
					error(`Override key '${key}' does not match any registered system`);
				}
			}

			return allSystems.map((entry) => entry.system);
		},
	};
}
