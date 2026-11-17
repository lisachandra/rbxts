import { Path } from "@lisachandra/react-router";
import { describe, expect, it } from "@rbxts/jest-globals";

describe("path", () => {
	it("should match a path pattern and capture its segments by position", () => {
		expect.assertions(3);

		expect(new Path("/users/:id").match("/users/42")).toEqual({ id: "42" });

		// Two captures, in declaration order.
		expect(new Path("/users/:id/posts/:postId").match("/users/42/posts/7")).toEqual({
			id: "42",
			postId: "7",
		});

		// A path with no matching prefix returns undefined rather than an empty table.
		expect(new Path("/users/:id").match("/groups/42")).toBeUndefined();
	});

	it("should anchor the pattern only when exact is requested", () => {
		expect.assertions(2);

		const path = new Path("/users/:id");

		// `exact` is what requires the pattern to consume the whole path.
		expect(path.match("/users/42/posts", { exact: true })).toBeUndefined();

		// Without it, the same pattern matches a longer path, as a prefix route should.
		expect(path.match("/users/42/posts")).toEqual({ id: "42" });
	});

	it("should return an empty record for a pattern with no captures", () => {
		expect.assertions(2);

		/*
		 * A pattern with no `:name` token compiles to a regex with no capture groups, so Lua returns
		 * the whole match. There is no capture name to attach it to, and the result must be empty
		 * rather than carrying the matched text under a numeric key.
		 */
		expect(new Path("/health").match("/health")).toEqual({});
		expect(new Path("/health").match("/health/checks")).toEqual({});
	});

	it("should compile a pattern with a capture-free suffix without losing it", () => {
		expect.assertions(1);

		/*
		 * The pattern is kept verbatim after token rewriting. A trailing-slash pattern therefore still
		 * matches, and the captured segment is not swallowed by a greedy trim.
		 */
		expect(new Path("/users/:id/").match("/users/42/")).toEqual({ id: "42" });
	});
});
