import type { Character } from "@lisachandra/core/schemas";
import { store } from "@lisachandra/core/store";
import { is, iterate } from "@lisachandra/core/utils/type";
import type { AnyEntity } from "@rbxts/matter";
import { isEmpty } from "@rbxts/object-utils";
import { TweenService } from "@rbxts/services";

import type { Force } from "../components";
import { Components } from "../components";
import { getEntityHumanoid } from "./entity";

interface TorsoMotorPair {
	part0: BasePart;
	part1: BasePart;
}

/**
 * Configuration for ragdoll constraints applied to character joints.
 *
 * Maps joint names (e.g., "Left Hip", "Right Hip") to constraint types and their properties. Also
 * includes a `recovery_time` for the ragdoll duration.
 *
 * @remarks
 *   Each joint entry specifies a `Constraint` type (e.g., `BallSocketConstraint`) and a
 *   `Properties` table with angle limits and other constraint settings.
 */
export const ragdollConfig = {
	"Left Hip": {
		Constraint: "BallSocketConstraint",
		Properties: {
			LimitsEnabled: true,
			TwistLimitsEnabled: true,
			TwistLowerAngle: -90,
			TwistUpperAngle: 90,
			UpperAngle: 45,
		},
	},
	"recovery_time": 0.7,
	"Right Hip": {
		Constraint: "BallSocketConstraint",
		Properties: {
			LimitsEnabled: true,
			TwistLimitsEnabled: true,
			TwistLowerAngle: -90,
			TwistUpperAngle: 90,
			UpperAngle: 45,
		},
	},
};

const torsoMotorPairsByCharacter = new Map<Model, Array<TorsoMotorPair>>();

function isValidTorsoMotorPair(character: Character, pair: TorsoMotorPair): boolean {
	if (!pair.part0.Parent || !pair.part1.Parent) {
		return false;
	}

	if (!pair.part0.IsDescendantOf(character) || !pair.part1.IsDescendantOf(character)) {
		return false;
	}

	return true;
}

function getTorsoMotorPairs(character: Character): Array<TorsoMotorPair> {
	const cached = torsoMotorPairsByCharacter.get(character);
	if (
		cached !== undefined &&
		!cached.isEmpty() &&
		cached.every((pair) => isValidTorsoMotorPair(character, pair))
	) {
		return cached;
	}

	const motorPairs: Array<TorsoMotorPair> = [];
	for (const motor of character.GetDescendants()) {
		if (!motor.IsA("Motor6D") || motor.Part1 === undefined) {
			continue;
		}

		if (motor.Part0 === character.Torso) {
			motorPairs.push({
				part0: motor.Part0,
				part1: motor.Part1,
			});
		}
	}

	torsoMotorPairsByCharacter.set(character, motorPairs);
	return motorPairs;
}

/**
 * Sets the walk speed of an entity's humanoid.
 *
 * @param entityId - The ID of the entity.
 * @param target - The target walk speed.
 * @param tweenInfo - The tween info to use.
 * @returns A promise that resolves when the speed change tween is complete.
 */
export async function setSpeed(
	entityId: AnyEntity,
	target: number,
	tweenInfo: TweenInfo,
): Promise<void> {
	const humanoid = getEntityHumanoid(entityId);
	if (!humanoid) {
		return;
	}

	if (time !== undefined) {
		const tween = TweenService.Create(humanoid, tweenInfo, {
			// eslint-disable-next-line ts/naming-convention -- Tween Property
			WalkSpeed: target,
		});
		tween.Play();
		tween.Completed.Wait();
	} else {
		humanoid.WalkSpeed = target;
	}
}

/**
 * Sets the velocity of an entity using a LinearVelocity constraint. If forceDirection is provided,
 * it applies a directional velocity. If forceDirection is nil, it disables the LinearVelocity
 * constraint, effectively stopping external velocity influence.
 *
 * @param entityId - The ID of the entity.
 * @param forceDirection - Optional direction and magnitude of the velocity to apply. If nil,
 *   velocity control is disabled.
 */
export function setVelocity(entityId: AnyEntity, forceDirection?: Vector3): void {
	const forces = store.world.get(entityId, Components.Forces)!;
	if (forceDirection) {
		forces.linearVelocity.ForceLimitsEnabled = false;
		forces.linearVelocity.VectorVelocity = forceDirection;
		forces.linearVelocity.Enabled = true;
	} else {
		forces.linearVelocity.ForceLimitsEnabled = true;
		forces.linearVelocity.Enabled = false;
	}
}

/**
 * Locks or unlocks the orientation of an entity's humanoid. When locked, the humanoid's rotation is
 * controlled externally, preventing automatic rotation. Optionally, for rigid locking, it enables
 * an AlignOrientation constraint.
 *
 * @param entityId - The ID of the entity.
 * @param lock - If true, locks the orientation; if false, unlocks it.
 * @param rigid - If true and `lock` is true, uses AlignOrientation for rigid locking. Defaults to
 *   false.
 */
export function lockOrientation(entityId: AnyEntity, lock: boolean, rigid = false): void {
	const humanoid = getEntityHumanoid(entityId);
	const forces = store.world.get(entityId, Components.Forces)!;
	if (!humanoid) {
		return;
	}

	humanoid.AutoRotate = !lock;
	forces.alignOrientation.CFrame = humanoid.RootPart!.CFrame;
	forces.alignOrientation.Enabled = lock && rigid;
}

/**
 * Applies an impulse force to an entity. Impulses are short bursts of force. The force is added to
 * a list of active forces and managed by the physics system.
 *
 * @param entityId - The ID of the entity.
 * @param impulse - The impulse force to apply, including direction and maximum torque.
 */
export function applyImpulse(entityId: AnyEntity, impulse: Force): void {
	const humanoid = getEntityHumanoid(entityId);
	const forces = store.world.get(entityId, Components.Forces)!;
	if (!humanoid) {
		return;
	}

	forces.linearVelocity.MaxForce = impulse.maxTorque;
	store.world.insert(
		entityId,
		forces.patch({
			forces: [...forces.forces, { force: impulse, time: os.clock() }],
		}),
	);
}

/**
 * Clears all applied forces on an entity, effectively stopping any external motion or velocity.
 * Resets velocity constraints and clears the list of active forces. Additionally, it sets the
 * AssemblyLinearVelocity of all BaseParts in the character model to Vector3.zero to halt any
 * residual motion.
 *
 * @param entityId - The ID of the entity.
 */
export function clearForces(entityId: AnyEntity): void {
	const humanoid = getEntityHumanoid(entityId);
	const forces = store.world.get(entityId, Components.Forces)!;
	if (!humanoid) {
		return;
	}

	setVelocity(entityId);
	store.world.insert(entityId, forces.patch({ forces: [] }));

	for (const child of humanoid.Parent.GetDescendants()) {
		if (child.IsA("BasePart")) {
			child.AssemblyLinearVelocity = Vector3.zero;
		}
	}
}

/**
 * Pivots the entity's RootPart to a target CFrame using a tween animation for smooth transition.
 *
 * @param entityId - The ID of the entity.
 * @param targetCF - The target CFrame to pivot to.
 * @param tweenInfo - The tween info to use.
 * @returns A promise that resolves when the pivot tween is complete.
 */
export async function pivotTo(
	entityId: AnyEntity,
	targetCF: CFrame,
	tweenInfo: TweenInfo,
): Promise<void> {
	const humanoid = getEntityHumanoid(entityId);
	if (!humanoid) {
		return;
	}

	const tween = TweenService.Create(humanoid.RootPart!, tweenInfo, {
		// eslint-disable-next-line ts/naming-convention -- Tween Property
		CFrame: targetCF,
	});

	tween.Play();
	tween.Completed.Wait();
}

/**
 * Creates a WeldConstraint between two BaseParts. Part1 will be welded to Part0. The weld
 * constraint itself will be parented to Part1.
 *
 * @param part1 - The BasePart that will be moved/attached to part0 (Part1). This is considered the
 *   child part in the weld.
 * @param part0 - The BasePart that part1 will be welded to (Part0). This is considered the parent
 *   part in the weld.
 * @returns The created WeldConstraint instance.
 */
export function weldTo(part1: BasePart, part0: BasePart): WeldConstraint {
	const weld = new Instance("WeldConstraint");
	weld.Part0 = part0;
	weld.Part1 = part1;
	weld.Parent = part1;
	weld.Enabled = true;
	return weld;
}

/**
 * Computes and applies forces to an entity based on a decaying force model.
 *
 * This function calculates the net force acting on an entity by iterating through a collection of
 * decaying forces. Each force's magnitude diminishes over time until it falls below a minimum
 * threshold, at which point the force is removed. The resulting net force is then applied as a
 * linear velocity to the entity.
 *
 * @remarks
 *   This function relies on the entity having a `Humanoid` and a `Forces` component. It early-exits
 *   if either is missing. The `forces.forces` array is iterated in reverse to allow for safe
 *   removal of elements during iteration.
 * @param entityId - The ID of the entity to compute forces for.
 * @param threshold - The minimum magnitude threshold for the linear velocity. Forces with a
 *   magnitude below this threshold will be disabled. Defaults to 20.
 */
export function computeForces(entityId: AnyEntity, threshold = 20): void {
	const humanoid = getEntityHumanoid(entityId);
	if (!humanoid) {
		return;
	}

	const changes: Partial<Components["Forces"]> = {};
	const forces = store.world.get(entityId, Components.Forces)!;
	if (forces.linearVelocity === undefined || forces.alignOrientation === undefined) {
		changes.linearVelocity = humanoid.RootPart?.FindFirstChildOfClass("LinearVelocity")!;
		changes.alignOrientation = humanoid.RootPart?.FindFirstChildOfClass("AlignOrientation")!;
	}

	const linearVelocity = changes.linearVelocity ?? forces.linearVelocity;
	const _alignOrientation = changes.alignOrientation ?? forces.alignOrientation;
	if (!linearVelocity?.ForceLimitsEnabled) {
		return;
	}

	let direction = new Vector3();
	for (const index of $range(forces.forces.size() - 1, 0, -1)) {
		const { force, time } = forces.forces[index]!;
		const magnitude =
			force.magnitude - (force.magnitude * (os.clock() - time)) / force.decayTime;

		if (magnitude < 1) {
			changes.forces ??= [...forces.forces];
			changes.forces.remove(index);
		} else {
			direction = direction.add(force.direction.mul(magnitude));
		}
	}

	linearVelocity.VectorVelocity = direction;
	linearVelocity.Enabled = linearVelocity.VectorVelocity.Magnitude > threshold;

	if (!isEmpty(changes)) {
		store.world.insert(entityId, forces.patch(changes));
	}
}

/**
 * Calculates the total mass of a model by summing the AssemblyMass of all its BasePart descendants.
 *
 * @param model - The Model to calculate the mass of.
 * @returns The total mass of the model in kilograms.
 */
export function getModelMass(model: Model): number {
	let mass = 0;
	for (const part of model.GetDescendants()) {
		mass += part.IsA("BasePart") ? part.AssemblyMass : 0;
	}

	return mass;
}

/**
 * Applies a backwards impulse to a BasePart using a LinearVelocity object.
 *
 * This function creates a LinearVelocity object and applies a backwards force relative to the
 * part's LookVector. The LinearVelocity is configured to operate in world space and is immediately
 * enabled.
 *
 * @param part - The BasePart to apply the impulse to.
 * @param magnitude - The magnitude of the impulse force.
 * @param yOffset - A vertical offset applied to the direction of the impulse. Defaults to 0.6.
 * @returns The LinearVelocity object that was created and applied to the
 * part.
 */
export function impulseBackwards(part: BasePart, magnitude: number, yOffset = 0.6): LinearVelocity {
	const att0 = new Instance("Attachment");
	const vector = new Instance("LinearVelocity");
	att0.Parent = part;
	vector.Parent = att0;

	vector.Attachment0 = att0;
	vector.MaxForce = 25000;
	vector.RelativeTo = Enum.ActuatorRelativeTo.World;
	vector.VectorVelocity = part.CFrame.LookVector.Unit.add(new Vector3(0, -yOffset, 0)).mul(
		-magnitude,
	);
	vector.Enabled = true;
	return vector;
}

/**
 * Asynchronously applies a backwards impulse to a BasePart and then destroys the LinearVelocity.
 *
 * This function calls `impulseBackwards` to create and apply the LinearVelocity. It then waits for
 * a specified decay time before destroying the LinearVelocity object, effectively applying a
 * short-lived impulse.
 *
 * @param part - The BasePart to apply the impulse to.
 * @param magnitude - The magnitude of the impulse force.
 * @param yOffset - A vertical offset applied to the direction of the impulse. Defaults to 0.0.
 * @param decayTime - The amount of time (in seconds) to wait before destroying the LinearVelocity.
 *   Defaults to 0.25.
 * @returns A Promise that resolves when the decay time has elapsed and the LinearVelocity has been
 *   destroyed.
 */
export async function impulseBackwardsAsync(
	part: BasePart,
	magnitude: number,
	yOffset = 0.0,
	decayTime = 0.25,
): Promise<void> {
	const vector = impulseBackwards(part, magnitude, yOffset);
	task.wait(decayTime);
	vector.Destroy();
}

/**
 * Ragdoll a character by disabling motor joints and creating physics constraints.
 *
 * @param character - The character to ragdoll.
 */
export function ragdoll(character: Character): void {
	const humanoid = character.FindFirstChildOfClass("Humanoid")!;
	humanoid.ChangeState(Enum.HumanoidStateType.Physics);
	collideJoints(character);

	for (const motor of character.GetDescendants()) {
		if (
			!motor.IsA("Motor6D") ||
			!is<keyof Omit<typeof ragdollConfig, "recovery_time">>(motor.Name)
		) {
			continue;
		}

		const config = ragdollConfig[motor.Name];
		let constraintType: keyof CreatableInstances = "BallSocketConstraint";
		let properties: Partial<WritableInstanceProperties<BallSocketConstraint>> = {};

		if (config !== undefined) {
			properties = config.Properties;
			constraintType = config.Constraint as "BallSocketConstraint";
		}

		motor.Enabled = false;

		const [a0, a1] = [new Instance("Attachment"), new Instance("Attachment")];
		a0.CFrame = motor.C0;
		a1.CFrame = motor.C1;
		a0.Parent = motor.Part0;
		a1.Parent = motor.Part1;

		const constraint = new Instance(constraintType);

		for (const [key, value] of iterate(properties)) {
			constraint[key] = value as never;
		}

		constraint.Attachment0 = a0;
		constraint.Attachment1 = a1;
		constraint.Parent = motor.Parent;
	}
}

/**
 * Un-ragdoll's a character by enabling its motor joints and removing ragdoll constraints.
 *
 * @param character - The character to un-ragdoll.
 */
export function unRagdoll(character: Character): void {
	const humanoid = character.FindFirstChildOfClass("Humanoid")!;
	humanoid.ChangeState(Enum.HumanoidStateType.Running);
	unCollideJoints(character);

	for (const motor of character.GetDescendants()) {
		if (
			!motor.IsA("Motor6D") ||
			!is<keyof Omit<typeof ragdollConfig, "recovery_time">>(motor.Name)
		) {
			continue;
		}

		const config = ragdollConfig[motor.Name];
		const constraintType = config?.Constraint ?? "BallSocketConstraint";

		motor.Enabled = true;

		const constraint = motor.Parent!.FindFirstChild<Constraint>(constraintType);

		if (constraint !== undefined) {
			constraint.Attachment0?.Destroy();
			constraint.Attachment1?.Destroy();
			constraint.Destroy();
		}
	}
}

/**
 * Enables collision on a character's torso motor joints for ragdoll physics.
 *
 * Sets the character's `PlatformStand` to `true`, enables collision on the `RootPart`, disables
 * `AutoRotate`, and enables collision on all torso motor pair parts.
 *
 * @param character - The character to enable joint collision on.
 */
export function collideJoints(character: Character): void {
	const humanoid = character.FindFirstChildOfClass("Humanoid")!;
	humanoid.PlatformStand = true;
	humanoid.RootPart!.CanCollide = true;
	humanoid.AutoRotate = false;

	for (const pair of getTorsoMotorPairs(character)) {
		pair.part0.CanCollide = true;
		pair.part1.CanCollide = true;
	}
}

/**
 * Disables collision on a character's torso motor joints, reversing the effects of `collideJoints`.
 *
 * Sets `PlatformStand` to `false`, disables collision on the `RootPart`, re-enables `AutoRotate`,
 * and disables collision on all torso motor pair parts.
 *
 * @param character - The character to disable joint collision on.
 */
export function unCollideJoints(character: Character): void {
	const humanoid = character.FindFirstChildOfClass("Humanoid")!;
	humanoid.PlatformStand = false;
	humanoid.RootPart!.CanCollide = false;
	humanoid.AutoRotate = true;

	for (const pair of getTorsoMotorPairs(character)) {
		pair.part0.CanCollide = false;
		pair.part1.CanCollide = false;
	}
}
