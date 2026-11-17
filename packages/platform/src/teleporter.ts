import { catcher } from "@lisachandra/core/utils/main";
import { iterate } from "@lisachandra/core/utils/type";
import { Boba } from "@rbxts/boba";
import Log from "@rbxts/log";
import HashLib from "@rbxts/rbxts-hashlib";
import { TeleportService } from "@rbxts/services";

// ─── Runtime Configuration ──────────────────────────────────────────────────

/** Configuration for teleport behavior including expiration, retry attempts, and flood delay. */
export interface TeleportConfig {
	/** Max teleport retry attempts (default: 3). */
	attempts?: number;
	/** Teleport data expiration in seconds (default: 300). */
	expiration?: number;
	/** Delay when teleport is flooded in seconds (default: 5). */
	flood_delay?: number;
	/** Delay between retries in seconds (default: 1). */
	retry_delay?: number;
}

const defaultConfig: Required<TeleportConfig> = {
	attempts: 3,
	expiration: 300,
	flood_delay: 5,
	retry_delay: 1,
};

let teleportConfig = { ...defaultConfig };
let teleportSecret = "";

/**
 * How far a token's `stamp` may lead the verifier's clock, in seconds.
 *
 * @remarks
 *   Exists because the expiry check below is one-sided without it: `now < stamp + expiration` is
 *   satisfied by `stamp = now + 10^9` for about 31 years. Real skew between servers is seconds, so
 *   60 is generous while still bounding a forged far-future token to the same window as a fresh
 *   one.
 */
const maximumClockSkew = 60;

/** The secret currently in use, halting when none has been configured. */
function requireTeleportSecret(): string {
	if (teleportSecret === "") {
		Log.Fatal(
			"No teleport secret configured; call configureTeleportSecret before minting or validating a teleport.",
		);
	}

	return teleportSecret;
}

/** Configures teleport behavior (expiration, retry, flood delay). */
export function configureTeleport(config: TeleportConfig): void {
	teleportConfig = { ...defaultConfig, ...config };
}

/**
 * Configures the secret used for teleport hash verification.
 *
 * @remarks
 *   Refuses a blank or whitespace-only secret here rather than deferring to the first mint or
 *   validation: an empty secret makes the MAC computable by anyone, so the failure belongs at the
 *   call site where it can be read against the configuration code. This replaced the old behaviour
 *   of hashing the payload alone, which admitted a forged `{hash = sha256(stamp), stamp = t}`.
 * @param secret - A non-blank string shared by every participating place.
 */
export function configureTeleportSecret(secret: string): void {
	if (string.match(secret, "^%s*$")[0] !== undefined) {
		Log.Fatal(
			"configureTeleportSecret was called with a blank secret; the secret must be a non-empty string shared by every participating place.",
		);
	}

	teleportSecret = secret;
}

const checkTeleportData = Boba.Struct({
	hash: Boba.String,
	stamp: Boba.Number,
}) satisfies Boba<PossibleTeleportData>;

const teleportAsync = Promise.promisify(
	(placeId: number, players: Array<Player>, options?: TeleportOptions) => {
		return TeleportService.TeleportAsync(placeId, players, options);
	},
);

/**
 * Reasons why a teleport may be considered invalid.
 *
 * @remarks
 *   Vestigial: nothing constructs or returns one. {@link verifyTeleportData} answers with a
 *   {@link TeleportVerification} object because a caller needs several booleans at once, not a
 *   single reason. Kept because it is a published export, but do not add members here — a new
 *   reason belongs on the verification result, where it can actually be observed.
 */
export enum TeleportReason {
	TeleportInvalidData,
	TeleportInvalidHash,
	TeleportOldHash,
}

/** The caller's own fields, which ride along with the attached `hash` and `stamp`. */
export type TeleportPayload = Record<string, defined>;

/** Defines the structure for teleport data that can be serialized and sent with a teleport. */
export type PossibleTeleportData = TeleportPayload & {
	/** A hash value used to verify the integrity of the teleport data. */
	hash: string;
	/** A timestamp indicating when the teleport data was generated. */
	stamp: number;
};

/**
 * Renders a value as a string that depends on every key and value inside it, in a fixed order.
 *
 * @remarks
 *   Sorting matters as much as the content: the same table iterated in a different order must
 *   produce the same string, or a legitimate token fails verification. Strings are quoted so that
 *   `a: "1,2"` cannot be confused with `a: "1"`, `b: "2"`.
 * @param value - Any value that may appear in teleport data.
 * @returns A canonical string.
 */
function canonicalize(value: unknown): string {
	if (typeIs(value, "table")) {
		const entries = new Array<[string, unknown]>();
		for (const [key, child] of iterate(value)) {
			entries.push([tostring(key), child]);
		}

		entries.sort(([left], [right]) => left < right);

		const parts = new Array<string>();
		for (const [key, child] of entries) {
			parts.push(`${key}:${canonicalize(child)}`);
		}

		return `{${parts.join(",")}}`;
	}

	if (typeIs(value, "string")) {
		return string.format("%q", value);
	}

	return tostring(value);
}

/**
 * Computes the MAC over a whole payload, not just its timestamp.
 *
 * @remarks
 *   The secret follows a NUL so no payload value can move text across the boundary.
 * @param payload - Every field being authenticated, including `stamp`.
 * @param secret - The shared secret.
 * @returns The hex digest carried as `hash`.
 */
export function generateTeleportHash(payload: TeleportPayload, secret: string): string {
	return HashLib.sha256(`${canonicalize(payload)}\0${secret}`);
}

/**
 * Attaches a `hash` and `stamp` to a payload.
 *
 * @remarks
 *   Pure and separate from {@link serializeTeleportData} so a token can be minted and checked
 *   without owning a `TeleportOptions` instance.
 * @param payload - The caller's fields.
 * @param stamp - The timestamp to sign, in seconds since the epoch.
 * @returns The payload with its MAC and timestamp, ready to send.
 */
export function signTeleportData(payload: TeleportPayload, stamp: number): PossibleTeleportData {
	const secret = requireTeleportSecret();

	return { ...payload, hash: generateTeleportHash({ ...payload, stamp }, secret), stamp };
}

/** The outcome of checking a token, field by field. */
export interface TeleportVerification {
	/** Boba's explanation of a malformed token. */
	format?: string;
	/** True only when the MAC matches and the stamp is inside the window. */
	success: boolean;
	/**
	 * Whether the stamp is inside the accepted window. False covers both directions: older than
	 * `expiration`, or further ahead than {@link maximumClockSkew}.
	 */
	unexpired?: boolean;
	/** Whether every field the verifier needs is present and correctly typed. */
	validData?: boolean;
	/** Whether the MAC matches the payload. */
	validHash?: boolean;
}

/**
 * Checks a token's MAC and timestamp.
 *
 * @remarks
 *   Exists as a pure function because the emulator backend cannot round-trip `TeleportOptions` —
 *   its `GetTeleportData` returns `nil` — so anything reachable only through {@link isValidTeleport}
 *   is unreachable in the test lane. This takes the data directly, which is also the shape a server
 *   receives it in.
 * @param data - The teleport data as received, before any checking.
 * @param now - The verifier's clock, in seconds since the epoch.
 * @returns The verification result.
 */
export function verifyTeleportData(data: unknown, now: number): TeleportVerification {
	const secret = requireTeleportSecret();
	const validData = checkTeleportData.match(data);
	if (!validData.ok) {
		return { format: validData.format(), success: false, validData: false };
	}

	const { hash, stamp, ...payload } = data as PossibleTeleportData;
	/*
	 * A plain `===` on the digest, deliberately. A constant-time comparison defends a secret compared
	 * byte by byte; here the compared value is the MAC, which travels in the token and is already
	 * known to whoever sent it, and the secret itself is never an operand. Luau also gives an attacker
	 * no per-byte timer worth modelling over a 64-character string a network round trip dominates. If
	 * this ever compares a secret-derived value not present in the input, that is when the timing
	 * argument becomes real.
	 */
	const validHash = hash === generateTeleportHash({ ...payload, stamp }, secret);
	const withinAge = now < stamp + teleportConfig.expiration;
	const withinSkew = stamp - now <= maximumClockSkew;
	const unexpired = withinAge && withinSkew;

	return { success: validHash && unexpired, unexpired, validData: true, validHash };
}

/**
 * Serializes teleport data into a TeleportOptions object, adding a hash and timestamp for security.
 *
 * @param data - The teleport data to serialize. It should not include `hash` or `stamp`.
 * @returns A TeleportOptions object with serialized data, hash, and timestamp.
 */
export function serializeTeleportData(data: TeleportPayload): TeleportOptions {
	const options = new Instance("TeleportOptions");
	options.SetTeleportData(signTeleportData(data, os.time(os.date("!*t"))));

	return options;
}

/* Logs invalid teleports. */
function logInvalidTeleport(
	{ format, success, unexpired, validData, validHash }: TeleportVerification,
	userId: number,
): void {
	if (success || validHash === true || unexpired === true) {
		return;
	}

	Log.Warn(
		"Invalid teleport detected for user {UserId}: validData={ValidData}, validHash={ValidHash}, unexpired={Unexpired} {Format}",
		userId,
		validData,
		validHash,
		unexpired,
		format,
	);
}

/**
 * Validates the teleport data received by a player upon joining a game instance.
 *
 * @remarks
 *   Halts if no secret has been configured: without one the MAC is computable by anyone, so there
 *   is no safe answer to return. The work itself is {@link verifyTeleportData}, so the checks are
 *   reachable without a `Player` — this lane's emulator does not round-trip `TeleportOptions`.
 * @param player - The player whose teleport data needs to be validated.
 * @param logInvalid - Whether it should log invalid teleports.
 * @returns The verification result, including which check failed.
 */
export function isValidTeleport(player: Player, logInvalid = true): TeleportVerification {
	const teleportData = player.GetJoinData().TeleportData as unknown;
	const returned = verifyTeleportData(teleportData, os.time(os.date("!*t")));
	if (!returned.success && logInvalid) {
		logInvalidTeleport(returned, player.UserId);
	}

	return returned;
}

/**
 * Teleports a group of players to a specified place, retrying upon failure.
 *
 * @param placeId - The ID of the target place.
 * @param players - An array of players to teleport.
 * @param options - Optional TeleportOptions to include with the teleport request.
 * @returns A promise resolving to a tuple indicating success and the result of the teleport
 *   attempt.
 */
export async function teleport(
	placeId: number,
	players: Array<Player>,
	options?: TeleportOptions,
): Promise<[success: false, result: unknown] | [success: true, result: TeleportAsyncResult]> {
	let attemptIndex = 0;
	let success = false;
	let result: unknown;

	while (!success && attemptIndex < teleportConfig.attempts) {
		[success, result] = teleportAsync(placeId, players, options).await();
		attemptIndex++;
		if (!success) {
			task.wait(teleportConfig.retry_delay);
		}
	}

	if (!success) {
		Log.Warn("Teleport unsuccessful: {$Result}", result);
		return [false, result];
	}

	return [true, result as TeleportAsyncResult];
}

TeleportService.TeleportInitFailed.Connect(
	(player, teleportResult, errorMessage, targetPlaceId, teleportOptions) => {
		if (teleportResult === Enum.TeleportResult.Flooded) {
			task.wait(teleportConfig.flood_delay);
		} else if (teleportResult === Enum.TeleportResult.Failure) {
			task.wait(teleportConfig.retry_delay);
		} else {
			Log.Fatal(`Invalid teleport [${teleportResult.Name}]: ${errorMessage}`);
		}

		teleport(targetPlaceId, [player], teleportOptions).catch(catcher());
	},
);
