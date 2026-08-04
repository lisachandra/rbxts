import { freezeDeep } from "@rbxts/sift/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import { force } from "../utils/type";
import { humanoid } from "./humanoid";

/**
 * A validated R15 character model instance tree.
 *
 * @remarks
 *   Represents the modern Roblox R15 avatar rig with MeshParts connected via Motor6D joints,
 *   including UpperTorso, LowerTorso, Head, limbs, Humanoid, and controller sensors.
 */
export type R15Character = EvaluateInstanceTree<typeof r15Character>;

const upperTorso = freezeDeep({
	$className: "MeshPart",
	BodyBackAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	BodyFrontAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	LeftCollarAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	LeftShoulderRigAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	NeckAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	NeckRigAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	OriginalSize: "Vector3Value",
	RightCollarAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	RightShoulderRigAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	Waist: "Motor6D",
	WaistRigAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
} as const);

/**
 * Schema for validating an R15 character model instance tree.
 *
 * @remarks
 *   Defines the expected structure of a modern R15 avatar: a Model containing MeshParts for the
 *   torso, head, and limbs, a HumanoidRootPart with sensors, a Humanoid, ControllerManager, and
 *   associated motor joints.
 */
export const r15Character = freezeDeep({
	$className: "Model",
	ControllerManager: force<{
		$className: "ControllerManager";
		AirController: "AirController";
		ClimbController: "ClimbController";
		GroundController: "GroundController";
	}>(),
	Head: {
		$className: "MeshPart",
		FaceCenterAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		FaceFrontAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		HairAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		HatAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		Neck: "Motor6D",
		NeckRigAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		OriginalSize: "Vector3Value",
	},
	Humanoid: humanoid,
	HumanoidRootPart: {
		$className: "Part",
		ClimbSensor: force<"ControllerPartSensor">(),
		GroundSensor: force<"ControllerPartSensor">(),
		OriginalSize: "Vector3Value",
		RootRigAttachment: "Attachment",
	},
	LeftFoot: { $className: "MeshPart", LeftAnkle: "Motor6D", OriginalSize: "Vector3Value" },
	LeftHand: { $className: "MeshPart", LeftWrist: "Motor6D", OriginalSize: "Vector3Value" },
	LeftLowerArm: { $className: "MeshPart", LeftElbow: "Motor6D", OriginalSize: "Vector3Value" },
	LeftLowerLeg: { $className: "MeshPart", LeftKnee: "Motor6D", OriginalSize: "Vector3Value" },
	LeftUpperArm: { $className: "MeshPart", LeftShoulder: "Motor6D", OriginalSize: "Vector3Value" },
	LeftUpperLeg: { $className: "MeshPart", LeftHip: "Motor6D", OriginalSize: "Vector3Value" },
	LowerTorso: { $className: "MeshPart", OriginalSize: "Vector3Value", Root: "Motor6D" },
	RightFoot: { $className: "MeshPart", OriginalSize: "Vector3Value", RightAnkle: "Motor6D" },
	RightHand: { $className: "MeshPart", OriginalSize: "Vector3Value", RightWrist: "Motor6D" },
	RightLowerArm: { $className: "MeshPart", OriginalSize: "Vector3Value", RightElbow: "Motor6D" },
	RightLowerLeg: { $className: "MeshPart", OriginalSize: "Vector3Value", RightKnee: "Motor6D" },
	RightUpperArm: {
		$className: "MeshPart",
		OriginalSize: "Vector3Value",
		RightShoulder: "Motor6D",
	},
	RightUpperLeg: { $className: "MeshPart", OriginalSize: "Vector3Value", RightHip: "Motor6D" },
	tiltPart: force<{ $className: "Part"; BodyPosition: "BodyPosition" }>(),
	UpperTorso: force<typeof upperTorso & { ToolGrip: "Motor6D" }>(upperTorso),
} as const);
