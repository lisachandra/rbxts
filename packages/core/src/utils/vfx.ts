import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import { Debris, Workspace } from "@rbxts/services";

import type { Character } from "../schemas";

import { catcher } from "./main";

type VFXAnimationMarkerParameters<VFX extends Part> =
	| [Exclude<keyof VFX, keyof Part>, "Emit"]
	| [Exclude<keyof VFX, keyof Part>, "Enable", `${number}`];

/**
 * Creates a WeldConstraint between two BaseParts. Part1 will be welded to
 * Part0. The weld constraint itself will be parented to Part1.
 *
 * @param part1 - The BasePart that will be moved/attached to part0 (Part1).
 *   This is considered the child part in the weld.
 * @param part0 - The BasePart that part1 will be welded to (Part0). This is
 *   considered the parent part in the weld.
 * @returns The created WeldConstraint instance.
 */
export function weldTo(this: void, part1: BasePart, part0: BasePart): WeldConstraint {
	const weld = new Instance("WeldConstraint");
	weld.Part0 = part0;
	weld.Part1 = part1;
	weld.Parent = part1;
	weld.Enabled = true;
	return weld;
}

/**
 * Creates and manages visual effects (VFX) with particle emitters using
 * predefined attributes. This function is suited for simple,
 * attribute-driven VFX playback. For more complex scenarios or animation
 * integration, consider using EmitAllDescendants, ToggleAllDescendants, or
 * AnimatedVFX.
 *
 * @param vfx - The VFX instance (BasePart with attributes) to clone and
 *   manage.
 * @param cf - The CFrame to position the VFX.
 * @param weld - Optional part to weld the VFX to.
 * @returns The cloned VFX instance.
 */
export function playVFX(this: void, vfx: BasePart, cf: CFrame, weld?: BasePart): BasePart {
	const lifetime = vfx.GetAttribute<number>("lifetime")!;
	const bursts = vfx.GetAttribute<number>("bursts")!;
	const duration = vfx.GetAttribute<number>("duration")!;
	const emit = vfx.GetAttribute<boolean>("emit")!;

	const vfxClone = vfx.Clone();
	vfxClone.CFrame = cf;
	vfxClone.Parent = Workspace;

	if (weld) {
		const weldConstraint = new Instance("WeldConstraint");
		weldConstraint.Part0 = vfxClone;
		weldConstraint.Part1 = weld;
		weldConstraint.Parent = vfxClone;
	}

	task.delay(lifetime, () => {
		// Check if clone still exists before destroying
		if (vfxClone.Parent) {
			vfxClone.Destroy();
		}
	});

	for (const particle of vfxClone.GetDescendants()) {
		if (!particle.IsA("ParticleEmitter")) {
			continue;
		}

		if (emit) {
			// Use EmitCount attribute if available, otherwise use bursts
			const emitCount = particle.GetAttribute<number>("EmitCount") ?? bursts;
			particle.Emit(emitCount);
		} else {
			particle.Enabled = true;
		}
	}

	if (!emit) {
		return vfxClone;
	}

	task.delay(duration, () => {
		// Check if clone still exists before disabling particles
		if (vfxClone.Parent) {
			for (const particle of vfxClone.GetDescendants()) {
				if (!particle.IsA("ParticleEmitter")) {
					continue;
				}

				particle.Enabled = false;
			}
		}
	});

	return vfxClone;
}

/**
 * Emits particles from all ParticleEmitter descendants of a given instance.
 * Optionally waits, sets position, parents to Workspace, and sets a
 * lifetime.
 *
 * @param clone - The instance (Model, BasePart, Attachment) containing
 *   ParticleEmitters.
 * @param at - CFrame.
 * @param delay - How much to wait.
 * @param lifetime - The lifetime of the emitter.
 */
export async function emitAllDescendants(
	this: void,
	clone: Model | BasePart | Attachment,
	at?: () => CFrame,
	delay = 0,
	lifetime?: number,
): Promise<void> {
	task.wait(delay);
	if (at && (clone.IsA("Model") || clone.IsA("BasePart"))) {
		clone.PivotTo(at());
	}

	clone.Parent ??= Workspace;

	for (const child of clone.GetDescendants()) {
		if (child.IsA("ParticleEmitter")) {
			child.Emit(child.GetAttribute<number>("EmitCount"));
		}
	}

	if (lifetime !== undefined) {
		Debris.AddItem(clone, lifetime);
	}
}

/**
 * For (const Child of clone.GetDescendants()) if
 * (Child.IsA("ParticleEmitter") or Child.IsA("Highlight")) Child.Enabled =
 * bool;
 *
 * If (clone.IsA("ParticleEmitter") || clone.IsA("Highlight")) clone.Enabled
 * = state;.
 *
 * @param model - A .Clone() of the vfx asset.
 * @param state - .Enabled = true or false.
 */
export function toggleAllDescendants(this: void, model: Instance, state: boolean): void {
	model.Parent ??= Workspace;

	for (const child of model.GetDescendants()) {
		if (child.IsA("ParticleEmitter") || child.IsA("Highlight")) {
			child.Enabled = state;
		}
	}

	if (model.IsA("ParticleEmitter") || model.IsA("Highlight")) {
		model.Enabled = state;
	}
}

/**
 * ```
 * If (!clone.Parent) clone.Parent = Workspace;
 * ```
 *
 * ToggleAllDescendants(clone, true); while (check(clone)) task.wait();
 * ToggleAllDescendants(clone, false);.
 *
 * @param clone - .Clone() of the vfx asset.
 * @param check - Boolean while condition.
 * @param atCFrame - Optional Pivot To.
 * @param lifetime - The lifetime of the emitter.
 * @returns A resolved Promise when check Param returns false.
 */
export async function enableWhile<T extends Model | Trail | BasePart | Highlight | Attachment>(
	this: void,
	clone: T,
	check: (clone: T) => boolean,
	atCFrame?: CFrame,
	lifetime?: number,
): Promise<void> {
	return new Promise((resolve) => {
		if (atCFrame && (clone.IsA("Model") || clone.IsA("BasePart"))) {
			clone.PivotTo(atCFrame);
		}

		clone.Parent ??= Workspace;

		toggleAllDescendants(clone, true);
		while (check(clone)) {
			task.wait();
		}

		toggleAllDescendants(clone, false);
		if (lifetime !== undefined) {
			Debris.AddItem(clone, lifetime);
		}

		resolve();
	});
}

/**
 * Handles an animation marker event specifically for triggering VFX. Parses
 * the marker parameters to determine which VFX attachment to use and how
 * (Emit or Enable). Expected parameter format: "AttachmentName,Emit" or
 * "AttachmentName,Enable,DurationSeconds".
 *
 * @param vfx - The parent Part containing VFX Attachments.
 * @param track - The AnimationTrack that fired the marker.
 * @param parameters - The string parameters from the marker event.
 */
export function vfxAnimationMarkerReached(
	this: void,
	vfx: Part,
	track: AnimationTrack,
	parameters?: string,
): void {
	if (parameters === undefined) {
		throw new Error(Log.Error(`Missing VFX parameters for animation: ${track.Animation?.AnimationId}`));
	}

	const [name, emitType, duration] = parameters.split(",") as VFXAnimationMarkerParameters<Part>;
	const vfxAttachment = vfx.FindFirstChild<Attachment>(name as string);
	if (!vfxAttachment) {
		throw new Error(
			Log.Error(
				`Missing VFX attachment for animation: ${track.Animation?.AnimationId} (${name as string})`,
			),
		);
	}

	switch (emitType) {
		case "Emit": {
			emitAllDescendants(vfxAttachment).catch(catcher);
			break;
		}
		case "Enable": {
			const numberDuration = tonumber(duration) ?? 0;
			const timestamp = tick();
			enableWhile(vfxAttachment, () => tick() - timestamp < numberDuration).catch(catcher);
			break;
		}
		default: {
			throw new Error(
				Log.Error(`Invalid VFX type for animation: ${track.Animation?.AnimationId} (${emitType})`),
			);
		}
	}
}

/**
 * Creates and manages VFX linked to a specific animation track. Clones the
 * VFX, attaches it to the character's HumanoidRootPart, and connects to the
 * "VFX" marker signal on the provided animation track. Cleans up the VFX
 * and connections when the animation stops.
 *
 * @param character - The character.
 * @param track - The animation track of the VFX.
 * @param assetVfx - The VFX Part or Model to clone for the animation.
 */
export function animatedVFX(this: void, character: Character, track: AnimationTrack, assetVfx: Part): void {
	if (!track?.IsPlaying) {
		return;
	}

	const vfx = assetVfx.Clone();
	vfx.CFrame = character.PrimaryPart!.CFrame;
	const weld = weldTo(vfx, character.PrimaryPart!);
	vfx.Parent = character.PrimaryPart!;

	const vfxConnection = track.GetMarkerReachedSignal("VFX").Connect((parameters) => {
		vfxAnimationMarkerReached(vfx, track, parameters);
	});

	task.spawn(() => {
		track.Ended.Wait();
		vfxConnection.Disconnect();
		vfx.Destroy();
		weld.Destroy();
	});
}
