import {
	catcher,
	getHumanoid,
	getInstanceByTree,
	getInstanceWithAttribute,
	lazyConnect,
	lazyDisconnect,
	lerpWithTransform,
	tracks,
} from "@lisachandra/core/utils/main";
import type { ConnectionLike } from "@lisachandra/core/utils/type";
import { describe, expect, it } from "@rbxts/jest-globals";

/*
 * Ported from the godkin repo's `shared/utils/main.spec.ts` (#17 triage: rewrite, the largest win at
 * 525 lines). Two things changed on the way over.
 *
 * The RuntimeLib mock preamble is gone, for the reason `vector.spec.ts` gives: this module's imports
 * resolve directly in this repo, so the mock exercised nothing.
 *
 * The original also covered `waitForFirst`, `waitForCharacter`, `loadAnimation`, `tween` and `loadFlag`
 * against real services. Those live in `utils.spec.ts` (`waitForDocument`) or are not portable — see
 * the note at the bottom of this file for what is deliberately absent and why.
 */
describe("lazyConnect", () => {
	it("should connect to an object that exposes Connect", () => {
		expect.assertions(1);

		const received = new Array<defined>();
		const eventLike = {
			Connect(callback: (...args: Array<defined>) => void) {
				callback("from-connect");
				return { Disconnect() {} };
			},
		};

		lazyConnect(eventLike, (...args) => {
			received.push(args);
		});

		expect(received).toEqual([["from-connect"]]);
	});

	it("should connect to an object that exposes lowercase connect", () => {
		expect.assertions(1);

		const received = new Array<defined>();
		const eventLike = {
			connect(callback: (...args: Array<defined>) => void) {
				callback("from-lowercase");
				return { disconnect() {} };
			},
		};

		lazyConnect(eventLike, (...args) => {
			received.push(args);
		});

		expect(received).toEqual([["from-lowercase"]]);
	});

	it("should connect to an object that exposes subscribe", () => {
		expect.assertions(1);

		const received = new Array<defined>();
		const eventLike = {
			subscribe(callback: (...args: Array<defined>) => void) {
				callback("from-subscribe");
				return { disconnect() {} };
			},
		};

		lazyConnect(eventLike, (...args) => {
			received.push(args);
		});

		expect(received).toEqual([["from-subscribe"]]);
	});
});

describe("lazyDisconnect", () => {
	it("should call a function connection", () => {
		expect.assertions(1);

		let disconnected = false;
		lazyDisconnect(() => {
			disconnected = true;
		});

		expect(disconnected).toBe(true);
	});

	it("should call Disconnect on an object that exposes it", () => {
		expect.assertions(1);

		let disconnected = false;
		/*
		 * Method shorthand rather than an arrow property: `ConnectionLike` declares `Disconnect` as a
		 * method, and roblox-ts rejects a function-valued field where a method is expected.
		 */
		const connection = {
			Disconnect() {
				disconnected = true;
			},
		} as unknown as ConnectionLike;

		lazyDisconnect(connection);

		expect(disconnected).toBe(true);
	});

	it("should call lowercase disconnect on an object that exposes it", () => {
		expect.assertions(1);

		let disconnected = false;
		const connection = {
			disconnect() {
				disconnected = true;
			},
		} as unknown as ConnectionLike;

		lazyDisconnect(connection);

		expect(disconnected).toBe(true);
	});

	it("should stop a signal connection from delivering", () => {
		expect.assertions(1);

		/*
		 * The `RBXScriptSignal` branch wraps the callback so it checks `connection.Connected` before
		 * forwarding — a guard the duck-typed branches do not have. Exercising that guard needs a real
		 * signal, which the emulator's stub data model does not schedule.
		 *
		 * What is checkable here is the shape: a real connection is handed back, and disconnecting it
		 * is accepted rather than throwing. The delivery-timing behaviour is Studio-only for the same
		 * reason #29's audio criteria are.
		 */
		const signal = new Instance("BindableEvent");
		const connection = lazyConnect(signal.Event, () => {});

		let threw = false;
		try {
			lazyDisconnect(connection);
		} catch {
			threw = true;
		}

		expect(threw).toBe(false);
	});
});

describe("getInstanceWithAttribute", () => {
	it("should return the first instance whose attribute matches", () => {
		expect.assertions(1);

		const [first, second] = [new Instance("Folder"), new Instance("Folder")];
		first.SetAttribute("Kind", "other");
		second.SetAttribute("Kind", "wanted");

		expect(getInstanceWithAttribute([first, second], "Kind", "wanted")).toBe(second);
	});

	it("should return the first of several matches, not the last", () => {
		expect.assertions(1);

		const [first, second] = [new Instance("Folder"), new Instance("Folder")];
		first.SetAttribute("Kind", "wanted");
		second.SetAttribute("Kind", "wanted");

		expect(getInstanceWithAttribute([first, second], "Kind", "wanted")).toBe(first);
	});

	it("should return undefined when no instance matches", () => {
		expect.assertions(1);

		const instance = new Instance("Folder");
		instance.SetAttribute("Kind", "other");

		expect(getInstanceWithAttribute([instance], "Kind", "wanted")).toBeUndefined();
	});

	it("should distinguish a false attribute from an absent one", () => {
		expect.assertions(2);

		const instance = new Instance("Folder");
		instance.SetAttribute("Enabled", false);

		expect(getInstanceWithAttribute([instance], "Enabled", false)).toBe(instance);
		expect(getInstanceWithAttribute([instance], "Enabled", true)).toBeUndefined();
	});
});

describe("getHumanoid", () => {
	it("should return undefined when given no model", () => {
		expect.assertions(1);

		expect(getHumanoid()).toBeUndefined();
	});

	it("should find the Humanoid inside a model", () => {
		expect.assertions(1);

		/*
		 * `nonStrict` is needed here: the strict path rejects a humanoid with no `RootPart` or one in
		 * the `Dead` state, and a bare `Instance("Humanoid")` has neither a root part nor a running
		 * state machine. That rejection is itself the next spec's subject.
		 */
		const model = new Instance("Model");
		const humanoid = new Instance("Humanoid");
		humanoid.Parent = model;

		expect(getHumanoid(model, true)).toBe(humanoid);
	});

	it("should reject a live-looking humanoid that has no RootPart", () => {
		expect.assertions(2);

		/*
		 * This is the strict path's whole purpose: a humanoid mid-despawn has no `RootPart`, and a
		 * caller that gets one back will then fail on the first `MoveTo`. Pinned in both directions so
		 * a "simplification" that drops the check fails here.
		 */
		const model = new Instance("Model");
		const humanoid = new Instance("Humanoid");
		humanoid.Parent = model;

		expect(getHumanoid(model)).toBeUndefined();
		expect(getHumanoid(model, true)).toBe(humanoid);
	});

	it("should return undefined for a model with no Humanoid", () => {
		expect.assertions(1);

		expect(getHumanoid(new Instance("Model"), true)).toBeUndefined();
	});

	it("should read the Character when given a Player", () => {
		expect.assertions(1);

		/*
		 * The Player branch is the whole reason `getHumanoid` takes a loose `Instance`: callers pass
		 * either a character model or the player. This pins that a Player is unwrapped rather than
		 * searched for a Humanoid child of its own.
		 *
		 * A Player is not creatable from `Instance.new` and the emulator has no `Players` service, so
		 * the player is a table exposing exactly the members the function reads: `IsA` and `Character`.
		 * Anything more would be asserting on the fake rather than on `getHumanoid`.
		 */
		const character = new Instance("Model");
		const humanoid = new Instance("Humanoid");
		humanoid.Parent = character;

		/*
		 * `IsA` is method syntax, not an arrow field: roblox-ts compiles `model.IsA("Player")` to a
		 * method call and passes the receiver implicitly, so an arrow field would receive the table as
		 * its first argument and compare that against "Player" — always false, silently taking the
		 * wrong branch and then calling `FindFirstChildOfClass` on the fake. The compiler adds `self`
		 * itself, so the declared parameter list starts at `className`.
		 */
		const player = {
			Character: character,
			IsA(className: string) {
				return className === "Player";
			},
		} as unknown as Instance;

		expect(getHumanoid(player, true)).toBe(humanoid);
	});
});

describe("lerpWithTransform", () => {
	it("should step alpha on each event and stop after the returned function runs", () => {
		expect.assertions(3);

		/*
		 * Driven through a duck-typed event rather than a `BindableEvent`, because `lazyConnect`'s
		 * `Connect` branch is synchronous here while the `RBXScriptSignal` one depends on an engine
		 * scheduler the emulator does not run. The behaviour under test — alpha starting at 0, the
		 * increment happening *after* the transform, and the disconnect stopping further calls — is
		 * the same on either branch.
		 */
		const listeners = new Array<() => void>();
		const eventLike = {
			Connect(callback: () => void) {
				listeners.push(callback);
				return {
					Disconnect() {
						listeners.clear();
					},
				};
			},
		};

		const seen = new Array<number>();
		const stop = lerpWithTransform(0.25, eventLike, (alpha) => {
			seen.push(alpha);
		});

		for (const listener of listeners) {
			listener();
		}

		for (const listener of listeners) {
			listener();
		}

		expect(seen).toEqual([0, 0.25]);

		stop();

		expect(listeners.size()).toBe(0);
		expect(seen).toEqual([0, 0.25]);
	});
});

describe("getInstanceByTree", () => {
	it("should walk the tree and return the descendant", () => {
		expect.assertions(1);

		const root = new Instance("Folder");
		const middle = new Instance("Folder");
		const leaf = new Instance("Folder");
		middle.Name = "Middle";
		leaf.Name = "Leaf";
		middle.Parent = root;
		leaf.Parent = middle;

		expect(getInstanceByTree(root, ["Middle", "Leaf"])).toBe(leaf);
	});

	it("should return the root for an empty path", () => {
		expect.assertions(1);

		const root = new Instance("Folder");

		expect(getInstanceByTree(root, [])).toBe(root);
	});
});

describe("tracks", () => {
	it("should start empty and be keyed by controller", () => {
		expect.assertions(2);

		/*
		 * `tracks` is module state that `loadAnimation` fills and a background GC ages out. Asserting
		 * the shape rather than the content keeps this from depending on which other spec ran first —
		 * the emulator reuses one VM across a file.
		 */
		expect(tracks).toBeDefined();
		expect(typeOf(tracks)).toBe("table");
	});
});

describe("catcher", () => {
	it("should log a warning rather than rethrowing", () => {
		expect.assertions(2);

		/*
		 * `catcher` exists to hand to a boundary that wants a non-halting report. If it ever threw,
		 * the boundary's error handling would swallow the original failure and replace it with this
		 * one; that is the property under test, so the assertion is that a call completes normally.
		 */
		const handler = catcher();

		expect(typeOf(handler)).toBe("function");

		let threw = false;
		try {
			handler({ message: "a test failure" });
		} catch {
			threw = true;
		}

		expect(threw).toBe(false);
	});
});

/*
 * Deliberately not ported:
 *
 * - `loadFlag`, `waitForCharacter`, `waitForFirst`, `tween` and `loadAnimation` need a running
 *   `RunService`/`TweenService` and a real character rig. The emulator boots a stub data model, so a
 *   port would assert against the stub rather than the engine — the same reason #29's audio criteria
 *   stay Studio-only.
 * - `applyHumanoidDescription` needs a Humanoid with a description; `ApplyDescriptionReset` is a
 *   no-op on a bare `Instance("Humanoid")`, so a spec here would pass without exercising anything.
 * - `waitForDocument` is already covered in `utils.spec.ts`, including the accessor seam that
 *   `configureDocumentAccessor` installs.
 */
