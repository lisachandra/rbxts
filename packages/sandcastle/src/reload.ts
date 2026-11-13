/*
 * Live configuration reload.
 *
 * A run is long: a batch can hold a worktree for hours, so a model that stops being usable — a
 * promotional window closing, an entitlement lapsing — would otherwise mean abandoning the run and
 * losing the conversation each phase had accumulated. Re-reading `sandcastle.config.ts` while the run
 * is in flight makes the config file itself the switch: the operator edits it and the run continues on
 * what the file now says.
 *
 * Two rules make that safe:
 *
 * - **Semantic, never mtime.** Saving an unrelated comment must not kill a turn that is half finished.
 *   The file's mtime only decides whether to re-parse; the comparison that decides whether to act is
 *   between the *effective step maps* before and after.
 * - **Never trust a config that does not load.** A parse or validation failure leaves the last good
 *   configuration running and is reported once per distinct error, because a typo must not be able to
 *   stop an overnight run.
 *
 * What a reload cannot move is refused rather than half-applied: `dir` is baked into this process's
 * paths at import, and a step cannot change backend because a stored session is only resumable by the
 * backend that owns it.
 */
/* oxlint-disable eslint/max-classes-per-file -- the abort reason and the engine are one unit: a reader of either needs the other */

import { statSync } from "node:fs";

import { configFilePath, loadConfig, type ResolvedSandcastleConfig } from "./config.js";
import { applyConfig, config, repoRoot } from "./runtime.js";
import {
	agentStepNames,
	configuredWorkflowModel,
	resolveAgentSteps,
	type WorkflowDefaults,
} from "./steps.js";
import type {
	AgentBackend,
	AgentPhaseName,
	AgentStepsConfig,
	ResolvedAgentStep,
	SandcastleEffort,
} from "./types.js";

/** How often a running phase checks whether the configuration changed. */
export const reloadCheckMs = 30_000;

/**
 * - How often a running phase checks the config file.
 * - @returns `reloadCheckMs`, or `SANDCASTLE_RELOAD_CHECK_SECONDS` when set to a positive integer.
 * - @remarks Tunable for the same reason the phase budget is: an operator watching a run switch
 *   models wants that to happen promptly, and the suite cannot wait out a real 30-second tick. Zero
 *   is not "poll constantly" — a busy loop against the filesystem is never what someone meant.
 */
export function resolveReloadCheckMs(): number {
	const raw = (process.env.SANDCASTLE_RELOAD_CHECK_SECONDS ?? "").trim();
	if (raw === "") {
		return reloadCheckMs;
	}

	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		console.warn(
			`  ⚠ Invalid SANDCASTLE_RELOAD_CHECK_SECONDS "${raw}" — checking every ${String(reloadCheckMs / 1000)}s.`,
		);
		return reloadCheckMs;
	}

	return parsed * 1000;
}

/**
 * Raised as the abort reason when the effective step map changed under an in-flight attempt.
 *
 * Deliberately not a provider failure: the retry loop restarts the attempt immediately and does not
 * count it, because nothing went wrong — the operator asked for a different model.
 */
export class ConfigReloadError extends Error {
	public override name = "ConfigReloadError";

	constructor(detail: string) {
		super(`Configuration reloaded while the phase was running (${detail}).`);
	}
}

/**
 * The selection a run was launched with, so a reload can tell "this step changed" from "this step
 * was already running on a flag".
 *
 * Without it, any config edit would silently discard an explicit `--model`, which is the opposite
 * of what an operator editing an unrelated key expects — and keeping the flag on steps the edit did
 * not touch is what lets both coexist.
 */
export interface LaunchSelection {
	/** Workflow-wide `--agent`. */
	agentBackend: AgentBackend;
	/** Raw per-step CLI overrides, exactly as parsed; every field wins over the config. */
	cliSteps: AgentStepsConfig;
	/** Workflow-wide `--effort`; always set, defaulted from config at parse time. */
	effort: SandcastleEffort;
	/** Workflow-wide `--model`, or the empty string when the flag was absent. */
	model: string;
	/** The catalog profile this run is bound to, by name. */
	profileName?: string;
}

/** One step whose effective selection moved, for the reload report. */
export interface StepChange {
	after: ResolvedAgentStep;
	before: ResolvedAgentStep;
	step: AgentPhaseName;
}

/** Why a reload was refused. */
export interface ReloadRefusal {
	/** One-line reason, already phrased for the operator. */
	reason: string;
	/** What about the config would need a new run. */
	requiresRestart: boolean;
}

/** The outcome of one reload check. */
export type ReloadOutcome =
	| { kind: "unchanged" }
	| { kind: "applied-non-agent" }
	| { error: string; kind: "invalid" }
	| { kind: "refused"; refusal: ReloadRefusal }
	| { changes: Array<StepChange>; kind: "applied" };

/**
 * Resolves the effective per-step map from a configuration and a launch selection.
 *
 * This is the one precedence rule, used by both the initial resolution and every reload, so a
 * running phase and a fresh one cannot disagree about which model a step runs. Order, lowest to
 * highest: `agents.models` → `agents.steps` → the launch selection (`--agent`/`--model`/`--effort`,
 * then per-step CLI flags).
 *
 * A catalog profile replaces the workflow default rather than overriding it field by field, so
 * "flash" means flash for every step that does not name its own override.
 */
export function effectiveSteps(
	source: ResolvedSandcastleConfig,
	launch: LaunchSelection,
): Record<AgentPhaseName, ResolvedAgentStep> {
	const profile = profileFor(source, launch.profileName);
	const agentBackend = profile?.backend ?? launch.agentBackend;
	/*
	 * The launch model replaces the workflow default, so it is the fallback for a step with no
	 * override of its own — but it must not shadow `agents.models` for a step that switched backend,
	 * which `resolveAgentStep` handles from the map it is given. `""` therefore means "no `--model`"
	 * rather than "the model is empty": a run launched with `--effort` alone has to take the config's
	 * model for that backend.
	 */
	const defaults: WorkflowDefaults = {
		agentBackend,
		effort: (profile?.effort ?? launch.effort) as ResolvedAgentStep["effort"],
		model:
			profile?.model ??
			(launch.model !== ""
				? launch.model
				: configuredWorkflowModel(source.agents.models, agentBackend)),
	};

	/*
	 * The profile's per-step overrides sit between the repository's and the CLI's, the same order a
	 * lane applies. Delegated to `steps.ts` rather than re-derived here so a reload and a fresh parse
	 * resolve identically — legacy env fallbacks included.
	 */
	return resolveAgentSteps(
		defaults,
		source.agents.models,
		mergeProfileSteps(source.agents.steps, profile?.steps),
		launch.cliSteps,
	);
}

/**
 * What the configuration file alone resolves each step to, with the operator's own value choices
 * left out.
 *
 * The reload comparison is between two of these, which is what makes "changed wins" work: a step
 * whose config-derived value moved is visibly a config change, and can therefore take the new value
 * even when a `--model` or `--implement-model` had been winning on it. A step whose value did not
 * move keeps running on the flag, because the edit was about something else.
 *
 * The launch still contributes the two things that are not value choices: the bound profile (a
 * lane's identity) and the workflow backend (a pin). A file edit cannot move either, so leaving
 * them in only keeps the comparison honest.
 */
function configOnlySteps(
	source: ResolvedSandcastleConfig,
	launch: LaunchSelection,
): Record<AgentPhaseName, ResolvedAgentStep> {
	const profile = profileFor(source, launch.profileName);
	const agentBackend = profile?.backend ?? launch.agentBackend;
	const defaults: WorkflowDefaults = {
		agentBackend,
		effort: (profile?.effort ?? source.effort) as ResolvedAgentStep["effort"],
		model: profile?.model ?? configuredWorkflowModel(source.agents.models, agentBackend),
	};

	return resolveAgentSteps(
		defaults,
		source.agents.models,
		mergeProfileSteps(source.agents.steps, profile?.steps),
		{},
	);
}

/** The named catalog profile, when the config still defines it. */
function profileFor(
	source: ResolvedSandcastleConfig,
	name: string | undefined,
): undefined | ResolvedSandcastleConfig["agents"]["catalog"][number] {
	return name === undefined
		? undefined
		: source.agents.catalog.find((entry) => entry.name === name);
}

/** Repository steps with a profile's own per-step overrides layered on top; the profile wins. */
function mergeProfileSteps(
	base: ResolvedSandcastleConfig["agents"]["steps"],
	overlay: undefined | ResolvedSandcastleConfig["agents"]["steps"],
): ResolvedSandcastleConfig["agents"]["steps"] {
	if (overlay === undefined) {
		return base;
	}

	const merged = { ...base };
	for (const step of agentStepNames) {
		const override = overlay[step];
		if (override !== undefined) {
			merged[step] = { ...merged[step], ...override };
		}
	}

	return merged;
}

/** Whether two resolved steps select the same model, effort, and backend. */
export function sameStep(left: ResolvedAgentStep, right: ResolvedAgentStep): boolean {
	return (
		left.agentBackend === right.agentBackend &&
		left.effort === right.effort &&
		left.model === right.model
	);
}

/** Every step whose selection differs between two maps, in declaration order. */
export function diffSteps(
	before: Record<AgentPhaseName, ResolvedAgentStep>,
	after: Record<AgentPhaseName, ResolvedAgentStep>,
): Array<StepChange> {
	return agentStepNames.flatMap((step) =>
		sameStep(before[step], after[step])
			? []
			: [{ after: after[step], before: before[step], step }],
	);
}

/** Human form of one change, e.g. `implement zcode/a → zcode/b (high)`. */
export function describeStepChange(change: StepChange): string {
	const from = `${change.before.agentBackend}/${change.before.model || "(none)"}`;
	const to = `${change.after.agentBackend}/${change.after.model || "(none)"}`;
	const effort = change.after.effort === change.before.effort ? "" : ` (${change.after.effort})`;
	return `${change.step} ${from} → ${to}${effort}`;
}

/**
 * The live reload engine: one instance per process, owned by whichever long-running workflow wants
 * to follow the config file.
 *
 * @remarks
 *   State is deliberately minimal — the mtime of the last _applied_ read and the last error text.
 *   Tracking the applied mtime rather than the attempted one is what makes a bad save retry on the
 *   next tick: a failed parse leaves the mtime unrecorded, so the file keeps looking new until it
 *   parses. That also means a save-and-fix without an intervening tick is picked up immediately.
 */
export class ConfigReloader {
	/**
	 * `mtimeNs` of the last successfully parsed read.
	 *
	 * Three states, and all three matter: `undefined` means this process has not read the file yet
	 * (so the first tick must read it), `null` means the last read found no file (a deletion is a
	 * legitimate reset to defaults), and a bigint is the stamp that was adopted.
	 */
	#appliedMtime: null | bigint | undefined;
	/** Configuration the steps above were derived from, for the non-agent comparison. */
	#config: ResolvedSandcastleConfig;
	/** Per-step map the running workflow is using. */
	#current: Record<AgentPhaseName, ResolvedAgentStep>;
	/** Last distinct error, so a broken config is reported once rather than every tick. */
	#lastError: string | undefined;

	constructor(
		private readonly launch: LaunchSelection,
		source: ResolvedSandcastleConfig = config,
		/**
		 * Repository whose `sandcastle.config.ts` is followed; defaults to the process's.
		 *
		 * A parameter only so tests can point the engine at a throwaway directory instead of
		 * writing a config into the checkout they are running from.
		 */
		private readonly root: string = repoRoot,
	) {
		this.#config = source;
		this.#current = effectiveSteps(source, launch);
		/*
		 * Deliberately no baseline stamp, so the first tick parses the file and diffs against the
		 * launched values. Recording the mtime here would race the caller's own read: an edit landing
		 * between that read and this constructor would be stamped as already applied while the running
		 * selection still predates it. The cost is one parse, 30 seconds in.
		 */
	}

	/** The step map a new attempt should use right now. */
	public steps(): Record<AgentPhaseName, ResolvedAgentStep> {
		return this.#current;
	}

	/** One step's current selection. */
	public step(step: AgentPhaseName): ResolvedAgentStep {
		return this.#current[step];
	}

	/**
	 * - Checks the config file and adopts it when the effective selection moved.
	 * - @returns What happened, for the caller to log and act on.
	 * - @remarks Cheap in the common case: one `statSync`, and the parse only runs when the file's
	 *   mtime actually moved. A missing file is not an error — it is the repository reverting to
	 *   defaults, which is a legitimate way to reset a model. The timestamp is read at nanosecond
	 *   resolution (`mtimeMs` truncates to whole milliseconds on some filesystems, which made a
	 *   write-then-write inside the same millisecond look untouched).
	 */
	public check(): ReloadOutcome {
		const path = configFilePath(this.root);
		let mtime: null | bigint;
		try {
			mtime = statSync(path, { bigint: true, throwIfNoEntry: false })?.mtimeNs ?? null;
		} catch {
			mtime = null;
		}

		if (mtime === this.#appliedMtime) {
			return { kind: "unchanged" };
		}

		let next: ResolvedSandcastleConfig;
		try {
			next = loadConfig(this.root);
		} catch (err) {
			const error = String(err);
			const first = error !== this.#lastError;
			this.#lastError = error;
			return { error: first ? error : "", kind: "invalid" };
		}

		this.#lastError = undefined;

		/*
		 * "Changed wins", per step. The comparison is between the file's own resolutions — with the
		 * CLI flags left out — so a step the edit did not touch is visibly untouched and keeps running
		 * on the operator's flag. A step whose config-derived value did move takes the file's value,
		 * because that is the thing the edit was about; letting the flag win there would make the
		 * config editor silently ineffective whenever a flag happened to cover that step.
		 */
		const beforeConfig = configOnlySteps(this.#config, this.launch);
		const afterConfig = configOnlySteps(next, this.launch);
		const adopted = { ...this.#current };
		for (const step of agentStepNames) {
			if (!sameStep(beforeConfig[step], afterConfig[step])) {
				adopted[step] = afterConfig[step];
			}
		}

		const refusal = this.#refusalFor(next, adopted);
		if (refusal !== undefined) {
			/*
			 * Recorded as applied even though nothing was adopted: the file is valid and the operator
			 * has been told it needs a new run, so retrying the same read every 30s would only repeat
			 * the same refusal.
			 */
			this.#appliedMtime = mtime;
			return { kind: "refused", refusal };
		}

		const changes = diffSteps(this.#current, adopted);
		const moved = this.#nonAgentChanged(next);
		this.#config = next;
		this.#appliedMtime = mtime;
		/*
		 * Only the process's own repository may move the process's configuration. A reloader pointed
		 * at another directory is a test double, and mutating the real `config` from it would leak one
		 * test's fixture into every later module that reads the shared object.
		 */
		if (this.root === repoRoot) {
			applyConfig(next);
		}

		if (changes.length > 0) {
			for (const change of changes) {
				this.#current[change.step] = change.after;
			}

			return { changes, kind: "applied" };
		}

		return moved ? { kind: "applied-non-agent" } : { kind: "unchanged" };
	}

	/**
	 * - Why a freshly loaded config cannot be adopted mid-run.
	 * - @param next - The configuration the file now describes.
	 * - @param adopted - The step map the reload would install.
	 * - @returns `undefined` when the reload can proceed.
	 * - @remarks Both refusals are properties of the process rather than policy: `dir` already
	 *   resolved every path this run created, and a stored session is only resumable by the backend
	 *   that owns it, so moving a step's backend would silently discard the conversation instead of
	 *   continuing it. Checked against the adopted map, not against the raw file, so a backend the
	 *   operator pinned with a CLI flag is not mistaken for an attempt to switch.
	 */
	#refusalFor(
		next: ResolvedSandcastleConfig,
		adopted: Record<AgentPhaseName, ResolvedAgentStep>,
	): undefined | ReloadRefusal {
		if (next.dir !== this.#config.dir) {
			return {
				reason: `state directory changed (${this.#config.dir} → ${next.dir})`,
				requiresRestart: true,
			};
		}

		for (const step of agentStepNames) {
			const before = this.#current[step];
			if (adopted[step].agentBackend !== before.agentBackend) {
				return {
					reason: `${step} backend changed (${before.agentBackend} → ${adopted[step].agentBackend}); a session cannot cross backends`,
					requiresRestart: true,
				};
			}
		}

		return undefined;
	}

	/**
	 * Whether anything outside the agent selection also moved.
	 *
	 * @remarks
	 *   Reported, never refused: a changed `setupCommands` cannot be re-run and a changed prompt
	 *   path applies to the next phase, but an operator who edited them should be told they took
	 *   effect rather than left believing a model switch was the only thing that happened.
	 */
	#nonAgentChanged(next: ResolvedSandcastleConfig): boolean {
		const before = this.#config;
		return (
			JSON.stringify(before.setupCommands) !== JSON.stringify(next.setupCommands) ||
			JSON.stringify(before.skills) !== JSON.stringify(next.skills) ||
			JSON.stringify(before.prompts) !== JSON.stringify(next.prompts) ||
			JSON.stringify(before.integration) !== JSON.stringify(next.integration) ||
			before.baseBranch !== next.baseBranch ||
			before.reviewMarker !== next.reviewMarker
		);
	}
}

/**
 * - Prints what a reload check did.
 * - @param outcome - The result of {@link ConfigReloader.check}.
 * - @remarks `unchanged` prints nothing, which is the common case at one check every 30 seconds. A
 *   change is named step by step rather than summarized, because "which step moved" is the only
 *   thing the operator needs to confirm the edit landed where they meant it.
 */
export function logReloadOutcome(outcome: ReloadOutcome): void {
	switch (outcome.kind) {
		case "applied-non-agent": {
			console.log("  ↻ Configuration reloaded (no agent step changed).");
			return;
		}
		case "invalid": {
			// Reported once per distinct error by the reloader; the empty string is a repeat.
			if (outcome.error !== "") {
				console.warn(
					`  ⚠ sandcastle.config.ts did not load; keeping the running configuration.\n    ${outcome.error}`,
				);
			}

			return;
		}
		case "refused": {
			const suffix = outcome.refusal.requiresRestart ? " Start a new run to apply it." : "";
			console.warn(`  ⚠ Ignoring the config change: ${outcome.refusal.reason}.${suffix}`);
			break;
		}
		case "unchanged": {
			break;
		}
		case "applied": {
			const detail = outcome.changes.map(describeStepChange).join("; ");
			console.log(`  ↻ Configuration reloaded: ${detail}`);
		}
	}
}

/**
 * - Builds the per-attempt watcher a phase runs alongside its agent.
 * - @param reloader - The process's reload engine.
 * - @param step - The phase being run, so only a change to _its_ selection aborts the attempt.
 * - @returns A closure returning a description of the change when this phase's selection moved.
 * - @remarks The comparison is against the reloader's current map rather than the check's outcome, so
 *   two phases watching one process both notice: the first to poll applies the change and the
 *   second sees `unchanged` while still observing a different selection than the one it started
 *   with.
 */
export function watchStep(
	reloader: ConfigReloader,
	step: AgentPhaseName,
): () => string | undefined {
	let started = reloader.step(step);
	return () => {
		logReloadOutcome(reloader.check());
		const now = reloader.step(step);
		if (sameStep(started, now)) {
			return undefined;
		}

		const detail = describeStepChange({ after: now, before: started, step });
		started = now;
		return detail;
	};
}

/**
 * - Builds the launch selection a reload compares changes against.
 * - @param options - Parsed CLI options; `steps` must be the raw per-step overrides.
 * - @returns The selection explicit flags contribute to every reload.
 * - @remarks Only flags that were actually passed are carried, which is what makes "changed wins"
 *   work per step: a step the edit did not touch keeps the flag, and a step the edit did touch
 *   takes the file's value.
 */
export function launchSelection(options: {
	agentBackend: AgentBackend;
	effort: SandcastleEffort;
	model: string;
	queueProfile?: string | undefined;
	steps: AgentStepsConfig;
}): LaunchSelection {
	return {
		agentBackend: options.agentBackend,
		cliSteps: options.steps,
		effort: options.effort,
		model: options.model,
		...(options.queueProfile === undefined || options.queueProfile === ""
			? {}
			: { profileName: options.queueProfile }),
	};
}
