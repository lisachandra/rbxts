import type { CollectionData } from "@lisachandra/core/store";
import { configureDocumentAccessor, waitForDocument } from "@lisachandra/core/utils/main";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";

interface TestData {
	credits: number;
}

describe("waitForDocument", () => {
	it("should return the loaded profile when the configured accessor provides it", async () => {
		expect.assertions(1);

		const scheduler = dataforge.schedulers.virtual.create();
		const hook = dataforge.hooks.memory.create(scheduler);
		const dfStore = dataforge.create_store({
			_hook: hook,
			_scheduler: scheduler,
			name: "WaitStore",
			template: { credits: 0 },
		} as never) as dataforge.Store<TestData>;
		const profile = dfStore
			.load("Player_42", [42])
			.unwrap() as unknown as import("@rbxts/dataforge").Profile<CollectionData>;

		configureDocumentAccessor(() => ({ document: profile }));

		const result = await waitForDocument(42);

		expect(result).toBe(profile);

		profile.unload();
	});
});
