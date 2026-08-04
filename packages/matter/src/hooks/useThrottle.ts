import { useHookState } from "@rbxts/matter";

/**
 * Returns `true` at most once every `seconds` seconds, throttling execution.
 *
 * @remarks
 *   Uses `os.clock()` for timing. The first invocation always returns `false` because the timer has
 *   just started.
 * @example
 * 	```ts
 * 	if (useThrottle(0.5)) {
 * 		sendNetworkUpdate();
 * 	}
 * 	```;
 *
 * @param seconds - The minimum interval in seconds between returning `true`.
 * @param discriminator - An optional value to distinguish between multiple hooks of the same type.
 * @returns `true` if the throttle period has elapsed, `false` otherwise.
 */
export function useThrottle(seconds: number, discriminator?: unknown): boolean {
	const storage = useHookState<{ expiry: number; time: number }>(
		discriminator,
		({ expiry, time }) => {
			return os.clock() - time < expiry;
		},
	);

	if (storage.time === undefined) {
		storage.time = os.clock();
		storage.expiry = os.clock() + seconds;
	}

	if (os.clock() - storage.time >= seconds) {
		storage.time = os.clock();
		storage.expiry = os.clock() + seconds;
		return true;
	}

	return false;
}
