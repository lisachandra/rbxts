import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { registerTestHooks } from "../test-helpers.js";
import { diracProvider, scopeForMarkerPath } from "./dirac.js";

registerTestHooks();

describe("diracAgent", () => {
	test("buildPrintCommand appends -T <taskId> when resuming", () => {
		const agent = diracProvider("m", { effort: "high" });
		const resume = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
			resumeSession: "1792827434130",
		});
		assert.match(resume.command, / -T 1792827434130/);

		const fresh = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
		});
		assert.doesNotMatch(fresh.command, / -T /);
	});

	test("buildPrintCommand keeps effort and model flags on resume", () => {
		const agent = diracProvider("glm-5", { effort: "max" });
		const resume = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
			resumeSession: "t-1",
		});
		assert.match(resume.command, /--reasoning-effort max/);
		assert.match(resume.command, /-m "glm-5"/);
	});

	test("parseStreamLine maps task_started to a session_id event", () => {
		const agent = diracProvider("m");
		assert.deepEqual(
			agent.parseStreamLine(JSON.stringify({ type: "task_started", taskId: "t1" })),
			[{ type: "session_id", sessionId: "t1" }],
		);
		assert.deepEqual(agent.parseStreamLine("not-json"), []);
		assert.deepEqual(agent.parseStreamLine(JSON.stringify({ type: "task_started" })), []);
	});
});

describe("scopeForMarkerPath", () => {
	test("derives the scope from the marker path", () => {
		assert.equal(
			scopeForMarkerPath("C:/repo/.sandcastle/markers/425.design.completed"),
			"425.design",
		);
		assert.equal(scopeForMarkerPath("/repo/.sandcastle/markers/planner.completed"), "planner");
	});
});
