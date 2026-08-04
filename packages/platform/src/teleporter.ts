import { catcher } from "@lisachandra/core/utils/main";
import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import HashLib from "@rbxts/rbxts-hashlib";
import { TeleportService } from "@rbxts/services";
import { t } from "@rbxts/t";

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

/** Configures teleport behavior (expiration, retry, flood delay). */
export function configureTeleport(config: TeleportConfig): void {
	teleportConfig = { ...defaultConfig, ...config };
}

/** Configures the secret used for teleport hash verification. */
export function configureTeleportSecret(secret: string): void {
	teleportSecret = secret;
}

const checkTeleportData = t.strictInterface({
	hash: t.string,
	stamp: t.number,
}) satisfies t.check<PossibleTeleportData>;

const teleportAsync = Promise.promisify(
	(placeId: number, players: Array<Player>, options?: TeleportOptions) => {
		return TeleportService.TeleportAsync(placeId, players, options);
	},
);

/** Reasons why a teleport may be considered invalid. */
export enum TeleportReason {
	TeleportInvalidData,
	TeleportInvalidHash,
	TeleportOldHash,
}

/** Defines the structure for teleport data that can be serialized and sent with a teleport. */
export interface PossibleTeleportData {
	/** A hash value used to verify the integrity of the teleport data. */
	hash: string;
	/** A timestamp indicating when the teleport data was generated. */
	stamp: number;
}

function generateTeleportHash(
	{ stamp }: Omit<PossibleTeleportData, "hash">,
	secret = teleportSecret,
): string {
	return HashLib.sha256(`${stamp}${secret}`);
}

/**
 * Serializes teleport data into a TeleportOptions object, adding a hash and timestamp for security.
 *
 * @param data - The teleport data to serialize. It should not include `hash` or `stamp`.
 * @returns A TeleportOptions object with serialized data, hash, and timestamp.
 */
export function serializeTeleportData(
	data: Omit<PossibleTeleportData, "hash" | "stamp">,
): TeleportOptions {
	const options = new Instance("TeleportOptions");
	const stamp = os.time(os.date("!*t"));
	const hash = generateTeleportHash({ ...data, stamp });

	const teleportData: PossibleTeleportData = { ...data, hash, stamp };
	options.SetTeleportData(teleportData);

	return options;
}

/* Logs invalid teleports. */
function logInvalidTeleport(
	{ success, unexpired, validData, validHash }: ReturnType<typeof isValidTeleport>,
	userId: number,
	_teleportData?: unknown,
): void {
	if (success || validHash === true || unexpired === true) {
		return;
	}

	Log.Warn(
		"Invalid teleport detected for user {UserId}: validData={ValidData}, validHash={ValidHash}, unexpired={Unexpired}",
		userId,
		validData,
		validHash,
		unexpired,
	);
}

/**
 * Validates the teleport data received by a player upon joining a game instance.
 *
 * @param player - The player whose teleport data needs to be validated.
 * @param logInvalid - Whether it should log invalid teleports.
 * @returns An object indicating the success of the validation and the validity of the hash and
 *   expiration status.
 */
export function isValidTeleport(
	player: Player,
	logInvalid = true,
): {
	success: boolean;
	unexpired?: boolean;
	validData?: boolean;
	validHash?: boolean;
} {
	const joinData = player.GetJoinData();
	const teleportData = joinData.TeleportData as unknown;
	const validData = checkTeleportData(teleportData);
	if (!validData) {
		const returned = { success: false, validData };
		if (logInvalid) {
			logInvalidTeleport(returned, player.UserId, teleportData);
		}

		return returned;
	}

	const stamp = os.time(os.date("!*t"));
	const hash = generateTeleportHash(teleportData);

	const validHash = teleportData.hash === hash;
	const unexpired = stamp < teleportData.stamp + teleportConfig.expiration;
	const success = validHash && unexpired;

	const returned = { success, unexpired, validData, validHash };
	if (!success) {
		logInvalidTeleport(returned, player.UserId, teleportData);
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
			throw new Error(
				Log.Error(`Invalid teleport [${teleportResult.Name}]: ${errorMessage}`),
			);
		}

		teleport(targetPlaceId, [player], teleportOptions).catch(catcher);
	},
);
