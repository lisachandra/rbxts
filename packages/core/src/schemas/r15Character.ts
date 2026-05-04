import { freezeDeep } from "@rbxts/sift/out/Dictionary";
import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

import { force } from "../utils/type";

import { humanoid } from "./humanoid";

/**
 * A validated R15 character model instance tree.
 *
 * @remarks
 * Represents the modern Roblox R15 avatar rig with MeshParts
 * connected via Motor6D joints, including UpperTorso, LowerTorso,
 * Head, limbs, Humanoid, and controller sensors.
 */
export type R15Character = EvaluateInstanceTree<typeof r15Character>;

const upperTorso = freezeDeep({
	$className: "MeshPart",
	OriginalSize: "Vector3Value",
	Waist: "Motor6D",
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
	RightCollarAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	RightShoulderRigAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
	WaistRigAttachment: {
		$className: "Attachment",
		OriginalPosition: "Vector3Value",
	},
} as const);

/**
 * Schema for validating an R15 character model instance tree.
 *
 * @remarks
 * Defines the expected structure of a modern R15 avatar: a Model
 * containing MeshParts for the torso, head, and limbs, a HumanoidRootPart
 * with sensors, a Humanoid, ControllerManager, and associated motor joints.
 */
export const r15Character = freezeDeep({
	$className: "Model",
	tiltPart: force<{ $className: "Part"; BodyPosition: "BodyPosition" }>(),
	UpperTorso: force<typeof upperTorso & { ToolGrip: "Motor6D" }>(upperTorso),
	ControllerManager: force<{
		$className: "ControllerManager";
		AirController: "AirController";
		ClimbController: "ClimbController";
		GroundController: "GroundController";
	}>(),
	Humanoid: humanoid,
	Head: {
		$className: "MeshPart",
		Neck: "Motor6D",
		OriginalSize: "Vector3Value",
		FaceCenterAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		FaceFrontAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		HairAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		HatAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
		NeckRigAttachment: { $className: "Attachment", OriginalPosition: "Vector3Value" },
	},
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
	LowerTorso: { $className: "MeshPart", Root: "Motor6D", OriginalSize: "Vector3Value" },
	RightFoot: { $className: "MeshPart", RightAnkle: "Motor6D", OriginalSize: "Vector3Value" },
	RightHand: { $className: "MeshPart", RightWrist: "Motor6D", OriginalSize: "Vector3Value" },
	RightLowerArm: { $className: "MeshPart", RightElbow: "Motor6D", OriginalSize: "Vector3Value" },
	RightLowerLeg: { $className: "MeshPart", RightKnee: "Motor6D", OriginalSize: "Vector3Value" },
	RightUpperArm: {
		$className: "MeshPart",
		RightShoulder: "Motor6D",
		OriginalSize: "Vector3Value",
	},
	RightUpperLeg: { $className: "MeshPart", RightHip: "Motor6D", OriginalSize: "Vector3Value" },
} as const);
