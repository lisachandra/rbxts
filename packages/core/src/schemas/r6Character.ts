import { freezeDeep } from "@rbxts/sift/out/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import { force } from "../utils/type";

import { humanoid } from "./humanoid";

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
