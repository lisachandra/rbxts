export interface TemplateSystem<TSystem = unknown> {
	key: string;
	system: TSystem;
}

export interface SystemTemplate<TSystem = unknown> {
	name: string;
	systems: ReadonlyArray<TemplateSystem<TSystem>>;
	dependencies?: ReadonlyArray<string>;
	provides?: ReadonlyArray<string>;
}

export interface PipelineExtension<TSystem = unknown> {
	name: string;
	systems: ReadonlyArray<TemplateSystem<TSystem>>;
}

export interface PipelineBuilder<TSystem = unknown> {
	use(template: SystemTemplate<TSystem> | PipelineExtension<TSystem>): PipelineBuilder<TSystem>;
	override(systemKey: string, nextSystem: TSystem): PipelineBuilder<TSystem>;
	build(): Array<TSystem>;
}

export type PipelineRegistration<TSystem = unknown> = SystemTemplate<TSystem> | PipelineExtension<TSystem>;

export interface TemplateFamily<TFamily extends string = string, TSystem = unknown> {
	name: TFamily;
	registrations: ReadonlyArray<PipelineRegistration<TSystem>>;
}

export interface TemplateFamilySelection<TFamily extends string = string> {
	include?: ReadonlyArray<TFamily>;
	exclude?: ReadonlyArray<TFamily>;
}
