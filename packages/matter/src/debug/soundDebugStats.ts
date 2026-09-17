/**
 * Package-internal sound diagnostic counters and GC timing.
 *
 * The client sound systems write into these accumulators in place of `Log.Debug` calls, and the
 * optional Iris audio debugger system reads them back. All functions are pure/MutableRef-free so
 * the module stays trivially testable and safe to hot-reload.
 */

/** Mutable live counters (written by systems, read by the debugger). */
export interface SoundDebugCounters {
	despawns: number;
	localPlays: number;
	nodeDestroys: number;
	nodeReturns: number;
	plays: number;
	spatialPlays: number;
}

/** Mutable GC timing diagnostics surfaced from the shared sound manager's idle sweep. */
export interface SoundDebugGc {
	idleSeconds: number;
	interval: number;
	lastSweepAt: number;
}

/**
 * Creates the zeroed counter snapshot used by reset assertions.
 *
 * @returns A fresh all-zero counter record.
 */
function createZeroedCounters(): SoundDebugCounters {
	return {
		despawns: 0,
		localPlays: 0,
		nodeDestroys: 0,
		nodeReturns: 0,
		plays: 0,
		spatialPlays: 0,
	};
}

const counters: SoundDebugCounters = createZeroedCounters();
const gc: SoundDebugGc = {
	idleSeconds: 10,
	interval: 1,
	lastSweepAt: 0,
};

/**
 * Records a sound playback start.
 *
 * @param id - The sound template id that began playing (unused by the counters, retained for trace
 *   parity).
 * @param isLocal - Whether the sound plays non-spatially for this player only.
 */
export function recordPlay(id: number, isLocal: boolean): void {
	void id;
	counters.plays += 1;
	if (isLocal) {
		counters.localPlays += 1;
	} else {
		counters.spatialPlays += 1;
	}
}

/** Records a node part being returned to the sound emitter cache. */
export function recordNodeReturned(): void {
	counters.nodeReturns += 1;
}

/** Records a node part being destroyed outright (GC audit path). */
export function recordNodeDestroyed(): void {
	counters.nodeDestroys += 1;
}

/** Records an audio entity being despawned by the shared GC sweep. */
export function recordDespawned(): void {
	counters.despawns += 1;
}

/**
 * Configures the GC timing constants surfaced by the debugger.
 *
 * @param interval - The throttled sweep interval in seconds (`SOUND_GC_INTERVAL`).
 * @param idleSeconds - The idle time before a finished sound is despawned (`SOUND_GC`).
 */
export function configureSoundDebugGc(interval: number, idleSeconds: number): void {
	gc.interval = interval;
	gc.idleSeconds = idleSeconds;
}

/**
 * Timestamps the last GC sweep.
 *
 * @param at - `os.clock()` at the sweep.
 */
export function markSoundDebugGc(at: number): void {
	gc.lastSweepAt = at;
}

/**
 * Returns a defensive copy of the current counters.
 *
 * @returns A snapshot of the playback/cache counters.
 */
export function readSoundDebugCounters(): SoundDebugCounters {
	return { ...counters };
}

/**
 * Returns a defensive copy of the current GC timing diagnostics.
 *
 * @returns A snapshot of the GC timing values.
 */
export function readSoundDebugGc(): SoundDebugGc {
	return { ...gc };
}

/** Resets accumulated counters and GC timing. Intended for tests and hot-reload. */
export function resetSoundDebugStats(): void {
	const zeroed = createZeroedCounters();
	counters.despawns = zeroed.despawns;
	counters.localPlays = zeroed.localPlays;
	counters.nodeDestroys = zeroed.nodeDestroys;
	counters.nodeReturns = zeroed.nodeReturns;
	counters.plays = zeroed.plays;
	counters.spatialPlays = zeroed.spatialPlays;
	gc.idleSeconds = 10;
	gc.interval = 1;
	gc.lastSweepAt = 0;
}
