/*
 * Queue manifest migration: v1 -> v2.
 *
 * v1 carried two identities for one batch — a short code in `name` and an optional integration
 * branch in `mergeName` — plus a `afterMerge` gate and prose notes ("#199 (SX) joins the S merge")
 * that nothing could read. v2 collapses them: `name` IS the integration, `after` is the gate, and a
 * batch name is unique, so a shared integration branch is a fold, not a note.
 *
 * The translation is pure and reported rather than silent: `queue migrate` prints every rename, the
 * fold it performed, the gate and `joins` values it remapped, and — refusing to write until they are
 * supplied — every batch whose v1 entry carried no `mergeName` to inherit a name from.
 *
 * Reading is tolerant instead: `readQueueManifest` accepts a v1 file through the same translation
 * this command writes, so a worktree built before the migration can still read the shared queue.
 * This command is for writing the v2 form — it prints every change it makes and refuses to write
 * until the renames it cannot infer are supplied.
 */

import { migrateQueueManifest, type QueueMigrationReport } from "./translate.js";

/*
 * Re-exported so `queue migrate` keeps one import site: the translation moved to `translate.ts`
 * only because `readQueueManifest` needs it without closing a module cycle.
 */
export {
	migrateQueueManifest,
	parseMigrationAssigns,
	type QueueMigrationAssigns,
	type QueueMigrationReport,
	readRawQueueManifest,
} from "./translate.js";

/**
 * - Renders the migration report the way `queue migrate` prints it.
 * - @param report - Output of {@link migrateQueueManifest}.
 * - @returns Human-readable lines: the rename table first, then folds, remaps, and blockers.
 */
export function renderQueueMigration(report: QueueMigrationReport): Array<string> {
	const lines: Array<string> = ["  Renames:"];
	for (const rename of report.renames) {
		const changed = rename.from === rename.to ? "  (unchanged)" : "";
		lines.push(`    ${rename.from} → ${rename.to}${changed}`);
	}

	for (const fold of report.folds) {
		const members = fold.issues.map((issue) => `#${issue}`).join(", ");
		lines.push("", `  Fold: "${fold.from}" joins "${fold.into}" (${members})`);
		if (fold.droppedNotes !== "") {
			lines.push(`    dropped note: ${fold.droppedNotes}`);
		}
	}

	if (report.gates.length > 0) {
		lines.push("", "  Gates remapped:");
		for (const gate of report.gates) {
			lines.push(`    ${gate.batch}: after ${gate.from} → ${gate.to}`);
		}
	}

	if (report.joins.length > 0) {
		lines.push("", "  Joins remapped:");
		for (const join of report.joins) {
			lines.push(`    #${join.issue}: ${join.from} → ${join.to}`);
		}
	}

	if (report.ignoredAssigns.length > 0) {
		lines.push("", `  --assign ignored (no such batch): ${report.ignoredAssigns.join(", ")}`);
	}

	if (report.unmapped.length > 0) {
		lines.push("", "  Unmapped batches (need --assign <old>=<integration-name>):");
		for (const name of report.unmapped) {
			lines.push(`    ${name}`);
		}
	}

	return lines;
}
