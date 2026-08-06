/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { packageRoot } from "./runtime.js";

const wrapperPath = join(packageRoot, "assets", "agent-wrapper.sh").replaceAll("\\", "/");

function runWrapper(marker: string | undefined, input = "prompt"): string {
	const env = {
		...process.env,
		...(marker !== undefined
			? { SANDCASTLE_MARKER_COMPLETED: marker.replaceAll("\\", "/") }
			: {}),
	};
	return execFileSync("bash", [wrapperPath, "--stdin", "--", "printf hello"], {
		encoding: "utf-8",
		env,
		input,
	});
}

describe("agent-wrapper.sh", () => {
	test("prints the marker protocol line when the marker exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "sandcastle-wrapper-present-"));
		const marker = join(dir, "completed");
		writeFileSync(marker, "", "utf-8");

		try {
			const stdout = runWrapper(marker);
			assert.match(stdout, /hello/);
			assert.match(stdout, /\{"sandcastleMarker":"completed"\}/);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("exits 1 with a clear error when the marker is missing", () => {
		assert.throws(
			() => runWrapper(undefined),
			(err: unknown) => {
				const error = err as { status?: number; stderr?: Buffer | string };
				const stderr = error.stderr?.toString() ?? "";
				return error.status === 1 && /completion marker not found/.test(stderr);
			},
		);
	});
});
