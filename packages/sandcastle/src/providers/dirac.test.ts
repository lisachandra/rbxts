import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { registerTestHooks } from "../test-helpers.js";
import { diracProvider, scopeForMarkerPath } from "./dirac.js";

/**
 * Splits a command into words, stripping the seam’s single quotes.
 *
 * Assertions decode rather than match the formatted string: what matters is the argv the wrapper
 * receives, not the quoting the seam happens to emit.
 */
function words(command: string): Array<string> {
	return command.split(" ").map((word) => word.replaceAll(/^'|'$/g, ""));
}

registerTestHooks();

describe("diracAgent", () => {
	test("buildPrintCommand appends -T <taskId> when resuming", () => {
		const agent = diracProvider("m", { effort: "high" });
		const resume = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
			resumeSession: "1792827434130",
		});
		const argv = words(resume.command);
		const resumeIndex = argv.indexOf("-T");

		// `-T` takes the captured id as its own argument, and the id is not re-parsed.
		assert.notEqual(resumeIndex, -1, `no -T in ${JSON.stringify(argv)}`);
		assert.equal(argv[resumeIndex + 1], "1792827434130");
		assert.ok(argv.includes("--reasoning-effort"));

		const fresh = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
		});
		assert.ok(!words(fresh.command).includes("-T"));
	});

	test("buildPrintCommand keeps effort and model flags on resume", () => {
		const agent = diracProvider("glm-5", { effort: "max" });
		const resume = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
			resumeSession: "t-1",
		});
		assert.deepEqual(words(resume.command).slice(-2), ["-m", "glm-5"]);
		assert.match(resume.command, /'--reasoning-effort' 'max'/);
	});

	test("buildPrintCommand keeps a hostile session id inside its own argument", () => {
		const agent = diracProvider("m");
		const resume = agent.buildPrintCommand({
			dangerouslySkipPermissions: true,
			prompt: "hi",
			resumeSession: "x; echo pwned",
		});

		// The metacharacters are quoted, so `-T` still receives exactly one argument.
		assert.match(resume.command, /'-T' 'x; echo pwned'/);
	});

	/*
	 * The provider base URL used to be concatenated into one shell string, where `-p ${provider}`
	 * with `provider = "-p <url>"` still produced a single `-p`. Building argv instead turns that
	 * into two arguments — `"-p"`, `"-p <url>"` — and dirac receives its own flag as the value.
	 * The flag must appear exactly once, with the URL as its own argument.
	 */
	test("buildPrintCommand passes the provider base URL once, as its own argument", () => {
		const agent = diracProvider("m", {
			env: { OPENAI_API_BASE: "https://router.bynara.id/v1" },
		});
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "hi",
		});
		const argv = words(command.command);

		const providerFlags = argv.filter((word) => word === "-p");
		assert.equal(providerFlags.length, 1, `expected one -p, saw ${JSON.stringify(argv)}`);

		const index = argv.indexOf("-p");
		assert.equal(argv[index + 1], "https://router.bynara.id/v1");
	});

	test("buildPrintCommand omits the provider flag when no base URL is configured", () => {
		const agent = diracProvider("m", { env: {} });
		const command = agent.buildPrintCommand({
			dangerouslySkipPermissions: false,
			prompt: "hi",
		});

		assert.ok(!words(command.command).includes("-p"));
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
