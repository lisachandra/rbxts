import { Signal } from "@rbxts/lemon-signal";

/**
 * A single entry in the navigation history stack.
 *
 * @param path - The URL path string for this entry.
 * @param state - Arbitrary state object associated with the route.
 */
export interface HistoryEntry {
	path: string;
	state: object;
}

/**
 * Manages a linear navigation history with support for pushing, replacing, and navigating between
 * entries.
 *
 * @remarks
 *   Fires {@link History.onChanged} whenever the current location changes. The initial index is
 *   clamped to `[1, entries.length]`.
 */
export class History {
	private _entries: Array<HistoryEntry>;
	private _index: number;

	/** The current history entry (path and state). */
	public location: HistoryEntry;
	/** Signal fired with `(path, state)` each time the active location changes. */
	public onChanged: Signal<[string, object]>;

	/**
	 * Creates a new history instance.
	 *
	 * @param initialEntries - Array of initial path strings. Defaults to `["/"]`.
	 * @param initialIndex - 1-based index of the initial active entry. Defaults to the last entry.
	 */
	constructor(initialEntries: Array<string> = ["/"], initialIndex = initialEntries.size()) {
		const entries: Array<HistoryEntry> = initialEntries.map((path) => {
			return {
				path,
				state: {},
			};
		});

		this.location = entries[initialIndex - 1]!;
		this.onChanged = new Signal<[string, object]>();

		this._entries = entries;
		this._index = initialIndex;
	}

	private _removeFutureEntries(): void {
		if (this._entries.size() > this._index) {
			for (const index of $range(this._index, this._entries.size() - 1)) {
				delete this._entries[index];
			}
		}
	}

	/**
	 * Moves the current index by the given offset, clamped to valid bounds.
	 *
	 * @param offset - Positive or negative integer direction.
	 */
	public go(offset: number): void {
		this._index = math.clamp(this._index + offset, 1, this._entries.size());

		this.location = this._entries[this._index - 1]!;
		this.onChanged.Fire(this.location.path, this.location.state);
	}

	/** Navigates to the previous history entry. Convenience for `go(-1)`. */
	public goBack(): void {
		this.go(-1);
	}

	/** Navigates to the next history entry. Convenience for `go(1)`. */
	public goForward(): void {
		this.go(1);
	}

	/** Jumps to the most recent (newest) entry in the history. */
	public goToEnd(): void {
		this.go(this._entries.size() - this._index);
	}

	/** Jumps to the oldest entry in the history. */
	public goToStart(): void {
		this.go(-(this._index - 1));
	}

	/**
	 * Adds a new entry after removing any forward history, then navigates to it.
	 *
	 * @param path - The path for the new entry.
	 * @param state - Optional state object. Defaults to `{}`.
	 */
	public push(path: string, state: object = {}): void {
		this._removeFutureEntries();

		const entry = { path, state };

		this._entries.push(entry);
		this._index = this._entries.size();

		this.location = entry;
		this.onChanged.Fire(entry.path, entry.state);
	}

	/**
	 * Replaces the current entry without changing the history length, then navigates to it.
	 *
	 * @param path - The new path.
	 * @param state - Optional state object. Defaults to `{}`.
	 */
	public replace(path: string, state: object = {}): void {
		this._removeFutureEntries();

		const entry = { path, state };

		this._entries[this._entries.size() - 1] = entry;

		this.location = entry;
		this.onChanged.Fire(entry.path, entry.state);
	}
}
