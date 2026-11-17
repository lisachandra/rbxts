import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { assertWithin, within } from "./containment.js";
import { registerTestHooks } from "./test-helpers.js";

registerTestHooks();

/*
 * Paths are written as POSIX strings and resolved by `path.resolve`, so on Windows they become
 * `C:\a\b`. The property under test is relative shape, not drive names, so every case is expressed as
 * a pair and the platform's own resolution decides — the exceptions are the Windows case-fold pair,
 * which is skipped elsewhere.
 */
const isWindows = process.platform === "win32";

describe("within", () => {
	test("a candidate equal to its root is not contained", () => {
		// Deleting the root itself is never the intent; permitting it would make the guard a foothold.
		assert.equal(within("/a/b", "/a/b"), false);
	});

	test("a direct child is contained", () => {
		assert.equal(within("/a/b", "/a/b/c"), true);
	});

	test("a nested descendant is contained", () => {
		assert.equal(within("/a/b", "/a/b/c/d/e"), true);
	});

	test("a sibling sharing a string prefix is not contained", () => {
		/*
		 * The reason the comparison is not a prefix test: `/a/bc`.startsWith(`/a/b`) is true, and a
		 * caller that deleted on that answer would delete a directory it does not own.
		 */
		assert.equal(within("/a/b", "/a/bc"), false);
		assert.equal(within("/a/b", "/a/b-evil"), false);
	});

	test("a parent is not contained", () => {
		assert.equal(within("/a/b/c", "/a/b"), false);
	});

	test("an escaping .. is not contained", () => {
		assert.equal(within("/a/b", "/a/b/../c"), false);
		assert.equal(within("/a/b", "/a/b/c/../../.."), false);
	});

	test("an interior .. that stays inside is contained", () => {
		// `resolve` collapses it before the comparison, so this is `/a/b/c`.
		assert.equal(within("/a/b", "/a/b/../b/c"), true);
	});

	test("an absolute outsider is not contained", () => {
		assert.equal(within("/a/b", "/etc/passwd"), false);
		assert.equal(within("/a/b", "/a"), false);
	});

	test("the separator boundary is respected", () => {
		// `/a/b` is a prefix of `/a/b/c` as characters but the check is on path segments.
		assert.equal(within("/a/b", "/a/b/"), false, "the root with a trailing slash is the root");
	});

	test("relative candidates resolve against the working directory", () => {
		const root = process.cwd();
		assert.equal(within(root, "child"), true);
		assert.equal(within(root, ".."), false);
	});

	test.skipIf(!isWindows)("the Windows case-fold pair is the same directory", () => {
		assert.equal(within("C:\\A\\B", "c:\\a\\b\\c"), true);
		assert.equal(within("C:\\A\\B", "c:\\a\\b"), false);
	});
});

describe("assertWithin", () => {
	test("returns the candidate unchanged when contained", () => {
		assert.equal(assertWithin("/a/b", "/a/b/c"), "/a/b/c");
	});

	test("throws a refusal naming both paths", () => {
		assert.throws(
			() => {
				assertWithin("/a/b", "/etc/passwd");
			},
			(error: Error) => {
				assert.match(error.message, /\/etc\/passwd/u);
				assert.match(error.message, /\/a\/b/u);
				assert.match(error.message, /not inside/u);

				return true;
			},
		);
	});

	test("names what it was about to touch", () => {
		assert.throws(() => {
			assertWithin("/a/b", "/etc/passwd", "worktree");
		}, /worktree/u);
	});

	test("refuses the root itself", () => {
		assert.throws(() => {
			assertWithin("/a/b", "/a/b");
		}, /not inside/u);
	});
});
