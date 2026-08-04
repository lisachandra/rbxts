import type { SystemStruct } from "@rbxts/matter";

type TSystem = SystemStruct<any>;

export type PipelineRuntime = "client" | "server" | "shared";

export interface TemplateSystem {
	key: string;
	runtime?: PipelineRuntime;
	system: TSystem;
}

export interface SystemTemplate {
	dependencies?: ReadonlyArray<string>;
	kind?: "template";
	name: string;
	provides?: ReadonlyArray<string>;
	systems: ReadonlyArray<TemplateSystem>;
}

export interface PipelineExtension {
	kind?: "extension";
	name: string;
	systems: ReadonlyArray<TemplateSystem>;
}

export interface PipelineBuilder {
	build(): Array<TSystem>;
	override(systemKey: string, nextSystem: TSystem): PipelineBuilder;
	use(template: SystemTemplate | PipelineExtension): PipelineBuilder;
}

export type PipelineRegistration = SystemTemplate | PipelineExtension;

export interface TemplateFamily<TFamily extends string = string> {
	name: TFamily;
	registrations: ReadonlyArray<PipelineRegistration>;
}

export interface TemplateFamilySelection<TFamily extends string = string> {
	exclude?: ReadonlyArray<TFamily>;
	include?: ReadonlyArray<TFamily>;
}
