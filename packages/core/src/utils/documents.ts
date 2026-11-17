import { equalsDeep } from "@rbxts/sift/Dictionary";

import { iterate } from "./type";

/**
 * Chooses which document keys a store update must persist.
 *
 * @remarks
 *   This is the decision the `documents` middleware makes, lifted out of it so it can be tested
 *   where the middleware itself cannot run. The middleware is registered inside `if
 *   (RunService.IsServer())`, and the offline emulator always boots a client, so nothing below that
 *   branch executes in any lane we have — a spec that drove the middleware would assert against an
 *   unregistered middleware and read the profile's template back, passing or failing for reasons
 *   unrelated to this logic. Two directions, and they deliberately differ. A key that is new, or
 *   whose data changed, must be written: that is the middleware's whole purpose, and the previous
 *   implementation derived its write set from `removeValues(previous, ...values(updated))`, which
 *   keeps only the keys whose value is absent from `updated` — so a changed value was never a
 *   difference and every update to an existing document was silently dropped. A key that
 *   disappeared is not returned: removing a document from the store must leave the data already
 *   persisted for it in place. The comparison is `equalsDeep`, not `equals`. Sift's `equals`
 *   compares nested tables by reference (`b[key] ~= value`), and a store update that changes any
 *   field rebuilds the document table it touched, so a reference comparison would report every such
 *   document as changed and spend a write on each one. Documents are small nested records of
 *   serializable data, which is what `equalsDeep` is for.
 * @param previous - The `documents` record before the update, or `undefined` when the store had
 *   none.
 * @param updated - The `documents` record after the update.
 * @returns The `[key, data]` pairs whose data must be written to their profile.
 */
export function documentsToPersist(
	previous: undefined | Record<string, unknown>,
	updated: Record<string, unknown>,
): Array<[string, unknown]> {
	const pending: Array<[string, unknown]> = [];

	for (const [key, data] of iterate(updated)) {
		const before = previous?.[key];
		/*
		 * Both sides are narrowed to tables before comparing so a scalar-shaped value — a caller using
		 * a loose record type — counts as a difference rather than failing the typecheck, since
		 * `equalsDeep` takes `object`.
		 */
		if (typeIs(before, "table") && typeIs(data, "table") && equalsDeep(before, data)) {
			continue;
		}

		pending.push([key, data]);
	}

	return pending;
}
