/** Represents the formatting mode for tables. */
import type { ValueOf } from "type-fest";

interface FormatMode {
	long: "Long";
	short: "Short";
}

/**
 * Provides functions for formatting Lua tables into strings. Includes options for short and long
 * formatting modes.
 */
declare const formatTable: {
	/** Formatting modes for tables. */
	formatMode: FormatMode;

	/**
	 * Formats a Lua table into a string representation.
	 *
	 * @param t - The table to format.
	 * @param mode - The formatting mode. Can be "Short" or "Long".
	 * @returns The formatted string.
	 */
	formatTable: (t: Table, mode: ValueOf<FormatMode>) => string;
};

export = formatTable;
