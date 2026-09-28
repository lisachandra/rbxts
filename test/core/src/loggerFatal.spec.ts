import { setupLogger } from "@lisachandra/core/logger";
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import Log, { Logger } from "@rbxts/log";
import type { ILogEventSink } from "@rbxts/log/Core";

_G.__TEST__ = true;

/**
 * A sink that records nothing and returns.
 *
 * @remarks
 *   Mimics a custom sink that handles `Fatal` without halting, which is the one case where
 *   `Log.Fatal` is still allowed to return.
 */
const returningSink: ILogEventSink = {
	Emit() {
		// Intentionally empty: this sink swallows the event and returns, so `Fatal` does not halt.
	},
};

const originalLogger = Log.Default();

describe("log.Fatal halting contract", () => {
	afterAll(() => {
		Log.SetLogger(originalLogger);
	});

	it("should halt when the logger has no sinks installed", () => {
		expect.assertions(1);

		/*
		 * Regression: the default logger ships with zero sinks, so an unwired process used to
		 * render + return and every `Log.Fatal` guard silently continued.
		 */
		Log.SetLogger(Logger.configure().Create());

		expect(() => Log.Fatal("boom")).toThrow("boom");
	});

	it("should halt through the configured sink", () => {
		expect.assertions(1);

		setupLogger();

		expect(() => Log.Fatal("boom")).toThrow("boom");
	});

	it("should return when a sink handles Fatal without halting", () => {
		expect.assertions(1);

		Log.SetLogger(Logger.configure().WriteTo(returningSink).Create());

		expect(() => Log.Fatal("boom")).never.toThrow();
	});
});
