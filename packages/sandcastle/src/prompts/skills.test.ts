/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { skillsForPrompt, uniqueSkills } from "./skills.js";

registerTestHooks();

describe("prompt skills", () => {
	test("uniqueSkills dedupes preserving order", () => {
		assert.deepEqual(uniqueSkills(["a", "b", "a"]), ["a", "b"]);
		assert.deepEqual(uniqueSkills([]), []);
	});

	test("skillsForPrompt includes label-specific skills and uniqueSkills dedupes", () => {
		const design = skillsForPrompt("design", ["ecs", "security", "ui"]);
		assert.match(design, /domain-modeling/);
		assert.match(design, /threat-model/);
		assert.match(design, /react-roblox-ui/);
		assert.equal(design.split("\n").length, new Set(design.split("\n")).size);
	});

	test("skillsForPrompt with no labels emits only defaults", () => {
		const implement = skillsForPrompt("implement");
		assert.match(implement, /tdd/);
		assert.doesNotMatch(implement, /ecs-design/);
	});
});
