import { useHookState } from "@rbxts/matter";

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
