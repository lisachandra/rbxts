import { describe, expect, it } from "@rbxts/jest-globals";

import { gardenDocumentDefaults, gardenStore } from "server/document";

describe("garden document defaults", () => {
	it("should contain garden stats and settings", () => {
		expect.assertions(4);
		expect(gardenDocumentDefaults.stats.totalHarvested).toBe(0);
		expect(gardenDocumentDefaults.stats.totalCleared).toBe(0);
		expect(gardenDocumentDefaults.settings.showWorldMarkers).toBe(true);
		expect(gardenDocumentDefaults.settings.showNotifications).toBe(true);
	});
});

describe("garden document store", () => {
	it("should initialize garden document store with dataforge", () => {
		expect.assertions(2);

		expect(gardenStore.config.name).toBe("PlayerData");
		expect(gardenStore.config.template).toEqual(gardenDocumentDefaults);
	});

	it("should load a player profile with the defaults as template", () => {
		expect.assertions(1);

		const profile = gardenStore.load("Player_133370944", [133370944]);

		expect(profile.get_data()).toEqual(gardenDocumentDefaults);

		profile.unload();
	});
});
