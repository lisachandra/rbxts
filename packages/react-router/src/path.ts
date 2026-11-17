/**
 * Options controlling how a path pattern is matched against a URL.
 *
 * @param exact - When `true`, the pattern must consume the entire URL string (anchored with `$`).
 *   Defaults to `false`.
 */
export interface PathMatchOptions {
	exact?: boolean;
}

/** Map of capture-group names to the substring values extracted from a matched URL. */
export type PathMatchResults = Record<string, string>;

/**
 * Compiles a colon-prefixed path pattern (e.g. `"/users/:id/posts/:postId"`) into a regex and
 * extracts named captures from candidate paths.
 */
export class Path {
	private readonly _captureNames: Array<string>;
	private readonly _pattern: string;

	/**
	 * Compiles a path pattern string into a regular expression.
	 *
	 * @param pattern - A path string where `:name` tokens denote named capture groups (e.g.
	 *   `"/users/:id"`).
	 */
	constructor(pattern: string) {
		const captureNames: Array<string> = [];

		/*
		 * `gsub` returns a `LuaTuple<[string, number]>` — the rewritten string and a match count. Index
		 * it rather than converting the tuple to a string, and do not trim with `match("^(.+)/*$")`: that pattern
		 * captures a group, so Lua returns the capture alone and a trailing-slash pattern loses its
		 * `$`-relevant text. The compiled pattern is kept verbatim.
		 */
		const [rewritten] = pattern.gsub(":([^/]+)", (captureName) => {
			captureNames.push(captureName);
			return "([^/]+)";
		});

		this._pattern = `^${rewritten}`;
		this._captureNames = captureNames;
	}

	/**
	 * Attempts to match a path string against the compiled pattern.
	 *
	 * @param path - The URL path to test.
	 * @param options - Optional {@link PathMatchOptions} (e.g. `{ exact: true }`).
	 * @returns A {@link PathMatchResults} record on success, or `undefined` when the path does not
	 *   match.
	 */
	public match(path: string, options: PathMatchOptions = {}): undefined | PathMatchResults {
		/*
		 * `exact` must anchor inside the same regex. Appending `$` to `this._pattern` afterwards works
		 * because the pattern is a plain regex string, but keeping it in one place makes it impossible
		 * for the anchored and unanchored forms to drift.
		 */
		const pattern = options.exact === true ? `${this._pattern}$` : this._pattern;

		/*
		 * Captures are positional. With at least one capture group Lua returns the captures and nothing
		 * else, so index 0 is the first capture; with no capture groups it returns the whole match,
		 * which no capture name corresponds to, and the loop below then yields an empty record.
		 */
		const captures = path.match(pattern);
		if (captures[0] === undefined) {
			return undefined;
		}

		const results: PathMatchResults = {};
		for (let index = 0; index < this._captureNames.size(); index++) {
			const captureName = this._captureNames[index];
			const value = captures[index];
			/*
			 * `LuaTuple` types a capture as `string | number` because `()` captures a position rather
			 * than a substring. This matcher only ever emits `([^/]+)`, so a numeric capture cannot
			 * occur here; narrowing on the string case keeps the record honest either way.
			 */
			if (captureName !== undefined && typeIs(value, "string")) {
				results[captureName] = value;
			}
		}

		return results;
	}
}
