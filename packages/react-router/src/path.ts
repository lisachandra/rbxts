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

		this._pattern = `^${pattern.gsub(":([^/]+)", (captureName) => {
			captureNames.push(captureName);
			return "([^/]+)";
		})}`.match("^(.+)/*$")[0] as string;
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
		let pattern = this._pattern;
		if (options.exact ?? false) {
			pattern += "$";
		}

		const match = [path.match(pattern)];
		if (match.size() === 0) {
			return;
		}

		const captures: PathMatchResults = {};

		for (const [index, value] of match) {
			const captureName = this._captureNames[index as number];
			if (captureName !== undefined) {
				captures[captureName] = value as string;
			}
		}

		return captures;
	}
}
