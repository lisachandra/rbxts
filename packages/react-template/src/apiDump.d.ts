// TODO: Generate periodically with flamework
export declare const ApiDump: {
	Classes: Array<
		{
			[K in keyof CreatableInstances]: {
				Members: Array<keyof WritableInstanceProperties<CreatableInstances[K]>>;
				Name: K;
			};
		}[keyof CreatableInstances]
	>;
};
