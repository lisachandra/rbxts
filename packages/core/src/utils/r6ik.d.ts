import type { Character } from "shared/schemas";

/* eslint-disable ts/naming-convention -- Module is in PascalCase */
declare class R6IK {
	constructor(character: Character);

	public C0s: {
		["Left Hip"]: CFrame;
		["Left Shoulder"]: CFrame;
		["Right Hip"]: CFrame;
		["Right Shoulder"]: CFrame;
		["Root Hip"]: CFrame;
	};
	public C1s: {
		["Left Hip"]: CFrame;
		["Left Shoulder"]: CFrame;
		["Right Hip"]: CFrame;
		["Right Shoulder"]: CFrame;
		["Root Hip"]: CFrame;
	};
	public Motor6Ds: {
		["Left Hip"]: Motor6D;
		["Left Shoulder"]: Motor6D;
		["Right Hip"]: Motor6D;
		["Right Shoulder"]: Motor6D;
		["Root Hip"]: Motor6D;
	};
	public Part0s: {
		["Left Hip"]: N<BasePart>;
		["Left Shoulder"]: N<BasePart>;
		["Right Hip"]: N<BasePart>;
		["Right Shoulder"]: N<BasePart>;
		["Root Hip"]: N<BasePart>;
	};
	public Part1s: {
		["Left Hip"]: N<BasePart>;
		["Left Shoulder"]: N<BasePart>;
		["Right Hip"]: N<BasePart>;
		["Right Shoulder"]: N<BasePart>;
		["Root Hip"]: N<BasePart>;
	};

	public HumanoidRootPart: Motor6D;
	public Identifier: Instance;
	public LeftArm: Part;
	public LeftLeg: Part;
	public LeftLowerArmLength: number;
	public LeftLowerLegLength: number;
	public LeftUpperArmLength: number;
	public LeftUpperLegLength: number;
	public RightArm: Part;
	public RightLeg: Part;
	public RightLowerArmLength: number;
	public RightLowerLegLength: number;
	public RightUpperArmLength: number;
	public RightUpperLegLength: number;
	public Torso: Motor6D;
	public TorsoIK: boolean;

	public ArmIK(side: "Left" | "Right", position: Vector3): void;
	public LegIK(side: "Left" | "Right", position: Vector3): void;
}
/* eslint-enable ts/naming-convention */

export = R6IK;
