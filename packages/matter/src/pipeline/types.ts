import { SystemStruct } from "@rbxts/matter";

type TSystem = SystemStruct<any>

export interface TemplateSystem {
	key: string;
	system: TSystem;
}

export interface SystemTemplate {
	name: string;
	systems: ReadonlyArray<TemplateSystem>;
	dependencies?: ReadonlyArray<string>;
	provides?: ReadonlyArray<string>;
}

export interface PipelineExtension {
	name: string;
	systems: ReadonlyArray<TemplateSystem>;
}

export interface PipelineBuilder {
	use(template: SystemTemplate | PipelineExtension): PipelineBuilder;
	override(systemKey: string, nextSystem: TSystem): PipelineBuilder;
	build(): Array<TSystem>;
}

export type PipelineRegistration = SystemTemplate | PipelineExtension;

export interface TemplateFamily<TFamily extends string = string, TSystem = unknown> {
	name: TFamily;
	registrations: ReadonlyArray<PipelineRegistration>;
}

export interface TemplateFamilySelection<TFamily extends string = string> {
	include?: ReadonlyArray<TFamily>;
	exclude?: ReadonlyArray<TFamily>;
}
