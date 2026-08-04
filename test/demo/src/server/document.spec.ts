import { describe, expect, it } from "@rbxts/jest-globals";

import { gardenDocumentDefaults } from "server/document";

describe("garden document defaults", () => {
	it("should contain garden stats and settings", () => {
		expect.assertions(4);
		expect(gardenDocumentDefaults.stats.totalHarvested).toBe(0);
		expect(gardenDocumentDefaults.stats.totalCleared).toBe(0);
		expect(gardenDocumentDefaults.settings.showWorldMarkers).toBe(true);
		expect(gardenDocumentDefaults.settings.showNotifications).toBe(true);
	});
});
