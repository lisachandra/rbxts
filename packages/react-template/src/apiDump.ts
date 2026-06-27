import { Modding } from "@flamework/core"
export const ApiDump = Modding.inspect<{
	Classes: Array<
		{
			[K in keyof CreatableInstances]: {
				Members: Array<keyof WritableInstanceProperties<CreatableInstances[K]>>;
				Name: K;
			};
		}[keyof CreatableInstances]
	>;
}>();
