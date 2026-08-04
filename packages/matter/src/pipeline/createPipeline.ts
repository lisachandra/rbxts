import type { SystemStruct } from "@rbxts/matter";
import { RunService } from "@rbxts/services";

import type { PipelineBuilder, PipelineExtension, SystemTemplate, TemplateSystem } from "./types";

type TSystem = SystemStruct<any>;

function isPipelineExtension(
	registration: SystemTemplate | PipelineExtension,
): registration is PipelineExtension {
	return registration.kind === "extension";
}

function ensureUniqueKeys(systems: ReadonlyArray<TemplateSystem>, owner: string): void {
	const seen = new Set<string>();
	for (const { key } of systems) {
		if (seen.has(key)) {
			error(`Duplicate system key '${key}' in '${owner}'`);
		}

		seen.add(key);
	}
}

function runtimeMatches(runtime?: TemplateSystem["runtime"]): boolean {
	return runtime === undefined || runtime === "shared"
		? true
		: runtime === "client"
			? RunService.IsClient()
			: RunService.IsServer();
}

export function createPipeline(): PipelineBuilder {
	const templates = new Map<string, SystemTemplate>();
	const extensions = new Array<PipelineExtension>();
	const overrides = new Map<string, TSystem>();

	const resolveTemplateOrder = (): Array<SystemTemplate> => {
		const resolved = new Array<SystemTemplate>();
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
			if (isPipelineExtension(templateOrExtension)) {
				const extension = templateOrExtension;
				ensureUniqueKeys(extension.systems, extension.name);
				extensions.push(extension);
				return this;
			}

			const template = templateOrExtension;
			if (templates.has(template.name)) {
				error(`Template '${template.name}' is already registered`);
			}

			ensureUniqueKeys(template.systems, template.name);
			templates.set(template.name, template);
			return this;
		},

		override(systemKey, nextSystem) {
			overrides.set(systemKey, nextSystem);
			return this;
		},

		build() {
			const ordered = resolveTemplateOrder();
			const allSystems = new Array<TemplateSystem>();

			for (const template of ordered) {
				for (const entry of template.systems) {
					if (!runtimeMatches(entry.runtime)) {
						continue;
					}

					allSystems.push({
						key: entry.key,
						runtime: entry.runtime,
						system: overrides.get(entry.key) ?? entry.system,
					});
				}
			}

			for (const extension of extensions) {
				for (const entry of extension.systems) {
					if (!runtimeMatches(entry.runtime)) {
						continue;
					}

					allSystems.push({
						key: entry.key,
						runtime: entry.runtime,
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
