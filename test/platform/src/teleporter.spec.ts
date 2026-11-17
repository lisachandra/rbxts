import {
	configureTeleport,
	configureTeleportSecret,
	signTeleportData,
	verifyTeleportData,
} from "@lisachandra/platform/teleporter";
import { describe, expect, it } from "@rbxts/jest-globals";

/**
 * A verifier clock far enough from zero that a `stamp` is unambiguously in the past.
 *
 * Fixed rather than `os.time()` so a token's window is decided by the arithmetic under test rather
 * than by how long the suite took to reach this file.
 */
const NOW = 1_700_000_000;

/**
 * The secret every case installs.
 *
 * `configureTeleportSecret` is module-level state and `verifyTeleportData` halts without it, so the
 * first call must happen before any verification — including the case that checks the halt itself,
 * which is written to run against a module that has not yet been configured.
 */
const SECRET = "a-shared-secret";

/** A secret distinct from {@link SECRET}, for the wrong-secret case. */
const OTHER_SECRET = "a-different-secret";

/** Restores the default 300 s window between cases, since `configureTeleport` is module state too. */
function resetWindow(): void {
	configureTeleport({ expiration: 300 });
}

describe("teleport verification without a configured secret", () => {
	/*
	 * Deliberately the first describe block, and deliberately not preceded by `configureTeleportSecret`.
	 * The guard is module state, so once any other case has configured a secret this can never be
	 * observed again in the same process — order is the fixture.
	 */
	it("should halt naming configureTeleportSecret when no secret is configured", () => {
		expect.assertions(2);

		const [ok, message] = pcall(() => verifyTeleportData({ stamp: NOW }, NOW));

		expect(ok).toBe(false);
		expect(tostring(message)).toContain("configureTeleportSecret");
	});
});

describe("teleport hashing", () => {
	it("should accept a token signed inside the window", () => {
		expect.assertions(3);

		configureTeleportSecret(SECRET);
		resetWindow();

		const token = signTeleportData({ fromLobby: true }, NOW);
		const result = verifyTeleportData(token, NOW);

		expect(result.success).toBe(true);
		expect(result.validHash).toBe(true);
		expect(result.unexpired).toBe(true);
	});

	it("should reject a token signed with a different secret", () => {
		expect.assertions(2);

		configureTeleportSecret(OTHER_SECRET);
		const foreign = signTeleportData({ fromLobby: true }, NOW);
		configureTeleportSecret(SECRET);

		const result = verifyTeleportData(foreign, NOW);

		expect(result.success).toBe(false);
		expect(result.validHash).toBe(false);
	});

	it("should reject a token whose non-stamp field was tampered with", () => {
		expect.assertions(3);

		configureTeleportSecret(SECRET);
		resetWindow();

		const token = signTeleportData({ fromLobby: true, target: "Arena" }, NOW);
		// The MAC was computed over `target: "Arena"`; this token now claims somewhere else.
		const tampered = { ...token, target: "Vault" };
		const result = verifyTeleportData(tampered, NOW);

		expect(result.success).toBe(false);
		expect(result.validHash).toBe(false);
		// The stamp is untouched, so the failure is the payload and not the clock.
		expect(result.unexpired).toBe(true);
	});

	it("should not depend on the order keys were written in", () => {
		expect.assertions(1);

		configureTeleportSecret(SECRET);
		resetWindow();

		/*
		 * The signature is computed over a canonical rendering, so a table built in the other order
		 * still verifies. Without that, a token would be valid or not depending on how the sender
		 * happened to construct it.
		 */
		const token = signTeleportData({ alpha: 1, beta: 2 }, NOW);
		const reordered = {
			alpha: token.alpha,
			beta: token.beta,
			hash: token.hash,
			stamp: token.stamp,
		};

		expect(verifyTeleportData(reordered, NOW).success).toBe(true);
	});
});

describe("teleport expiry window", () => {
	it("should reject a stamp more than 60 seconds in the future despite a valid signature", () => {
		expect.assertions(3);

		configureTeleportSecret(SECRET);
		resetWindow();

		/*
		 * Signed correctly, so `validHash` is true — the rejection has to come from the skew bound.
		 * Without it the token would verify for `expiration` seconds after a stamp ~31 years away.
		 */
		const token = signTeleportData({ fromLobby: true }, NOW + 61);
		const result = verifyTeleportData(token, NOW);

		expect(result.validHash).toBe(true);
		expect(result.unexpired).toBe(false);
		expect(result.success).toBe(false);
	});

	it("should accept a stamp inside the skew allowance", () => {
		expect.assertions(2);

		configureTeleportSecret(SECRET);
		resetWindow();

		// A clock 30 s fast is ordinary drift between servers, not an attack.
		const token = signTeleportData({ fromLobby: true }, NOW + 30);
		const result = verifyTeleportData(token, NOW);

		expect(result.unexpired).toBe(true);
		expect(result.success).toBe(true);
	});

	it("should reject a token older than the expiration window", () => {
		expect.assertions(2);

		configureTeleportSecret(SECRET);
		resetWindow();

		const token = signTeleportData({ fromLobby: true }, NOW - 301);
		const result = verifyTeleportData(token, NOW);

		expect(result.validHash).toBe(true);
		expect(result.success).toBe(false);
	});

	it("should honour a configured expiration", () => {
		expect.assertions(2);

		configureTeleportSecret(SECRET);
		configureTeleport({ expiration: 10 });

		const token = signTeleportData({ fromLobby: true }, NOW - 11);

		expect(verifyTeleportData(token, NOW).success).toBe(false);

		const fresh = signTeleportData({ fromLobby: true }, NOW - 5);

		expect(verifyTeleportData(fresh, NOW).success).toBe(true);

		resetWindow();
	});
});

describe("teleport data shape", () => {
	it("should report a malformed token as invalid data rather than hashing it", () => {
		expect.assertions(3);

		configureTeleportSecret(SECRET);
		resetWindow();

		const result = verifyTeleportData({ hash: "abc" }, NOW);

		expect(result.validData).toBe(false);
		expect(result.success).toBe(false);
		expect(result.format).toBeDefined();
	});

	it("should reject non-table teleport data", () => {
		expect.assertions(2);

		configureTeleportSecret(SECRET);
		resetWindow();

		const result = verifyTeleportData("not a table", NOW);

		expect(result.validData).toBe(false);
		expect(result.success).toBe(false);
	});
});

describe("configureTeleportSecret", () => {
	it("should refuse a blank secret", () => {
		expect.assertions(2);

		const [empty] = pcall(() => configureTeleportSecret(""));

		expect(empty).toBe(false);

		const [whitespace] = pcall(() => configureTeleportSecret("   "));

		expect(whitespace).toBe(false);
	});
});
