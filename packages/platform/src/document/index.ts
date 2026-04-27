import { setConfig } from "@rbxts/lapis";
import DataStoreServiceMock from "@rbxts/lapis-mockdatastore";

if (_G.__TEST__ ?? false) {
	setConfig({
		dataStoreService: new DataStoreServiceMock(),
		loadAttempts: 1,
		loadRetryDelay: 0,
		saveAttempts: 1,
	});
}

export * from "./validate";
