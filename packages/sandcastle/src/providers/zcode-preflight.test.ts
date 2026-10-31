/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import {
	assertZcodeModelSelectable,
	buildZcodeModelCatalog,
	ZcodePreflightError,
} from "./zcode-preflight.js";

const tmpDirs: Array<string> = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sandcastle-zpreflight-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

function writeConfig(body: unknown): string {
	const path = join(tempDir(), "provider-config.json");
	writeFileSync(path, JSON.stringify(body), "utf-8");
	return path;
}

const PROVIDER_ID = "71fe3b98-87e8-4798-ac98-8985c12de697";

function configWithProviders(): unknown {
	return {
		config: {
			providerConfigRules: {
				providerRules: [
					{
						config: {
							personalModelIds: ["th/glm-5.3-flash", "th/deepseek-v4.1-flash"],
						},
						enabled: true,
						providerId: PROVIDER_ID,
						providerName: "CPAMC",
					},
					{
						config: {
							personalModelIds: ["dp/v4"],
						},
						enabled: false,
						providerId: "dead-provider-0000",
						providerName: "Disabled",
					},
				],
				templateRules: [
					{
						config: {
							builtinModelIds: ["GLM-5.3", "GLM-5.3-Flash"],
						},
						templateId: "zai-api",
					},
				],
			},
		},
		schemaVersion: 1,
	};
}

describe("zcode model/effort preflight", () => {
	test("accepts a registered model on an enabled provider", () => {
		assert.doesNotThrow(() => {
			assertZcodeModelSelectable(`${PROVIDER_ID}/th/glm-5.3-flash`, "high", [
				writeConfig(configWithProviders()),
			]);
		});
	});

	test("rejects an unregistered model id with the available list", () => {
		const paths = [writeConfig(configWithProviders())];
		assert.throws(
			() => assertZcodeModelSelectable(`${PROVIDER_ID}/th/nope`, "high", paths),
			(error: unknown) => {
				assert.ok(error instanceof ZcodePreflightError);
				assert.match(error.message, /th\/nope.*not registered/);
				assert.match(error.message, /th\/glm-5\.3-flash/);
				return true;
			},
		);
	});

	test("rejects a model on a disabled provider", () => {
		const paths = [writeConfig(configWithProviders())];
		assert.throws(
			() => assertZcodeModelSelectable("dead-provider-0000/dp/v4", "high", paths),
			(error: unknown) => {
				assert.ok(error instanceof ZcodePreflightError);
				assert.match(error.message, /disabled/);
				return true;
			},
		);
	});

	test("rejects a malformed model id before reading any config", () => {
		assert.throws(
			() =>
				assertZcodeModelSelectable("no-slash", "high", [
					writeConfig(configWithProviders()),
				]),
			ZcodePreflightError,
		);
	});

	test("rejects an effort zcode does not register", () => {
		const paths = [writeConfig(configWithProviders())];
		assert.throws(
			() => assertZcodeModelSelectable(`${PROVIDER_ID}/th/glm-5.3-flash`, "xhigh", paths),
			(error: unknown) => {
				assert.ok(error instanceof ZcodePreflightError);
				assert.match(error.message, /xhigh.*not one of/);
				return true;
			},
		);
	});

	test("skips the empty model (backend default applies)", () => {
		assert.doesNotThrow(() => {
			assertZcodeModelSelectable("", "high", [writeConfig(configWithProviders())]);
		});
	});

	test("skips when no config files exist", () => {
		assert.doesNotThrow(() => {
			assertZcodeModelSelectable("unknown-provider/whatever", "high", []);
		});
	});

	test("skips with a note when the provider id is unknown to the configs", () => {
		const paths = [writeConfig(configWithProviders())];
		assert.doesNotThrow(() => {
			assertZcodeModelSelectable("unknown-provider/whatever", "high", paths);
		});
	});

	test("skips when a config file is unparseable", () => {
		const broken = join(tempDir(), "broken.json");
		writeFileSync(broken, "{not json", "utf-8");
		assert.doesNotThrow(() => {
			assertZcodeModelSelectable("unknown-provider/whatever", "high", [broken]);
		});
	});

	test("builtin template models validate by model id", () => {
		const paths = [writeConfig(configWithProviders())];
		assert.doesNotThrow(() => {
			/*
			 * Template rules key their models by model id (no providerId), so the
			 * model-id half of the selection is checkable even though the CLI-side
			 * provider id ("zai") never appears in a config.
			 */
			assertZcodeModelSelectable("zai/GLM-5.3-Flash", "high", paths);
		});
		/*
		 * A template instance's provider id is unknowable from the configs, so an
		 * unknown provider + unregistered model stays on the conservative skip
		 * path (never block) rather than throwing.
		 */
		assert.doesNotThrow(() => {
			assertZcodeModelSelectable("zai/GLM-9.9", "high", paths);
		});
	});

	test("buildZcodeModelCatalog merges duplicate provider rules", () => {
		const paths = [
			writeConfig(configWithProviders()),
			writeConfig({
				config: {
					providerConfigRules: {
						providerRules: [
							{
								config: { personalModelIds: ["th/waze-27b"] },
								enabled: true,
								providerId: PROVIDER_ID,
							},
						],
					},
				},
			}),
		];
		const { enabled, models } = buildZcodeModelCatalog(paths);
		assert.equal(enabled.get(PROVIDER_ID), true);
		const ids = models.get(PROVIDER_ID);
		assert.ok(ids !== undefined);
		assert.ok(ids.has("th/glm-5.3-flash"));
		assert.ok(ids.has("th/waze-27b"));
	});
});
