import { configureDocumentAccessor } from "@lisachandra/core/utils/main";
import { DocumentCommand } from "@lisachandra/platform/centurion/commands/document";
import { createTestStore } from "@lisachandra/platform/document";
import type { CommandContext } from "@rbxts/centurion";
import { CommandContext as CenturionContext, RegistryPath } from "@rbxts/centurion";
import type dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";

interface TestData {
	credits: number;
	items: Array<string>;
}

const USER_ID = 133370944;

/** A minimal mock Player executor for the command context. */
function createMockPlayer(): Player {
	return {
		GetRoleInGroup: () => "Developer",
		Name: "Dirac",
		UserId: USER_ID,
	} as unknown as Player;
}

/**
 * Yields to the real scheduler and steps the dataforge virtual scheduler so deferred work (load,
 * unload) can complete.
 */
async function advance(scheduler: dataforge.VirtualScheduler): Promise<void> {
	scheduler.step(0.1);
	await Promise.delay(1);
}

describe("document command", () => {
	it("should execute document command reading data via get_data() and unloading", async () => {
		expect.assertions(3);

		const { scheduler, store } = createTestStore<TestData>({
			name: "PlayerData",
			template: { credits: 0, items: [] },
		});
		const profile = store.load(`Player_${USER_ID}`, [USER_ID]);

		configureDocumentAccessor(() => ({
			document: profile as unknown as import("@rbxts/dataforge").Profile<
				import("@lisachandra/core/store").CollectionData
			>,
		}));

		const command = new DocumentCommand();
		const context = new CenturionContext(
			createMockPlayer(),
			RegistryPath.fromString("document"),
			["133370944"],
			"document 133370944",
		) as unknown as CommandContext;

		command.document(context, USER_ID);

		// Wait for the waitForDocument promise chain to resolve and reply.
		for (let i = 0; i < 100 && !context.isReplyReceived(); i++) {
			await advance(scheduler);
		}

		expect(context.isReplyReceived()).toBe(true);
		expect(context.getReply()?.text).toContain("credits");

		// The player is not in the server, so the document is unloaded asynchronously.
		for (let i = 0; i < 100 && profile.open; i++) {
			await advance(scheduler);
		}

		expect(profile.open).toBe(false);
	});
});
