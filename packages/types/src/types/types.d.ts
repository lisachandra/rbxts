/* eslint-disable ts/naming-convention -- for instance */
/* eslint-disable @cspell/spellchecker -- Global declaration file. */

import type { IntRange } from "type-fest";

declare global {
	type Table = Record<number | string | symbol, unknown>;

	/** A general type for a value that may be nil (undefined). */
	// eslint-disable-next-line no-restricted-syntax -- N<T> definition
	type N<T> = T | undefined;

	/** A conditional type if an object type has a nominal key or not. */
	type IsNominal<T> = Exclude<keyof T, ExcludeNominalKeys<T>> extends never ? false : true;

	interface LuaGlobals {
		/** Type signature for the Lua unpack function. */
		unpack: <T extends Array<unknown>>(...args: T) => T;

		/** Type signature for the Lua setfenv function. */
		setfenv: (func: Callback, fenv: Table) => void;
	}

	interface _G extends Table {
		__COMPAT_WARNINGS__?: boolean;
		__DEV__?: boolean;
		__EXPERIMENTAL__?: boolean;
		__PROD__?: boolean;
		__PROFILE__?: boolean;
		__REACT_MICROPROFILER_LEVEL?: IntRange<0, 11>;
		__TEST__?: boolean;
		__VERSION__?: `${number}.${number}.${number}`;
		NOCOLOR?: boolean;
	}
	/* eslint-enable ts/naming-convention */
}

export {};
