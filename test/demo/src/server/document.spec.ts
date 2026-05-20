import { describe, expect, it } from "@rbxts/jest-globals";
import { gardenDocumentDefaults } from "server/document";

describe("garden document defaults", () => {
	it("contains garden stats and settings", () => {
		expect(gardenDocumentDefaults.stats.totalHarvested).toBe(0);
		expect(gardenDocumentDefaults.stats.totalCleared).toBe(0);
		expect(gardenDocumentDefaults.settings.showWorldMarkers).toBe(true);
		expect(gardenDocumentDefaults.settings.showNotifications).toBe(true);
	});
});
