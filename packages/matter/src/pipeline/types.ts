import { SystemStruct } from "@rbxts/matter";

type TSystem = SystemStruct<any>

export type PipelineRuntime = "client" | "server" | "shared";

export interface TemplateSystem {
	key: string;
	runtime?: PipelineRuntime;
	system: TSystem;
}

export interface SystemTemplate {
	kind?: "template";
	name: string;
	systems: ReadonlyArray<TemplateSystem>;
	dependencies?: ReadonlyArray<string>;
	provides?: ReadonlyArray<string>;
}

export interface PipelineExtension {
	kind?: "extension";
	name: string;
	systems: ReadonlyArray<TemplateSystem>;
}

export interface PipelineBuilder {
	use(template: SystemTemplate | PipelineExtension): PipelineBuilder;
	override(systemKey: string, nextSystem: TSystem): PipelineBuilder;
	build(): Array<TSystem>;
}

export type PipelineRegistration = SystemTemplate | PipelineExtension;

export interface TemplateFamily<TFamily extends string = string> {
	name: TFamily;
	registrations: ReadonlyArray<PipelineRegistration>;
}

export interface TemplateFamilySelection<TFamily extends string = string> {
	include?: ReadonlyArray<TFamily>;
	exclude?: ReadonlyArray<TFamily>;
}
