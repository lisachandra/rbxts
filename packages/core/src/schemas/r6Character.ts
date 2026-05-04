import { freezeDeep } from "@rbxts/sift/out/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import { force } from "../utils/type";

import { humanoid } from "./humanoid";

/**
 * A validated R6 character model instance tree.
 *
 * @remarks
 * Represents the classic Roblox R6 avatar rig with body parts
 * connected via Motor6D joints, including Torso, Head, limbs,
 * Humanoid, and controller sensors.
 */
export type R6Character = EvaluateInstanceTree<typeof r6Character>;

const torso = freezeDeep({
	"$className": "Part",
	"Left Hip": "Motor6D",
	"Left Hip Attachment": "Attachment",
	"Left Shoulder": "Motor6D",
	"Left Shoulder Attachment": "Attachment",
	"Neck": "Motor6D",
	"Right Hip": "Motor6D",
	"Right Hip Attachment": "Attachment",
	"Right Shoulder": "Motor6D",
	"Right Shoulder Attachment": "Attachment",
} as const);

/**
 * Schema for validating an R6 character model instance tree.
 *
 * @remarks
 * Defines the expected structure of a classic R6 avatar: a Model
 * containing Torso, Head, limbs, HumanoidRootPart with sensors,
 * a Humanoid, ControllerManager, and associated motor joints.
 */
export const r6Character = freezeDeep({
	"$className": "Model",

	"tiltPart": force<{ $className: "Part"; BodyPosition: "BodyPosition" }>(),
	"Torso": force<typeof torso & { ToolGrip: "Motor6D" }>(torso),
	"ControllerManager": force<{
		$className: "ControllerManager";
		AirController: "AirController";
		ClimbController: "ClimbController";
		GroundController: "GroundController";
	}>(),

	"Humanoid": humanoid,
	"Root Motion": "Part",
	"Head": {
		$className: "Part",
		Face: "Decal",
		Mesh: "SpecialMesh",
	},
	"HumanoidRootPart": {
		"$className": "Part",
		"ClimbSensor": force<"ControllerPartSensor">(),
		"GroundSensor": force<"ControllerPartSensor">(),
		"Root": "Attachment",
		"Root Hip": "Motor6D",
		"Root Motion": "Motor6D",
	},
	"Left Arm": {
		"$className": "Part",
		"Left Hand": "Attachment",
	},
	"Left Leg": {
		"$className": "Part",
		"Left Foot": "Attachment",
	},
	"Right Arm": {
		"$className": "Part",
		"Right Hand": "Attachment",
	},
	"Right Leg": {
		"$className": "Part",
		"Right Foot": "Attachment",
	},
} as const);
