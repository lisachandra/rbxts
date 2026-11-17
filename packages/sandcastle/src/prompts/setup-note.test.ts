import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { setupNoteFor } from "./setup-note.js";

describe("setup note", () => {
	test("should render an empty string when setup passed", () => {
		/*
		 * The prompt files interpolate `{{SETUP_NOTE}}` verbatim, so the empty case must still be a
		 * string — an absent key leaves a literal placeholder in the agent's instructions.
		 */
		assert.equal(setupNoteFor(undefined), "");
		assert.equal(setupNoteFor(""), "");
	});

	test("should name the failure and forbid repairing the environment", () => {
		const note = setupNoteFor("Command failed: pnpm run setup | log: .sandcastle/logs/x.log");

		assert.match(note, /setup commands FAILED/u);
		assert.match(note, /Command failed: pnpm run setup/u);
		assert.match(note, /Do not spend the phase repairing the environment/u);
	});
});
