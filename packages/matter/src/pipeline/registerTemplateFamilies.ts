import type {
	PipelineBuilder,
	PipelineRegistration,
	TemplateFamily,
	TemplateFamilySelection,
} from "./types";

export interface TemplateFamilyOverride<TSystem = unknown> {
	key: string;
	system: TSystem;
}

export interface RegisterTemplateFamiliesOptions<TFamily extends string = string, TSystem = unknown>
	extends TemplateFamilySelection<TFamily> {
	extensions?: ReadonlyArray<PipelineRegistration<TSystem>>;
	overrides?: ReadonlyArray<TemplateFamilyOverride<TSystem>>;
}

function shouldIncludeFamily<TFamily extends string>(
	familyName: TFamily,
	selection: TemplateFamilySelection<TFamily>,
): boolean {
	if (selection.include !== undefined && !selection.include.includes(familyName)) {
		return false;
	}

	if (selection.exclude !== undefined && selection.exclude.includes(familyName)) {
		return false;
	}

	return true;
}

export function defineTemplateFamily<TFamily extends string, TSystem>(
	name: TFamily,
	registrations: ReadonlyArray<PipelineRegistration<TSystem>>,
): TemplateFamily<TFamily, TSystem> {
	return {
		name,
		registrations,
	};
}

export function registerTemplateFamilies<TFamily extends string, TSystem>(
	builder: PipelineBuilder<TSystem>,
	families: ReadonlyArray<TemplateFamily<TFamily, TSystem>>,
	options: RegisterTemplateFamiliesOptions<TFamily, TSystem> = {},
): PipelineBuilder<TSystem> {
	for (const family of families) {
		if (!shouldIncludeFamily(family.name, options)) {
			continue;
		}

		for (const registration of family.registrations) {
			builder.use(registration);
		}
	}

	for (const extension of options.extensions ?? []) {
		builder.use(extension);
	}

	for (const override of options.overrides ?? []) {
		builder.override(override.key, override.system);
	}

	return builder;
}
